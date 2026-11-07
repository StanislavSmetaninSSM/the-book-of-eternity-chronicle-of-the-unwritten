
import { CheckIcon, ChevronDoubleLeftIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatWindow from './components/ChatWindow';
import ErrorBoundary from './components/ErrorBoundary';
import ImageRenderer from './components/ImageRenderer';
import InputBar from './components/InputBar';
import MarkdownRenderer from './components/MarkdownRenderer';
import Modal from './components/Modal';
import { PartyStatus } from './components/PartyStatus';
// FIX: Changed import to named import as per error message indicating no default export.
import StartScreen  from './components/StartScreen';
import { useWorldTranslations } from './hooks/useWorldTranslations';
import { withLiveActivePlayer } from './utils/partyView';
import TurnIndicator from './components/TurnIndicator';
import { useLocalization } from './context/LocalizationContext';
import { useGameLogic } from './hooks/useGameLogic';
import { ChatMessage, Faction, Item, Location, NPC, PlayerCharacter, Quest, Wound, LocationStorage, LocationData, ImageCacheEntry } from './types';
import { useSpeech } from './context/SpeechContext';
import { consumeStartupLoadRequest, migrateInlineImagesToImageStore, releasePreparedSaveFiles, type PreparedSaveFiles } from './utils/fileManager';
import ConfirmationModal from './components/ConfirmationModal';
import LoadingSpinner from './components/LoadingSpinner';
import ArenaGmRelayPanel from './components/ArenaGmRelayPanel';

// The in-game screens ship as their own chunks: the start screen needs none of them, and
// the panels, modals and the detail renderer only appear once the chronicle is running.
const SidePanel = React.lazy(() => import('./components/SidePanel'));
const DetailRenderer = React.lazy(() => import('./components/DetailRenderer/index'));
const CharacterSheet = React.lazy(() => import('./components/CharacterSheet'));
const InventoryScreen = React.lazy(() => import('./components/InventoryScreen').then(module => ({ default: module.InventoryScreen })));
const StorageScreen = React.lazy(() => import('./components/StorageScreen'));
const CombatTracker = React.lazy(() => import('./components/CombatTracker'));
const LocationViewer = React.lazy(() => import('./components/LocationViewer'));
const CinemaHall = React.lazy(() => import('./components/CinemaHall'));
const CinemaPlayer = React.lazy(() => import('./components/CinemaPlayer'));
const ImageCacheGallery = React.lazy(() => import('./components/ImageCacheGallery'));
const LyriaMusicPlayer = React.lazy(() => import('./components/LyriaMusicPlayer'));
const TextReaderModal = React.lazy(() => import('./components/TextReaderModal'));


interface ImageModalInfo {
    prompt: string;
    originalTextPrompt: string;
    onClearCustom?: () => void;
    onUpload?: (base64: string) => void;
    pendingPrompt?: string | null;
    onAcceptPending?: () => void;
}

const isNpc = (d: any): d is NPC => d && typeof d === 'object' && !Array.isArray(d) && (d.relationshipLevel !== undefined || d.NPCId !== undefined);
const isItem = (d: any): d is Item => d && typeof d === 'object' && !Array.isArray(d) && typeof d.quality === 'string' && typeof d.weight === 'number';
const isQuest = (d: any): d is Quest => d && typeof d === 'object' && !Array.isArray(d) && typeof d.questGiver === 'string' && Array.isArray(d.objectives);
const isLocation = (d: any): d is (Location & { type: 'location' }) => d && typeof d === 'object' && !Array.isArray(d) && d.type === 'location' && d.externalDifficultyProfile !== undefined;
const isWound = (d: any): d is (Wound & { type: 'wound', characterType: 'player' | 'npc', characterId: string | null }) => d && typeof d === 'object' && !Array.isArray(d) && d.type === 'wound';
const isPlayerCharacter = (d: any): d is PlayerCharacter & { type: 'playerCharacter' } => d && typeof d === 'object' && !Array.isArray(d) && d.type === 'playerCharacter';
const isFaction = (data: any): data is Faction & { type: 'faction' } => data && typeof data === 'object' && !Array.isArray(data) && data.type === 'faction' && data.reputation !== undefined;

const clampUiScale = (value: unknown, min = 0.8, max = 1.25): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(max, Math.max(min, parsed));
};


