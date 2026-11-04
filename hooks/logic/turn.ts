import { networkSafeSaveFile } from '../../utils/networkSavePrivacy';

import React from 'react';
import { GameState, GameContext, ChatMessage, GameResponse, WorldStateFlag, Location, NPC, PeerInfo, NetworkRole, GameSettings, NetworkMessage, SaveFile } from '../../types';
import { executeTurn, askGmQuestion as executeGmQuestion, getModelForStep, executeWorldProgression } from '../../utils/gemini';
import { createInitialContext, buildNextContext, WorldMapWarning } from '../../utils/gameContext';
import { formatError } from '../../utils/errorUtils';
import { playNotificationSound } from '../../utils/soundManager';
import { DataConnection } from 'peerjs';
import { sendOnOpenConnection } from '../../utils/peerSend';
import type { TurnSyncStamp } from '../../utils/networkTurnProtocol';
import { deepMergeResponses, processAndApplyResponse } from '../../utils/responseProcessor';
import { deepStripModerationSymbols } from '../../utils/textUtils';
import { acquireArenaGmTurnLease } from '../../utils/arenaGmRelay';
import { shouldRunWorldProgression } from '../../utils/worldProgression.js';
import { clearInterruptedTurnRecoveryIfUnchanged, saveInterruptedTurnRecovery, type InterruptedTurnRecovery } from '../../utils/fileManager';


const asArray = <T>(value: T | T[] | null | undefined): T[] => {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.filter(item => item !== null && item !== undefined);
    return [value];
};
const isObject = (item: any): item is object => (item && typeof item === 'object' && !Array.isArray(item));

// Distinguish explicit cancellation from sync/role aborts. Only the former
// discards this turn's own recovery record.
const USER_CANCELLED_TURN = Symbol('user-cancelled-turn');

// Stopping the wait does not cancel a network send or prove non-delivery.
const waitForSendOrAbort = (send: Promise<void>, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(new DOMException('Turn cancelled.', 'AbortError')); };
    send.then(() => { signal.removeEventListener('abort', onAbort); resolve(); }, error => { signal.removeEventListener('abort', onAbort); reject(error); });
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
});

