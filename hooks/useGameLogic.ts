import { localizeLegacySave, localizeLegacyState } from '../utils/localizeLegacySave';
import { sanitizeGameState } from '../utils/sanitizeGameState';
import { isLocalPreferenceKey, sharedSettingsEqual } from '../utils/localGamePreferences';
import { beginGameplayMutation, gameplayMutationCommitted, guardGameplayActions } from '../utils/gameplayMutationGate';
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
// FIX: Imported missing types to resolve multiple "Cannot find name" errors.
import { GameState, GameContext, ChatMessage, SaveFile, WorldState, GameSettings, Language, DBSaveSlotInfo, PlayerCharacter, Location, NPC, Faction, Wound, WorldStateFlag, UnlockedMemory, Effect, LocationStorage, Item, CompletedActivity, Cinematic, FactionRank, CinemaFrame, ImageCacheEntry, DayInfo, Month } from '../types';
import { useLocalization } from '../context/LocalizationContext';
import { GoogleGenAI, Modality } from "@google/genai";
import { getCinemaPrompt, getContinueCinemaPrompt } from '../prompts/cinemaPrompt';
import narrativeStyleGuide from '../prompts/narrativeStyleGuide.js';

import { formatError } from '../utils/errorUtils';

import { createTurnManager } from './logic/turn';
import { createSaveLoadManager } from './logic/saveLoad';
import { createInventoryActions } from './logic/inventoryActions';
import { createPlayerActionsManager } from './logic/playerActions';
import { createMusicManager } from './logic/music';
import { restorePlayerStats } from '../utils/restorePlayer';
import { cloneGameStateForEdit } from '../utils/gameStateClone';
import { migrateGameSettings } from '../utils/settingsMigration';
import { withLiveActivePlayer } from '../utils/partyView';
import { recalculateAllWeights } from '../utils/inventoryManager';
import { recalculateDerivedStats, calculateDate, calculateJourneyDay, ensureThreatActivityIds } from '../utils/gameContext';
import {
    clearCrashRecoveryMarker,
    getAutosaveTimestampFromDB,
    getCrashRecoveryMarker,
    getCrashRecoveryMetadata,
    loadCrashRecoveryPoint,
    markCrashDetected,
    markCrashRecoveryAttempt,
    saveCrashRecoveryPoint,
    loadInterruptedTurnRecovery,
    clearInterruptedTurnRecoveryIfUnchanged,
    listDBSlots,
    sweepUnusedImages,
} from '../utils/fileManager';
import type { CrashRecoveryMarker, CrashRecoveryMetadata, CrashRecoveryReason, InterruptedTurnRecovery } from '../utils/fileManager';
import { initializeAndPreviewSound, playNotificationSound } from '../utils/soundManager';
import { createNewPlayerCharacter } from '../utils/characterManager';
import { generateFactionColor } from '../utils/colorUtils';
import { executeCancellableJsonGeneration } from '../utils/gemini';
import { gameData } from '../utils/localizationGameData';
import { translate } from '../utils/localization';
import { cancelInterruptedArenaGmRequest, requestArenaGmImage } from '../utils/arenaGmRelay';
import { notifyError } from '../utils/notifications';



interface UseGameLogicProps {
    language: Language;
    setLanguage: (lang: Language) => void;
}

const isObject = (item: any): item is object => {
    return (item && typeof item === 'object' && !Array.isArray(item));
};

const asArray = <T>(value: T | T[] | null | undefined): T[] => {
    if (value === null || value === undefined) {
        return [];
    }
    if (Array.isArray(value)) {
        return value.filter(item => item !== null && item !== undefined);
    }
    return [value];
};

const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;



