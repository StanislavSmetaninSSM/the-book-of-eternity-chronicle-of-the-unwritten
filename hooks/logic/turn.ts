
import React from 'react';
import { GameState, GameContext, ChatMessage, GameResponse, WorldStateFlag, Location, NPC, PeerInfo, NetworkRole, GameSettings, NetworkMessage, SaveFile, Item } from '../../types';
import { executeTurn, askGmQuestion as executeGmQuestion, getModelForStep, executeWorldProgression } from '../../utils/gemini';
import { createInitialContext, buildNextContext } from '../../utils/gameContext';
import { formatError } from '../../utils/errorUtils';
import { playNotificationSound } from '../../utils/soundManager';
import { DataConnection } from 'peerjs';
import { deepMergeResponses, processAndApplyResponse } from '../../utils/responseProcessor';
import { deepStripModerationSymbols } from '../../utils/textUtils';
import { acquireArenaGmTurnLease } from '../../utils/arenaGmRelay';
import { clearInterruptedTurnRecovery, saveInterruptedTurnRecovery } from '../../utils/fileManager';


const asArray = <T>(value: T | T[] | null | undefined): T[] => {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.filter(item => item !== null && item !== undefined);
    return [value];
};
const isObject = (item: any): item is object => (item && typeof item === 'object' && !Array.isArray(item));