export const createTurnManager = (
    {
        gameState, setGameState, gameHistory, setGameHistory,
        isLoading, setIsLoading, setError,
        setLastJsonResponse, setLastRequestJson,
        setGameLog, setCombatLog, setSceneImagePrompt, setSuggestedActions,
        setWorldMap, setVisitedLocations, setWorldState, setTurnNumber,
        gameContextRef, abortControllerRef,
        syncRevisionRef = { current: 0 }, activeTurnRef = { current: null }, turnPhaseRef = { current: 'idle' },
        clientTurnStampRef, pendingNetworkTurnRef, hostRestorePendingRef,
        gameplayMutationRevisionRef = { current: 0 }, gameplayMutationPendingRef = { current: false },
        setSuperInstructions, setGameSettings,
        setLanguage,
        t,
        turnStartTimeRef, setTurnTime, setCurrentStep, setCurrentModel,
        language,
        gameSettings,
        hostConnectionRef,
        gameStateRef,
        broadcastFullSync,
        combatLog,
        gameLog,
        packageSaveDataForTurn,
        setLastTurnSaveFile
    }: {
        gameState: GameState | null,
        setGameState: React.Dispatch<React.SetStateAction<GameState | null>>,
        gameHistory: ChatMessage[],
        setGameHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
        isLoading: boolean,
        setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
        setError: React.Dispatch<React.SetStateAction<string | null>>,
        setLastJsonResponse: React.Dispatch<React.SetStateAction<string | null>>,
        setLastRequestJson: React.Dispatch<React.SetStateAction<string | null>>,
        setGameLog: React.Dispatch<React.SetStateAction<string[]>>,
        setCombatLog: React.Dispatch<React.SetStateAction<string[]>>,
        setSceneImagePrompt: React.Dispatch<React.SetStateAction<string | null>>,
        setSuggestedActions: React.Dispatch<React.SetStateAction<string[]>>,
        setWorldMap: React.Dispatch<React.SetStateAction<Record<string, Location>>>,
        setVisitedLocations: React.Dispatch<React.SetStateAction<Location[]>>,
        setWorldState: React.Dispatch<React.SetStateAction<any>>,
        setTurnNumber: React.Dispatch<React.SetStateAction<number | null>>,
        gameContextRef: React.MutableRefObject<GameContext | null>,
        abortControllerRef: React.MutableRefObject<AbortController | null>,
        syncRevisionRef?: React.MutableRefObject<number>,
        activeTurnRef?: React.MutableRefObject<symbol | null>,
        turnPhaseRef?: React.MutableRefObject<'idle' | 'generating' | 'sending' | 'committed' | 'awaiting-sync'>,
        clientTurnStampRef?: React.MutableRefObject<TurnSyncStamp | null>,
        pendingNetworkTurnRef?: React.MutableRefObject<string | null>,
        hostRestorePendingRef?: React.MutableRefObject<unknown | null>,
        gameplayMutationRevisionRef?: React.MutableRefObject<number>,
        gameplayMutationPendingRef?: React.MutableRefObject<boolean>,
        setSuperInstructions: React.Dispatch<React.SetStateAction<string>>,
        setGameSettings: React.Dispatch<React.SetStateAction<any>>,
        setLanguage: (lang: any) => void,
        t: (key: string, replacements?: any) => string,
        turnStartTimeRef: React.MutableRefObject<number | null>,
        setTurnTime: React.Dispatch<React.SetStateAction<number | null>>,
        setCurrentStep: React.Dispatch<React.SetStateAction<string | null>>,
        setCurrentModel: React.Dispatch<React.SetStateAction<string | null>>,
        language: any,
        gameSettings: GameSettings | null,
        hostConnectionRef: React.MutableRefObject<DataConnection | null>,
        gameStateRef: React.RefObject<GameState | null>,
        broadcastFullSync: (saveData: SaveFile) => void | Promise<void>,
        combatLog: string[],
        gameLog: string[],
        packageSaveDataForTurn?: () => SaveFile | null;
        setLastTurnSaveFile?: React.Dispatch<React.SetStateAction<SaveFile | null>>;
    }
) => {
    // Clear the previous stash only in the candidate state. A rejected turn
    // must leave it available, and a successful turn may create a new stash.
    const withoutPreviousStash = (state: GameState): GameState =>
        state.temporaryStash?.length ? { ...state, temporaryStash: [] } : state;

    const retainPresentation = (state: GameState, latest: GameState | null): GameState => ({
        ...state,
        ...(latest?.imageCache !== undefined ? { imageCache: latest.imageCache } : {}),
        ...(latest?.cinematics !== undefined ? { cinematics: latest.cinematics } : {})
    });

    // The host displays its own character even while another player owns the
    // turn. GM processing, however, applies primary changes to the active
    // player. Never feed the displayed host into the active guest slot.
    const prepareHostTurn = (state: GameState, context: GameContext) => {
        if (state.networkRole !== 'host') return { state, context };
        const ids = state.players.map(p => p?.playerId);
        const displayedId = state.playerCharacter?.playerId;
        if (!state.myPeerId || ids.some(id => !id) || new Set(ids).size !== ids.length ||
            !ids.includes(state.myPeerId) || !displayedId || !ids.includes(displayedId) ||
            !Number.isSafeInteger(state.activePlayerIndex) || !state.players[state.activePlayerIndex]) {
            throw new Error(t('host_turn_identity_conflict'));
        }
        const players = state.players.map(p => p.playerId === displayedId ? state.playerCharacter : p);
        const active = players[state.activePlayerIndex];
        return { state: { ...state, players, playerCharacter: active }, context: { ...context, players, playerCharacter: active } };
    };
    const restoreHostView = (state: GameState, context: GameContext, hostId: string | null | undefined) => {
        const hosts = state.players.filter(p => p.playerId === hostId);
        if (!hostId || hosts.length !== 1) throw new Error(t('host_turn_identity_conflict'));
        state.playerCharacter = hosts[0];
        context.playerCharacter = hosts[0];
    };

    const handleTurn = async (context: GameContext, fullHistoryForTurn: ChatMessage[], baseStateOverride?: GameState) => {
        if (activeTurnRef.current) return;
        if (hostRestorePendingRef?.current) { setError(t('host_sync_not_ready')); return; }
        if (gameplayMutationPendingRef.current) { setError(t('game_state_updating')); return; }
        const turnToken = Symbol('turn');
        activeTurnRef.current = turnToken;
        turnPhaseRef.current = 'generating';
        const startingRevision = syncRevisionRef.current;
        const startingGameplayRevision = gameplayMutationRevisionRef.current;
        const isPlayerTurn = (baseStateOverride || gameStateRef.current)?.networkRole === 'player';
        const startingStamp = clientTurnStampRef?.current ? { ...clientTurnStampRef.current } : null;
        if (isPlayerTurn && clientTurnStampRef && !startingStamp) {
            activeTurnRef.current = null; turnPhaseRef.current = 'idle';
            setIsLoading(false); setError(t('network_sync_not_ready'));
            return;
        }
        const wasSuperseded = () => syncRevisionRef.current !== startingRevision || gameplayMutationRevisionRef.current !== startingGameplayRevision;
        setIsLoading(true);
        setError(null);
        const startingCombatLog = context.enemiesDataForCurrentTurn?.length ? combatLog : [];
        if (startingCombatLog !== combatLog) setCombatLog([]);
        setGameLog([]);
        setLastJsonResponse('');
        setSuggestedActions([]);
        const turnController = new AbortController();
        abortControllerRef.current = turnController;
        // Each turn owns its lease; never share it with the separate Ask GM flow.
        let releaseArenaGmTurn: (() => void) | null = null;
        // Errors after committing the state (e.g. broadcasting it) must not
        // roll back its logs or suggest that the user repeat the action.
        let stateCommitted = false;
        let playerSendAttempted = false;
        let checkpoint: InterruptedTurnRecovery | null = null;
        const clearOwnCheckpoint = async () => {
            if (checkpoint) await clearInterruptedTurnRecoveryIfUnchanged(checkpoint);
        };
        const reportSuperseded = () => {
            const warning = t(syncRevisionRef.current !== startingRevision ? (playerSendAttempted ? 'turn_sync_during_send' : 'turn_sync_before_send') : 'turn_game_state_changed');
            setError(warning);
            setGameHistory(prev => [...prev, { sender: 'system', content: warning }]);
            setIsLoading(false);
        };

        try {
            const onPartialResponse = (response: any, stepName: string, modelName: string) => {
                if (wasSuperseded()) return;
                setLastJsonResponse(JSON.stringify(response, null, 2));
                if (response.items_and_stat_calculations) {
                    setGameLog(response.items_and_stat_calculations);
                }
            };
            const onStepStart = (stepName: string, modelName: string) => {
                if (wasSuperseded()) return;
                setCurrentStep(stepName);
                setCurrentModel(getModelForStep(stepName, context));
            };
            const onStreamingChunk = (text: string) => {
                if (wasSuperseded()) return;
                setLastJsonResponse(text);
            };

            let baseState: GameState | null = baseStateOverride || gameStateRef.current;

            if (!baseState) {
                const errorMsg = "Critical error: Game state is missing when trying to process a turn. This might be due to a stale state closure. Aborting turn.";
                console.error(errorMsg);
                setError(errorMsg);
                setIsLoading(false);
                return;
            }
            
            ({ state: baseState, context } = prepareHostTurn(baseState, context));
            setLastRequestJson(JSON.stringify(context, null, 2));

            // Save the submitted action and its pre-turn state before the first relay request.
            // If the browser reloads, the start screen can replay this exact action from the saved baseline.
            if (baseState.networkRole === 'none') {
                try {
                    checkpoint = await saveInterruptedTurnRecovery({ context, baseState, history: fullHistoryForTurn });
                } catch (recoveryError) {
                    console.error('Could not persist interrupted-turn recovery checkpoint:', recoveryError);
                    setError(t('Could not save the interrupted turn checkpoint. The game will continue, but a browser reload may lose this action.'));
                }
            }

            if (turnController.signal.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
            // Keep automatic/optional image jobs out of the mailbox for the entire staged turn.
            releaseArenaGmTurn = await acquireArenaGmTurnLease(turnController.signal);
            const finalResponseRaw = await executeTurn(
                context,
                turnController.signal,
                onPartialResponse,
                onStreamingChunk,
                onStepStart
            );
            
            if (wasSuperseded()) { reportSuperseded(); return; }
            if (turnController.signal.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
            const finalResponse = deepStripModerationSymbols(finalResponseRaw);
          
            if (context.gameSettings.allowHistoryManipulation !== true && finalResponse.playerBehaviorAssessment?.historyManipulationCoefficient >= 0.8) {
                setError(t("history_manipulation_rejection"));
                setGameHistory(prev => prev.slice(0, -1)); // Remove the offending player message
                setIsLoading(false);
                await clearOwnCheckpoint().catch(error => console.error('Could not clear rejected turn checkpoint:', error));
                return;
            }
          
            setLastJsonResponse(JSON.stringify(finalResponse, null, 2));
            const gmMessage: ChatMessage = { sender: 'gm', content: finalResponse.response || '' };

            // FIX: Passing context.worldMap to processAndApplyResponse to prevent data bleeding
            let { newState, logsToAdd, combatLogsToAdd, processedResponse } = processAndApplyResponse(finalResponse, withoutPreviousStash(baseState), context.gameSettings, t, true, context.currentTurnNumber, context.worldMap);
            newState = retainPresentation(newState, gameStateRef.current);
            const applyResponsePresentation = () => {
                if (finalResponse.image_prompt !== undefined && finalResponse.image_prompt !== null) {
                    setSceneImagePrompt(finalResponse.image_prompt);
                }
                setSuggestedActions(finalResponse.dialogueOptions || []);
            };

            // Save the thought signature to the game state for the next turn
            if (finalResponse.thoughtSignature) {
                newState.thoughtSignature = finalResponse.thoughtSignature;
            }
            
            const newHistoryWithAnswer = [...fullHistoryForTurn, gmMessage];
            const onWorldMapWarning = (warning: WorldMapWarning) => {
                newHistoryWithAnswer.push({ sender: 'system', content: t(`world_map_warning_${warning.kind}`, { subject: warning.subject }) });
            };
            const currentRole = baseState.networkRole;

            if (currentRole === 'player') {
                const nextContext = buildNextContext(context, processedResponse, newState, newHistoryWithAnswer, true, onWorldMapWarning);

                const newSaveData: SaveFile = {
                    gameContext: nextContext,
                    gameState: newState,
                    gameHistory: newHistoryWithAnswer,
                    gameLog: [...asArray(finalResponse.items_and_stat_calculations), ...logsToAdd],
                    combatLog: startingCombatLog.concat(combatLogsToAdd),
                    lastJsonResponse: JSON.stringify(finalResponse, null, 2),
                    sceneImagePrompt: finalResponse.image_prompt || null,
                    timestamp: new Date().toISOString()
                };
                
                if (hostConnectionRef.current) {
                    const message: NetworkMessage = {
                        type: 'turn_result_from_player',
                        payload: { saveFile: networkSafeSaveFile(newSaveData), ...(startingStamp ? { submission: { turnId: crypto.randomUUID(), base: startingStamp } } : {}) },
                        senderId: baseState.myPeerId!,
                    };
                    if (turnController.signal.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
                    playerSendAttempted = true;
                    if (pendingNetworkTurnRef) pendingNetworkTurnRef.current = message.payload.submission?.turnId || null;
                    turnPhaseRef.current = 'sending';
                    await waitForSendOrAbort(sendOnOpenConnection(hostConnectionRef.current, message), turnController.signal);
                    if (wasSuperseded()) { reportSuperseded(); return; }
                    if (turnController.signal.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
                    
                    // Optimistic update for UI responsiveness
                    applyResponsePresentation();
                    setGameHistory(newHistoryWithAnswer);
                    setGameLog([...asArray(finalResponse.items_and_stat_calculations), ...logsToAdd]);
                    if (combatLogsToAdd.length > 0) {
                        setCombatLog(prev => [...prev, ...combatLogsToAdd]);
                    }
                    gameContextRef.current = nextContext;
                    setWorldMap(nextContext.worldMap);
                    setVisitedLocations(nextContext.visitedLocations);
                    setWorldState(nextContext.worldState);
                    setTurnNumber(nextContext.currentTurnNumber);
                    setGameState(previous => retainPresentation(newState, previous));
                    stateCommitted = true;
                    turnPhaseRef.current = 'awaiting-sync';
                    // isLoading remains true until sync from host
                } else {
                    setGameLog(gameLog);
                    setCombatLog(combatLog);
                    setError(t("connection_lost"));
                    setIsLoading(false);
                }
            } else { // Host or local
                const nextContext = buildNextContext(context, processedResponse, newState, newHistoryWithAnswer, true, onWorldMapWarning);
                if (currentRole === 'host') restoreHostView(newState, nextContext, baseState.myPeerId);
                applyResponsePresentation();

                setGameLog([...asArray(finalResponse.items_and_stat_calculations), ...logsToAdd]);
                if (combatLogsToAdd.length > 0) {
                    setCombatLog(prev => [...prev, ...combatLogsToAdd]);
                }
                setGameHistory(newHistoryWithAnswer);
                
                gameContextRef.current = nextContext;
                setWorldMap(nextContext.worldMap);
                setVisitedLocations(nextContext.visitedLocations);
                setWorldState(nextContext.worldState);
                setTurnNumber(nextContext.currentTurnNumber);
                
                if (nextContext.gameSettings.notificationSound) {
                    playNotificationSound();
                }

                setGameState(previous => retainPresentation(newState, previous));
                stateCommitted = true;
                turnPhaseRef.current = 'committed';

                if (currentRole === 'host') {
                    const newSaveData: SaveFile = {
                        gameContext: nextContext,
                        gameState: newState,
                        gameHistory: newHistoryWithAnswer,
                        gameLog: [...asArray(finalResponse.items_and_stat_calculations), ...logsToAdd],
                        combatLog: startingCombatLog.concat(combatLogsToAdd),
                        lastJsonResponse: JSON.stringify(finalResponse, null, 2),
                        sceneImagePrompt: finalResponse.image_prompt || null,
                        timestamp: new Date().toISOString()
                    };
                    await broadcastFullSync(newSaveData);
                }
            }
            if (baseState.networkRole === 'none') {
                await clearOwnCheckpoint().catch(error => console.error('Could not clear completed-turn checkpoint:', error));
            }
          
        } catch (err: any) {
          if (turnController.signal.reason === USER_CANCELLED_TURN) {
            await clearOwnCheckpoint().catch(error => console.error('Could not clear cancelled-turn checkpoint:', error));
          }
          if (wasSuperseded()) { reportSuperseded(); return; }
          // Roll back streamed calculations only if the state was not applied.
          // A post-commit sync error must retain the committed logs and story.
          if (!stateCommitted) {
            setGameLog(gameLog);
            setCombatLog(combatLog);
          }
          setIsLoading(false);
          if (err.name !== 'AbortError' || stateCommitted || playerSendAttempted) {
            const detail = formatError(err);
            const formattedError = stateCommitted ? `${t('error_turn_applied_followup')}\n\n${detail}` : playerSendAttempted ? `${t('error_turn_delivery_unknown')}\n\n${detail}` : detail;
            setError(formattedError);
            const systemMessage: ChatMessage = { sender: 'system', content: `Error: ${formattedError}` };
            setGameHistory(prev => [...prev, systemMessage]);
          }
        } finally {
            if (activeTurnRef.current === turnToken) {
                activeTurnRef.current = null;
                if (turnPhaseRef.current !== 'awaiting-sync') turnPhaseRef.current = 'idle';
            }
            if (gameStateRef.current?.networkRole !== 'player') {
                setIsLoading(false);
                if (turnStartTimeRef.current) {
                    const endTime = performance.now();
                    const elapsedTime = endTime - turnStartTimeRef.current;
                    setTurnTime(elapsedTime);
                    turnStartTimeRef.current = null;
                }
            }
            const releaseTurnLease = releaseArenaGmTurn;
            releaseArenaGmTurn = null;
            releaseTurnLease?.();
        }
    };
    
    const sendMessage = (message: string, image?: { data: string; mimeType: string; } | null, clearCollective = false) => {
        if (isLoading || activeTurnRef.current) return;
        if (gameStateRef.current?.networkRole === 'spectator') { setError(t('spectator_cannot_submit_turn')); return; }
        if (hostRestorePendingRef?.current) { setError(t('host_sync_not_ready')); return; }
        if (gameplayMutationPendingRef.current) { setError(t('game_state_updating')); return; }
        if (gameStateRef.current?.networkRole === 'player' && clientTurnStampRef && !clientTurnStampRef.current) {
            setError(t('network_sync_not_ready')); return;
        }

        if (packageSaveDataForTurn && setLastTurnSaveFile) {
            const saveData = packageSaveDataForTurn();
            if (saveData) {
                setLastTurnSaveFile(saveData);
            }
        }
        
        turnStartTimeRef.current = performance.now();
        setTurnTime(null);
        setCurrentStep(null);
        setCurrentModel(null);
        const playerMessage: ChatMessage = { sender: 'player', content: message };
        setSuggestedActions([]);
        
        const newHistory = [...gameHistory, playerMessage];
        setGameHistory(newHistory);

        const newContext = { ...gameContextRef.current! };
        const baseState = clearCollective && gameStateRef.current
            ? { ...gameStateRef.current, collectiveActionState: null }
            : undefined;
        if (clearCollective) (newContext as any).collectiveActionState = null;
        newContext.message = message;
        newContext.image = image || null;
        newContext.responseHistory = newHistory.slice(-15);
        // Use the signature from the current game state to continue the thought process
        if (gameState && gameState.thoughtSignature) {
            newContext.previousThoughtSignature = gameState.thoughtSignature;
        }
        setLastRequestJson(JSON.stringify(newContext, null, 2));
        
        // The caller may hold cross-tab coordination until generation and
        // delivery finish. The turn still starts synchronously as before.
        return handleTurn(newContext, newHistory, baseState);
    };

    const initializeAndRunFirstTurn = (creationData: any, networkConfig: { role: NetworkRole, peerId?: string } = { role: 'none' }) => {
        const initialContext = createInitialContext(creationData, language);
        gameContextRef.current = initialContext;

        const baseState: GameState = {
            playerCharacter: initialContext.playerCharacter,
            players: [initialContext.playerCharacter],
            activePlayerIndex: 0,
            currentLocationData: initialContext.currentLocation as Location,
            activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [],
            enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null,
            worldStateFlags: [], worldEventsLog: [], imageCache: {},
            networkRole: networkConfig.role,
            myPeerId: networkConfig.peerId || null,
            hostPeerId: networkConfig.role === 'host' ? networkConfig.peerId : (networkConfig.role === 'player' || networkConfig.role === 'spectator' ? creationData.hostId : null),
            peers: [],
            isConnectedToHost: networkConfig.role === 'host' || networkConfig.role === 'none',
            playerNeedsToCreateCharacter: false,
        };
        
        if (networkConfig.role === 'host' && networkConfig.peerId) {
            const hostPeerInfo: PeerInfo = {
                id: networkConfig.peerId,
                name: creationData.multiplayerNickname || creationData.playerName || `Player-${networkConfig.peerId.slice(-4)}`
            };
            baseState.peers.push(hostPeerInfo);
    
            baseState.playerCharacter.playerId = networkConfig.peerId;
            baseState.players[0].playerId = networkConfig.peerId;
            
            initialContext.playerCharacter.playerId = networkConfig.peerId;
            initialContext.players[0].playerId = networkConfig.peerId;
            initialContext.peers = baseState.peers;
        }

        setGameState(baseState);
        setSuperInstructions(initialContext.superInstructions || '');
        setWorldMap(initialContext.worldMap);
        setVisitedLocations(initialContext.visitedLocations);
        setWorldState(initialContext.worldState);
        setGameSettings(initialContext.gameSettings);
        setTurnNumber(initialContext.currentTurnNumber);
        turnStartTimeRef.current = performance.now();
        setTurnTime(null);
        const initialMessage = { sender: 'player', content: creationData.initialPrompt } as ChatMessage;
        const newHistory = [initialMessage];
        setGameHistory(newHistory);
        const contextWithHistory = { ...initialContext, responseHistory: newHistory };
        setLastRequestJson(JSON.stringify(contextWithHistory, null, 2));
        handleTurn(contextWithHistory, newHistory, baseState);
    };

    const askQuestion = async (question: string, image?: { data: string; mimeType: string; } | null) => {
        let baseState: GameState | null = gameStateRef.current;
        if (!gameContextRef.current || isLoading || !baseState || activeTurnRef.current) return;
        if (baseState.networkRole === 'spectator') { setError(t('spectator_cannot_submit_turn')); return; }
        if (hostRestorePendingRef?.current) { setError(t('host_sync_not_ready')); return; }
        if (gameplayMutationPendingRef.current) { setError(t('game_state_updating')); return; }
        const startingStamp = clientTurnStampRef?.current ? { ...clientTurnStampRef.current } : null;
        if (baseState.networkRole === 'player' && clientTurnStampRef && !startingStamp) {
            setError(t('network_sync_not_ready'));
            return;
        }
    
        if (packageSaveDataForTurn && setLastTurnSaveFile) {
            const saveData = packageSaveDataForTurn();
            if (saveData) {
                setLastTurnSaveFile(saveData);
            }
        }
    
        turnStartTimeRef.current = performance.now();
        setTurnTime(null);
        setCurrentStep(null);
        setCurrentModel(null);
        setIsLoading(true);
        setError(null);
        const startingCombatLog = gameContextRef.current?.enemiesDataForCurrentTurn?.length ? combatLog : [];
        if (startingCombatLog !== combatLog) setCombatLog([]);
        setLastJsonResponse('');
        setSuggestedActions([]);
        const turnController = new AbortController();
        abortControllerRef.current = turnController;
    
        const questionMessage: ChatMessage = { sender: 'player', content: `[Question] ${question}` };
        const historyWithQuestion = [...gameHistory, questionMessage];
        setGameHistory(historyWithQuestion);
    
        // The OOC instruction is a one-request override, not a new campaign
        // instruction. Preserve the pre-question value in the resulting save.
        const retainedSuperInstructions = gameContextRef.current.superInstructions;
        let context: GameContext = {
            ...gameContextRef.current, 
            message: question,
            image: image || null,
            superInstructions: "The user is asking a question out-of-character. Answer it as the Game Master based on the rules and current state, then return to the game.",
            currentStepFocus: 'StepQuestion_CorrectionAndClarification_TaskGuide',
            partiallyGeneratedResponse: null,
            responseHistory: historyWithQuestion.slice(-15),
            // Use previous thought signature if available
            previousThoughtSignature: baseState.thoughtSignature
        };
        setLastRequestJson(JSON.stringify(context, null, 2));
        const turnToken = Symbol('question');
        activeTurnRef.current = turnToken;
        turnPhaseRef.current = 'generating';
        const startingRevision = syncRevisionRef.current;
        const startingGameplayRevision = gameplayMutationRevisionRef.current;
        const wasSuperseded = () => syncRevisionRef.current !== startingRevision || gameplayMutationRevisionRef.current !== startingGameplayRevision;
        let stateCommitted = false;
        let playerSendAttempted = false;
        const reportSuperseded = () => {
            const warning = t(syncRevisionRef.current !== startingRevision ? (playerSendAttempted ? 'turn_sync_during_send' : 'turn_sync_before_send') : 'turn_game_state_changed');
            setError(warning);
            setGameHistory(prev => [...prev, { sender: 'system', content: warning }]);
            setIsLoading(false);
        };

        try {
            ({ state: baseState, context } = prepareHostTurn(baseState, context));
            setLastRequestJson(JSON.stringify(context, null, 2));
            const onStepStart = (stepName: string, modelName: string) => {
              if (wasSuperseded()) return;
              setCurrentStep(stepName);
              setCurrentModel(getModelForStep(stepName, context));
            };
            const onStreamingChunk = (text: string) => {
              if (wasSuperseded()) return;
              setLastJsonResponse(text);
            };
    
            const finalResponseRaw: GameResponse = await executeGmQuestion(context, turnController.signal, onStreamingChunk, onStepStart);
            if (wasSuperseded()) { reportSuperseded(); return; }
            if (turnController.signal.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
            const finalResponse = deepStripModerationSymbols(finalResponseRaw);
            
            let finalMergedResponse = finalResponse;
            const gmMessage: ChatMessage = { sender: 'gm', content: finalResponse.response || '' };
    
            if (shouldRunWorldProgression(finalResponse.generateWorldProgression, context.gameSettings)) {
                const wpContext = { ...context, responseHistory: [...historyWithQuestion, gmMessage] };
                const wpResponseRaw = await executeWorldProgression(wpContext, turnController.signal, onStreamingChunk, (r, s, m) => { if (!wasSuperseded()) setLastJsonResponse(JSON.stringify(r, null, 2)); }, onStepStart);
                const wpResponse = deepStripModerationSymbols(wpResponseRaw);
                finalMergedResponse = deepMergeResponses(finalResponse, wpResponse);
                
                // If World Progression returns a new signature, use it. Otherwise keep the one from the question.
                if (wpResponse.thoughtSignature) {
                    finalMergedResponse.thoughtSignature = wpResponse.thoughtSignature;
                } else if (finalResponse.thoughtSignature) {
                    finalMergedResponse.thoughtSignature = finalResponse.thoughtSignature;
                }
            }
            
            if (wasSuperseded()) { reportSuperseded(); return; }
            if (turnController.signal.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
            setLastJsonResponse(JSON.stringify(finalMergedResponse, null, 2));
    
            // FIX: Passing context.worldMap instead of visitedLocations
            let { newState, logsToAdd, combatLogsToAdd, processedResponse } = processAndApplyResponse(finalMergedResponse as GameResponse, withoutPreviousStash(baseState), gameSettings, t, false, context.currentTurnNumber, context.worldMap);
            
            newState = retainPresentation(newState, gameStateRef.current);
            // Save the signature if present
            if (finalMergedResponse.thoughtSignature) {
                newState.thoughtSignature = finalMergedResponse.thoughtSignature;
            }

            const newHistoryWithAnswer = [...historyWithQuestion, gmMessage];
            const onWorldMapWarning = (warning: WorldMapWarning) => {
                newHistoryWithAnswer.push({ sender: 'system', content: t(`world_map_warning_${warning.kind}`, { subject: warning.subject }) });
            };
            const newLogsForThisTurn = [...asArray(finalMergedResponse.items_and_stat_calculations), ...logsToAdd];
            
            const currentRole = baseState.networkRole;
    
            if (currentRole === 'player') {
                const nextContext = buildNextContext({ ...context, superInstructions: retainedSuperInstructions }, processedResponse, newState, newHistoryWithAnswer, false, onWorldMapWarning);
                const newSaveData: SaveFile = {
                    gameContext: nextContext,
                    gameState: newState,
                    gameHistory: newHistoryWithAnswer,
                    gameLog: [...gameLog, ...newLogsForThisTurn],
                    combatLog: [...startingCombatLog, ...combatLogsToAdd],
                    lastJsonResponse: JSON.stringify(finalMergedResponse, null, 2),
                    sceneImagePrompt: finalMergedResponse.image_prompt || null,
                    timestamp: new Date().toISOString()
                };
                
                if (hostConnectionRef.current) {
                    const message: NetworkMessage = {
                        type: 'turn_result_from_player',
                        payload: { saveFile: networkSafeSaveFile(newSaveData), ...(startingStamp ? { submission: { turnId: crypto.randomUUID(), base: startingStamp } } : {}) },
                        senderId: baseState.myPeerId!,
                    };
                    if (turnController.signal.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
                    playerSendAttempted = true;
                    if (pendingNetworkTurnRef) pendingNetworkTurnRef.current = message.payload.submission?.turnId || null;
                    turnPhaseRef.current = 'sending';
                    await waitForSendOrAbort(sendOnOpenConnection(hostConnectionRef.current, message), turnController.signal);
                    if (wasSuperseded()) { reportSuperseded(); return; }
                    if (turnController.signal.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
                    
                    // Optimistic update for UI responsiveness
                    setGameHistory(newHistoryWithAnswer);
                    setGameLog(prev => [...prev, ...newLogsForThisTurn]);
                    if (combatLogsToAdd.length > 0) {
                        setCombatLog(prev => [...prev, ...combatLogsToAdd]);
                    }
                    gameContextRef.current = nextContext;
                    setWorldMap(nextContext.worldMap);
                    setVisitedLocations(nextContext.visitedLocations);
                    setWorldState(nextContext.worldState);
                    setTurnNumber(nextContext.currentTurnNumber);
                    setGameState(previous => retainPresentation(newState, previous));
                    stateCommitted = true;
                    turnPhaseRef.current = 'awaiting-sync';
                    // isLoading remains true until sync from host
                } else {
                    setGameLog(gameLog);
                    setCombatLog(combatLog);
                    setError(t("connection_lost"));
                    setIsLoading(false);
                }
            } else { // Host or local
                setGameLog(prev => [...prev, ...newLogsForThisTurn]);
                if (combatLogsToAdd.length > 0) {
                    setCombatLog(prev => [...prev, ...combatLogsToAdd]);
                }
                
                const nextContext = buildNextContext({ ...context, superInstructions: retainedSuperInstructions }, processedResponse, newState, newHistoryWithAnswer, false, onWorldMapWarning);
                if (currentRole === 'host') restoreHostView(newState, nextContext, baseState.myPeerId);
                gameContextRef.current = nextContext;
    
                setGameHistory(newHistoryWithAnswer);
                setWorldState(nextContext.worldState);
                setWorldMap(nextContext.worldMap);
                setVisitedLocations(nextContext.visitedLocations);
                setTurnNumber(nextContext.currentTurnNumber);
                
                setGameState(previous => retainPresentation(newState, previous));
                stateCommitted = true;
                turnPhaseRef.current = 'committed';
    
                if (currentRole === 'host') {
                    const newSaveData: SaveFile = {
                        gameContext: nextContext,
                        gameState: newState,
                        gameHistory: newHistoryWithAnswer,
                        gameLog: [...gameLog, ...newLogsForThisTurn],
                        combatLog: [...startingCombatLog, ...combatLogsToAdd],
                        lastJsonResponse: JSON.stringify(finalMergedResponse, null, 2),
                        sceneImagePrompt: finalMergedResponse.image_prompt || null,
                        timestamp: new Date().toISOString()
                    };
                    await broadcastFullSync(newSaveData);
                }
            }
          
        } catch (err: any) {
          if (wasSuperseded()) { reportSuperseded(); return; }
          if (!stateCommitted) {
            setGameLog(gameLog);
            setCombatLog(combatLog);
          }
          setIsLoading(false);
          if (err.name !== 'AbortError' || stateCommitted || playerSendAttempted) {
            const detail = formatError(err);
            const formattedError = stateCommitted ? `${t('error_turn_applied_followup')}\n\n${detail}` : playerSendAttempted ? `${t('error_turn_delivery_unknown')}\n\n${detail}` : detail;
            setError(formattedError);
            const systemMessage: ChatMessage = { sender: 'system', content: `Error: ${formattedError}` };
            if (stateCommitted) setGameHistory(prev => [...prev, systemMessage]);
            else setGameHistory([...historyWithQuestion, systemMessage]);
          }
        } finally {
            if (activeTurnRef.current === turnToken) {
                activeTurnRef.current = null;
                if (turnPhaseRef.current !== 'awaiting-sync') turnPhaseRef.current = 'idle';
            }
            if (gameStateRef.current?.networkRole !== 'player') {
                setIsLoading(false);
                if (turnStartTimeRef.current) {
                    const endTime = performance.now();
                    const elapsedTime = endTime - turnStartTimeRef.current;
                    setTurnTime(elapsedTime);
                    turnStartTimeRef.current = null;
                }
            }
        }
    };
    
    const cancelRequest = () => {
        if (turnPhaseRef.current === 'committed' || turnPhaseRef.current === 'awaiting-sync') {
            const warning = t(turnPhaseRef.current === 'committed' ? 'error_turn_applied_followup' : 'cancel_waiting_sync');
            setError(warning);
            setGameHistory(prev => [...prev, { sender: 'system', content: warning }]);
            if (!activeTurnRef.current) setIsLoading(false);
            return;
        }
        if (abortControllerRef.current && activeTurnRef.current) {
            const sending = turnPhaseRef.current === 'sending';
            abortControllerRef.current.abort(USER_CANCELLED_TURN);
            // Keep the submission lock until the task's catch/finally has run.
            setIsLoading(true);
            setError(t(sending ? 'error_turn_delivery_unknown' : 'requestCancelledByUser'));
            setSuggestedActions([]);
        }
    };

    const resumeInterruptedTurn = (recovery: { context: GameContext; baseState: GameState; history: ChatMessage[] }) => {
        if (hostRestorePendingRef?.current) { setError(t('host_sync_not_ready')); return; }
        if (gameplayMutationPendingRef.current) { setError(t('game_state_updating')); return; }
        if (recovery.baseState.networkRole === 'player' && clientTurnStampRef && !clientTurnStampRef.current) {
            setError(t('network_sync_not_ready')); return;
        }
        gameContextRef.current = recovery.context;
        setGameState(recovery.baseState);
        setGameHistory(recovery.history);
        setWorldMap(recovery.context.worldMap || {});
        setVisitedLocations(recovery.context.visitedLocations || []);
        setWorldState(recovery.context.worldState);
        setGameSettings(recovery.context.gameSettings);
        setSuperInstructions(recovery.context.superInstructions || '');
        setTurnNumber(recovery.context.currentTurnNumber);
        setLastRequestJson(JSON.stringify(recovery.context, null, 2));
        return handleTurn(recovery.context, recovery.history, recovery.baseState);
    };

    const startGame = (creationData: any) => {
        initializeAndRunFirstTurn(creationData, { role: 'none' });
    };

    return {
        sendMessage,
        askQuestion,
        cancelRequest,
        resumeInterruptedTurn,
        startGame,
        initializeAndRunFirstTurn,
    };
}