export default function App(): React.ReactNode {
    const { language, setLanguage, t } = useLocalization();
    const { cancel } = useSpeech();

    const {
        gameState,
        gameHistory,
        isLoading,
        error,
        startGame,
        sendMessage,
        askQuestion,
        cancelRequest,
        lastJsonResponse,
        // FIX: Destructure 'lastRequestJsonForDebug' from the useGameLogic hook and alias it to 'lastRequestJson' to resolve a property not existing on the hook's return type.
        lastRequestJsonForDebug: lastRequestJson,
        gameLog,
        combatLog,
        equipItem,
        unequipItem,
        dropItem,
        moveItem,
        splitItemStack,
        mergeItemStacks,
        disassembleItem,
        disassembleNpcItem,
        craftItem,
        moveFromStashToInventory,
        dropItemFromStash,
        deleteMessage,
        clearHalfHistory,
        deleteLogs,
        forgetNpc,
        forgetFaction,
        clearNpcJournal,
        deleteOldestNpcJournalEntries,
        deleteNpcJournalEntry,
        forgetLocation,
        forgetQuest,
        spendAttributePoint,
        setAutoCombatSkill,
        sceneImagePrompt,
        saveGame,
        loadGame,
        loadAutosave,
        autosaveTimestamp,
        crashRecoveryInfo,
        crashRecoveryMarker,
        loadCrashRecovery,
        interruptedTurnRecovery,
        resumeInterruptedGameTurn,
        discardInterruptedGameTurn,
        recordCrash,
        suggestedActions,
        visitedLocations,
        worldState,
        gameSettings,
        updateGameSettings,
        superInstructions,
        updateSuperInstructions,
        turnNumber,
        editChatMessage,
        editNpcData,
        editQuestData,
        editItemData,
        editFactionData,
        editLocationData,
        editPlayerData,
        editWorldState,
        editWeather,
        editWorldStateFlagData,
        saveGameToSlot,
        loadGameFromSlot,
        deleteGameSlot,
        dbSaveSlots,
        refreshDbSaveSlots,
        isMusicLoading,
        isMusicPlayerVisible,
        musicPrompt,
        handlePrimaryMusicClick,
        generateMusicPrompt,
        closeMusicPlayer,
        updateMusicPrompt,
        generateSurpriseMusicPrompt,
        currentStep,
        currentModel,
        turnTime,
        onImageGenerated,
        forgetHealedWound,
        forgetActiveWound,
        clearAllHealedWounds,
        onRegenerateId,
        deleteCustomState,
        deleteNpcCustomState,
        deleteWorldStateFlag,
        deleteWorldEvent,
        deleteWorldEventsByTurnRange,
        updateNpcSortOrder,
        updateItemSortOrder,
        updateItemSortSettings,
        updateNpcItemSortOrder,
        updateNpcItemSortSettings,
        updateActiveSkillSortOrder,
        updatePassiveSkillSortOrder,
        handleTransferItem,
        handleEquipItemForNpc,
        handleUnequipItemForNpc,
        handleSplitItemForNpc,
        handleMergeItemsForNpc,
        handleMoveItemForNpc,
        onEditNpcMemory,
        onDeleteNpcMemory,
        clearNpcJournalsNow,
        passTurnManually,
        addPlayer,
        updatePlayerPortrait,
        removePlayer,
        passTurnToPlayer,
        deleteActiveSkill,
        deletePassiveSkill,
        deleteActiveEffect,
        clearAllCompletedFactionProjects,
        clearAllCompletedNpcActivities,
        onDeleteCurrentActivity,
        onDeleteCompletedActivity,
        deleteFactionProject,
        deleteFactionCompletedProject,
        deleteFactionCustomState,
        worldMap,
        updateNpcPortrait,
        placeAsStorage,
        moveToLocationStorage,
        retrieveFromLocationStorage,
        deleteLocationThreat,
        isGeneratingCinema,
        cinemaGenerationProgress,
        generateFilmTrailer,
        playingCinematic,
        playCinematic,
        exportCinematic,
        importCinematic,
        deleteCinematic,
        continueFilmTrailer,
        extendingCinematicId,
        cancelCinemaGeneration,
        isCinemaVisible,
        closeCinemaPlayer,
        updateCinematic,
        regenerateCinemaFrame,
        generateCinematicAudio,
        lastTurnSaveFile,
        regenerateLastResponse,
        deleteFactionBonus,
        isSaving,
        deleteImageFromCache,
        clearImageCache,
    } = useGameLogic({ language, setLanguage });

    // Ensure image prompts for the active scene and newly visible game entities are
    // submitted even when their detail panel/card is not currently open. ImageRenderer
    // delegates to the relay scheduler, which defers them until the turn lease is free.
    const imageWarmupPrompts = useMemo(() => {
        const prompts = new Set<string>();
        const addPrompt = (value?: string | null) => {
            if (typeof value === 'string' && value.trim()) prompts.add(value.trim());
        };
        if (!gameState || gameSettings?.disableImageGeneration === true) return [];
        addPrompt(sceneImagePrompt);
        addPrompt(gameState.playerCharacter?.image_prompt);
        addPrompt(gameState.currentLocationData?.image_prompt);
        withLiveActivePlayer(gameState.players, gameState.playerCharacter).forEach(player => {
            addPrompt(player.image_prompt);
            (player.inventory || []).forEach(item => addPrompt(item.image_prompt));
        });
        (gameState.encounteredNPCs || []).forEach(npc => {
            addPrompt(npc.image_prompt);
            (npc.inventory || []).forEach(item => addPrompt(item.image_prompt));
        });
        (gameState.encounteredFactions || []).forEach(faction => addPrompt(faction.image_prompt));
        if (gameSettings?.generateWorldEventImages !== false) {
            (gameState.worldEventsLog || []).forEach(event => addPrompt(event.image_prompt));
        }
        return Array.from(prompts).filter(prompt => !gameState.imageCache?.[prompt]);
    }, [gameState, sceneImagePrompt, gameSettings?.generateWorldEventImages, gameSettings?.disableImageGeneration]);

    useEffect(() => {
        // Older saves still carry base64 images inside the stored payload; move them
        // into the image store once so later saves only keep references.
        void migrateInlineImagesToImageStore();
    }, []);

    useEffect(() => {
        const controlScale = clampUiScale(gameSettings?.uiControlScale);
        const fontScale = clampUiScale(gameSettings?.uiFontScale, 0.85, 1.25);
        const textScaleFactor = fontScale / controlScale;
        const root = document.documentElement;

        root.style.setProperty('--ui-control-scale', String(controlScale));
        root.style.setProperty('--ui-font-scale', String(fontScale));
        root.style.setProperty('--ui-text-scale-factor', String(textScaleFactor));

        return () => {
            root.style.setProperty('--ui-control-scale', '1');
            root.style.setProperty('--ui-font-scale', '1');
            root.style.setProperty('--ui-text-scale-factor', '1');
        };
    }, [gameSettings?.uiControlScale, gameSettings?.uiFontScale]);

    const [hasStarted, setHasStarted] = useState(false);
    const [isInventoryOpen, setIsInventoryOpen] = useState(false);
    const [managingNpcInventory, setManagingNpcInventory] = useState<NPC | null>(null);
    const [messageModalState, setMessageModalState] = useState<{ title: string; content: string } | null>(null);
    const [textReaderState, setTextReaderState] = useState<{ title: string; content: string } | null>(null);
    const [imageModalInfo, setImageModalInfo] = useState<ImageModalInfo | null>(null);
    const [preparedSaveFiles, setPreparedSaveFiles] = useState<PreparedSaveFiles | null>(null);
    const [detailModalStack, setDetailModalStack] = useState<{ title: string; data: any }[]>([]);

    const [isDetailModalFullScreen, setIsDetailModalFullScreen] = useState(false);
    const [editModalData, setEditModalData] = useState<{ index: number, message: ChatMessage } | null>(null);
    const [editContent, setEditContent] = useState('');
    const [isMapFullScreen, setIsMapFullScreen] = useState(false);
    const [isCombatFullScreen, setIsCombatFullScreen] = useState(false);
    const [viewingCharacter, setViewingCharacter] = useState<PlayerCharacter | NPC | null>(null);
    const [isCharacterSheetFullScreen, setIsCharacterSheetFullScreen] = useState(false);
    const [isPartyStatusFullScreen, setIsPartyStatusFullScreen] = useState(false);
    const [sidePanelView, setSidePanelView] = useState<string>('menu');
    const [characterSheetDefaultView, setCharacterSheetDefaultView] = useState('menu');
    const [storageScreenState, setStorageScreenState] = useState<{ storage: LocationStorage, locationId: string } | null>(null);
    const [isCinemaHallFullScreen, setIsCinemaHallFullScreen] = useState(false);
    const [isImageCacheFullScreen, setIsImageCacheFullScreen] = useState(false);
    const [isRegenConfirmOpen, setIsRegenConfirmOpen] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [stealthConfirmAction, setStealthConfirmAction] = useState<'enter' | 'exit' | null>(null);
    const allWorldLocations = useMemo<LocationData[]>(() => Object.values(worldMap || {}), [worldMap]);
    const [isMusicPlayerDocked, setIsMusicPlayerDocked] = useState(false);
    const [isMusicPlaying, setIsMusicPlaying] = useState(false);
    const [musicStatus, setMusicStatus] = useState<'stopped' | 'connecting' | 'playing' | 'buffering' | 'error'>('stopped');
    const playPauseMusicRef = useRef<() => void>(() => {});
    const pendingRegenerationMessage = useRef<string | null>(null);
    const [isUIHidden, setIsUIHidden] = useState(false);

    useEffect(() => {
        if (!isMusicPlayerVisible) {
            setIsMusicPlayerDocked(false);
        }
    }, [isMusicPlayerVisible]);


    const handleOpenStorage = useCallback((locationId: string, storage: LocationStorage) => {
        setStorageScreenState({ locationId, storage });
    }, []);
    const handleCloseStorage = useCallback(() => {
        setStorageScreenState(null);
    }, []);


    const handleOpenNpcInventory = useCallback((npc: NPC) => {
        setViewingCharacter(null); // Ensure character sheet modal is closed
        setManagingNpcInventory(npc);
        setIsInventoryOpen(false);
    }, []);

    const handleCloseNpcInventory = useCallback(() => {
        setManagingNpcInventory(null);
    }, []);

    const handleOpenPlayerInventory = useCallback(() => {
        setViewingCharacter(null); // Ensure character sheet modal is closed
        setManagingNpcInventory(null);
        setIsInventoryOpen(true);
    }, []);

    const handleClosePlayerInventory = useCallback(() => {
        setIsInventoryOpen(false);
    }, []);


    useEffect(() => {
        if (managingNpcInventory && gameState?.encounteredNPCs) {
            const freshNpc = gameState.encounteredNPCs.find(n => n.NPCId === managingNpcInventory.NPCId);
            if (freshNpc && JSON.stringify(freshNpc) !== JSON.stringify(managingNpcInventory)) {
                setManagingNpcInventory(freshNpc);
            }
        }
    }, [gameState?.encounteredNPCs, managingNpcInventory]);


    useEffect(() => {
        if (viewingCharacter && gameState) {
            if ('playerId' in viewingCharacter) { // It's a PlayerCharacter
                const freshCharacter = gameState.playerCharacter?.playerId === viewingCharacter.playerId
                    ? gameState.playerCharacter
                    : gameState.players.find(p => p.playerId === viewingCharacter.playerId);
                if (freshCharacter && JSON.stringify(freshCharacter) !== JSON.stringify(viewingCharacter)) {
                    setViewingCharacter(freshCharacter);
                }
            } else { // It's an NPC
                const freshCharacter = gameState.encounteredNPCs.find(n => n.NPCId === viewingCharacter.NPCId);
                if (freshCharacter && JSON.stringify(freshCharacter) !== JSON.stringify(viewingCharacter)) {
                    setViewingCharacter(freshCharacter);
                }
            }
        }
    }, [gameState, viewingCharacter]);

    // Resizable sidebar state and logic
    const [sidebarWidth, setSidebarWidth] = useState(507);
    const [isResizing, setIsResizing] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    const currentDetailModal = useMemo(() => detailModalStack.length > 0 ? detailModalStack[detailModalStack.length - 1] : null, [detailModalStack]);

    useEffect(() => {
        if (!currentDetailModal || !gameState) return;

        const { data } = currentDetailModal;
        let updatedData: any = null;

        if (isWound(data)) {
            const woundData = data as (Wound & { type: 'wound', characterType: 'player' | 'npc', characterId: string | null });
            let foundWound: Wound | undefined | null = null;

            const findWoundInList = (woundList?: Wound[]) => (woundList || []).find((w: Wound) =>
                (woundData.woundId && w.woundId === woundData.woundId) ||
                (!woundData.woundId && w.woundName === woundData.woundName && w.severity === woundData.severity)
            );

            foundWound = findWoundInList(gameState.playerCharacter.playerWounds);

            if (!foundWound && Array.isArray(gameState.encounteredNPCs)) {
                for (const npc of gameState.encounteredNPCs) {
                    if (npc) {
                        foundWound = findWoundInList(npc.wounds);
                        if (foundWound) break;
                    }
                }
            }

            if (foundWound) {
                updatedData = Object.assign({}, data, foundWound);
            } else {
                updatedData = data;
            }
        } else if (isPlayerCharacter(data)) {
            const pcData = data as PlayerCharacter & { type: 'playerCharacter' };
            const foundPlayer = gameState.playerCharacter?.playerId === pcData.playerId
                ? gameState.playerCharacter
                : gameState.players.find((p: PlayerCharacter) => p.playerId === pcData.playerId);
            if (foundPlayer) {
                updatedData = Object.assign({}, data, foundPlayer);
            }
        } else if (isNpc(data) && Array.isArray(gameState.encounteredNPCs)) {
            const npcData = data as NPC;
            const foundNpc = gameState.encounteredNPCs.find(npc =>
                npc && ((npcData.NPCId && npc.NPCId === npcData.NPCId) ||
                    (!npcData.NPCId && npc.name === npcData.name))
            );
            if (foundNpc) {
                updatedData = Object.assign({}, data, foundNpc);
            }
        } else if (isFaction(data) && Array.isArray(gameState.encounteredFactions)) {
            const factionData = data as Faction;
            const foundFaction = gameState.encounteredFactions.find(faction =>
                faction && ((factionData.factionId && faction.factionId === factionData.factionId) ||
                    (!factionData.factionId && faction.name === factionData.name))
            );
            if (foundFaction) {
                updatedData = Object.assign({}, data, foundFaction);
            }
        } else if (isItem(data) && Array.isArray(gameState.playerCharacter.inventory)) {
            const itemData = data as Item;
            updatedData = gameState.playerCharacter.inventory.find((item: Item) => item.existedId === itemData.existedId);
        } else if (isQuest(data)) {
            const questData = data as Quest;
            const allQuests = [...(Array.isArray(gameState.activeQuests) ? gameState.activeQuests : []), ...(Array.isArray(gameState.completedQuests) ? gameState.completedQuests : [])];
            updatedData = allQuests.find((q: Quest) =>
                (questData.questId && q.questId === questData.questId) ||
                (!questData.questId && q.questName === questData.questName)
            );
        } else if (isLocation(data)) {
             const locationData = data as Location & { type: 'location' };
             const allKnownLocations: Record<string, Location> = {
                 ...(worldMap || {}),
                 ...(gameState.currentLocationData && gameState.currentLocationData.locationId
                     ? { [gameState.currentLocationData.locationId]: gameState.currentLocationData }
                     : {})
             };
             const foundLocation = locationData.locationId ? allKnownLocations[locationData.locationId] : undefined;
             if (foundLocation && typeof foundLocation === 'object' && !Array.isArray(foundLocation)) {
                 updatedData = Object.assign({}, data, foundLocation);
             }
        }

        if (updatedData && JSON.stringify(updatedData) !== JSON.stringify(data)) {
            setDetailModalStack(prev => {
                const newStack = [...prev];
                if (newStack.length > 0) {
                    newStack[newStack.length - 1] = { ...newStack[newStack.length - 1], data: updatedData };
                }
                return newStack;
            });
        }
    }, [gameState, currentDetailModal, visitedLocations, worldMap]);

    const activePlayerName = gameSettings?.cooperativeGameType !== 'None' ? gameState?.playerCharacter?.name || null : null;

    const npcsInScene = useMemo(() => {
        if (!gameState) return [];
        const { currentLocationData, encounteredNPCs } = gameState;
        if (!currentLocationData || !encounteredNPCs) return [];

        const currentLocId = currentLocationData.locationId;
        const currentLocInitialId = currentLocationData.initialId;
        const currentLocName = currentLocationData.name;

        // Create a map of all known locations for efficient lookup
        const allKnownLocations = new Map<string, Location>();
        Object.values(worldMap || {}).forEach(loc => loc.locationId && allKnownLocations.set(loc.locationId, loc));
        (visitedLocations || []).forEach(loc => loc.locationId && allKnownLocations.set(loc.locationId, loc));
        if (currentLocationData.locationId) {
            allKnownLocations.set(currentLocationData.locationId, currentLocationData);
        }

        const npcsInLocation = encounteredNPCs.filter(npc => {
            if (!npc) return false;

            // 1. Match by location ID
            if (currentLocId && npc.currentLocationId === currentLocId) {
                return true;
            }

            // 2. Match by initial ID (for new locations)
            if (currentLocInitialId && npc.initialLocationId === currentLocInitialId) {
                return true;
            }

            // 3. Match by location name
            if (npc.currentLocationId) {
                const npcLocation = allKnownLocations.get(npc.currentLocationId);
                if (npcLocation && npcLocation.name === currentLocName) {
                    return true;
                }
            }

            return false;
        });

        const npcsWithRecentJournalsSet = new Set<string>();
        if (lastJsonResponse) {
            try {
                // This might fail if JSON is streaming, but that's okay.
                const response = JSON.parse(lastJsonResponse);
                if (response && response.NPCJournals && Array.isArray(response.NPCJournals)) {
                    response.NPCJournals.forEach((journalEntry: any) => {
                        const npcName = journalEntry.NPCName || journalEntry.name;
                        if (journalEntry.NPCId) {
                            npcsWithRecentJournalsSet.add(journalEntry.NPCId);
                        } else if (npcName) {
                            // Fallback to name if ID is missing (e.g. for new NPCs)
                            const npc = encounteredNPCs.find(n => n.name === npcName);
                            if (npc && npc.NPCId) {
                                npcsWithRecentJournalsSet.add(npc.NPCId);
                            }
                        }
                    });
                }
            } catch (e) {
                // It's fine if it's not a valid JSON yet during streaming.
            }
        }

        const combinedNpcSet = new Set(npcsInLocation.map(n => n.NPCId));
        npcsWithRecentJournalsSet.forEach(id => id && combinedNpcSet.add(id));

        return encounteredNPCs.filter(npc => npc && npc.NPCId && combinedNpcSet.has(npc.NPCId));

    }, [gameState, visitedLocations, worldMap, lastJsonResponse]);

    const toggleSidebar = useCallback(() => {
        setIsSidebarCollapsed(prev => !prev);
    }, []);

    const startResizing = useCallback((mouseDownEvent: React.MouseEvent) => {
        mouseDownEvent.preventDefault();
        setIsResizing(true);
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback((mouseMoveEvent: MouseEvent) => {
        if (isResizing) {
            const newWidth = window.innerWidth - mouseMoveEvent.clientX;
            const minWidth = 320;
            const maxWidth = 800;
            if (newWidth > minWidth && newWidth < maxWidth) {
                setSidebarWidth(newWidth);
            }
        }
    }, [isResizing]);

    useEffect(() => {
        window.addEventListener("mousemove", resize);
        window.addEventListener("mouseup", stopResizing);
        return () => {
            window.removeEventListener("mousemove", resize);
            window.removeEventListener("mouseup", stopResizing);
        };
    }, [resize, stopResizing]);

    const handleStartGame = (creationData: any) => {
        startGame(creationData);
        setHasStarted(true);
    };

    const handleSaveGame = async () => {
        const prepared = await saveGame();
        if (!prepared) return;
        if (preparedSaveFiles) {
            window.setTimeout(() => releasePreparedSaveFiles(preparedSaveFiles), 60_000);
        }
        setPreparedSaveFiles(prepared);
    };

    const closePreparedSaveFile = () => {
        if (preparedSaveFiles) {
            window.setTimeout(() => releasePreparedSaveFiles(preparedSaveFiles), 60_000);
        }
        setPreparedSaveFiles(null);
    };

    const handleLoadGame = async () => {
        const success = await loadGame();
        if (success) {
            setHasStarted(true);
        }
    };

    const handleLoadAutosave = async (): Promise<boolean> => {
        const success = await loadAutosave();
        if (success) {
            setHasStarted(true);
        }
        return success;
    };

    const handleLoadCrashRecovery = async (): Promise<boolean> => {
        const success = await loadCrashRecovery();
        if (success) {
            setHasStarted(true);
        }
        return success;
    };

    const handleResumeInterruptedTurn = async () => {
        const started = await resumeInterruptedGameTurn();
        if (started) setHasStarted(true);
    };

    const handleDiscardInterruptedTurn = () => {
        void discardInterruptedGameTurn();
    };

    const handleLoadGameFromSlot = async (slotId: number) => {
        const success = await loadGameFromSlot(slotId);
        if (success) {
            setHasStarted(true);
        }
    };

    useEffect(() => {
        const handleWindowError = (event: ErrorEvent) => {
            recordCrash('window.error', event.error || event.message);
        };
        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            recordCrash('window.unhandledrejection', event.reason);
        };

        window.addEventListener('error', handleWindowError);
        window.addEventListener('unhandledrejection', handleUnhandledRejection);

        return () => {
            window.removeEventListener('error', handleWindowError);
            window.removeEventListener('unhandledrejection', handleUnhandledRejection);
        };
    }, [recordCrash]);

    useEffect(() => {
        const startupLoadRequest = consumeStartupLoadRequest();
        if (startupLoadRequest === 'crashRecovery') {
            void handleLoadCrashRecovery();
        } else if (startupLoadRequest === 'autosave') {
            void handleLoadAutosave();
        }
    }, []);

    const handleShowMessageModal = useCallback((title: string, content: string) => {
        setMessageModalState({ title, content });
    }, []);

    const handleOpenTextReader = useCallback((title: string, content: string) => {
        setTextReaderState({ title, content });
    }, []);

    const handleCloseTextReader = useCallback(() => {
        cancel(); // Stop speech when closing modal
        setTextReaderState(null);
    }, [cancel]);

    const handleShowImageModal = useCallback((prompt: string, originalTextPrompt: string, onClearCustom?: () => void, onUpload?: (base64: string) => void, pendingPrompt?: string | null, onAcceptPending?: () => void) => {
        if (prompt) {
            setImageModalInfo({ prompt, originalTextPrompt, onClearCustom, onUpload, pendingPrompt, onAcceptPending });
        }
    }, []);

    const handleOpenDetailModal = useCallback((title: string, data: any) => {
        setDetailModalStack(prev => [...prev, { title, data }]);
    }, []);

    const handleCloseDetailModal = useCallback(() => {
        setDetailModalStack(prev => {
            const newStack = prev.slice(0, -1);
            if (newStack.length === 0) {
                setIsDetailModalFullScreen(false); // Reset on closing last modal
            }
            return newStack;
        });
    }, []);

    const handleShowEditModal = (index: number, message: ChatMessage) => {
        setEditModalData({ index, message });
        setEditContent(message.content);
    };

    const handleSaveEdit = () => {
        if (editModalData) {
            editChatMessage(editModalData.index, editContent);
            setEditModalData(null);
        }
    };

    const handleOpenJournalModal = useCallback((npc: NPC) => {
        setViewingCharacter(npc);
        setCharacterSheetDefaultView('Journal');
    }, []);


    const lastPlayerMessage = useMemo(() =>
        gameHistory.slice().reverse().find(m => m.sender === 'player'),
        [gameHistory]);

    const handleResend = useCallback(() => {
        if (lastPlayerMessage && !isLoading) {
            const isLastMessageAQuestion = lastPlayerMessage.content.startsWith('[Question]');

            if (isLastMessageAQuestion) {
                const originalQuestion = lastPlayerMessage.content.substring('[Question] '.length);
                askQuestion(originalQuestion, null);
            } else {
                sendMessage(lastPlayerMessage.content, null);
            }
        }
    }, [lastPlayerMessage, isLoading, sendMessage, askQuestion]);


    const handleViewCharacter = useCallback((character: PlayerCharacter | NPC) => {
        setViewingCharacter(character);
        setCharacterSheetDefaultView('menu');
    }, []);

    const handleCloseCharacterSheet = useCallback(() => {
        setViewingCharacter(null);
        setCharacterSheetDefaultView('menu');
    }, []);

    const handleModalClearCustom = useCallback(() => {
        const onClearCallback = imageModalInfo?.onClearCustom;
        if (onClearCallback) {
            onClearCallback();
        }
    }, [imageModalInfo]);

    const handleModalUploadCustom = useCallback((base64: string | null) => {
        setImageModalInfo(prev => {
            if (prev?.onUpload && base64) {
                prev.onUpload(base64);
                return { ...prev, prompt: base64 };
            }
            return prev;
        });
    }, []);

    const handleImageGeneratedInModal = useCallback((generatedFromPrompt: string, newBase64: string, sourceProvider: ImageCacheEntry['sourceProvider'], sourceModel?: string) => {
        onImageGenerated(generatedFromPrompt, newBase64, sourceProvider, sourceModel);

        if (imageModalInfo?.onClearCustom) {
            imageModalInfo.onClearCustom();
        }

        setImageModalInfo(prev => {
            if (!prev) return null;
            return { ...prev, prompt: generatedFromPrompt, originalTextPrompt: generatedFromPrompt };
        });
    }, [onImageGenerated, imageModalInfo]);

    const handleAcceptPendingInModal = useCallback(() => {
        if (imageModalInfo?.onAcceptPending) {
            imageModalInfo.onAcceptPending();
            setImageModalInfo(null); // Close modal to refresh or update state
        }
    }, [imageModalInfo]);

    const handleConfirmRegenerate = useCallback(async () => {
        if (lastPlayerMessage) {
            pendingRegenerationMessage.current = lastPlayerMessage.content;
        }

        setIsRegenConfirmOpen(false);
        if (regenerateLastResponse) {
            const success = await regenerateLastResponse();
            if (success) {
                setIsRegenerating(true);
            }
        }
    }, [regenerateLastResponse, lastPlayerMessage]);

    const handleStealthButtonClick = useCallback(() => {
        if (!gameState) return;
        const action = gameState.playerCharacter.stealthState.isActive ? 'exit' : 'enter';
        setStealthConfirmAction(action);
    }, [gameState]);

    const handleConfirmStealth = useCallback(() => {
        if (!stealthConfirmAction) return;
        const message = stealthConfirmAction === 'enter' ? t('enterStealthAction') : t('exitStealthAction');
        sendMessage(message, null);
        setStealthConfirmAction(null);
    }, [stealthConfirmAction, sendMessage, t]);

    useEffect(() => {
        if (isRegenerating) {
            if (pendingRegenerationMessage.current) {
                const rawContent = pendingRegenerationMessage.current;

                if (rawContent.startsWith('[Question] ')) {
                    const actualQuestion = rawContent.substring('[Question] '.length);
                    askQuestion(actualQuestion, null);
                } else {
                    sendMessage(rawContent, null);
                }
                pendingRegenerationMessage.current = null;
            }
            setIsRegenerating(false);
        }
    }, [isRegenerating, sendMessage, askQuestion]);

    // The per-universe dictionary (races, classes, skills, months) is loaded on demand.
    // A save written before the universe was recorded gets every dictionary.
    const activeUniverse = gameSettings?.gameWorldInformation?.universe
        ?? (gameState ? null : undefined);
    const worldTranslationsReady = useWorldTranslations(activeUniverse);

    if (!hasStarted) {
        return <>
            <ArenaGmRelayPanel />
            <StartScreen
                onStartLocal={handleStartGame}
                onLoadGame={handleLoadGame}
                onLoadAutosave={handleLoadAutosave}
                autosaveTimestamp={autosaveTimestamp}
                crashRecoveryInfo={crashRecoveryInfo}
                crashRecoveryMarker={crashRecoveryMarker}
                onLoadCrashRecovery={handleLoadCrashRecovery}
                interruptedTurnRecoveryMessage={interruptedTurnRecovery?.history.slice().reverse().find(message => message.sender === 'player')?.content || null}
                onResumeInterruptedTurn={handleResumeInterruptedTurn}
                onDiscardInterruptedTurn={handleDiscardInterruptedTurn}
                onLoadFromSlot={handleLoadGameFromSlot}
                dbSaveSlots={dbSaveSlots}
            />
        </>;
    }


        if (!worldTranslationsReady) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center" data-testid="translations-loading">
                <p className="text-gray-300">{t('Loading Settings...')}</p>
            </div>
        );
    }

    return (
        <>
            <ArenaGmRelayPanel />
            {gameState && imageWarmupPrompts.length > 0 && (
                <div className="hidden" aria-hidden="true">
                    {imageWarmupPrompts.map(prompt => (
                        <ImageRenderer
                            key={prompt}
                            prompt={prompt}
                            originalTextPrompt={prompt}
                            imageCache={gameState.imageCache ?? {}}
                            onImageGenerated={onImageGenerated}
                            gameSettings={gameSettings}
                            gameIsLoading={isLoading}
                            width={512}
                            height={512}
                        />
                    ))}
                </div>
            )}
            <div className="bg-gray-900/50 text-gray-200 min-h-screen flex flex-col md:flex-row font-sans backdrop-blur-sm">
                <div className="relative flex-1 h-screen min-w-0">
                    {sceneImagePrompt && (
                        <div className="absolute inset-0 z-0 cursor-pointer" onClick={() => handleShowImageModal(sceneImagePrompt, sceneImagePrompt)}>
                            <ImageRenderer
                                key={sceneImagePrompt}
                                prompt={sceneImagePrompt}
                                originalTextPrompt={sceneImagePrompt}
                                alt={t("Current game scene")}
                                className={`object-cover w-full h-full ${isUIHidden ? 'opacity-100' : 'opacity-30'}`}
                                width={1024}
                                height={1024}
                                imageCache={gameState?.imageCache ?? {}}
                                onImageGenerated={onImageGenerated}
                                onClick={() => handleShowImageModal(sceneImagePrompt, sceneImagePrompt)}
                                gameSettings={gameSettings}
                                gameIsLoading={isLoading}
                            />
                            {!isUIHidden && (
                                <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/80 to-transparent"></div>
                            )}
                        </div>
                    )}

                    <div className="absolute top-4 right-4 z-50">
                         <button
                            onClick={() => setIsUIHidden(!isUIHidden)}
                            className="bg-gray-800/80 p-2 rounded-full border border-gray-600 hover:bg-gray-700 transition-colors text-gray-300 hover:text-white backdrop-blur-sm"
                            title={isUIHidden ? t('Show UI') : t('Hide UI')}
                         >
                            {isUIHidden ? <EyeIcon className="w-6 h-6" /> : <EyeSlashIcon className="w-6 h-6" />}
                         </button>
                    </div>

                    <main className="relative z-10 flex-1 flex flex-col h-screen p-4 md:p-6 lg:p-8 pointer-events-none">
                        <ErrorBoundary
                            name="Gameplay"
                            onError={(boundaryError, errorInfo) => recordCrash('Gameplay', boundaryError, errorInfo.componentStack)}
                            onLoadRecovery={handleLoadCrashRecovery}
                            onLoadAutosave={handleLoadAutosave}
                            compact
                        >
                            {!isUIHidden && (
                                <>
                                {gameState && gameSettings?.showPartyStatusPanel && gameState.players.length > 1 && (
                                    <PartyStatus
                                        players={withLiveActivePlayer(gameState.players, gameState.playerCharacter)}
                                        activePlayerIndex={gameState.activePlayerIndex}
                                        onPassTurn={passTurnManually}
                                        gameSettings={gameSettings}
                                        imageCache={gameState?.imageCache ?? {}}
                                        onImageGenerated={onImageGenerated}
        // FIX: Changed handleOpenImageModal to handleShowImageModal as the former is not defined.
                                        onOpenImageModal={handleShowImageModal}
                                        onExpandFullScreen={() => setIsPartyStatusFullScreen(true)}
                                        updatePlayerPortrait={updatePlayerPortrait}
                                        isLoading={isLoading}
                                    />
                                )}
                                <div className="flex-1 overflow-y-auto mb-4 pr-2 pointer-events-auto">
                                    <ChatWindow
                                        history={gameHistory}
                                        error={error}
                                        onDeleteMessage={deleteMessage}
                                        onShowMessageModal={handleShowMessageModal}
                                        onResend={lastPlayerMessage ? handleResend : undefined}
                                        onShowEditModal={handleShowEditModal}
                                        allowHistoryManipulation={gameSettings?.allowHistoryManipulation ?? false}
                                        onRegenerate={lastTurnSaveFile && !isLoading ? () => setIsRegenConfirmOpen(true) : undefined}
                                        isLoading={isLoading}
                                    />
                                </div>
                                <>
                                        <TurnIndicator
                                            activePlayerName={activePlayerName}
                                            gameSettings={gameSettings}
                                        />
                                        <InputBar
                                            onSendMessage={sendMessage}
                                            onAskQuestion={askQuestion}
                                            onCancelRequest={cancelRequest}
                                            onClearHalfHistory={clearHalfHistory}
                                            isLoading={isLoading}
                                            history={gameHistory}
                                            suggestedActions={suggestedActions}
                                            gameState={gameState}
                                            playerCharacter={gameState?.playerCharacter}
                                            gameSettings={gameSettings}
                                            onGetMusicSuggestion={handlePrimaryMusicClick}
                                            isMusicLoading={isMusicLoading}
                                            isMusicPlayerVisible={isMusicPlayerVisible}
        // FIX: Changed onToggleStealth to the defined handler handleStealthButtonClick.
                                            onToggleStealth={handleStealthButtonClick}
                                            isMusicPlayerDocked={isMusicPlayerDocked}
                                            undockMusicPlayer={() => setIsMusicPlayerDocked(false)}
                                            isMusicPlaying={isMusicPlaying}
                                            musicStatus={musicStatus}
                                            playPauseMusicRef={playPauseMusicRef}
                                        />
                                    </>
                                </>
                            )}
                        </ErrorBoundary>
                    </main>
                </div>

                {!isSidebarCollapsed && (
                    <div
                        onMouseDown={startResizing}
                        className="hidden md:block w-1.5 cursor-col-resize bg-gray-700/40 hover:bg-cyan-500/60 transition-colors duration-200 flex-shrink-0"
                    />
                )}

                <aside
                    style={{ width: isSidebarCollapsed ? '0px' : `${sidebarWidth}px` }}
                    className={`w-full md:w-auto bg-gray-800/80 rounded-lg backdrop-blur-md border border-gray-700/60 h-screen flex-shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${isSidebarCollapsed ? 'p-0 border-none' : 'p-4 md:p-6'}`}
                >
                    {!isSidebarCollapsed && (
                        <ErrorBoundary
                            name="Side Panel"
                            onError={(boundaryError, errorInfo) => recordCrash('Side Panel', boundaryError, errorInfo.componentStack)}
                            onLoadRecovery={handleLoadCrashRecovery}
                            onLoadAutosave={handleLoadAutosave}
                            compact
                        >
                            <Suspense fallback={<div className="p-4 text-sm text-gray-400" data-testid="side-panel-loading">{t('Loading Settings...')}</div>}>
                            <SidePanel
                                gameState={gameState}
                                worldState={worldState}
                                worldStateFlags={gameState?.worldStateFlags}
                                onOpenInventory={handleOpenPlayerInventory}
                                onOpenNpcInventory={handleOpenNpcInventory}
                                lastJsonResponse={lastJsonResponse}
                                lastRequestJsonForDebug={lastRequestJson}
                                gameLog={gameLog}
                                combatLog={combatLog}
                                onDeleteLogs={deleteLogs}
                                onSaveGame={handleSaveGame}
                                onLoadGame={handleLoadGame}
                                onLoadAutosave={loadAutosave}
                                autosaveTimestamp={autosaveTimestamp}
                                visitedLocations={visitedLocations}
                                onOpenDetailModal={handleOpenDetailModal}
                                onOpenJournalModal={handleOpenJournalModal}
                                onOpenImageModal={handleShowImageModal}
                                onShowMessageModal={handleShowMessageModal}
                                onSpendAttributePoint={spendAttributePoint}
                                onToggleSidebar={toggleSidebar}
                                onExpandMap={() => setIsMapFullScreen(true)}
                                onExpandCombat={() => setIsCombatFullScreen(true)}
                                onExpandCinemaHall={() => setIsCinemaHallFullScreen(true)}
                                onExpandImageCache={() => setIsImageCacheFullScreen(true)}
                                gameSettings={gameSettings}
                                updateGameSettings={updateGameSettings}
                                superInstructions={superInstructions}
                                updateSuperInstructions={updateSuperInstructions}
                                isLoading={isLoading}
                                setAutoCombatSkill={setAutoCombatSkill}
                                lastUpdatedQuestId={gameState?.lastUpdatedQuestId}
                                onSendMessage={sendMessage}
                                craftItem={craftItem}
                                moveFromStashToInventory={moveFromStashToInventory}
                                dropItemFromStash={dropItemFromStash}
                                turnNumber={turnNumber}
                                editChatMessage={editChatMessage}
                                editNpcData={editNpcData}
                                editQuestData={editQuestData}
                                editItemData={editItemData}
                                editFactionData={editFactionData}
                                editLocationData={editLocationData}
                                editPlayerData={editPlayerData}
                                editWorldState={editWorldState}
                                editWeather={editWeather}
                                editWorldStateFlagData={editWorldStateFlagData}
                                saveGameToSlot={saveGameToSlot}
                                loadGameFromSlot={handleLoadGameFromSlot}
                                deleteGameSlot={deleteGameSlot}
                                dbSaveSlots={dbSaveSlots}
                                refreshDbSaveSlots={refreshDbSaveSlots}
                                currentStep={currentStep}
                                currentModel={currentModel}
                                turnTime={turnTime}
                                imageCache={gameState?.imageCache ?? {}}
                                onImageGenerated={onImageGenerated}
                                forgetHealedWound={forgetHealedWound}
                                forgetActiveWound={forgetActiveWound}
                                clearAllHealedWounds={clearAllHealedWounds}
                                onRegenerateId={onRegenerateId}
                                deleteCustomState={deleteCustomState}
                                deleteNpcCustomState={deleteNpcCustomState}
                                deleteWorldStateFlag={deleteWorldStateFlag}
                                deleteWorldEvent={deleteWorldEvent}
                                deleteWorldEventsByTurnRange={deleteWorldEventsByTurnRange}
                                updateNpcSortOrder={updateNpcSortOrder}
                                updateItemSortOrder={updateItemSortOrder}
                                updateItemSortSettings={updateItemSortSettings}
                                updateNpcItemSortOrder={updateNpcItemSortOrder}
                                updateNpcItemSortSettings={updateNpcItemSortSettings}
                                updateActiveSkillSortOrder={updateActiveSkillSortOrder}
                                updatePassiveSkillSortOrder={updatePassiveSkillSortOrder}
                                handleTransferItem={handleTransferItem}
                                handleEquipItemForNpc={handleEquipItemForNpc}
                                handleUnequipItemForNpc={handleUnequipItemForNpc}
                                handleSplitItemForNpc={handleSplitItemForNpc}
                                handleMergeItemsForNpc={handleMergeItemsForNpc}
                                handleMoveItemForNpc={handleMoveItemForNpc}
                                forgetNpc={forgetNpc}
                                forgetFaction={forgetFaction}
                                forgetQuest={forgetQuest}
                                forgetLocation={forgetLocation}
                                onEditNpcMemory={onEditNpcMemory}
                                onDeleteNpcMemory={onDeleteNpcMemory}
                                clearNpcJournalsNow={clearNpcJournalsNow}
                                addPlayer={addPlayer}
                                updatePlayerPortrait={updatePlayerPortrait}
                                allNpcs={gameState?.encounteredNPCs || []}
                                allFactions={gameState?.encounteredFactions || []}
                                allLocations={allWorldLocations}
                                removePlayer={removePlayer}
                                passTurnManually={passTurnManually}
                                passTurnToPlayer={passTurnToPlayer}
                                deleteActiveSkill={deleteActiveSkill}
                                deletePassiveSkill={deletePassiveSkill}
                                deleteActiveEffect={deleteActiveEffect}
                                deleteFactionBonus={deleteFactionBonus}
                                onViewCharacterSheet={handleViewCharacter}
                                clearAllCompletedFactionProjects={clearAllCompletedFactionProjects}
                                clearAllCompletedNpcActivities={clearAllCompletedNpcActivities}
                                onDeleteCurrentActivity={onDeleteCurrentActivity}
                                onDeleteCompletedActivity={onDeleteCompletedActivity}
                                deleteFactionProject={deleteFactionProject}
                                deleteFactionCompletedProject={deleteFactionCompletedProject}
                                deleteFactionCustomState={deleteFactionCustomState}
                                sidePanelView={sidePanelView}
                                onSetSidePanelView={setSidePanelView}
                                updateNpcPortrait={updateNpcPortrait}
// FIX: Changed onOpenTextReader to handleOpenTextReader as the former is not defined.
                                onOpenTextReader={handleOpenTextReader}
                                onOpenStorage={handleOpenStorage}
                                placeAsStorage={placeAsStorage}
                                generateFilmTrailer={generateFilmTrailer}
                                isGeneratingCinema={isGeneratingCinema}
                                cinemaGenerationProgress={cinemaGenerationProgress}
                                playCinematic={playCinematic}
                                exportCinematic={exportCinematic}
                                importCinematic={importCinematic}
                                deleteCinematic={deleteCinematic}
                                continueFilmTrailer={continueFilmTrailer}
                                extendingCinematicId={extendingCinematicId}
                                cancelCinemaGeneration={cancelCinemaGeneration}
                                updateCinematic={updateCinematic}
                                regenerateCinemaFrame={regenerateCinemaFrame}
                                generateCinematicAudio={generateCinematicAudio}
                                npcsInScene={npcsInScene}
                                deleteImageFromCache={deleteImageFromCache}
                                clearImageCache={clearImageCache}
                            />
                            </Suspense>
                        </ErrorBoundary>
                    )}
                </aside>
            </div>
            {isSidebarCollapsed && (
                <button
                    onClick={toggleSidebar}
                    className="fixed top-1/2 -translate-y-1/2 right-0 z-30 p-2 bg-gray-800/80 hover:bg-cyan-600/80 rounded-l-md transition-colors shadow-lg"
                    title={t("Expand Sidebar")}
                >
                    <ChevronDoubleLeftIcon className="h-6 w-6 text-white" />
                </button>
            )}
            <ErrorBoundary
                name="Modals"
                onError={(boundaryError, errorInfo) => recordCrash('Modals', boundaryError, errorInfo.componentStack)}
                onLoadRecovery={handleLoadCrashRecovery}
                onLoadAutosave={handleLoadAutosave}
                className="fixed inset-x-4 top-4 z-[1200]"
                compact
            >
                {(isInventoryOpen || managingNpcInventory) && gameState && (
                    <Suspense fallback={null}><InventoryScreen
                        gameState={gameState}
                        npc={managingNpcInventory}
                        onClose={isInventoryOpen ? handleClosePlayerInventory : handleCloseNpcInventory}
                        gameSettings={gameSettings}
                        onEquip={equipItem}
                        onUnequip={unequipItem}
                        onDropItem={dropItem}
                        onMoveItem={moveItem}
                        onSplitItem={splitItemStack}
                        onMergeItems={mergeItemStacks}
                        onTransferItem={handleTransferItem}
                        onEquipItemForNpc={handleEquipItemForNpc}
                        onUnequipItemForNpc={handleUnequipItemForNpc}
                        onSplitItemForNpc={handleSplitItemForNpc}
                        onMergeItemsForNpc={handleMergeItemsForNpc}
                        onMoveNpcItem={handleMoveItemForNpc}
                        onOpenDetailModal={handleOpenDetailModal}
                        onOpenImageModal={handleShowImageModal}
                        imageCache={gameState.imageCache ?? {}}
                        onImageGenerated={onImageGenerated}
                        updateItemSortOrder={updateItemSortOrder}
                        updateItemSortSettings={updateItemSortSettings}
                        updateNpcItemSortOrder={updateNpcItemSortOrder}
                        updateNpcItemSortSettings={updateNpcItemSortSettings}
                        isLoading={isLoading}
                    /></Suspense>
                )}
                {messageModalState && (
                    <Modal isOpen={true} onClose={() => setMessageModalState(null)} title={messageModalState.title} showFontSizeControls={true}>
                        <MarkdownRenderer content={messageModalState.content} />
                    </Modal>
                )}

                {textReaderState && (
                    <Suspense fallback={null}><TextReaderModal
                        isOpen={!!textReaderState}
                        onClose={handleCloseTextReader}
                        title={textReaderState.title}
                        content={textReaderState.content}
                    /></Suspense>
                )}

                {storageScreenState && gameState && (
                    <Suspense fallback={null}><StorageScreen
                        isOpen={!!storageScreenState}
                        onClose={handleCloseStorage}
                        storage={storageScreenState.storage}
                        locationId={storageScreenState.locationId}
                        gameState={gameState}
                        onMoveToStorage={moveToLocationStorage}
                        onRetrieveFromStorage={retrieveFromLocationStorage}
                        onOpenDetailModal={handleOpenDetailModal}
                        imageCache={gameState.imageCache}
                        onImageGenerated={onImageGenerated}
                        gameSettings={gameSettings}
                    /></Suspense>
                )}

                {imageModalInfo && (
                    <Modal isOpen={true} onClose={() => setImageModalInfo(null)} title={t("Scene Image")}>
                        <div className="flex justify-center items-center h-full">
                            <ImageRenderer
                                key={imageModalInfo.originalTextPrompt}
                                prompt={imageModalInfo.prompt}
                                originalTextPrompt={imageModalInfo.originalTextPrompt}
                                alt={t("Enlarged game scene")}
                                fitMode="natural"
                                className="rounded-md"
                                showRegenerateButton={!!imageModalInfo.onClearCustom || !imageModalInfo.prompt.startsWith('data:image')}
                                width={1024}
                                height={1024}
                                imageCache={gameState?.imageCache ?? {}}
                                onImageGenerated={handleImageGeneratedInModal}
                                onClearCustom={imageModalInfo.onClearCustom ? handleModalClearCustom : undefined}
                                onUploadCustom={imageModalInfo.onUpload ? handleModalUploadCustom : undefined}
                                gameSettings={gameSettings}
                                gameIsLoading={isLoading}
                                showCancelButton={true}
                                showSourceInfo={true}
                                showDownloadButton={true}
                                pendingPrompt={imageModalInfo.pendingPrompt}
                                onAcceptPending={handleAcceptPendingInModal}
                            />
                        </div>
                    </Modal>
                )}
                <Modal
                    isOpen={!!currentDetailModal}
                    onClose={handleCloseDetailModal}
                    title={currentDetailModal?.title || t('Details')}
                    size={isDetailModalFullScreen ? "fullscreen" : "default"}
                    onToggleFullScreen={() => setIsDetailModalFullScreen(p => !p)}
                    isFullScreen={isDetailModalFullScreen}
                >
                    {currentDetailModal && <Suspense fallback={null}><DetailRenderer
                        data={currentDetailModal.data}
                    onForgetNpc={forgetNpc}
                    onForgetLocation={forgetLocation}
                    onClearNpcJournal={clearNpcJournal}
                    onDeleteOldestNpcJournalEntries={deleteOldestNpcJournalEntries}
                    onDeleteNpcJournalEntry={deleteNpcJournalEntry}
                    onForgetQuest={forgetQuest}
                    onCloseModal={handleCloseDetailModal}
                    onOpenImageModal={handleShowImageModal}
                    onShowMessageModal={handleShowMessageModal}
                    playerCharacter={gameState?.playerCharacter}
                    setAutoCombatSkill={setAutoCombatSkill}
                    onOpenDetailModal={handleOpenDetailModal}
                    onOpenJournalModal={handleOpenJournalModal}
                    disassembleItem={disassembleItem}
                    disassembleNpcItem={disassembleNpcItem}
                    currentLocationId={gameState?.currentLocationData?.locationId}
                    allowHistoryManipulation={(gameSettings?.allowHistoryManipulation ?? false) && !isLoading}
                    onEditNpcData={editNpcData}
                    onEditQuestData={editQuestData}
                    onEditItemData={editItemData}
                    onEditLocationData={editLocationData}
                    onEditPlayerData={editPlayerData}
                    onEditFactionData={editFactionData}
                    onRegenerateId={onRegenerateId}
                    encounteredFactions={gameState?.encounteredFactions}
                    gameSettings={gameSettings}
                    imageCache={gameState?.imageCache ?? {}}
                    onImageGenerated={onImageGenerated}
                    forgetHealedWound={forgetHealedWound}
                    forgetActiveWound={forgetActiveWound}
                    clearAllHealedWounds={clearAllHealedWounds}
                    visitedLocations={visitedLocations}
                    handleTransferItem={handleTransferItem}
                    handleEquipItemForNpc={handleEquipItemForNpc}
                    handleUnequipItemForNpc={handleUnequipItemForNpc}
                    handleSplitItemForNpc={handleSplitItemForNpc}
                    handleMergeItemsForNpc={handleMergeItemsForNpc}
                    updateItemSortOrder={updateItemSortOrder}
                    updateItemSortSettings={updateItemSortSettings}
                    updateNpcItemSortOrder={updateNpcItemSortOrder}
                    updateNpcItemSortSettings={updateNpcItemSortSettings}
                    deleteNpcCustomState={deleteNpcCustomState}
                    deleteCustomState={deleteCustomState}
                    deleteWorldStateFlag={deleteWorldStateFlag}
                    onEditNpcMemory={onEditNpcMemory}
                    onDeleteNpcMemory={onDeleteNpcMemory}
                    updatePlayerPortrait={updatePlayerPortrait}
                    allNpcs={gameState?.encounteredNPCs}
                    allFactions={gameState?.encounteredFactions}
                    allLocations={allWorldLocations}
                    clearAllCompletedFactionProjects={clearAllCompletedFactionProjects}
                    deleteFactionProject={deleteFactionProject}
                    deleteFactionCompletedProject={deleteFactionCompletedProject}
                    deleteFactionCustomState={deleteFactionCustomState}
                    deleteFactionBonus={deleteFactionBonus}
                    clearAllCompletedNpcActivities={clearAllCompletedNpcActivities}
                    onDeleteCurrentActivity={onDeleteCurrentActivity}
                    onDeleteCompletedActivity={onDeleteCompletedActivity}
                    onViewCharacterSheet={handleViewCharacter}
                    updateNpcPortrait={updateNpcPortrait}
// FIX: Changed onOpenTextReader to handleOpenTextReader as the former is not defined.
                    onOpenTextReader={handleOpenTextReader}
                    onOpenStorage={handleOpenStorage}
                    placeAsStorage={placeAsStorage}
                    deleteLocationThreat={deleteLocationThreat}
                    isLoading={isLoading}
                    deleteActiveEffect={deleteActiveEffect}
                /></Suspense>}
            </Modal>
            {isMapFullScreen && gameState && (
                <Modal
                    isOpen={isMapFullScreen}
                    onClose={() => setIsMapFullScreen(false)}
                    title={t('World Map')}
                    size="fullscreen"
                >
                    <div className="flex-1 flex flex-col h-full bg-gray-900 -m-6">
                        <Suspense fallback={null}><LocationViewer
                            visitedLocations={visitedLocations}
                            currentLocation={gameState.currentLocationData}
                            onOpenModal={handleOpenDetailModal}
                            imageCache={gameState?.imageCache ?? {}}
                            onImageGenerated={onImageGenerated}
                            isFullScreen={true}
                            onCollapse={() => setIsMapFullScreen(false)}
                            gameSettings={gameSettings}
                            encounteredFactions={gameState.encounteredFactions || []}
                        /></Suspense>
                    </div>
                </Modal>
            )}
            {isCombatFullScreen && gameState && (
                <Modal
                    isOpen={isCombatFullScreen}
                    onClose={() => setIsCombatFullScreen(false)}
                    title={t('Combat')}
                    size="fullscreen"
                >
                    <div className="flex-1 flex flex-col h-full bg-gray-900 -m-6 p-4">
                        <Suspense fallback={null}><CombatTracker
                            enemies={gameState.enemiesData}
                            allies={gameState.alliesData}
                            combatLog={combatLog}
                            allNpcs={gameState.encounteredNPCs}
                            playerCharacter={gameState.playerCharacter}
                            setAutoCombatSkill={setAutoCombatSkill}
                            onOpenDetailModal={handleOpenDetailModal}
                            onViewCharacterSheet={handleViewCharacter}
                            onSendMessage={sendMessage}
                            isLoading={isLoading}
                            imageCache={gameState?.imageCache ?? {}}
                            onImageGenerated={onImageGenerated}
                            onOpenImageModal={handleShowImageModal}
                            gameSettings={gameSettings}
                            isFullScreen={true}
                            onCollapse={() => setIsCombatFullScreen(false)}
                            editNpcData={editNpcData}
                        /></Suspense>
                    </div>
                </Modal>
            )}
            {isPartyStatusFullScreen && gameState && (
                <Modal
                    isOpen={isPartyStatusFullScreen}
                    onClose={() => setIsPartyStatusFullScreen(false)}
                    title={t('Party Status')}
                    size="fullscreen"
                >
                    <div className="flex-1 flex flex-col h-full bg-gray-900 -m-6 p-4">
                        <PartyStatus
                            players={withLiveActivePlayer(gameState.players, gameState.playerCharacter)}
                            activePlayerIndex={gameState.activePlayerIndex}
                            onPassTurn={passTurnManually}
                            gameSettings={gameSettings}
                            imageCache={gameState?.imageCache ?? {}}
                            onImageGenerated={onImageGenerated}
                            onOpenImageModal={handleShowImageModal}
                            isFullScreen={true}
                            onCollapseFullScreen={() => setIsPartyStatusFullScreen(false)}
                            updatePlayerPortrait={updatePlayerPortrait}
                            isLoading={isLoading}
                        />
                    </div>
                </Modal>
            )}
            {isCinemaHallFullScreen && gameState && (
                <Modal
                    isOpen={isCinemaHallFullScreen}
                    onClose={() => setIsCinemaHallFullScreen(false)}
                    title={t('CinemaHall')}
                    size="fullscreen"
                >
                    <div className="flex-1 flex flex-col h-full bg-gray-900 -m-6 p-4">
                        <Suspense fallback={null}><CinemaHall
                            cinematics={gameState.cinematics || []}
                            onGenerateTrailer={generateFilmTrailer}
                            isGenerating={isGeneratingCinema || isLoading}
                            progress={cinemaGenerationProgress}
                            onPlay={playCinematic}
                            onExport={exportCinematic}
                            onDelete={deleteCinematic}
                            onImport={importCinematic}
                            onContinue={continueFilmTrailer}
                            extendingCinematicId={extendingCinematicId}
                            onCancel={cancelCinemaGeneration}
                            updateCinematic={updateCinematic}
                            regenerateCinemaFrame={regenerateCinemaFrame}
                            generateCinematicAudio={generateCinematicAudio}
                            isFullScreen={true}
                            onCollapse={() => setIsCinemaHallFullScreen(false)}
                        /></Suspense>
                    </div>
                </Modal>
            )}
            {isImageCacheFullScreen && gameState && (
                <Modal
                    isOpen={isImageCacheFullScreen}
                    onClose={() => setIsImageCacheFullScreen(false)}
                    title={t('ImageCache')}
                    size="fullscreen"
                >
                    <div className="flex-1 flex flex-col h-full bg-gray-900 -m-6 p-4">
                        <Suspense fallback={null}><ImageCacheGallery
                            imageCache={gameState.imageCache}
                            onImageGenerated={onImageGenerated}
                            onOpenImageModal={handleShowImageModal}
                            deleteImageFromCache={deleteImageFromCache}
                            clearImageCache={clearImageCache}
                            gameSettings={gameSettings}
                            isLoading={isLoading}
                            isFullScreen={true}
                            onCollapse={() => setIsImageCacheFullScreen(false)}
                        /></Suspense>
                    </div>
                </Modal>
            )}
            {editModalData && (
                <Modal isOpen={true} onClose={() => setEditModalData(null)} title={t("Edit Message")}>
                    <div className="space-y-4">
                        <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition min-h-[200px]"
                        />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setEditModalData(null)} className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 text-white font-semibold transition flex items-center gap-2">
                                <XMarkIcon className="w-5 h-5" />
                                {t('Cancel')}
                            </button>
                            <button onClick={handleSaveEdit} className="px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition flex items-center gap-2">
                                <CheckIcon className="w-5 h-5" />
                                {t('Save')}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
             <ConfirmationModal
                isOpen={isRegenConfirmOpen}
                onClose={() => setIsRegenConfirmOpen(false)}
                onConfirm={handleConfirmRegenerate}
                title={t('Regenerate Last Response')}
            >
                <p>{t('regenerate_confirmation_p1')}</p>
                <p className="mt-2 text-sm text-yellow-400/80">{t('regenerate_confirmation_p2')}</p>
            </ConfirmationModal>
            <ConfirmationModal
                isOpen={!!stealthConfirmAction}
                onClose={() => setStealthConfirmAction(null)}
                onConfirm={handleConfirmStealth}
                title={stealthConfirmAction === 'enter' ? t('enter_stealth_confirmation_title') : t('exit_stealth_confirmation_title')}
            >
                <p>{stealthConfirmAction === 'enter' ? t('enter_stealth_confirmation_p1') : t('exit_stealth_confirmation_p1')}</p>
            </ConfirmationModal>
            {isMusicPlayerVisible && musicPrompt && (
                <Suspense fallback={null}><LyriaMusicPlayer
                    initialPrompt={musicPrompt}
                    onClose={closeMusicPlayer}
                    onRegeneratePrompt={generateMusicPrompt}
                    onUpdatePrompt={updateMusicPrompt}
                    onGenerateSurprisePrompt={generateSurpriseMusicPrompt}
                    isHidden={isMusicPlayerDocked}
                    onDock={() => setIsMusicPlayerDocked(true)}
                    isPlaying={isMusicPlaying}
                    setIsPlaying={setIsMusicPlaying}
                    musicStatus={musicStatus}
                    setMusicStatus={setMusicStatus}
                    playPauseRef={playPauseMusicRef}
                /></Suspense>
            )}
            {viewingCharacter && gameState && (
                <Modal
                    isOpen={true}
                    onClose={handleCloseCharacterSheet}
                    title={`${t('Character Sheet')}: ${viewingCharacter.name}`}
                    size={isCharacterSheetFullScreen ? "fullscreen" : "default"}
                    onToggleFullScreen={() => setIsCharacterSheetFullScreen(p => !p)}
                    isFullScreen={isCharacterSheetFullScreen}
                >
                    <Suspense fallback={null}>
                    <CharacterSheet
                        character={viewingCharacter as PlayerCharacter | NPC}
                        playerCharacter={gameState.playerCharacter}
                        // FIX: Pass activeQuests to CharacterSheet
                        activeQuests={gameState.activeQuests}
                        isViewOnly={isLoading || ('playerId' in viewingCharacter ? viewingCharacter.playerId !== gameState.playerCharacter.playerId : (viewingCharacter.progressionType !== 'Companion' && !gameSettings!.allowHistoryManipulation))}
                        gameSettings={gameSettings!}
                        // FIX: Changed onOpenDetailModal to handleOpenDetailModal as the former is not defined.
                        onOpenDetailModal={handleOpenDetailModal}
                        onShowMessageModal={handleShowMessageModal}
                        // FIX: Changed onOpenTextReader to handleOpenTextReader as the former is not defined.
                        onOpenTextReader={handleOpenTextReader}
                        onOpenInventory={handleOpenPlayerInventory}
                        onOpenNpcInventory={handleOpenNpcInventory}
                        onSpendAttributePoint={spendAttributePoint}
                        forgetHealedWound={forgetHealedWound}
                        forgetActiveWound={forgetActiveWound}
                        clearAllHealedWounds={clearAllHealedWounds}
                        onDeleteCustomState={deleteCustomState}
                        onDeleteNpcCustomState={deleteNpcCustomState}
                        onDeleteActiveEffect={deleteActiveEffect}
                        onEditPlayerData={editPlayerData}
                        onEditNpcData={editNpcData}
                        updatePlayerPortrait={updatePlayerPortrait}
                        updateNpcPortrait={updateNpcPortrait}
                        onDeleteActiveSkill={deleteActiveSkill}
                        onDeletePassiveSkill={deletePassiveSkill}
                        updateActiveSkillSortOrder={updateActiveSkillSortOrder}
                        updatePassiveSkillSortOrder={updatePassiveSkillSortOrder}
                        updateNpcItemSortOrder={updateNpcItemSortOrder}
                        updateNpcItemSortSettings={updateNpcItemSortSettings}
                        imageCache={gameState.imageCache ?? {}}
                        onImageGenerated={onImageGenerated}
                        encounteredFactions={gameState.encounteredFactions}
                        onOpenImageModal={handleShowImageModal}
                        onOpenJournalModal={handleOpenJournalModal}
                        clearAllCompletedNpcActivities={clearAllCompletedNpcActivities}
                        onDeleteCurrentActivity={onDeleteCurrentActivity}
                        onDeleteCompletedActivity={onDeleteCompletedActivity}
                        onEditNpcMemory={onEditNpcMemory}
                        onDeleteNpcMemory={onDeleteNpcMemory}
                        allLocations={allWorldLocations}
                        allNpcs={gameState.encounteredNPCs}
                        onViewCharacterSheet={handleViewCharacter}
                        handleTransferItem={handleTransferItem}
                        handleEquipItemForNpc={handleEquipItemForNpc}
                        handleUnequipItemForNpc={handleUnequipItemForNpc}
                        handleSplitItemForNpc={handleSplitItemForNpc}
                        handleMergeItemsForNpc={handleMergeItemsForNpc}
                        initialView={characterSheetDefaultView}
                        onRegenerateId={onRegenerateId}
                        isLoading={isLoading}
                    />
                    </Suspense>
                </Modal>
            )}
            <Suspense fallback={null}><CinemaPlayer
                cinematic={playingCinematic}
                isOpen={isCinemaVisible}
                onClose={closeCinemaPlayer}
            /></Suspense>
            {preparedSaveFiles && (
                <Modal isOpen={true} onClose={closePreparedSaveFile} title={t('Save file is ready')}>
                    <div className="space-y-4 text-gray-200">
                        <p>{t('Choose how to save your game file.')}</p>
                        <a
                            href={preparedSaveFiles.single.url}
                            download={preparedSaveFiles.single.filename}
                            className="flex w-full items-center justify-center rounded-md bg-cyan-600 px-4 py-3 font-semibold text-white hover:bg-cyan-500"
                        >
                            {t('Download save file')} ({preparedSaveFiles.single.filename})
                        </a>
                        {preparedSaveFiles.images && (
                            <div className="space-y-2 rounded-md border border-gray-700 p-3">
                                <p className="text-sm text-gray-300">{t('Or download the save and its images as two files: keep them together, the save needs the images file.')}</p>
                                <a
                                    href={preparedSaveFiles.save.url}
                                    download={preparedSaveFiles.save.filename}
                                    className="flex w-full items-center justify-center rounded-md border border-gray-600 px-4 py-3 font-semibold text-cyan-200 hover:bg-gray-700"
                                >
                                    {t('Save file without images')} ({preparedSaveFiles.save.filename})
                                </a>
                                <a
                                    href={preparedSaveFiles.images.url}
                                    download={preparedSaveFiles.images.filename}
                                    className="flex w-full items-center justify-center rounded-md border border-gray-600 px-4 py-3 font-semibold text-cyan-200 hover:bg-gray-700"
                                >
                                    {t('Images file')} ({preparedSaveFiles.images.filename})
                                </a>
                            </div>
                        )}
                        <a
                            href={preparedSaveFiles.single.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex w-full items-center justify-center rounded-md border border-gray-600 px-4 py-3 font-semibold text-cyan-200 hover:bg-gray-700"
                        >
                            {t('Open save file in new tab')}
                        </a>
                        <p className="text-sm text-gray-400">{t('If the download is blocked, open the save in a new tab and use your browser’s Save command.')}</p>
                    </div>
                </Modal>
            )}
            {isSaving && (
                <div className="fixed bottom-4 right-4 z-[1100] bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-4 animate-fade-in-down">
                    <LoadingSpinner />
                    <span className="font-semibold">{t('Saving game...')}</span>
                </div>
            )}
            </ErrorBoundary>
        </>
    );
}