export function useGameLogic({ language, setLanguage }: UseGameLogicProps) {
    // Party transitions must change the active player, turn number and history
    // in one React update. Independent setters are still exposed to the rest of
    // the lifecycle, but share one ordered state queue.
    const [core, setCore] = useState<{ gameState: GameState | null; gameHistory: ChatMessage[]; turnNumber: number | null; partyRevision: number }>({ gameState: null, gameHistory: [], turnNumber: null, partyRevision: 0 });
    // Mirrors the committed core so a transition can be evaluated eagerly to learn
    // whether it would actually change anything.
    const coreRef = useRef(core);
    coreRef.current = core;
    const { gameState, gameHistory, turnNumber } = core;
    const _setGameState = useCallback((action: React.SetStateAction<GameState | null>) => setCore(previous => {
        const next = typeof action === 'function' ? action(previous.gameState) : action;
        return next === previous.gameState ? previous : { ...previous, gameState: next };
    }), []);
    const _setGameHistory = useCallback((action: React.SetStateAction<ChatMessage[]>) => setCore(previous => {
        const next = typeof action === 'function' ? action(previous.gameHistory) : action;
        return next === previous.gameHistory ? previous : { ...previous, gameHistory: next };
    }), []);
    const setTurnNumber = useCallback((action: React.SetStateAction<number | null>) => setCore(previous => {
        const next = typeof action === 'function' ? action(previous.turnNumber) : action;
        return next === previous.turnNumber ? previous : { ...previous, turnNumber: next };
    }), []);
    const gameStateRef = useRef(gameState);
    const gameplayMutationRevisionRef = useRef(0);
    const gameplayMutationAppliedRef = useRef(0);
    const stateMutationRevisionRef = useRef(0), stateMutationAppliedRef = useRef(0);
    const historyMutationRevisionRef = useRef(0), historyMutationAppliedRef = useRef(0);
    const gameplayMutationPendingRef = useRef(false);
    const [gameplayMutationEpoch, setGameplayMutationEpoch] = useState(0);
    const mutationMessageRef = useRef({ delivery: '' });
    const pendingPartyTransitionRef = useRef<{ revision: number } | null>(null);
    const contextEditRef = useRef({
        settings: { revision: 0, applied: 0, expected: null as GameSettings | null },
        instructions: { revision: 0, applied: 0, expected: '' },
        world: { revision: 0, applied: 0, expected: null as WorldState | null },
        map: { revision: 0, applied: 0, expected: {} as Record<string, Location> },
        visited: { revision: 0, applied: 0, expected: [] as Location[] },
        gameLog: { revision: 0, applied: 0, expected: [] as string[] },
        combatLog: { revision: 0, applied: 0, expected: [] as string[] }
    });
    const [contextEditEpoch, setContextEditEpoch] = useState(0);
    const contextEditGenerationRef = useRef(0);
    // Internal state updates (turn commits, restores, and presentation assets)
    // do not represent competing player edits.
    const setGameStateInternal = useCallback((action: React.SetStateAction<GameState | null>) => {
        _setGameState(previous => {
            const proposed = typeof action === 'function' ? action(previous) : action;
            const next = sanitizeGameState(proposed);
            gameStateRef.current = next;
            return next;
        });
    }, []);

    const setGameState = useCallback((action: React.SetStateAction<GameState | null>) => {
        const revision = beginGameplayMutation(gameplayMutationRevisionRef, gameplayMutationPendingRef);
        if (revision === null) {
            setError(mutationMessageRef.current.delivery);
            return;
        }
        stateMutationRevisionRef.current = revision;
        setGameStateInternal(previous => {
            try {
                const next = typeof action === 'function' ? action(previous) : action;
                return next;
            }
            finally {
                stateMutationAppliedRef.current = Math.max(stateMutationAppliedRef.current, revision);
                gameplayMutationAppliedRef.current = Math.max(gameplayMutationAppliedRef.current, revision);
            }
        });
        setGameplayMutationEpoch(epoch => epoch + 1);
        if (activeTurnRef.current && turnPhaseRef.current === 'generating') abortControllerRef.current?.abort();
    }, [setGameStateInternal]);

    const userGameplayActionBlocked = useCallback(() => false, []);
    const setPresentationState = setGameStateInternal;

    const [worldState, setWorldState] = useState<WorldState | null>(null);
    const [gameSettings, setGameSettings] = useState<GameSettings | null>(null);
    const [superInstructions, setSuperInstructions] = useState<string>('');
    // Separate context setters must invalidate authority before React can defer
    // them. Track each field independently so a partial commit cannot release
    // the hold. Local UI preference updates are intentionally not included.
    const beginSharedContextEdit = useCallback((field: 'settings' | 'instructions' | 'world' | 'map' | 'visited' | 'gameLog' | 'combatLog') => {
        const revision = beginGameplayMutation(gameplayMutationRevisionRef, gameplayMutationPendingRef);
        if (revision === null) throw new Error('Shared context mutation unexpectedly blocked');
        const entry = contextEditRef.current[field];
        const generation = contextEditGenerationRef.current;
        entry.revision = revision;
        if (activeTurnRef.current && turnPhaseRef.current === 'generating') abortControllerRef.current?.abort();
        return <T,>(value: T): T => {
            if (generation === contextEditGenerationRef.current) {
                if (revision >= entry.applied) {
                    entry.applied = revision;
                    (entry as unknown as { expected: T }).expected = value;
                }
                gameplayMutationAppliedRef.current = Math.max(gameplayMutationAppliedRef.current, revision);
                // A same-value update may bail out of rendering. Schedule a
                // post-updater commit check even in that case.
                queueMicrotask(() => setContextEditEpoch(epoch => epoch + 1));
            }
            return value;
        };
    }, []);
    const clearPendingContextEdits = useCallback(() => {
        contextEditGenerationRef.current++;
        const edits = contextEditRef.current;
        edits.settings.revision = edits.settings.applied = 0;
        edits.instructions.revision = edits.instructions.applied = 0;
        edits.world.revision = edits.world.applied = 0;
        edits.map.revision = edits.map.applied = 0;
        edits.visited.revision = edits.visited.applied = 0;
        edits.gameLog.revision = edits.gameLog.applied = 0;
        edits.combatLog.revision = edits.combatLog.applied = 0;
        // Other pending user edits have their own state/history commit checks.
        gameplayMutationAppliedRef.current = gameplayMutationRevisionRef.current;
        if (gameplayMutationPendingRef.current) setContextEditEpoch(epoch => epoch + 1);
    }, []);
    const gameHistoryRef = useRef(gameHistory);
    const setGameHistory = useCallback((action: React.SetStateAction<ChatMessage[]>) => {
        _setGameHistory(previous => {
            const next = typeof action === 'function' ? action(previous) : action;
            gameHistoryRef.current = next;
            return next;
        });
    }, []);
    const setUserGameHistory = useCallback((action: React.SetStateAction<ChatMessage[]>) => {
        const revision = beginGameplayMutation(gameplayMutationRevisionRef, gameplayMutationPendingRef);
        if (revision === null) { setError(mutationMessageRef.current.delivery); return; }
        historyMutationRevisionRef.current = revision;
        setGameHistory(previous => {
            try { return typeof action === 'function' ? action(previous) : action; }
            finally {
                historyMutationAppliedRef.current = Math.max(historyMutationAppliedRef.current, revision);
                gameplayMutationAppliedRef.current = Math.max(gameplayMutationAppliedRef.current, revision);
            }
        });
        setGameplayMutationEpoch(epoch => epoch + 1);
        if (activeTurnRef.current && turnPhaseRef.current === 'generating') abortControllerRef.current?.abort();
    }, [setGameHistory]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastJsonResponse, setLastJsonResponse] = useState<string | null>(null);
    const [lastRequestJson, setLastRequestJson] = useState<string | null>(null);
    const [gameLog, setGameLog] = useState<string[]>([]);
    const [combatLog, setCombatLog] = useState<string[]>([]);
    // User log clearing shares the same pre-commit authority barrier as other
    // gameplay edits. Independent media messages may prepend to its result.
    const setUserGameLog = useCallback((action: React.SetStateAction<string[]>) => {
        const applied = beginSharedContextEdit('gameLog');
        setGameLog(previous => applied(typeof action === 'function' ? action(previous) : action));
    }, [beginSharedContextEdit]);
    const setUserCombatLog = useCallback((action: React.SetStateAction<string[]>) => {
        const applied = beginSharedContextEdit('combatLog');
        setCombatLog(previous => applied(typeof action === 'function' ? action(previous) : action));
    }, [beginSharedContextEdit]);
    const setPresentationGameLog = useCallback((action: React.SetStateAction<string[]>) => {
        setGameLog(previous => {
            const next = typeof action === 'function' ? action(previous) : action;
            const pending = contextEditRef.current.gameLog;
            if (pending.revision !== 0 && pending.applied === pending.revision && previous === pending.expected) {
                pending.expected = next;
                queueMicrotask(() => setContextEditEpoch(epoch => epoch + 1));
            }
            return next;
        });
    }, []);
    const [sceneImagePrompt, setSceneImagePrompt] = useState<string | null>(null);
    const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
    const [worldMap, setWorldMap] = useState<Record<string, Location>>({});
    const [visitedLocations, setVisitedLocations] = useState<Location[]>([]);
    // These wrappers are only passed to guarded user actions. Turn/restore
    // setters keep their separate lifecycle and must not self-cancel.
    const setUserWorldState = useCallback((action: React.SetStateAction<WorldState | null>) => {
        const applied = beginSharedContextEdit('world');
        setWorldState(previous => applied(typeof action === 'function' ? action(previous) : action));
    }, [beginSharedContextEdit]);
    const setUserWorldMap = useCallback((action: React.SetStateAction<Record<string, Location>>) => {
        const applied = beginSharedContextEdit('map');
        setWorldMap(previous => applied(typeof action === 'function' ? action(previous) : action));
    }, [beginSharedContextEdit]);
    const setUserVisitedLocations = useCallback((action: React.SetStateAction<Location[]>) => {
        const applied = beginSharedContextEdit('visited');
        setVisitedLocations(previous => applied(typeof action === 'function' ? action(previous) : action));
    }, [beginSharedContextEdit]);
    const [autosaveTimestamp, setAutosaveTimestamp] = useState<string | null>(null);
    const [crashRecoveryInfo, setCrashRecoveryInfo] = useState<CrashRecoveryMetadata | null>(null);
    const [crashRecoveryMarker, setCrashRecoveryMarker] = useState<CrashRecoveryMarker | null>(null);
    const [interruptedTurnRecovery, setInterruptedTurnRecovery] = useState<InterruptedTurnRecovery | null>(null);
    const [dbSaveSlots, setDbSaveSlots] = useState<DBSaveSlotInfo[]>([]);
    const [musicPrompt, setMusicPrompt] = useState<string | null>(null);
    const [isMusicLoading, setIsMusicLoading] = useState(false);
    const [isMusicPlayerVisible, setIsMusicPlayerVisible] = useState(false);
    const previousMusicQueries = useRef<string[]>([]);

    const [isGeneratingCinema, setIsGeneratingCinema] = useState(false);
    const [cinemaGenerationProgress, setCinemaGenerationProgress] = useState({ current: 0, total: 0, message: '' });
    const [playingCinematic, setPlayingCinematic] = useState<Cinematic | null>(null);
    const [extendingCinematicId, setExtendingCinematicId] = useState<string | null>(null);

    const [lastTurnSaveFile, setLastTurnSaveFile] = useState<SaveFile | null>(null);

    const [currentStep, setCurrentStep] = useState<string | null>(null);
    const [currentModel, setCurrentModel] = useState<string | null>(null);
    const [turnTime, setTurnTime] = useState<number | null>(null);
    const turnStartTimeRef = useRef<number | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Increment synchronously before restoring a snapshot, even before React renders.
    const syncRevisionRef = useRef(0);
    const activeTurnRef = useRef<symbol | null>(null);
    const turnPhaseRef = useRef<'idle' | 'generating' | 'committed'>('idle');

    const wasLoadingRef = useRef(false);
    const isTurnSubmitPendingRef = useRef(false);


    const playerLevelRef = useRef<number | null>(null);

    useEffect(() => {
        if (wasLoadingRef.current && !isLoading) {
            if (gameSettings?.notificationSound) {
                playNotificationSound();
            }
        }
        wasLoadingRef.current = isLoading;
    }, [isLoading, gameSettings]);

    const { t } = useLocalization();
    mutationMessageRef.current = { delivery: t('game_state_updating') };
    const gameContextRef = useRef<GameContext | null>(null);

    // Unlike separate history/turn setters, this callback is pure inside the
    // React queue. A hold is acquired before scheduling and released only
    // after the matching composite update has committed.
    // Returns whether the transition produced a result that is now queued for commit.
    // Callers that own user input must not discard it when the transition is refused.
    // The transition is evaluated eagerly against the committed core so a no-op (an
    // invalid target, a stale index) reports `false` instead of claiming success.
    const setPartyTransition = useCallback((transition: (state: GameState | null, turn: number | null) => { gameState: GameState; turnNumber: number | null; message: ChatMessage } | null): boolean => {
        if (pendingPartyTransitionRef.current) { setError(mutationMessageRef.current.delivery); return false; }
        const base = coreRef.current;
        const outcome = transition(base.gameState, base.turnNumber);
        if (!outcome) return false;
        const revision = beginGameplayMutation(gameplayMutationRevisionRef, gameplayMutationPendingRef);
        if (revision === null) { setError(mutationMessageRef.current.delivery); return false; }
        stateMutationRevisionRef.current = revision;
        historyMutationRevisionRef.current = revision;
        pendingPartyTransitionRef.current = { revision };
        setCore(previous => {
            // Reuse the eager result unless the committed core moved underneath us.
            const result = previous.gameState === base.gameState && previous.turnNumber === base.turnNumber
                ? outcome
                : transition(previous.gameState, previous.turnNumber);
            if (!result) return { ...previous, partyRevision: revision };
            const state = sanitizeGameState(result.gameState);
            return { ...previous, gameState: state, gameHistory: [...previous.gameHistory, result.message], turnNumber: result.turnNumber, partyRevision: revision };
        });
        setGameplayMutationEpoch(epoch => epoch + 1);
        if (activeTurnRef.current && turnPhaseRef.current === 'generating') abortControllerRef.current?.abort();
        return true;
    }, []);

    useEffect(() => {
        const pending = pendingPartyTransitionRef.current;
        if (!pending || core.partyRevision !== pending.revision) return;
        // These refs are published from the committed render, never from a
        // speculative invocation of the party transition reducer.
        gameStateRef.current = gameState;
        gameHistoryRef.current = gameHistory;
        stateMutationAppliedRef.current = Math.max(stateMutationAppliedRef.current, pending.revision);
        historyMutationAppliedRef.current = Math.max(historyMutationAppliedRef.current, pending.revision);
        gameplayMutationAppliedRef.current = Math.max(gameplayMutationAppliedRef.current, pending.revision);
        pendingPartyTransitionRef.current = null;
    }, [core.partyRevision, gameState, gameHistory]);

    useEffect(() => {
        const contextEdits = contextEditRef.current;
        const settingsCommitted = contextEdits.settings.applied === contextEdits.settings.revision &&
            (contextEdits.settings.revision === 0 || sharedSettingsEqual(gameSettings, contextEdits.settings.expected));
        const instructionsCommitted = contextEdits.instructions.applied === contextEdits.instructions.revision &&
            (contextEdits.instructions.revision === 0 || superInstructions === contextEdits.instructions.expected);
        const worldCommitted = contextEdits.world.applied === contextEdits.world.revision &&
            (contextEdits.world.revision === 0 || worldState === contextEdits.world.expected);
        const mapCommitted = contextEdits.map.applied === contextEdits.map.revision &&
            (contextEdits.map.revision === 0 || worldMap === contextEdits.map.expected);
        const visitedCommitted = contextEdits.visited.applied === contextEdits.visited.revision &&
            (contextEdits.visited.revision === 0 || visitedLocations === contextEdits.visited.expected);
        const gameLogCommitted = contextEdits.gameLog.applied === contextEdits.gameLog.revision &&
            (contextEdits.gameLog.revision === 0 || gameLog === contextEdits.gameLog.expected);
        const combatLogCommitted = contextEdits.combatLog.applied === contextEdits.combatLog.revision &&
            (contextEdits.combatLog.revision === 0 || combatLog === contextEdits.combatLog.expected);
        if (!pendingPartyTransitionRef.current && settingsCommitted && instructionsCommitted && worldCommitted && mapCommitted && visitedCommitted && gameLogCommitted && combatLogCommitted && gameHistoryRef.current === gameHistory &&
            stateMutationAppliedRef.current === stateMutationRevisionRef.current &&
            historyMutationAppliedRef.current === historyMutationRevisionRef.current) {
            if (gameplayMutationCommitted(gameplayMutationPendingRef, gameplayMutationAppliedRef,
                gameplayMutationRevisionRef, gameState, gameStateRef.current)) {
                contextEditGenerationRef.current++;
                contextEdits.settings.revision = contextEdits.settings.applied = 0;
                contextEdits.instructions.revision = contextEdits.instructions.applied = 0;
                contextEdits.world.revision = contextEdits.world.applied = 0;
                contextEdits.map.revision = contextEdits.map.applied = 0;
                contextEdits.visited.revision = contextEdits.visited.applied = 0;
                contextEdits.gameLog.revision = contextEdits.gameLog.applied = 0;
                contextEdits.combatLog.revision = contextEdits.combatLog.applied = 0;

            }
        }
    }, [gameState, gameHistory, gameSettings, superInstructions, worldState, worldMap, visitedLocations, gameLog, combatLog, gameplayMutationEpoch, contextEditEpoch, core.partyRevision]);

    useEffect(() => {
        if (gameState) {
            playerLevelRef.current = gameState.playerCharacter.level;

        }
    }, [gameState]);

    useEffect(() => {
        if (!gameState) {
            playerLevelRef.current = null;
            return;
        }

        const currentLevel = gameState.playerCharacter.level;
        const previousLevel = playerLevelRef.current;

        if (typeof currentLevel === 'number' && previousLevel !== currentLevel) {
            playerLevelRef.current = currentLevel;
        }

        if (previousLevel !== null && typeof currentLevel === 'number' && currentLevel > previousLevel) {
            console.log(`Level up detected! From ${previousLevel} to ${currentLevel}. Scaling quest rewards.`);

            const newExpForNextLevel = gameState.playerCharacter.experienceForNextLevel;
            const meaningfulRewardThreshold = newExpForNextLevel * 0.1;

            setGameState(currentGameState => {
                if (!currentGameState) return null;

                let questsWereUpdated = false;
                const newLogs: string[] = [];

                const updatedActiveQuests = currentGameState.activeQuests.map(quest => {
                    if (quest.rewards?.experience && quest.rewards.experience < meaningfulRewardThreshold) {
                        const oldReward = quest.rewards.experience;
                        const newReward = Math.floor(meaningfulRewardThreshold);
                        if (oldReward < newReward) { // Only scale up
                            questsWereUpdated = true;
                            const logMessage = t('quest_reward_scaled_for_danger', {
                              name: quest.questName,
                              old: oldReward,
                              new: newReward
                            });
                            newLogs.push(logMessage);

                            const newRewards = { ...quest.rewards, experience: newReward };
                            return { ...quest, rewards: newRewards };
                        }
                    }
                    return quest;
                });

                if (questsWereUpdated) {
                    setPresentationGameLog(currentLog => [...newLogs, ...currentLog]);
                    return {
                        ...currentGameState,
                        activeQuests: updatedActiveQuests
                    };
                }

                return currentGameState;
            });
        }
    }, [gameState, setGameState, setPresentationGameLog, t]);

    useEffect(() => {
        // This effect is the SINGLE SOURCE OF TRUTH for synchronizing all relevant states to gameContextRef.
        if (gameContextRef.current) {
            if (gameState) {
                gameContextRef.current.playerCharacter = gameState.playerCharacter;
                // The roster slot of the active character lags behind playerCharacter
                // between turns; the GM prompt treats `players` as the party snapshot.
                gameContextRef.current.players = withLiveActivePlayer(gameState.players, gameState.playerCharacter);
                gameContextRef.current.encounteredNPCs = gameState.encounteredNPCs;
                gameContextRef.current.encounteredFactions = gameState.encounteredFactions;
                gameContextRef.current.activeQuests = gameState.activeQuests;
                gameContextRef.current.completedQuests = gameState.completedQuests;
                gameContextRef.current.worldStateFlags = gameState.worldStateFlags;
                gameContextRef.current.worldEventsLog = gameState.worldEventsLog;
                gameContextRef.current.playerCustomStates = gameState.playerCustomStates;
            }
            if (gameSettings) {
                gameContextRef.current.gameSettings = gameSettings;
            }
            if (typeof superInstructions === 'string') {
                gameContextRef.current.superInstructions = superInstructions;
            }
            if (worldState) {
                gameContextRef.current.worldState = worldState;
            }
            // Manual party passes advance the turn counter without a GM turn, so
            // the persisted/GM-visible counter must follow the displayed one.
            if (typeof turnNumber === 'number') {
                gameContextRef.current.currentTurnNumber = turnNumber;
            }
        }
    }, [gameState, gameSettings, superInstructions, worldState, turnNumber]);

    const restoreFromSaveData = useCallback((source: SaveFile) => {
        const data = localizeLegacySave(source);
        // Old saves keep the pre-single-player settings key; rename it before it is used.
        if (data.gameContext?.gameSettings) {
            data.gameContext.gameSettings = migrateGameSettings(data.gameContext.gameSettings);
        }
        syncRevisionRef.current += 1;
        clearPendingContextEdits();
        if (activeTurnRef.current) abortControllerRef.current?.abort();
        // --- BACKWARD COMPATIBILITY MIGRATION FOR EVENT LOGS ---
        const migrateLocationEvents = (loc: any) => {
            if (loc && loc.lastEventsDescription && typeof loc.lastEventsDescription === 'string' && !loc.eventDescriptions) {
                console.warn(`Migrating old 'lastEventsDescription' for location: ${loc.name || loc.locationId}`);
                loc.eventDescriptions = loc.lastEventsDescription.split('\n\n').filter((e: string) => e.trim()).reverse();
                delete loc.lastEventsDescription;
            }
        };

        migrateLocationEvents(data.gameContext?.currentLocation);
        if (data.gameContext?.worldMap) {
            Object.values(data.gameContext.worldMap).forEach(migrateLocationEvents);
        }
        if (data.gameContext?.visitedLocations) {
            data.gameContext.visitedLocations.forEach(migrateLocationEvents);
        }
        if (data.gameState?.currentLocationData) {
            migrateLocationEvents(data.gameState.currentLocationData);
        }
        // --- END EVENT LOG MIGRATION ---

        // --- BACKWARD COMPATIBILITY MIGRATION FOR DIFFICULTY PROFILES ---
        const migrateDifficultyProfile = (obj: any) => {
            if (obj && obj.difficultyProfile && !obj.internalDifficultyProfile) {
                console.warn(`Migrating old 'difficultyProfile' for: ${obj.name || obj.locationId}`);
                obj.internalDifficultyProfile = JSON.parse(JSON.stringify(obj.difficultyProfile));
                obj.externalDifficultyProfile = JSON.parse(JSON.stringify(obj.difficultyProfile));
                delete obj.difficultyProfile;
            }
        };
        const migrateAdjacencyMap = (adjMap: any[] | undefined) => {
            if (!adjMap) return;
            adjMap.forEach((link: any) => {
                if (link && link.estimatedDifficultyProfile && !link.estimatedInternalDifficultyProfile) {
                    console.warn(`Migrating old 'estimatedDifficultyProfile' for link: ${link.name}`);
                    link.estimatedInternalDifficultyProfile = JSON.parse(JSON.stringify(link.estimatedDifficultyProfile));
                    link.estimatedExternalDifficultyProfile = JSON.parse(JSON.stringify(link.estimatedDifficultyProfile));
                    delete link.estimatedDifficultyProfile;
                }
            });
        };

        // Migrate all locations
        const allLocationsToMigrate = [
            data.gameContext?.currentLocation,
            ...(Object.values(data.gameContext?.worldMap || {})),
            ...(data.gameContext?.visitedLocations || [])
        ].filter(Boolean);

        allLocationsToMigrate.forEach(loc => {
            migrateDifficultyProfile(loc);
            migrateAdjacencyMap(loc.adjacencyMap);
        });

        // Migrate worldMapUpdates in previousTurnResponse
        const worldMapUpdates = data.gameContext?.previousTurnResponse?.worldMapUpdates;
        if (worldMapUpdates) {
            asArray(worldMapUpdates.locationUpdates).forEach((update: any) => {
                if (update && update.newDifficultyProfile && !update.newInternalDifficultyProfile) {
                    update.newInternalDifficultyProfile = JSON.parse(JSON.stringify(update.newDifficultyProfile));
                    update.newExternalDifficultyProfile = JSON.parse(JSON.stringify(update.newDifficultyProfile));
                    delete update.newDifficultyProfile;
                }
            });
            asArray(worldMapUpdates.newLocations).forEach((newLoc: any) => {
                migrateDifficultyProfile(newLoc);
            });
        }
        // --- END MIGRATION ---

        // --- EXPERIENCE MIGRATION ---
        const experienceForLevelTransition = (level: number): number => {
            if (level < 1) return 100;
            const baseXP = 100;
            return Math.floor(baseXP * Math.pow(level, 2.5));
        };

        const migrateExperience = <T extends PlayerCharacter | NPC>(character: T): T => {
            if (!character || typeof character.level !== 'number' || character.level < 1) {
                return character;
            }

            const currentExperience = Number(character.experience) || 0;
            const currentExpForNextLevel = Number(character.experienceForNextLevel) || 0;

            const correctExpForNextLevel = experienceForLevelTransition(character.level);

            if (currentExpForNextLevel > 0 && currentExpForNextLevel !== correctExpForNextLevel) {
                console.warn(`Migrating experience for ${character.name} (Lvl ${character.level}). Old next level XP: ${currentExpForNextLevel}, New: ${correctExpForNextLevel}`);

                const oldProportion = currentExperience / currentExpForNextLevel;
                const newExperience = Math.floor(correctExpForNextLevel * oldProportion);

                character.experience = newExperience;
                character.experienceForNextLevel = correctExpForNextLevel;
            } else if (currentExpForNextLevel === 0 && correctExpForNextLevel > 0 && character.level > 0) {
                character.experienceForNextLevel = correctExpForNextLevel;
            }
            return character;
        };
        // --- END EXPERIENCE MIGRATION ---

        // --- LOCATION STORAGE ID MIGRATION ---
        const fixStorageIdsInLocation = (loc: Location | undefined | null): void => {
            if (!loc || !loc.locationStorages) return;
            loc.locationStorages = loc.locationStorages.map(storage => {
                if (storage && !storage.storageId) {
                    console.warn(`Found a location storage named "${storage.name}" without a storageId. Generating a new one.`);
                    return { ...storage, storageId: generateId('storage') };
                }
                return storage;
            }).filter((s): s is LocationStorage => !!s);
        };

        fixStorageIdsInLocation(data.gameContext?.currentLocation);
        if (data.gameContext?.worldMap) {
            Object.values(data.gameContext.worldMap).forEach(fixStorageIdsInLocation);
        }
        if (data.gameContext?.visitedLocations) {
            data.gameContext.visitedLocations.forEach(fixStorageIdsInLocation);
        }
        if (data.gameState?.currentLocationData) {
            fixStorageIdsInLocation(data.gameState.currentLocationData);
        }
        // --- END LOCATION STORAGE ID MIGRATION ---

        // --- FACTION RANK MIGRATION ---
        const migrateFactionRanks = (faction: Partial<Faction> | undefined | null) => {
            if (faction && (faction as any).ranks && Array.isArray((faction as any).ranks)) {
                console.warn(`Migrating old array-based rank structure for faction: ${faction.name}`);
                const oldRanks = (faction as any).ranks as FactionRank[];
                faction.ranks = {
                    branches: [
                        {
                            branchId: 'core',
                            displayName: t('core_path_name'),
                            isCoreBranch: true,
                            ranks: oldRanks
                        }
                    ]
                };
            }
        };

        if (data.gameState?.encounteredFactions) {
            data.gameState.encounteredFactions.forEach(migrateFactionRanks);
        }
        if (data.gameContext?.encounteredFactions) {
            data.gameContext.encounteredFactions.forEach(migrateFactionRanks);
        }
        if (data.gameContext?.previousTurnResponse?.factionDataChanges) {
            data.gameContext.previousTurnResponse.factionDataChanges.forEach(migrateFactionRanks);
        }
        // --- END FACTION RANK MIGRATION ---

        let loadedSettings = data.gameContext.gameSettings;
        const loadedLanguage = loadedSettings.language || 'en';
        setLanguage(loadedLanguage);

        // --- CALENDAR MIGRATION AND LOCALIZATION ---
        if (loadedSettings.gameWorldInformation && loadedSettings.gameWorldInformation.calendar) {
            const calendar = loadedSettings.gameWorldInformation.calendar;

            let baseCalendarTemplate =
                loadedSettings.gameWorldInformation.baseInfo?.calendar ||
                calendar ||
                gameData.fantasy.calendar;

            // MIGRATION FOR OLD dayNames FORMAT (string[] instead of DayInfo[])
            // This now runs on the chosen template, ensuring consistency.
            if (baseCalendarTemplate.dayNames && baseCalendarTemplate.dayNames.length > 0 && typeof baseCalendarTemplate.dayNames[0] === 'string') {
                console.warn("Migrating old calendar dayNames format from string[] to DayInfo[].");

                const isFantasyCalendar = baseCalendarTemplate.months && baseCalendarTemplate.months[0] && (baseCalendarTemplate.months[0].name === 'Месяц Начал' || baseCalendarTemplate.months[0].name === 'fantasy_month_1_name');

                if (isFantasyCalendar) {
                    console.log("Fantasy calendar detected. Restoring day names with descriptions.");
                    baseCalendarTemplate.dayNames = gameData.fantasy.calendar.dayNames;
                } else {
                    console.log("Standard calendar detected. Converting day names to object format.");
                    baseCalendarTemplate.dayNames = (baseCalendarTemplate.dayNames as unknown as string[]).map((dayName: string) => ({ name: dayName, description: '' }));
                }
            }

            const localizedCalendar = JSON.parse(JSON.stringify(baseCalendarTemplate));
            localizedCalendar.months = localizedCalendar.months.map((month: Month) => ({ ...month, name: translate(loadedLanguage, month.name), description: month.description ? translate(loadedLanguage, month.description) : '' }));
            localizedCalendar.dayNames = localizedCalendar.dayNames.map((day: DayInfo) => ({ ...day, name: translate(loadedLanguage, day.name), description: day.description ? translate(loadedLanguage, day.description) : '' }));

            loadedSettings.gameWorldInformation.calendar = localizedCalendar;

            if (data.gameContext.worldState) {
                const totalMinutes = data.gameContext.worldState.currentTimeInMinutes;
                data.gameContext.worldState.date = calculateDate(totalMinutes, localizedCalendar);
                // FIX: Recalculate 'day' to ensure it's in sync with 'currentTimeInMinutes'.
                // This resolves inconsistencies from older save files where these two values could diverge.
                // Use helper for consistent day calculation
                data.gameContext.worldState.day = calculateJourneyDay(totalMinutes, data.gameContext.worldState.campaignStartTimeInMinutes);
            }
        } else if (loadedSettings.gameWorldInformation) {
            console.warn("Save data missing calendar, adding default.");
            loadedSettings.gameWorldInformation.calendar = gameData.fantasy.calendar;
        }

        // Strip provider, model, search, and image-pipeline settings from legacy saves.
        const legacyAISettings = loadedSettings as GameSettings & Record<string, unknown>;
        [
            'modelName', 'correctionModelName', 'aiProvider', 'isCustomModel', 'customModelName',
            'openRouterModelName', 'openRouterApiKey', 'geminiThinkingBudget', 'geminiThinkingLevel',
            'useDynamicThinkingBudget', 'geminiApiKey', 'useGoogleSearch', 'imageGenerationModelPipeline',
            'pollinationsImageModel', 'useNanoBananaFallback', 'useNanoBananaPrimary',
        ].forEach(key => delete legacyAISettings[key]);
        loadedSettings.showImageSourceInfo = false;

        ensureThreatActivityIds(data.gameContext.worldMap || {}, data.gameContext.currentLocation);
        ensureThreatActivityIds(data.gameContext.worldMap || {}, data.gameState?.currentLocationData);
        gameContextRef.current = data.gameContext;
        let loadedGameState = data.gameState;

        // --- APPLY EXPERIENCE MIGRATION ---
        if (loadedGameState.playerCharacter) {
            loadedGameState.playerCharacter = migrateExperience(loadedGameState.playerCharacter);
        }
        if (loadedGameState.players) {
            loadedGameState.players = loadedGameState.players.map(p => p ? migrateExperience(p) : p).filter((p): p is PlayerCharacter => !!p);
        }
        if (loadedGameState.encounteredNPCs) {
            loadedGameState.encounteredNPCs = loadedGameState.encounteredNPCs.map(npc => npc ? migrateExperience(npc) : npc).filter((n): n is NPC => !!n);
        }
        // --- END APPLY EXPERIENCE MIGRATION ---

        if (loadedGameState.playerCharacter && !loadedGameState.playerCharacter.playerId) {
            console.warn("Loaded playerCharacter is missing a playerId. Generating a new one.");
            loadedGameState.playerCharacter.playerId = generateId('player');
        }

        if (loadedGameState.players) {
            loadedGameState.players = loadedGameState.players.map(p => {
                if (p && !p.playerId) {
                    console.warn(`Loaded player in players array (name: ${p.name}) is missing a playerId. Generating a new one.`);
                    return { ...p, playerId: generateId('player') };
                }
                return p;
            }).filter((p): p is PlayerCharacter => !!p);
        }

        const fixTextContentInInventory = (inventory?: Item[]): Item[] | undefined => {
            if (!Array.isArray(inventory)) return inventory;
            return inventory.map(item => {
                if (item && typeof item.textContent === 'string') {
                    return { ...item, textContent: [item.textContent] };
                }
                return item;
            }).filter((i): i is Item => !!i);
        };

        const processCharacterInventories = <T extends PlayerCharacter | NPC>(characters: T[]): T[] => {
            if (!Array.isArray(characters)) return characters;
            return characters.map(c => {
                if (c) {
                    c.inventory = fixTextContentInInventory(c.inventory) || [];
                }
                return c;
            });
        };

        if (loadedGameState.playerCharacter) {
            loadedGameState.playerCharacter.inventory = fixTextContentInInventory(loadedGameState.playerCharacter.inventory) || [];
        }
        if (loadedGameState.players) {
            loadedGameState.players = processCharacterInventories(loadedGameState.players);
        }
        if (loadedGameState.encounteredNPCs) {
            loadedGameState.encounteredNPCs = processCharacterInventories(loadedGameState.encounteredNPCs);
        }
        if (loadedGameState.temporaryStash) {
            loadedGameState.temporaryStash = fixTextContentInInventory(loadedGameState.temporaryStash);
        }

        if (!loadedGameState.imageCache) {
            loadedGameState.imageCache = {};
        } else {
            // MIGRATION LOGIC FOR imageCache
            const firstValue = Object.values(loadedGameState.imageCache)[0];
            if (typeof firstValue === 'string' || !firstValue?.src) { // Check if it's old format
                console.warn("Migrating old imageCache format.");
                const newCache: Record<string, ImageCacheEntry> = {};
                for (const key in loadedGameState.imageCache) {
                    const value = (loadedGameState.imageCache as any)[key];
                    if (typeof value === 'string') {
                        newCache[key] = {
                            src: value,
                            sourceProvider: key.startsWith('custom-') ? 'Custom Upload' : 'Imagen',
                            sourceModel: key.startsWith('custom-') ? undefined : 'imagen-4.0-generate-001'
                        };
                    }
                }
                loadedGameState.imageCache = newCache as any;
            }
        }

        if (!loadedGameState.cinematics) {
            loadedGameState.cinematics = [];
        }

        const originalFlags = loadedGameState.worldStateFlags;
        let processedFlags: WorldStateFlag[] = [];
        if (originalFlags) {
            if (Array.isArray(originalFlags)) {
                processedFlags = originalFlags;
            } else if (typeof originalFlags === 'object') {
                processedFlags = Object.keys(originalFlags).map(key => {
                    const flagData = (originalFlags as any)[key];
                    if (isObject(flagData) && !(flagData as any).flagId) {
                        return { ...flagData, flagId: key };
                    }
                    return flagData;
                }).filter((f): f is WorldStateFlag => isObject(f));
            }
        }
        loadedGameState.worldStateFlags = processedFlags;

        if (loadedGameState.encounteredNPCs) {
            loadedGameState.encounteredNPCs = loadedGameState.encounteredNPCs.map(npc => {
                if (!npc || !npc.characteristics) {
                    return npc;
                }
                if (!npc.tags) {
                    npc.tags = [];
                }
                let updatedNpc = recalculateDerivedStats(npc);
                updatedNpc = recalculateAllWeights(updatedNpc);
                if (updatedNpc.totalWeight !== undefined && updatedNpc.maxWeight !== undefined) {
                    updatedNpc.isOverloaded = updatedNpc.totalWeight > updatedNpc.maxWeight;
                } else {
                    updatedNpc.isOverloaded = false;
                }
                if (updatedNpc.criticalExcessWeight === undefined) {
                    updatedNpc.criticalExcessWeight = 15;
                }
                return updatedNpc;
            }).filter(isObject) as NPC[];
        }

        if (loadedGameState.encounteredFactions) {
            loadedGameState.encounteredFactions = loadedGameState.encounteredFactions.map(faction => {
                if (faction && !faction.color) {
                    return { ...faction, color: generateFactionColor(faction.factionId || faction.name) };
                }
                return faction;
            }).filter(isObject) as Faction[];
        }

        if (!loadedGameState.players || !Array.isArray(loadedGameState.players) || loadedGameState.players.length === 0) {
            loadedGameState.players = [loadedGameState.playerCharacter];
        }
        if (!Number.isSafeInteger(loadedGameState.activePlayerIndex) || loadedGameState.activePlayerIndex < 0 || loadedGameState.activePlayerIndex >= loadedGameState.players.length) {
            loadedGameState.activePlayerIndex = 0;
        }

        const levelUpLogs = restorePlayerStats(loadedGameState, t);
        let finalGameLog = data.gameLog || [];
        if (levelUpLogs.length > 0) {
            finalGameLog = [...finalGameLog, ...levelUpLogs];
        }

        if (loadedSettings.keepLatestNpcJournals === undefined) {
            loadedSettings.keepLatestNpcJournals = false;
        }
        if (loadedSettings.latestNpcJournalsCount === undefined) {
            loadedSettings.latestNpcJournalsCount = 20;
        }
        if (loadedSettings.cooperativeGameType === undefined) {
            loadedSettings.cooperativeGameType = 'None';
        }
        if (loadedSettings.doNotUseWorldEvents === undefined) {
            loadedSettings.doNotUseWorldEvents = false;
        }

        loadedGameState = sanitizeGameState(loadedGameState)!;
        const restoredCombatLog = data.combatLog ?? [];
        const restoredWorldMap = data.gameContext.worldMap ?? {};
        const restoredVisitedLocations = data.gameContext.visitedLocations ?? [];
        const restored = { ...data, gameState: loadedGameState, gameLog: finalGameLog, combatLog: restoredCombatLog,
            // The live context ref is synchronized by effects and must not
            // mutate the commit barrier's expected values before comparison.
            gameContext: { ...data.gameContext, gameSettings: { ...loadedSettings },
                superInstructions: data.gameContext.superInstructions || '', worldMap: restoredWorldMap,
                visitedLocations: restoredVisitedLocations } };
        setGameStateInternal(loadedGameState);
        setWorldState(data.gameContext.worldState);
        setGameSettings(loadedSettings);
        setSuperInstructions(data.gameContext.superInstructions || '');
        setGameHistory(data.gameHistory as ChatMessage[]);
        setGameLog(finalGameLog);
        setCombatLog(restoredCombatLog);
        setLastJsonResponse(data.lastJsonResponse);
        setSceneImagePrompt(data.sceneImagePrompt);
        setWorldMap(restoredWorldMap);
        setVisitedLocations(restoredVisitedLocations);
        setTurnNumber(data.gameContext.currentTurnNumber);
        setIsLoading(false);
        setError(null);
        return restored;

    }, [clearPendingContextEdits, setLanguage, t, setGameState, setWorldState, setGameSettings, setSuperInstructions, setGameHistory, setGameLog, setCombatLog, setLastJsonResponse, setSceneImagePrompt, setWorldMap, setVisitedLocations, setTurnNumber, setIsLoading, setError, language]);

    const abortControllerRef = useRef<AbortController | null>(null);
    const lastSavedTurnRef = useRef<number | null>(null);

    const onImageGenerated = useCallback((cacheKey: string, src: string, sourceProvider: ImageCacheEntry['sourceProvider'], sourceModel?: string) => {
        setPresentationState(prev => {
            if (!prev) return null;
            const newCacheEntry: ImageCacheEntry = { src, sourceProvider, sourceModel };
            const newCache = { ...(prev.imageCache || {}), [cacheKey]: newCacheEntry };
            return { ...prev, imageCache: newCache };
        });
    }, [setPresentationState]);

    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                const ts = await getAutosaveTimestampFromDB();
                setAutosaveTimestamp(ts);
                setCrashRecoveryInfo(getCrashRecoveryMetadata());
                setCrashRecoveryMarker(getCrashRecoveryMarker());
                const interruptedTurn = await loadInterruptedTurnRecovery();
                if (interruptedTurn) setInterruptedTurnRecovery(interruptedTurn);
                // Database slots are offered on the start screen, so read them before
                // the game begins instead of only after the first save or delete.
                setDbSaveSlots(await listDBSlots());
            } catch (e) {
                console.error("Failed to fetch initial save data from DB", e);
            }
        };
        fetchInitialData();
    }, []);

    const addPlayer = useCallback((creationData: PlayerCharacter | any) => {
        if (!gameSettings || userGameplayActionBlocked()) return;
        const newPlayer: PlayerCharacter = creationData.playerId ? creationData : createNewPlayerCharacter(
            creationData, gameSettings, {
                partyLevel: gameStateRef.current?.playerCharacter.level || 1,
                shareCharacteristics: gameSettings.multiplePersonalitiesSettings?.shareCharacteristics ?? false,
                templatePlayer: creationData.templatePlayer
            });
        setGameState(prev => {
            if (!prev) return prev;
            const players = [...prev.players];
            if (Number.isSafeInteger(prev.activePlayerIndex) && prev.activePlayerIndex >= 0 && prev.activePlayerIndex < players.length) {
                players[prev.activePlayerIndex] = prev.playerCharacter;
            }
            return { ...prev, players: [...players, newPlayer] };
        });
        setGameHistory(prev => [...prev, { sender: 'system', content: t('player_joined', { name: newPlayer.name }) }]);
    }, [gameSettings, t, setGameState, setGameHistory, userGameplayActionBlocked]);

    const removePlayer = useCallback((playerIdToRemove: string): boolean => {
        if (userGameplayActionBlocked()) return false;
        const current = gameStateRef.current;
        const matches = current?.players?.filter(p => p?.playerId === playerIdToRemove) || [];
        if (!playerIdToRemove || matches.length !== 1) {
            setError(t('player_remove_identity_conflict'));
            return false;
        }
        return setPartyTransition((prevState, currentTurnNumber) => {
            if (!prevState || prevState.players.length <= 1 || !Number.isSafeInteger(prevState.activePlayerIndex) ||
                prevState.activePlayerIndex < 0 || prevState.activePlayerIndex >= prevState.players.length) return null;

            const targets = prevState.players.filter(p => p?.playerId === playerIdToRemove);
            if (targets.length !== 1) return null;
            const playerToRemove = targets[0];
            const synchronizedPlayers = [...prevState.players];
            synchronizedPlayers[prevState.activePlayerIndex] = prevState.playerCharacter;
            const newPlayers = synchronizedPlayers.filter(p => p.playerId !== playerIdToRemove);
            let newActivePlayerIndex = prevState.activePlayerIndex;
            const removedPlayerIndex = prevState.players.findIndex(p => p.playerId === playerIdToRemove);

            if (removedPlayerIndex < newActivePlayerIndex) newActivePlayerIndex--;
            else if (removedPlayerIndex === newActivePlayerIndex || newActivePlayerIndex >= newPlayers.length) newActivePlayerIndex = 0;
            newActivePlayerIndex = Math.max(0, Math.min(newPlayers.length - 1, newActivePlayerIndex));
            const newPc = newPlayers[newActivePlayerIndex];

            const newState = { ...prevState, players: newPlayers, activePlayerIndex: newActivePlayerIndex, playerCharacter: newPc };
            const systemMessage: ChatMessage = { sender: 'system', content: t('player_removed', { name: playerToRemove.name }) };
            return { gameState: newState, turnNumber: currentTurnNumber, message: systemMessage };
        });
    }, [t, setPartyTransition, userGameplayActionBlocked]);

    const passTurnToPlayer = useCallback((targetPlayerIndex: number): boolean => {
        return setPartyTransition((prevState, currentTurnNumber) => {
            if (!prevState || !gameSettings) return null;
            if (targetPlayerIndex === prevState.activePlayerIndex) return null;

            if (!Array.isArray(prevState.players) || !Number.isSafeInteger(targetPlayerIndex) ||
                targetPlayerIndex < 0 || targetPlayerIndex >= prevState.players.length ||
                !Number.isSafeInteger(prevState.activePlayerIndex) || prevState.activePlayerIndex < 0 ||
                prevState.activePlayerIndex >= prevState.players.length || !prevState.players[targetPlayerIndex]) {
                console.error(`Invalid targetPlayerIndex: ${targetPlayerIndex}`);
                return null;
            }

            const playerIds = new Set();
            for (const player of prevState.players) {
                if (!player || !player.playerId || playerIds.has(player.playerId)) {
                    console.error(`Missing or duplicate playerId detected before turn pass: ${player?.playerId}`);
                    return null;
                }
                playerIds.add(player.playerId);
            }

            const nextGameState = cloneGameStateForEdit(prevState);

            const currentActivePlayerIndex = nextGameState.activePlayerIndex;
            const outgoingPlayerSnapshot = nextGameState.players[currentActivePlayerIndex];
            if (!outgoingPlayerSnapshot) {
                console.error(`No player found at current active index: ${currentActivePlayerIndex}`);
                return null;
            }

            const outgoingPlayerCharacterState = { ...nextGameState.playerCharacter };
            let updatedOutgoingSnapshot = { ...outgoingPlayerSnapshot, ...outgoingPlayerCharacterState };

            if (gameSettings.cooperativeGameType === 'MultiplePersonalities' && !gameSettings.multiplePersonalitiesSettings?.shareNpcReputation) {
                updatedOutgoingSnapshot.personalNpcReputations = nextGameState.encounteredNPCs.map((npc: NPC) => ({
                    NPCId: npc.NPCId,
                    relationshipLevel: npc.relationshipLevel,
                    isCompanion: npc.progressionType === 'Companion',
                }));
            }
            if (gameSettings.cooperativeGameType === 'MultiplePersonalities' && !gameSettings.multiplePersonalitiesSettings?.shareFactionReputation) {
                updatedOutgoingSnapshot.personalFactionReputations = nextGameState.encounteredFactions.map((faction: Faction) => ({
                    factionId: faction.factionId,
                    reputation: faction.reputation,
                    playerRank: faction.playerRank,
                    isPlayerMember: faction.isPlayerMember,
                }));
            }
            nextGameState.players[currentActivePlayerIndex] = updatedOutgoingSnapshot;

            const incomingPlayerSnapshot = { ...nextGameState.players[targetPlayerIndex] };

            if (!incomingPlayerSnapshot) {
                console.error(`No player found at target index: ${targetPlayerIndex}`);
                return null;
            }

            let newActivePlayerCharacter: PlayerCharacter;

            if (gameSettings.cooperativeGameType === 'MultiplePersonalities') {
                const { shareCharacteristics, shareSkills, shareInventory } = gameSettings.multiplePersonalitiesSettings || {};
                newActivePlayerCharacter = {
                    ...incomingPlayerSnapshot,
                    characteristics: shareCharacteristics ? outgoingPlayerCharacterState.characteristics : incomingPlayerSnapshot.characteristics,
                    activeSkills: shareSkills ? outgoingPlayerCharacterState.activeSkills : incomingPlayerSnapshot.activeSkills,
                    passiveSkills: shareSkills ? outgoingPlayerCharacterState.passiveSkills : incomingPlayerSnapshot.passiveSkills,
                    skillMasteryData: shareSkills ? outgoingPlayerCharacterState.skillMasteryData : incomingPlayerSnapshot.skillMasteryData,
                    inventory: shareInventory ? outgoingPlayerCharacterState.inventory : incomingPlayerSnapshot.inventory,
                    equippedItems: shareInventory ? outgoingPlayerCharacterState.equippedItems : incomingPlayerSnapshot.equippedItems,
                    knownRecipes: shareInventory ? outgoingPlayerCharacterState.knownRecipes : incomingPlayerSnapshot.knownRecipes,
                    money: shareInventory ? outgoingPlayerCharacterState.money : incomingPlayerSnapshot.money,
                    currentHealth: shareCharacteristics ? outgoingPlayerCharacterState.currentHealth : incomingPlayerSnapshot.currentHealth,
                    maxHealth: shareCharacteristics ? outgoingPlayerCharacterState.maxHealth : incomingPlayerSnapshot.maxHealth,
                    currentEnergy: shareCharacteristics ? outgoingPlayerCharacterState.currentEnergy : incomingPlayerSnapshot.currentEnergy,
                    maxEnergy: shareCharacteristics ? outgoingPlayerCharacterState.maxEnergy : incomingPlayerSnapshot.maxEnergy,
                };
            } else { // FullParty mode
                newActivePlayerCharacter = incomingPlayerSnapshot;
            }

            const nextEncounteredNPCs = [...nextGameState.encounteredNPCs];
            const nextEncounteredFactions = [...nextGameState.encounteredFactions];

            if (gameSettings.cooperativeGameType === 'MultiplePersonalities' && !gameSettings.multiplePersonalitiesSettings?.shareNpcReputation) {
                const personalReps = new Map(asArray(incomingPlayerSnapshot.personalNpcReputations).map(rep => [rep.NPCId, rep]));
                nextEncounteredNPCs.forEach(npc => {
                    if (!npc) return;
                    const personalRep = personalReps.get(npc.NPCId) as { relationshipLevel: number; isCompanion: boolean; } | undefined;
                    if (personalRep) {
                        npc.relationshipLevel = personalRep.relationshipLevel;
                        npc.progressionType = personalRep.isCompanion ? 'Companion' : 'PlotDriven';
                    } else {
                        npc.relationshipLevel = 50;
                        npc.progressionType = 'PlotDriven';
                    }
                });
            }
            if (gameSettings.cooperativeGameType === 'MultiplePersonalities' && !gameSettings.multiplePersonalitiesSettings?.shareFactionReputation) {
                const personalReps = new Map(asArray(incomingPlayerSnapshot.personalFactionReputations).map(rep => [rep.factionId, rep]));
                nextEncounteredFactions.forEach(faction => {
                    const personalRep = personalReps.get(faction.factionId!) as { reputation: number; playerRank: string | null; isPlayerMember: boolean; } | undefined;
                    if (personalRep) {
                        faction.reputation = personalRep.reputation;
                        faction.playerRank = personalRep.playerRank;
                        faction.isPlayerMember = personalRep.isPlayerMember;
                    } else {
                        faction.reputation = 0;
                        faction.playerRank = null;
                        faction.isPlayerMember = false;
                    }
                });
            }

            let nextTurnNumber = currentTurnNumber || 0;
            if (targetPlayerIndex < currentActivePlayerIndex) {
                nextTurnNumber++;
            }

            nextGameState.activePlayerIndex = targetPlayerIndex;
            nextGameState.playerCharacter = newActivePlayerCharacter;
            nextGameState.encounteredNPCs = nextEncounteredNPCs;
            nextGameState.encounteredFactions = nextEncounteredFactions;

            const finalPlayerIds = new Set();
            for (const player of nextGameState.players) {
                if (finalPlayerIds.has(player.playerId)) {
                    console.error(`Duplicate playerId detected after turn pass: ${player.playerId}. Aborting turn pass.`);
                    return null;
                }
                finalPlayerIds.add(player.playerId);
            }

            return {
                gameState: nextGameState,
                turnNumber: nextTurnNumber,
                message: { sender: 'system', content: t('turn_passed_to', { name: newActivePlayerCharacter.name }) },
            };
        });
    }, [gameSettings, t, setPartyTransition]);

    // Do not replace a state that changed while the save was being read.
    const beginLocalLoad = useCallback((): (() => boolean) | null => {
        const initialState = gameStateRef.current;
        const initialSyncRevision = syncRevisionRef.current;
        const initialGameplayRevision = gameplayMutationRevisionRef.current;
        const canCommit = () => {
            const blocked = !!activeTurnRef.current || isTurnSubmitPendingRef.current || gameplayMutationPendingRef.current ||
                gameStateRef.current !== initialState || syncRevisionRef.current !== initialSyncRevision ||
                gameplayMutationRevisionRef.current !== initialGameplayRevision;
            if (blocked) {
                setError(t('load_unavailable_while_game_changing'));
                return false;
            }
            return true;
        };
        return canCommit() ? canCommit : null;
    }, [t, setError]);

    const allManagers = useMemo(() => {
        const saveLoadManager = createSaveLoadManager({
            gameContextRef, gameStateRef, gameHistory, gameLog, combatLog, lastJsonResponse, sceneImagePrompt,
            restoreFromSaveData, t, setAutosaveTimestamp, setDbSaveSlots, beginLocalLoad, setIsSaving,
        });

        const { packageSaveData } = saveLoadManager;

        const turnManager = createTurnManager({
            gameState, setGameState: setGameStateInternal, gameHistory, setGameHistory,
            isLoading, setIsLoading, setError,
            setLastJsonResponse, setLastRequestJson,
            setGameLog, setCombatLog, setSceneImagePrompt, setSuggestedActions,
            setWorldMap, setVisitedLocations, setWorldState, setTurnNumber,
            gameContextRef, abortControllerRef, syncRevisionRef, activeTurnRef, turnPhaseRef, gameplayMutationRevisionRef, gameplayMutationPendingRef,
            setSuperInstructions, setGameSettings,
            setLanguage,
            t,
            turnStartTimeRef, setTurnTime, setCurrentStep, setCurrentModel,
            language, gameSettings,
            gameStateRef,
            combatLog,
            gameLog,
            // Pass true for manual turn snapshots to ensure data integrity if desired,
            // or false if these snapshots shouldn't trigger cleanup.
            // For safety, we disable GC on internal turn snapshots to avoid accidental loss during rapid turns.
            packageSaveDataForTurn: () => packageSaveData(gameStateRef.current!, false),
            setLastTurnSaveFile
        });

        return {
            ...turnManager,
            ...saveLoadManager,
            ...guardGameplayActions(createInventoryActions({
                setGameState, gameContextRef, t, gameState
            }), userGameplayActionBlocked),
            ...guardGameplayActions(createPlayerActionsManager({
                setGameState, setGameHistory, setUserGameHistory, setGameLog: setUserGameLog, setCombatLog: setUserCombatLog, setVisitedLocations: setUserVisitedLocations,
                setWorldMap: setUserWorldMap, setWorldState: setUserWorldState, gameSettings, gameContextRef, t
            }), userGameplayActionBlocked),
            ...createMusicManager({
                gameContextRef, setError, t, setGameLog: setPresentationGameLog, setMusicPrompt,
                setIsMusicLoading, setIsMusicPlayerVisible, previousMusicQueries
            }),
        };
    }, [
        gameState, gameHistory, isLoading, error, combatLog, gameLog, lastJsonResponse, sceneImagePrompt,
        gameSettings, superInstructions, language, t, restoreFromSaveData, setGameState, setGameHistory, setUserGameLog, setUserCombatLog, setPresentationGameLog, setUserWorldMap, setUserWorldState, setUserVisitedLocations, setIsLoading, setError, setLastJsonResponse, setLastRequestJson, setGameLog, setCombatLog, setSceneImagePrompt, setSuggestedActions, setWorldMap, setVisitedLocations, setWorldState, setTurnNumber, setSuperInstructions, setGameSettings, setLanguage, setAutosaveTimestamp, setDbSaveSlots, setMusicPrompt, setIsMusicLoading, setIsMusicPlayerVisible,
        setLastTurnSaveFile, addPlayer, removePlayer, passTurnToPlayer, beginLocalLoad
    ]);


    // The manager exposes a low-level recovery primitive for its own turn
    // machinery. Do not expose it from the hook without checking the live
    // session: the checkpoint's role is not the current connection's role.
    const resumeInterruptedTurnSafely = useCallback((recovery: Parameters<typeof allManagers.resumeInterruptedTurn>[0]) => {
        if (((recovery.baseState as GameState & { networkRole?: string }).networkRole && (recovery.baseState as GameState & { networkRole?: string }).networkRole !== 'none') || activeTurnRef.current || isTurnSubmitPendingRef.current || gameplayMutationPendingRef.current) {
            setError(t('interrupted_turn_recovery_needs_local_idle_game'));
            return;
        }
        try {
            const localized = localizeLegacyState(recovery.baseState, recovery.context);
            return allManagers.resumeInterruptedTurn({ ...recovery, baseState: localized.state, context: localized.context });
        } catch (error) { setError(formatError(error)); return; }
    }, [allManagers, t, setError]);

    const resumeInterruptedGameTurn = useCallback(async () => {
        const initialState = gameStateRef.current;
        const initialSyncRevision = syncRevisionRef.current;
        const initialGameplayRevision = gameplayMutationRevisionRef.current;
        const blocked = () => !!activeTurnRef.current || isTurnSubmitPendingRef.current || gameplayMutationPendingRef.current ||
            gameStateRef.current !== initialState || syncRevisionRef.current !== initialSyncRevision ||
            gameplayMutationRevisionRef.current !== initialGameplayRevision;
        const reject = () => {
            setError(t('interrupted_turn_recovery_resume_state_changed'));
            return false;
        };
        if (blocked()) return reject();
        const recovery = interruptedTurnRecovery || await loadInterruptedTurnRecovery();
        if (blocked()) return reject();
        if (!recovery) return false;
        if (((recovery.baseState as GameState & { networkRole?: string }).networkRole && (recovery.baseState as GameState & { networkRole?: string }).networkRole !== 'none')) {
            setError(t('interrupted_turn_recovery_legacy_network_checkpoint'));
            return false;
        }
        let localized: ReturnType<typeof localizeLegacyState>;
        try { localized = localizeLegacyState(recovery.baseState, recovery.context); }
        catch (error) { setError(formatError(error)); return false; }
        await cancelInterruptedArenaGmRequest();
        // Cancellation and checkpoint reads can both yield to a connection,
        // restore, turn, or local edit. Do not clear the recovery on refusal.
        if (blocked()) return reject();
        setInterruptedTurnRecovery(null);
        setError(null);
        void allManagers.resumeInterruptedTurn({ ...recovery, baseState: localized.state, context: localized.context });
        return true;
    }, [allManagers, interruptedTurnRecovery, t, setError]);

    const discardInterruptedGameTurn = useCallback(async () => {
        const initialState = gameStateRef.current;
        const syncRevision = syncRevisionRef.current;
        const gameplayRevision = gameplayMutationRevisionRef.current;
        const blocked = () => !!activeTurnRef.current || isTurnSubmitPendingRef.current || gameplayMutationPendingRef.current ||
            gameStateRef.current !== initialState || syncRevisionRef.current !== syncRevision || gameplayMutationRevisionRef.current !== gameplayRevision;
        const reject = () => setError(t('interrupted_turn_discard_unavailable'));
        if (blocked()) { reject(); return; }
        try {
            const recovery = interruptedTurnRecovery || await loadInterruptedTurnRecovery();
            if (blocked()) { reject(); return; }
            if (!recovery) {
                setError(t('interrupted_turn_checkpoint_not_found'));
                return;
            }
            await cancelInterruptedArenaGmRequest();
            if (blocked()) { reject(); return; }
            // Conditional deletion is atomic with its IndexedDB read: a newer
            // checkpoint cannot be removed even if it appears while awaiting IO.
            const deleted = await clearInterruptedTurnRecoveryIfUnchanged(recovery);
            if (!deleted) {
                setError(t('interrupted_turn_checkpoint_changed'));
                return;
            }
            setInterruptedTurnRecovery(current => current === recovery ? null : current);
        } catch (error) {
            setError(formatError(error));
        }
    }, [interruptedTurnRecovery, t, setError]);

    const recordCrash = useCallback((source: string, errorToRecord: unknown, componentStack?: string) => {
        const marker = markCrashDetected(source, errorToRecord, componentStack);
        setCrashRecoveryMarker(marker);
        setCrashRecoveryInfo(getCrashRecoveryMetadata());
    }, []);

    const saveCrashRecoveryFromData = useCallback(async (saveData: SaveFile | null, reason: CrashRecoveryReason) => {
        if (!saveData) return null;

        try {
            const metadata = await saveCrashRecoveryPoint(saveData, reason);
            setCrashRecoveryInfo(metadata);

            const marker = getCrashRecoveryMarker();
            if (reason === 'stable' && marker?.recoveryAttemptedAt) {
                clearCrashRecoveryMarker();
                setCrashRecoveryMarker(null);
            }

            return metadata;
        } catch (e) {
            console.error("Failed to save crash recovery checkpoint", e);
            return null;
        }
    }, []);

    const savePreActionCrashRecovery = useCallback(async () => {
        const currentState = gameStateRef.current;
        if (!currentState) return;

        const saveData = allManagers.packageSaveData(currentState, true);
        if (saveData) {
            await saveCrashRecoveryFromData(saveData, 'pre_action');
        }
    }, [allManagers, saveCrashRecoveryFromData]);

    const loadCrashRecovery = useCallback(async (): Promise<boolean> => {
        const initialState = gameStateRef.current;
        const initialRevision = syncRevisionRef.current;
        const initialGameplayRevision = gameplayMutationRevisionRef.current;
        const recoveryBusy = () => !!activeTurnRef.current || isTurnSubmitPendingRef.current ||
            gameplayMutationPendingRef.current ||
            gameplayMutationRevisionRef.current !== initialGameplayRevision;
        const rejectBusy = () => {
            setError(t('crash_recovery_unavailable_while_game_busy'));
            return false;
        };
        if (recoveryBusy()) return rejectBusy();

        const attemptedMarker = markCrashRecoveryAttempt();
        if (attemptedMarker) {
            setCrashRecoveryMarker(attemptedMarker);
        }

        try {
            const data = await loadCrashRecoveryPoint();
            if (!data) {
                setError(t('crash_recovery_state_not_found'));
                return false;
            }

            // IndexedDB is asynchronous and metadata can be stale or absent.
            // Recheck both the actual checkpoint and the current session before
            // a local restore replaces the snapshot or overwrites newer state.
            if (recoveryBusy()) return rejectBusy();
            if (gameStateRef.current !== initialState || syncRevisionRef.current !== initialRevision) {
                setError(t('crash_recovery_state_changed'));
                return false;
            }
            if (data.missingImageCount) {
                console.warn(`Crash recovery restored ${data.missingImageCount} image(s) fewer than it references.`);
            }
            restoreFromSaveData(data);
            return true;
        } catch (e: any) {
            setError(formatError(e));
            return false;
        }
    }, [t, restoreFromSaveData, setError]);

    useEffect(() => {
        if (turnNumber && turnNumber > 0 && gameState && lastSavedTurnRef.current !== turnNumber) {
            console.log(`Autosaving for turn ${turnNumber}`);
            // Autosave runs frequently, so keep its IndexedDB payload compact.
            const saveData = allManagers.packageSaveData(gameState, true);
            if (saveData) {
                allManagers.autosave(saveData);
                void saveCrashRecoveryFromData(saveData, 'stable');
            }
            lastSavedTurnRef.current = turnNumber;
        }
    }, [turnNumber, gameState, allManagers, saveCrashRecoveryFromData]);

    const updateGameSettings = useCallback((newSettings: Partial<GameSettings>) => {
        // Display/media preferences do not invalidate game-rule edits.
        const shared = Object.keys(newSettings).some(key => !isLocalPreferenceKey(key));
        if (shared && userGameplayActionBlocked()) return;
        const applied = shared ? beginSharedContextEdit('settings') : null;
        setGameSettings(prevSettings => {
            if (!prevSettings) return applied ? applied(prevSettings) : prevSettings;

            if (newSettings.notificationSound === true && prevSettings.notificationSound === false) {
                initializeAndPreviewSound();
            }

            const updatedSettings = { ...prevSettings, ...newSettings };

            return applied ? applied(updatedSettings) : updatedSettings;
        });
    }, [userGameplayActionBlocked, beginSharedContextEdit]);

    const updateSuperInstructions = useCallback((newInstructions: string) => {
        if (userGameplayActionBlocked()) return;
        const applied = beginSharedContextEdit('instructions');
        setSuperInstructions(() => applied(newInstructions));
    }, [userGameplayActionBlocked, beginSharedContextEdit]);

    const editLocationData = (locationId: string, field: keyof Location, value: any) => {
        if (!gameSettings?.allowHistoryManipulation || userGameplayActionBlocked()) return;

        setUserWorldMap(prevMap => {
            const newMap = { ...prevMap };
            if (newMap[locationId]) {
                newMap[locationId] = { ...newMap[locationId], [field]: value };
                if (gameContextRef.current) {
                    gameContextRef.current.worldMap = newMap;
                }
            }
            return newMap;
        });

        setUserVisitedLocations(prev => {
            const newLocations = prev.map(loc => loc.locationId === locationId ? { ...loc, [field]: value } : loc);
            if (gameContextRef.current) {
                gameContextRef.current.visitedLocations = newLocations;
            }
            return newLocations;
        });

        setGameState(prev => {
            if(!prev) return null;
            if(prev.currentLocationData?.locationId === locationId){
                const newCurrent = {...prev.currentLocationData, [field]: value} as Location;
                if(gameContextRef.current) {
                    gameContextRef.current.currentLocation = newCurrent;
                }
                return {...prev, currentLocationData: newCurrent};
            }
            return prev;
        });
    };

    const updatePlayerPortrait = useCallback((playerId: string, portraitData: { prompt?: string | null; custom?: string | null; }) => {
        setGameState(prevState => {
            if (!prevState || !prevState.players || prevState.players.length === 0) return prevState;

            const matches = prevState.players.flatMap((p, index) => p?.playerId === playerId ? [index] : []);
            const pcIndex = matches.length === 1 && playerId ? matches[0] : -1;
            if (pcIndex === -1) {
                console.warn(`updatePlayerPortrait: Player with ID ${playerId} not found.`);
                return prevState;
            }

            const newPlayers = [...prevState.players];
            const playerToUpdate = { ...newPlayers[pcIndex] };
            let newImageCache = { ...prevState.imageCache };

            if (portraitData.custom !== undefined) {
                const currentKey = playerToUpdate.portrait;
                if (currentKey && currentKey.startsWith('custom-portrait-')) {
                    delete newImageCache[currentKey];
                }
                if (portraitData.custom === null) {
                    playerToUpdate.portrait = null;
                } else {
                    const key = `custom-portrait-${playerToUpdate.playerId}`;
                    newImageCache[key] = { src: portraitData.custom, sourceProvider: 'Custom Upload' };
                    playerToUpdate.portrait = key;
                }
            }
            else if (portraitData.prompt !== undefined) {
                const currentKey = playerToUpdate.portrait;
                if (currentKey && currentKey.startsWith('custom-portrait-')) {
                    delete newImageCache[currentKey];
                }

                // FIX: When accepting a new prompt, update image_prompt, clear pending_image_prompt, and reset portrait.
                // This ensures the new prompt becomes the active one.
                playerToUpdate.image_prompt = portraitData.prompt;
                playerToUpdate.pending_image_prompt = null;
                playerToUpdate.portrait = null;
            }

            newPlayers[pcIndex] = playerToUpdate;

            let newPlayerCharacter = prevState.playerCharacter;
            if (prevState.playerCharacter?.playerId === playerId) {
                newPlayerCharacter = playerToUpdate;
            }

            const newState = {
                ...prevState,
                players: newPlayers,
                playerCharacter: newPlayerCharacter,
                imageCache: newImageCache,
            };

            return newState;
        });
    }, [setGameState]);

    const updateNpcPortrait = useCallback((npcId: string, portraitData: { prompt?: string | null; custom?: string | null; }) => {
        setGameState(prevState => {
            if (!prevState || !prevState.encounteredNPCs || prevState.encounteredNPCs.length === 0) return prevState;

            const newNpcs = [...prevState.encounteredNPCs];
            const npcIndex = newNpcs.findIndex(n => n.NPCId === npcId);
            if (npcIndex === -1) {
                return prevState;
            }

            const newNpc = { ...newNpcs[npcIndex] };
            let newImageCache = { ...prevState.imageCache };

            if (portraitData.custom !== undefined) {
                const currentKey = newNpc.custom_image_prompt;
                if (currentKey && (currentKey.startsWith('custom-portrait-npc-') || currentKey.startsWith('data:image'))) {
                    if (currentKey.startsWith('custom-portrait-npc-')) {
                        delete newImageCache[currentKey];
                    }
                }

                if (portraitData.custom === null) {
                    newNpc.custom_image_prompt = null;
                } else {
                    const key = `custom-portrait-npc-${npcId}`;
                    newImageCache[key] = { src: portraitData.custom, sourceProvider: 'Custom Upload' };
                    newNpc.custom_image_prompt = key;
                }
            } else if (portraitData.prompt !== undefined) {
                const currentKey = newNpc.custom_image_prompt;
                if (currentKey && (currentKey.startsWith('custom-portrait-npc-') || currentKey.startsWith('data:image'))) {
                    if (currentKey.startsWith('custom-portrait-npc-')) {
                        delete newImageCache[currentKey];
                    }
                }
                newNpc.custom_image_prompt = null;

                // FIX: When accepting a new prompt, update image_prompt and clear pending_image_prompt.
                newNpc.image_prompt = portraitData.prompt;
                newNpc.pending_image_prompt = null;
            }

            newNpcs[npcIndex] = newNpc;

            const newState = {
                ...prevState,
                encounteredNPCs: newNpcs,
                imageCache: newImageCache,
            };

            return newState;
        });
    }, [setGameState]);

    // FIX: Added deleteImageFromCache function to manage the image cache.
    const deleteImageFromCache = useCallback((prompt: string) => {
        setPresentationState(prev => {
            if (!prev) return null;
            const newCache = { ...prev.imageCache };
            if (newCache[prompt]) {
                delete newCache[prompt];
            }
            // also check if the prompt is an originalTextPrompt for a custom upload
            for (const key in newCache) {
                const entry = newCache[key];
                if (typeof entry !== 'string' && entry.src === prompt) {
                    delete newCache[key];
                    break;
                }
            }
            return { ...prev, imageCache: newCache };
        });
    }, [setPresentationState]);

    // FIX: Added clearImageCache function and exported it from the useGameLogic hook.
    const clearImageCache = useCallback(() => {
        setPresentationState(prev => {
            if (!prev) return null;
            return { ...prev, imageCache: {} };
        });
        // Every image is gone from the game state here, so the blobs that no autosave or
        // slot still points at can go right away instead of waiting for the next save.
        // A single deletion does not sweep: images generated during the current turn are
        // not in any stored record yet, and the sweep would delete them.
        void sweepUnusedImages({ force: true }).catch(() => undefined);
    }, [setPresentationState]);

    const regenerateLastResponse = useCallback(async (): Promise<boolean> => {
        const turnSaveToUse = lastTurnSaveFile;

        if (!turnSaveToUse) {
            setError(t('no_regeneration_data'));
            return false;
        }
        if (!beginLocalLoad()) return false;

        try {
            restoreFromSaveData(turnSaveToUse);
            return true;
        } catch (e: any) {
            setError(formatError(e));
            return false;
        }
    }, [lastTurnSaveFile, restoreFromSaveData, beginLocalLoad, setError, t]);

    const passTurnManually = useCallback((): boolean => {
        if (!gameState || !gameSettings || gameSettings.cooperativeGameType === 'None') return false;
        if (!gameState.players || gameState.players.length === 0) return false;

        const currentActivePlayerIndex = gameState.activePlayerIndex;
        let nextPlayerIndex = (currentActivePlayerIndex + 1) % gameState.players.length;

        return passTurnToPlayer(nextPlayerIndex);
    }, [gameState, gameSettings, passTurnToPlayer]);

    const deleteActiveSkill = useCallback((skillName: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newPc = { ...prevState.playerCharacter };
            newPc.activeSkills = newPc.activeSkills.filter(s => s.skillName !== skillName);
            newPc.skillMasteryData = newPc.skillMasteryData.filter(m => m.skillName !== skillName);
            if (newPc.autoCombatSkill === skillName) {
                newPc.autoCombatSkill = null;
            }
            return { ...prevState, playerCharacter: newPc };
        });
    }, [gameSettings, setGameState]);

    const deletePassiveSkill = useCallback((skillName: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newPc = { ...prevState.playerCharacter };
            newPc.passiveSkills = newPc.passiveSkills.filter(s => s.skillName !== skillName);
            const recalculatedPc = recalculateDerivedStats(newPc);
            return { ...prevState, playerCharacter: recalculatedPc };
        });
    }, [gameSettings, setGameState]);

    const deleteActiveEffect = useCallback((characterType: 'player' | 'npc', characterId: string | null, effectId: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;

        setGameState(prevState => {
            if (!prevState) return null;
            const newState = cloneGameStateForEdit(prevState);

            if (characterType === 'player') {
                const pc = newState.playerCharacter as PlayerCharacter;
                pc.activePlayerEffects = (pc.activePlayerEffects || []).filter((e: Effect) => e.effectId !== effectId);

                newState.playerCharacter = recalculateDerivedStats(pc);

                if (gameContextRef.current) {
                    gameContextRef.current.playerCharacter = newState.playerCharacter;
                }
            } else if (characterType === 'npc' && characterId) {
                const npcIndex = newState.encounteredNPCs.findIndex((n: NPC) => n.NPCId === characterId);
                if (npcIndex > -1) {
                    const npc = newState.encounteredNPCs[npcIndex];
                    npc.activeEffects = (npc.activeEffects || []).filter((e: Effect) => e.effectId !== effectId);

                    newState.encounteredNPCs[npcIndex] = recalculateDerivedStats(npc);

                    if (gameContextRef.current) {
                        gameContextRef.current.encounteredNPCs = newState.encounteredNPCs;
                    }
                }
            }
            return newState;
        });
    }, [gameSettings, setGameState]);

    const forgetHealedWound = useCallback((characterType: 'player' | 'npc', characterId: string | null, woundId: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newState = cloneGameStateForEdit(prevState);
            if (characterType === 'player') {
                const pc = newState.playerCharacter as PlayerCharacter;
                pc.playerWounds = pc.playerWounds.filter((w: Wound) => w.woundId !== woundId);
                 if (gameContextRef.current) {
                    gameContextRef.current.playerCharacter = { ...gameContextRef.current.playerCharacter, playerWounds: pc.playerWounds };
                }
            } else if (characterType === 'npc' && characterId) {
                const npcIndex = newState.encounteredNPCs.findIndex((n: NPC) => n.NPCId === characterId);
                if (npcIndex > -1) {
                    newState.encounteredNPCs[npcIndex].wounds = (newState.encounteredNPCs[npcIndex].wounds || []).filter((w: Wound) => w.woundId !== woundId);
                     if (gameContextRef.current) {
                        gameContextRef.current.encounteredNPCs = newState.encounteredNPCs;
                    }
                }
            }
            return newState;
        });
    }, [gameSettings, setGameState]);

    const forgetActiveWound = useCallback((characterType: 'player' | 'npc', characterId: string | null, woundId: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newState = cloneGameStateForEdit(prevState);

            let woundToRemove: Wound | undefined;

            if (characterType === 'player') {
                const pc = newState.playerCharacter as PlayerCharacter;
                const woundIndex = pc.playerWounds.findIndex((w: Wound) => w.woundId === woundId);
                if (woundIndex > -1) {
                    woundToRemove = pc.playerWounds[woundIndex];
                    pc.playerWounds.splice(woundIndex, 1);
                }
                if (woundToRemove) {
                    pc.activePlayerEffects = (pc.activePlayerEffects || []).filter((e: Effect) => e.sourceWoundId !== woundId);
                }
                if (gameContextRef.current) {
                    gameContextRef.current.playerCharacter = pc;
                }
            } else if (characterType === 'npc' && characterId) {
                const npcIndex = newState.encounteredNPCs.findIndex((n: NPC) => n.NPCId === characterId);
                if (npcIndex > -1) {
                    const npc = newState.encounteredNPCs[npcIndex];
                    if (npc.wounds) {
                        const woundIndex = npc.wounds.findIndex((w: Wound) => w.woundId === woundId);
                        if (woundIndex > -1) {
                            woundToRemove = npc.wounds[woundIndex];
                            npc.wounds.splice(woundIndex, 1);
                        }
                    }
                    if (woundToRemove) {
                        npc.activeEffects = (npc.activeEffects || []).filter((e: Effect) => e.sourceWoundId !== woundId);
                    }
                    if (gameContextRef.current) {
                        gameContextRef.current.encounteredNPCs = newState.encounteredNPCs;
                    }
                }
            }
            return newState;
        });
    }, [gameSettings, setGameState]);

    const clearAllHealedWounds = useCallback((characterType: 'player' | 'npc', characterId: string | null) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newState = cloneGameStateForEdit(prevState);
            if (characterType === 'player') {
                const pc = newState.playerCharacter as PlayerCharacter;
                pc.playerWounds = pc.playerWounds.filter((w: Wound) => !w.healingState || w.healingState.currentState !== 'Healed');
                 if (gameContextRef.current) {
                    gameContextRef.current.playerCharacter = { ...gameContextRef.current.playerCharacter, playerWounds: pc.playerWounds };
                }
            } else if (characterType === 'npc' && characterId) {
                const npcIndex = newState.encounteredNPCs.findIndex((n: NPC) => n.NPCId === characterId);
                if (npcIndex > -1) {
                    newState.encounteredNPCs[npcIndex].wounds = (newState.encounteredNPCs[npcIndex].wounds || []).filter((w: Wound) => !w.healingState || w.healingState.currentState !== 'Healed');
                     if (gameContextRef.current) {
                        gameContextRef.current.encounteredNPCs = newState.encounteredNPCs;
                    }
                }
            }
            return newState;
        });
    }, [gameSettings, setGameState]);

    const onEditNpcMemory = useCallback((npcId: string, memory: UnlockedMemory) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newNpcs = prevState.encounteredNPCs.map(npc => {
                if (npc.NPCId === npcId && npc.unlockedMemories) {
                    const newMemories = npc.unlockedMemories.map(mem =>
                        mem.memoryId === memory.memoryId ? memory : mem
                    );
                    return { ...npc, unlockedMemories: newMemories };
                }
                return npc;
            });
            if (gameContextRef.current) {
                gameContextRef.current.encounteredNPCs = newNpcs;
            }
            return { ...prevState, encounteredNPCs: newNpcs };
        });
    }, [gameSettings, setGameState]);

    const onDeleteNpcMemory = useCallback((npcId: string, memoryId: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newNpcs = prevState.encounteredNPCs.map(npc => {
                if (npc.NPCId === npcId && npc.unlockedMemories) {
                    const newMemories = npc.unlockedMemories.filter(mem => mem.memoryId !== memoryId);
                    return { ...npc, unlockedMemories: newMemories };
                }
                return npc;
            });
            if (gameContextRef.current) {
                gameContextRef.current.encounteredNPCs = newNpcs;
            }
            return { ...prevState, encounteredNPCs: newNpcs };
        });
    }, [gameSettings, setGameState]);

    const onDeleteCurrentActivity = useCallback((npcId: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newNpcs = prevState.encounteredNPCs.map(npc => {
                if (npc.NPCId === npcId) {
                    return { ...npc, currentActivity: null };
                }
                return npc;
            });
            return { ...prevState, encounteredNPCs: newNpcs };
        });
    }, [gameSettings, setGameState]);

    const onDeleteCompletedActivity = useCallback((npcId: string, activity: CompletedActivity) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newNpcs = prevState.encounteredNPCs.map(npc => {
                if (npc.NPCId === npcId) {
                    const newCompleted = (npc.completedActivities || []).filter(
                        (act: CompletedActivity) => !(act.activityName === activity.activityName && act.completionTurn === activity.completionTurn)
                    );
                    return { ...npc, completedActivities: newCompleted };
                }
                return npc;
            });
            return { ...prevState, encounteredNPCs: newNpcs };
        });
    }, [gameSettings, setGameState]);

    const deleteFactionProject = useCallback((factionId: string, projectId: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newFactions = prevState.encounteredFactions.map(faction => {
                if (faction.factionId === factionId) {
                    const newActiveProjects = (faction.activeProjects || []).filter(p => p.projectId !== projectId);
                    return { ...faction, activeProjects: newActiveProjects };
                }
                return faction;
            });
            if (gameContextRef.current) {
                gameContextRef.current.encounteredFactions = newFactions;
            }
            return { ...prevState, encounteredFactions: newFactions };
        });
    }, [gameSettings, setGameState]);

    const deleteFactionCompletedProject = useCallback((factionId: string, projectId: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newFactions = prevState.encounteredFactions.map(faction => {
                if (faction.factionId === factionId) {
                    const newCompletedProjects = (faction.completedProjects || []).filter(p => p.projectId !== projectId);
                    return { ...faction, completedProjects: newCompletedProjects };
                }
                return faction;
            });
            if (gameContextRef.current) {
                gameContextRef.current.encounteredFactions = newFactions;
            }
            return { ...prevState, encounteredFactions: newFactions };
        });
    }, [gameSettings, setGameState]);

    const deleteFactionCustomState = useCallback((factionId: string, stateIdOrName: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newFactions = prevState.encounteredFactions.map(faction => {
                if (faction.factionId === factionId && faction.customStates) {
                    const newStates = faction.customStates.filter(s => s.stateId !== stateIdOrName && s.stateName !== stateIdOrName);
                    return { ...faction, customStates: newStates };
                }
                return faction;
            });
            if (gameContextRef.current) {
                gameContextRef.current.encounteredFactions = newFactions;
            }
            return { ...prevState, encounteredFactions: newFactions };
        });
    }, [gameSettings, setGameState]);

    const deleteCustomState = useCallback((idOrName: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            if (!prevState.playerCharacter.playerCustomStates) return prevState;

            const pc = prevState.playerCharacter;
            const initialLength = pc.playerCustomStates.length;
            const newPlayerCustomStates = pc.playerCustomStates.filter(s =>
                s.stateId !== idOrName && s.stateName !== idOrName
            );

            if (newPlayerCustomStates.length === initialLength) {
                console.warn(`Could not find player custom state to delete with identifier: ${idOrName}`);
                return prevState; // No change
            }

            const newPc = { ...pc, playerCustomStates: newPlayerCustomStates };
            const newState = { ...prevState, playerCharacter: newPc, playerCustomStates: newPlayerCustomStates };

            if (gameContextRef.current) {
                gameContextRef.current.playerCustomStates = newPlayerCustomStates;
                gameContextRef.current.playerCharacter = { ...gameContextRef.current.playerCharacter, playerCustomStates: newPlayerCustomStates };
            }

            return newState;
        });
    }, [gameSettings, setGameState]);

    const deleteNpcCustomState = useCallback((npcId: string, idOrName: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newNpcs = prevState.encounteredNPCs.map(npc => {
                if (npc.NPCId === npcId && npc.customStates) {
                    const newStates = npc.customStates.filter(s => s.stateId !== idOrName && s.stateName !== idOrName);
                    return { ...npc, customStates: newStates };
                }
                return npc;
            });
            if (gameContextRef.current) {
                gameContextRef.current.encounteredNPCs = newNpcs;
            }
            return { ...prevState, encounteredNPCs: newNpcs };
        });
    }, [gameSettings, setGameState]);

    const deleteLocationThreat = useCallback((locationId: string, threatId: string) => {
        if (!gameSettings?.allowHistoryManipulation || userGameplayActionBlocked()) return;

        const updater = (location: Location) => {
            if (location && location.activeThreats) {
                const newThreats = location.activeThreats.filter(t => t.threatId !== threatId);
                return { ...location, activeThreats: newThreats };
            }
            return location;
        };

        setUserWorldMap(prevMap => {
            const newMap = { ...prevMap };
            if (newMap[locationId]) {
                newMap[locationId] = updater(newMap[locationId]);
                if (gameContextRef.current) {
                    gameContextRef.current.worldMap = newMap;
                }
                return newMap;
            }
            return prevMap;
        });

        setGameState(prevState => {
            if (prevState && prevState.currentLocationData.locationId === locationId) {
                const newCurrentLocation = updater(prevState.currentLocationData);
                if (gameContextRef.current) {
                    gameContextRef.current.currentLocation = newCurrentLocation;
                }
                return { ...prevState, currentLocationData: newCurrentLocation };
            }
            return prevState;
        });

        setUserVisitedLocations(prev => {
            const newLocations = prev.map(loc => loc.locationId === locationId ? updater(loc) : loc);
            if (gameContextRef.current) {
                gameContextRef.current.visitedLocations = newLocations;
            }
            return newLocations;
        });

    }, [gameSettings, setGameState, setUserWorldMap, setUserVisitedLocations, userGameplayActionBlocked]);

    const deleteFactionBonus = useCallback((factionId: string, bonusIdentifier: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newFactions = prevState.encounteredFactions.map(faction => {
                if (faction.factionId === factionId && faction.structuredBonuses) {
                    const newBonuses = faction.structuredBonuses.filter(b => b.bonusId !== bonusIdentifier && b.description !== bonusIdentifier);
                    return { ...faction, structuredBonuses: newBonuses };
                }
                return faction;
            });
            if (gameContextRef.current) {
                gameContextRef.current.encounteredFactions = newFactions;
            }
            return { ...prevState, encounteredFactions: newFactions };
        });
    }, [gameSettings, setGameState]);

    const clearAllCompletedFactionProjects = useCallback((factionId: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newFactions = prevState.encounteredFactions.map(faction => {
                if (faction.factionId === factionId) {
                    return { ...faction, completedProjects: [] };
                }
                return faction;
            });
            if (gameContextRef.current) {
                gameContextRef.current.encounteredFactions = newFactions;
            }
            return { ...prevState, encounteredFactions: newFactions };
        });
    }, [gameSettings, setGameState]);

    const clearAllCompletedNpcActivities = useCallback((npcId: string) => {
        if (!gameSettings?.allowHistoryManipulation) return;
        setGameState(prevState => {
            if (!prevState) return null;
            const newNpcs = prevState.encounteredNPCs.map(npc => {
                if (npc.NPCId === npcId) {
                    return { ...npc, completedActivities: [] };
                }
                return npc;
            });
            if (gameContextRef.current) {
                gameContextRef.current.encounteredNPCs = newNpcs;
            }
            return { ...prevState, encounteredNPCs: newNpcs };
        });
    }, [gameSettings, setGameState]);

    const clearNpcJournalsNow = useCallback(() => {
        if (!gameSettings) return;

        setGameState(prevState => {
            if (!prevState) return null;

            const countToKeepNum = Number(gameSettings.latestNpcJournalsCount);
            const countToKeep = !isNaN(countToKeepNum) && countToKeepNum > 0 ? countToKeepNum : 20;

            const newNpcs = prevState.encounteredNPCs.map(npc => {
                if (npc && Array.isArray(npc.journalEntries) && npc.journalEntries.length > countToKeep) {
                    const trimmedEntries = npc.journalEntries.slice(0, countToKeep);
                    return { ...npc, journalEntries: trimmedEntries };
                }
                return npc;
            });

            if (gameContextRef.current) {
                gameContextRef.current.encounteredNPCs = newNpcs;
            }
            return { ...prevState, encounteredNPCs: newNpcs };
        });
    }, [gameSettings, setGameState]);


    const {
        generateMusicPrompt,
        generateSurpriseMusicPrompt,
        closeMusicPlayer,
        updateMusicPrompt,
    } = allManagers;

    const handlePrimaryMusicClick = () => {
        generateMusicPrompt();
    };

    const stopPlayingCinematic = useCallback(() => {
        setPlayingCinematic(null);
    }, []);

    const isCinemaVisible = !!playingCinematic;
    const cinemaFrames = playingCinematic?.frames || null;
    const closeCinemaPlayer = stopPlayingCinematic;

    const runLocalSubmission = useCallback(async (kind: 'action' | 'question', text: string, image?: { data: string; mimeType: string } | null): Promise<boolean> => {
        if (isTurnSubmitPendingRef.current || isLoading || activeTurnRef.current || !gameStateRef.current || !gameContextRef.current) return false;
        if (gameplayMutationPendingRef.current) { setError(t('game_state_updating')); return false; }
        isTurnSubmitPendingRef.current = true;
        const startingRevision = syncRevisionRef.current;
        const startingGameplayRevision = gameplayMutationRevisionRef.current;
        try {
            await savePreActionCrashRecovery();
            if (syncRevisionRef.current !== startingRevision ||
                gameplayMutationRevisionRef.current !== startingGameplayRevision || gameplayMutationPendingRef.current) {
                setError(t('turn_game_state_changed')); isTurnSubmitPendingRef.current = false; return false;
            }
            // Acceptance is distinct from completion: once dispatched, failures may
            // occur after a committed turn and must not cause automatic retries.
            const isManualPass = kind === 'action' && text.trim().toLowerCase() === '[system action] pass turn';
            if (isManualPass) {
                // A refused pass is not an accepted action, so the caller must keep the draft.
                if (!passTurnManually()) { isTurnSubmitPendingRef.current = false; return false; }
                isTurnSubmitPendingRef.current = false;
                return true;
            }
            const task = kind === 'action' ? allManagers.sendMessage(text, image) : allManagers.askQuestion(text, image);
            void Promise.resolve(task).catch(error => { console.error('Submission failed', error); setError(formatError(error)); })
                .finally(() => { isTurnSubmitPendingRef.current = false; });
            return true;
        } catch (error) {
            isTurnSubmitPendingRef.current = false;
            setError(formatError(error));
            return false;
        }
    }, [isLoading, t, savePreActionCrashRecovery, passTurnManually, allManagers, setError]);
    const sendMessageWithStashClear = useCallback((message: string, image?: { data: string; mimeType: string } | null) => runLocalSubmission('action', message, image), [runLocalSubmission]);
    const askQuestionWithRecovery = useCallback((question: string, image?: { data: string; mimeType: string } | null) => runLocalSubmission('question', question, image), [runLocalSubmission]);

    const cinemaAbortControllerRef = useRef<AbortController | null>(null);
    const cancelCinemaGeneration = useCallback(() => {
        if (cinemaAbortControllerRef.current) {
            cinemaAbortControllerRef.current.abort();
            cinemaAbortControllerRef.current = null;
        }
        setIsGeneratingCinema(false);
        setExtendingCinematicId(null);
        setCinemaGenerationProgress({ current: 0, total: 0, message: '' });
    }, []);

    const generateFilmTrailer = useCallback(async (userPrompt: string) => {
        if (!gameContextRef.current || !gameSettings) return;

        setIsGeneratingCinema(true);
        setError(null);
        setCinemaGenerationProgress({ current: 0, total: 1, message: t('Generating trailer script...') });

        cinemaAbortControllerRef.current?.abort();
        const cinemaController = new AbortController();
        cinemaAbortControllerRef.current = cinemaController;

        try {
            const cinemaContext = {
                ...gameContextRef.current,
                superInstructions: narrativeStyleGuide.getGuide() + '\n' + superInstructions,
            };

            const prompt = getCinemaPrompt(cinemaContext, userPrompt);

            const result = await executeCancellableJsonGeneration(
                prompt,
                cinemaContext,
                cinemaController.signal,
                (_text) => { /* streaming not needed here */ }
            );

            const newCinematic: Cinematic = {
                id: generateId('cinematic'),
                userPrompt,
                title: result.title,
                synopsis: result.synopsis,
                comments: result.comments || [],
                frames: result.frames,
            };

            if (gameContextRef.current?.gameSettings?.disableImageGeneration !== true) {
                setCinemaGenerationProgress({ current: 0, total: newCinematic.frames.length, message: t('Generating scene images...') });

                for (let i = 0; i < newCinematic.frames.length; i++) {
                    if (cinemaController.signal.aborted) throw new Error("Cancelled");
                    if (Boolean(gameContextRef.current?.gameSettings?.disableImageGeneration)) break;
                    setCinemaGenerationProgress(prev => ({ ...prev, current: i + 1, message: `${t('Generating scene')} ${i + 1}/${newCinematic.frames.length}` }));

                    const imageUrl = await requestArenaGmImage(
                        newCinematic.frames[i].imagePrompt,
                        1024,
                        1024,
                        cinemaController.signal,
                    );
                    if (!cinemaController.signal.aborted) {
                        newCinematic.frames[i].imageUrl = imageUrl;
                    }
                }
            }

            if (cinemaController.signal.aborted) return;
            setPresentationState(prev => {
                if (!prev) return null;
                const cinematics = [...(prev.cinematics || []), newCinematic];
                return { ...prev, cinematics };
            });

            setCinemaGenerationProgress({ current: newCinematic.frames.length, total: newCinematic.frames.length, message: t('TrailerReady') });

        } catch (e: any) {
            if (e.name !== 'AbortError') {
                setError(formatError(e));
                console.error("Failed to generate film trailer:", e);
            }
        } finally {
            if (cinemaAbortControllerRef.current === cinemaController) {
                cinemaAbortControllerRef.current = null;
                setIsGeneratingCinema(false);
            }
        }
    }, [gameSettings, superInstructions, t, setError, setPresentationState]);

    const continueFilmTrailer = useCallback(async (cinematicId: string) => {
        if (!gameContextRef.current || !gameSettings) return;

        const cinematicToExtend = gameStateRef.current?.cinematics?.find(c => c.id === cinematicId);
        if (!cinematicToExtend) {
            setError("Cinematic not found.");
            return;
        }

        setIsGeneratingCinema(true);
        setExtendingCinematicId(cinematicId);
        setError(null);
        setCinemaGenerationProgress({ current: 0, total: 1, message: t('Continuing trailer script...') });
        cinemaAbortControllerRef.current?.abort();
        const cinemaController = new AbortController();
        cinemaAbortControllerRef.current = cinemaController;

        try {
            const cinemaContext = {
                ...gameContextRef.current,
                superInstructions: narrativeStyleGuide.getGuide() + '\n' + superInstructions,
            };

            const prompt = getContinueCinemaPrompt(cinemaContext, cinematicToExtend);
            const result = await executeCancellableJsonGeneration(
                prompt,
                cinemaContext,
                cinemaController.signal,
                (_text) => { /* streaming not needed here */ }
            );

            const newFrames: CinemaFrame[] = result.frames;

            if (gameContextRef.current?.gameSettings?.disableImageGeneration !== true) {
                setCinemaGenerationProgress({ current: 0, total: newFrames.length, message: t('Generating additional scenes...') });

                for (let i = 0; i < newFrames.length; i++) {
                    if (cinemaController.signal.aborted) throw new Error("Cancelled");
                    if (Boolean(gameContextRef.current?.gameSettings?.disableImageGeneration)) break;
                    setCinemaGenerationProgress(prev => ({ ...prev, current: i + 1, message: `${t('Generating scene')} ${i + 1}/${newFrames.length}` }));
                    newFrames[i].imageUrl = await requestArenaGmImage(
                        newFrames[i].imagePrompt,
                        1024,
                        1024,
                        cinemaController.signal,
                    );
                }
            }

            if (cinemaController.signal.aborted) return;
            setPresentationState(prev => {
                if (!prev) return null;
                const newCinematics = (prev.cinematics || []).map(c => {
                    if (c.id === cinematicId) {
                        return { ...c, frames: [...c.frames, ...newFrames] };
                    }
                    return c;
                });
                return { ...prev, cinematics: newCinematics };
            });

            setCinemaGenerationProgress({ current: newFrames.length, total: newFrames.length, message: t('TrailerReady') });

        } catch (e: any) {
             if (e.name !== 'AbortError') {
                setError(formatError(e));
                console.error("Failed to continue film trailer:", e);
            }
        } finally {
            if (cinemaAbortControllerRef.current === cinemaController) {
                cinemaAbortControllerRef.current = null;
                setIsGeneratingCinema(false);
                setExtendingCinematicId(null);
            }
        }
    }, [gameSettings, superInstructions, t, setError, setPresentationState, gameStateRef]);

    const playCinematic = useCallback((cinematicId: string) => {
        const cinematic = gameStateRef.current?.cinematics?.find(c => c.id === cinematicId);
        if (cinematic) {
            setPlayingCinematic(cinematic);
        }
    }, []);

    const exportCinematic = useCallback((cinematicId: string) => {
        const cinematic = gameStateRef.current?.cinematics?.find(c => c.id === cinematicId);
        if (cinematic) {
            const blob = new Blob([JSON.stringify(cinematic, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const filename = `cinematic-${cinematic.title.replace(/\s+/g, '_')}.json`;
            a.download = filename;
            a.click();
             URL.revokeObjectURL(url);
            setPresentationGameLog(prev => [t('CinematicExported', { filename }), ...prev]);
        }
    }, [t, setPresentationGameLog, gameStateRef]);

    const importCinematic = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (re) => {
                    try {
                        const content = re.target?.result as string;
                        const cinematic = JSON.parse(content) as Cinematic;
                        if (cinematic.id && cinematic.title && cinematic.frames) {
                            setPresentationState(prev => {
                                if (!prev) return null;
                                const existing = (prev.cinematics || []).find(c => c.id === cinematic.id);
                                if (existing) {
                                    notifyError('A cinematic with this ID already exists.');
                                    return prev;
                                }
                                const cinematics = [...(prev.cinematics || []), cinematic];
                                setPresentationGameLog(p => [t('CinematicImported'), ...p]);
                                return { ...prev, cinematics };
                            });
                        } else {
                            throw new Error("Invalid format");
                        }
                    } catch (err) {
                        setError(t('CinematicImportError'));
                        console.error(err);
                    }
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }, [t, setError, setPresentationGameLog, setPresentationState]);

    const deleteCinematic = useCallback((cinematicId: string) => {
        setPresentationState(prev => {
            if (!prev) return null;
            const cinematics = (prev.cinematics || []).filter(c => c.id !== cinematicId);
            setPresentationGameLog(p => [t('CinematicDeleted'), ...p]);
            return { ...prev, cinematics };
        });
    }, [setPresentationState, setPresentationGameLog, t]);

    const updateCinematic = useCallback((cinematicId: string, updates: Partial<Omit<Cinematic, 'id'>>) => {
        setPresentationState(prev => {
            if (!prev) return null;
            const newCinematics = (prev.cinematics || []).map(c => {
                if (c.id === cinematicId) {
                    return { ...c, ...updates };
                }
                return c;
            });
            setPresentationGameLog(p => [t('CinematicUpdated'), ...p]);
            return { ...prev, cinematics: newCinematics };
        });
    }, [setPresentationState, setPresentationGameLog, t]);

    const regenerateCinemaFrame = useCallback(async (cinematicId: string, frameIndex: number, newPrompt: string): Promise<boolean> => {
        if (gameSettings?.disableImageGeneration || gameContextRef.current?.gameSettings?.disableImageGeneration) return false;
        try {
            const imageUrl = await requestArenaGmImage(newPrompt, 1024, 1024);
            if (imageUrl) {
                setPresentationState(prev => {
                    if (!prev) return null;
                    const newCinematics = (prev.cinematics || []).map(c => {
                        if (c.id === cinematicId) {
                            const newFrames = [...c.frames];
                            if (newFrames[frameIndex]) {
                                newFrames[frameIndex] = { ...newFrames[frameIndex], imagePrompt: newPrompt, imageUrl: imageUrl };
                            }
                            return { ...c, frames: newFrames };
                        }
                        return c;
                    });
                    setPlayingCinematic(currentPlaying => {
                        if (currentPlaying && currentPlaying.id === cinematicId) {
                            const newFrames = [...currentPlaying.frames];
                            if (newFrames[frameIndex]) {
                                newFrames[frameIndex] = { ...newFrames[frameIndex], imagePrompt: newPrompt, imageUrl: imageUrl };
                            }
                            return { ...currentPlaying, frames: newFrames };
                        }
                        return currentPlaying;
                    });
                    return { ...prev, cinematics: newCinematics };
                });
                return true;
            }
            return false;
        } catch (e: any) {
            setError(formatError(e));
            return false;
        }
    }, [gameSettings, gameContextRef, setPresentationState, setError]);

    const generateCinematicAudio = useCallback(async (cinematicId: string, voice: string) => {
        setIsGeneratingCinema(true);
        setCinemaGenerationProgress({ current: 0, total: 1, message: t('GeneratingAudio') });

        try {
            const cinematic = gameStateRef.current?.cinematics?.find(c => c.id === cinematicId);
            if (!cinematic) throw new Error("Cinematic not found");

            const fullText = cinematic.frames.map(f => f.subtitle).join('\n');
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: `Narrate dramatically: ${fullText}` }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voice as any },
                        },
                    },
                },
            });
            const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (audioData) {
                // FIX: Changed audio_base_64 to audio_base64 to match interface
                updateCinematic(cinematicId, { audio_base64: audioData, audio_voice: voice });
                setCinemaGenerationProgress({ current: 1, total: 1, message: t('AudioReady') });
            } else {
                throw new Error("No audio data returned");
            }
        } catch (e: any) {
            setError(formatError(e));
        } finally {
            setIsGeneratingCinema(false);
        }
    }, [updateCinematic, setError, t, gameStateRef]);

    return {
        gameState,
        gameHistory,
        isLoading,
        error,
        ...allManagers,
        resumeInterruptedTurn: resumeInterruptedTurnSafely,
        sendMessage: sendMessageWithStashClear,
        askQuestion: askQuestionWithRecovery,
        lastJsonResponse,
        // FIX: Correctly map the `lastRequestJson` state variable to the `lastRequestJsonForDebug` property in the returned object.
        lastRequestJsonForDebug: lastRequestJson,
        gameLog,
        combatLog,
        sceneImagePrompt,
        suggestedActions,
        visitedLocations,
        worldState,
        gameSettings,
        updateGameSettings,
        superInstructions,
        updateSuperInstructions,
        turnNumber,
        autosaveTimestamp,
        crashRecoveryInfo,
        crashRecoveryMarker,
        loadCrashRecovery,
        interruptedTurnRecovery,
        resumeInterruptedGameTurn,
        discardInterruptedGameTurn,
        recordCrash,
        dbSaveSlots,
        musicPrompt,
        isMusicLoading,
        isMusicPlayerVisible,
        handlePrimaryMusicClick,
        generateMusicPrompt,
        closeMusicPlayer,
        updateMusicPrompt,
        generateSurpriseMusicPrompt,
        currentStep,
        currentModel,
        turnTime,
        onImageGenerated,
        editLocationData,
        updatePlayerPortrait,
        addPlayer,
        removePlayer,
        passTurnToPlayer,
        passTurnManually,
        deleteActiveSkill,
        deletePassiveSkill,
        onEditNpcMemory,
        onDeleteNpcMemory,
        clearAllCompletedFactionProjects,
        clearAllCompletedNpcActivities,
        onDeleteCurrentActivity,
        onDeleteCompletedActivity,
        deleteFactionProject,
        deleteFactionCompletedProject,
        deleteFactionCustomState,
        worldMap,
        updateNpcPortrait,
        deleteLocationThreat,
        isGeneratingCinema,
        cinemaGenerationProgress,
        generateFilmTrailer,
        playingCinematic,
        playCinematic,
        stopPlayingCinematic,
        exportCinematic,
        importCinematic,
        deleteCinematic,
        continueFilmTrailer,
        extendingCinematicId,
        cancelCinemaGeneration,
        updateCinematic,
        regenerateCinemaFrame,
        generateCinematicAudio,
        // FIX: Added missing properties to the return object of the useGameLogic hook.
        isCinemaVisible,
        cinemaFrames,
        closeCinemaPlayer,
        lastTurnSaveFile,
        regenerateLastResponse,
        deleteActiveEffect,
        forgetHealedWound,
        forgetActiveWound,
        clearAllHealedWounds,
        deleteCustomState,
        deleteNpcCustomState,
        deleteFactionBonus,
        clearNpcJournalsNow,
        isSaving,
        deleteImageFromCache,
        clearImageCache,
    };
}