export const createTurnManager = (
    {
        gameState, setGameState, gameHistory, setGameHistory,
        isLoading, setIsLoading, setError,
        setLastJsonResponse, setLastRequestJson,
        setGameLog, setCombatLog, setSceneImagePrompt, setSuggestedActions,
        setWorldMap, setVisitedLocations, setWorldState, setTurnNumber,
        gameContextRef, abortControllerRef,
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
        broadcastFullSync: (saveData: SaveFile) => void,
        combatLog: string[],
        gameLog: string[],
        packageSaveDataForTurn?: () => SaveFile | null;
        setLastTurnSaveFile?: React.Dispatch<React.SetStateAction<SaveFile | null>>;
    }
) => {
    const clearStashForNewTurn = () => {
        setGameState(prev => {
            if (!prev) return null;
            if (prev.temporaryStash && prev.temporaryStash.length > 0) {
                return { ...prev, temporaryStash: [] };
            }
            return prev;
        });
    };

    let releaseArenaGmTurn: (() => void) | null = null;
    const handleTurn = async (context: GameContext, fullHistoryForTurn: ChatMessage[], baseStateOverride?: GameState) => {
        setIsLoading(true);
        setError(null);
        clearStashForNewTurn();
        if (!context.enemiesDataForCurrentTurn || context.enemiesDataForCurrentTurn.length === 0) {
          setCombatLog([]);
        }
        setGameLog([]);
        setLastJsonResponse('');
        setSuggestedActions([]);
        abortControllerRef.current = new AbortController();

        try {
            const onPartialResponse = (response: any, stepName: string, modelName: string) => {
                setLastJsonResponse(JSON.stringify(response, null, 2));
                if (response.items_and_stat_calculations) {
                    setGameLog(response.items_and_stat_calculations);
                }
            };
            const onStepStart = (stepName: string, modelName: string) => {
                setCurrentStep(stepName);
                setCurrentModel(getModelForStep(stepName, context));
            };
            const onStreamingChunk = (text: string) => {
                setLastJsonResponse(text);
            };

            const baseState: GameState | null = baseStateOverride || gameStateRef.current;

            if (!baseState) {
                const errorMsg = "Critical error: Game state is missing when trying to process a turn. This might be due to a stale state closure. Aborting turn.";
                console.error(errorMsg);
                setError(errorMsg);
                setIsLoading(false);
                return;
            }
            
            // Save the submitted action and its pre-turn state before the first relay request.
            // If the browser reloads, the start screen can replay this exact action from the saved baseline.
            if (baseState.networkRole === 'none') {
                try {
                    await saveInterruptedTurnRecovery({ context, baseState, history: fullHistoryForTurn });
                } catch (recoveryError) {
                    console.error('Could not persist interrupted-turn recovery checkpoint:', recoveryError);
                    setError(t('Could not save the interrupted turn checkpoint. The game will continue, but a browser reload may lose this action.'));
                }
            }

            // Keep automatic/optional image jobs out of the mailbox for the entire staged turn.
            releaseArenaGmTurn = await acquireArenaGmTurnLease();
            const finalResponseRaw = await executeTurn(
                context,
                abortControllerRef.current.signal,
                onPartialResponse,
                onStreamingChunk,
                onStepStart
            );
            
            const finalResponse = deepStripModerationSymbols(finalResponseRaw);
          
            if (context.gameSettings.allowHistoryManipulation !== true && finalResponse.playerBehaviorAssessment?.historyManipulationCoefficient >= 0.8) {
                setError(t("history_manipulation_rejection"));
                setGameHistory(prev => prev.slice(0, -1)); // Remove the offending player message
                setIsLoading(false);
                await clearInterruptedTurnRecovery().catch(error => console.error('Could not clear rejected turn checkpoint:', error));
                return;
            }
          
            setLastJsonResponse(JSON.stringify(finalResponse, null, 2));
            if (finalResponse.image_prompt !== undefined && finalResponse.image_prompt !== null) {
                setSceneImagePrompt(finalResponse.image_prompt);
            }
            setSuggestedActions(finalResponse.dialogueOptions || []);

            const gmMessage: ChatMessage = { sender: 'gm', content: finalResponse.response || '' };
                      
            // FIX: Passing context.worldMap to processAndApplyResponse to prevent data bleeding
            const { newState, logsToAdd, combatLogsToAdd } = processAndApplyResponse(finalResponse, baseState, context.gameSettings, t, true, context.currentTurnNumber, context.worldMap);

            // Save the thought signature to the game state for the next turn
            if (finalResponse.thoughtSignature) {
                newState.thoughtSignature = finalResponse.thoughtSignature;
            }
            
            if (finalResponse.itemJournalUpdates) {
                asArray(finalResponse.itemJournalUpdates).forEach(update => {
                    let itemFound = false;
                    
                    const findAndUpdate = (inventory: Item[]) => {
                        if (itemFound || !inventory) return;
            
                        let item: Item | null = null;
                        
                        if (update.itemId) {
                            item = inventory.find((i: Item) => i.existedId === update.itemId) || null;
                        }
                        
                        if (!item && update.initialItemId) {
                            item = inventory.find((i: Item) => i.initialId === update.initialItemId) || null;
                        }
            
                        if (!item && update.itemName) {
                            item = inventory.find((i: Item) => i.name === update.itemName && (!i.journalEntries || i.journalEntries.length === 0)) || inventory.find(i => i.name === update.itemName);
                        }
            
                        if (item) {
                            if (!Array.isArray(item.journalEntries)) {
                                item.journalEntries = [];
                            }
                            item.journalEntries.unshift(update.entryToAppend);
                            itemFound = true;
                        }
                    };
            
                    newState.players.forEach(p => {
                        if (p?.inventory) findAndUpdate(p.inventory);
                    });
            
                    if (!itemFound) {
                        newState.encounteredNPCs.forEach(npc => {
                            if (npc?.inventory) findAndUpdate(npc.inventory);
                        });
                    }
                });
            }


            if (newState.currentLocationData.initialId) {
                newState.encounteredNPCs.forEach(npc => {
                    if (npc.initialLocationId === newState.currentLocationData.initialId) {
                        npc.currentLocationId = newState.currentLocationData.locationId;
                    }
                });
            }

            const newHistoryWithAnswer = [...fullHistoryForTurn, gmMessage];
            const currentRole = baseState.networkRole;

            if (currentRole === 'player') {
                const nextContext = buildNextContext(context, finalResponse, newState, newHistoryWithAnswer, true);

                const newSaveData: SaveFile = {
                    gameContext: nextContext,
                    gameState: newState,
                    gameHistory: newHistoryWithAnswer,
                    gameLog: [...asArray(finalResponse.items_and_stat_calculations), ...logsToAdd],
                    combatLog: combatLog.concat(combatLogsToAdd),
                    lastJsonResponse: JSON.stringify(finalResponse, null, 2),
                    sceneImagePrompt: finalResponse.image_prompt || null,
                    timestamp: new Date().toISOString()
                };
                
                if (hostConnectionRef.current) {
                    const message: NetworkMessage = {
                        type: 'turn_result_from_player',
                        payload: { saveFile: newSaveData },
                        senderId: baseState.myPeerId!,
                    };
                    hostConnectionRef.current.send(message);
                    
                    // Optimistic update for UI responsiveness
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
                    setGameState(newState);
                    // isLoading remains true until sync from host
                } else {
                    setError(t("connection_lost"));
                    setIsLoading(false);
                }
            } else { // Host or local
                const nextContext = buildNextContext(context, finalResponse, newState, newHistoryWithAnswer, true);

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

                setGameState(newState);

                if (currentRole === 'host') {
                    const newSaveData: SaveFile = {
                        gameContext: nextContext,
                        gameState: newState,
                        gameHistory: newHistoryWithAnswer,
                        gameLog: [...asArray(finalResponse.items_and_stat_calculations), ...logsToAdd],
                        combatLog: combatLog.concat(combatLogsToAdd),
                        lastJsonResponse: JSON.stringify(finalResponse, null, 2),
                        sceneImagePrompt: finalResponse.image_prompt || null,
                        timestamp: new Date().toISOString()
                    };
                    broadcastFullSync(newSaveData);
                }
            }
            if (baseState.networkRole === 'none') {
                await clearInterruptedTurnRecovery().catch(error => console.error('Could not clear completed-turn checkpoint:', error));
            }
          
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            const formattedError = formatError(err);
            setError(formattedError);
            const systemMessage: ChatMessage = { sender: 'system', content: `Error: ${formattedError}` };
            setGameHistory(prev => [...prev, systemMessage]);
          }
        } finally {
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
    
    const sendMessage = (message: string, image?: { data: string; mimeType: string; } | null) => {
        if (isLoading) return;

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
        newContext.message = message;
        newContext.image = image || null;
        newContext.responseHistory = newHistory.slice(-15);
        // Use the signature from the current game state to continue the thought process
        if (gameState && gameState.thoughtSignature) {
            newContext.previousThoughtSignature = gameState.thoughtSignature;
        }
        setLastRequestJson(JSON.stringify(newContext, null, 2));
        
        handleTurn(newContext, newHistory);
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
        const baseState: GameState | null = gameStateRef.current;
        if (!gameContextRef.current || isLoading || !baseState) return;
    
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
        clearStashForNewTurn();
        if (!gameContextRef.current?.enemiesDataForCurrentTurn || gameContextRef.current.enemiesDataForCurrentTurn.length === 0) {
            setCombatLog([]);
        }
        setLastJsonResponse('');
        setSuggestedActions([]);
        abortControllerRef.current = new AbortController();
    
        const questionMessage: ChatMessage = { sender: 'player', content: `[Question] ${question}` };
        const historyWithQuestion = [...gameHistory, questionMessage];
        setGameHistory(historyWithQuestion);
    
        const context = { 
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
        
        try {
            const onStepStart = (stepName: string, modelName: string) => {
              setCurrentStep(stepName);
              setCurrentModel(getModelForStep(stepName, context));
            };
            const onStreamingChunk = (text: string) => {
              setLastJsonResponse(text);
            };
    
            const finalResponseRaw: GameResponse = await executeGmQuestion(context, abortControllerRef.current.signal, onStreamingChunk, onStepStart);
            const finalResponse = deepStripModerationSymbols(finalResponseRaw);
            
            let finalMergedResponse = finalResponse;
            const gmMessage: ChatMessage = { sender: 'gm', content: finalResponse.response || '' };
    
            if (finalResponse.generateWorldProgression === true) {
                const wpContext = { ...context, responseHistory: [...historyWithQuestion, gmMessage] };
                const wpResponseRaw = await executeWorldProgression(wpContext, abortControllerRef.current!.signal, onStreamingChunk, (r, s, m) => setLastJsonResponse(JSON.stringify(r, null, 2)), onStepStart);
                const wpResponse = deepStripModerationSymbols(wpResponseRaw);
                finalMergedResponse = deepMergeResponses(finalResponse, wpResponse);
                
                // If World Progression returns a new signature, use it. Otherwise keep the one from the question.
                if (wpResponse.thoughtSignature) {
                    finalMergedResponse.thoughtSignature = wpResponse.thoughtSignature;
                } else if (finalResponse.thoughtSignature) {
                    finalMergedResponse.thoughtSignature = finalResponse.thoughtSignature;
                }
            }
            
            setLastJsonResponse(JSON.stringify(finalMergedResponse, null, 2));
    
            // FIX: Passing context.worldMap instead of visitedLocations
            const { newState, logsToAdd, combatLogsToAdd } = processAndApplyResponse(finalMergedResponse as GameResponse, baseState, gameSettings, t, false, context.currentTurnNumber, context.worldMap);
            
            // Save the signature if present
            if (finalMergedResponse.thoughtSignature) {
                newState.thoughtSignature = finalMergedResponse.thoughtSignature;
            }

            const newHistoryWithAnswer = [...historyWithQuestion, gmMessage];
            const newLogsForThisTurn = [...asArray(finalMergedResponse.items_and_stat_calculations), ...logsToAdd];
            
            const currentRole = baseState.networkRole;
    
            if (currentRole === 'player') {
                const nextContext = buildNextContext(context, finalMergedResponse as GameResponse, newState, newHistoryWithAnswer, false);
                const newSaveData: SaveFile = {
                    gameContext: nextContext,
                    gameState: newState,
                    gameHistory: newHistoryWithAnswer,
                    gameLog: [...gameLog, ...newLogsForThisTurn],
                    combatLog: [...combatLog, ...combatLogsToAdd],
                    lastJsonResponse: JSON.stringify(finalMergedResponse, null, 2),
                    sceneImagePrompt: finalMergedResponse.image_prompt || null,
                    timestamp: new Date().toISOString()
                };
                
                if (hostConnectionRef.current) {
                    const message: NetworkMessage = {
                        type: 'turn_result_from_player',
                        payload: { saveFile: newSaveData },
                        senderId: baseState.myPeerId!,
                    };
                    hostConnectionRef.current.send(message);
                    
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
                    setGameState(newState);
                    // isLoading remains true until sync from host
                } else {
                    setError(t("connection_lost"));
                    setIsLoading(false);
                }
            } else { // Host or local
                setGameLog(prev => [...prev, ...newLogsForThisTurn]);
                if (combatLogsToAdd.length > 0) {
                    setCombatLog(prev => [...prev, ...combatLogsToAdd]);
                }
                
                const nextContext = buildNextContext(context, finalMergedResponse as GameResponse, newState, newHistoryWithAnswer, false);
                gameContextRef.current = nextContext;
    
                setGameHistory(newHistoryWithAnswer);
                setWorldState(nextContext.worldState);
                setWorldMap(nextContext.worldMap);
                setVisitedLocations(nextContext.visitedLocations);
                setTurnNumber(nextContext.currentTurnNumber);
                
                setGameState(newState);
    
                if (currentRole === 'host') {
                    const newSaveData: SaveFile = {
                        gameContext: nextContext,
                        gameState: newState,
                        gameHistory: newHistoryWithAnswer,
                        gameLog: [...gameLog, ...newLogsForThisTurn],
                        combatLog: [...combatLog, ...combatLogsToAdd],
                        lastJsonResponse: JSON.stringify(finalMergedResponse, null, 2),
                        sceneImagePrompt: finalMergedResponse.image_prompt || null,
                        timestamp: new Date().toISOString()
                    };
                    broadcastFullSync(newSaveData);
                }
            }
          
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            const formattedError = formatError(err);
            setError(formattedError);
            const systemMessage: ChatMessage = { sender: 'system', content: `Error: ${formattedError}` };
            setGameHistory([...historyWithQuestion, systemMessage]);
          }
        } finally {
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
    
    const cancelRequest = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            void clearInterruptedTurnRecovery().catch(error => console.error('Could not clear cancelled-turn checkpoint:', error));
            setIsLoading(false);
            setError("Request cancelled by user.");
            setSuggestedActions([]);
        }
    };

    const resumeInterruptedTurn = (recovery: { context: GameContext; baseState: GameState; history: ChatMessage[] }) => {
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
