
import React from 'react';
import { GameState, SaveFile, NetworkMessage, NetworkRole, PeerInfo, PlayerCharacter, GameSettings, ChatMessage, CollectiveActionState, SimultaneousActionState, NetworkChatMessage } from '../../types';
import Peer, { DataConnection } from 'peerjs';
import { createNewPlayerCharacter } from '../../utils/characterManager';
import { formatError } from '../../utils/errorUtils';
import { acceptHostStamp, HostTurnAuthority, type TurnSyncStamp } from '../../utils/networkTurnProtocol';
import { sendOnOpenConnection } from '../../utils/peerSend';

const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

type TFunction = (key: string, replacements?: Record<string, string | number>) => string;

interface MultiplayerManagerProps {
    setGameState: React.Dispatch<React.SetStateAction<GameState | null>>;
    setGameStateForConnection: React.Dispatch<React.SetStateAction<GameState | null>>;
    setGameHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    setError: React.Dispatch<React.SetStateAction<string | null>>;
    t: TFunction;
    initializeAndRunFirstTurn: (creationData: any, networkConfig?: { role: NetworkRole; peerId?: string }) => void;
    restoreFromSaveData: (data: SaveFile, isNetworkSync?: boolean, identity?: { role: NetworkRole; myPeerId: string; hostPeerId: string }) => SaveFile;
    packageSaveData: (gameState: GameState | null) => SaveFile | null;
    broadcastFullSync: (saveData: SaveFile) => void | Promise<void>;
    addPlayer: (creationData: any) => void;
    removePlayer: (playerId: string) => void;
    passTurnToPlayer: (playerIndex: number) => void;
    gameContextRef: React.MutableRefObject<any>;
    peerRef: React.MutableRefObject<Peer | null>;
    connectionsRef: React.MutableRefObject<Map<string, DataConnection>>;
    hostConnectionRef: React.MutableRefObject<DataConnection | null>;
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
    activeTurnRef: React.MutableRefObject<symbol | null>;
    abortControllerRef: React.MutableRefObject<AbortController | null>;
    turnPhaseRef: React.MutableRefObject<'idle' | 'generating' | 'sending' | 'committed' | 'awaiting-sync'>;
    hostTurnAuthority: HostTurnAuthority;
    clientTurnStampRef: React.MutableRefObject<TurnSyncStamp | null>;
    pendingNetworkTurnRef: React.MutableRefObject<string | null>;
    observedHostStampRef: React.MutableRefObject<TurnSyncStamp | null>;
    pendingClientSyncRef: React.MutableRefObject<PendingClientSync | null>;
    scheduleClientSyncCommit: () => void;
    clearHostRestorePending: () => void;
    syncNewPeerRef: React.MutableRefObject<(conn: DataConnection) => void>;
    sendMessageRef: React.MutableRefObject<(message: string, image?: { data: string; mimeType: string; } | null) => void>;
    gameStateRef: React.RefObject<GameState | null>;
    onChatMessage: (message: NetworkChatMessage) => void;
}


export interface PendingClientSync { stamp: TurnSyncStamp; snapshot: SaveFile; presentationReplayRequested?: boolean; }

export function snapshotMatchesRendered(snapshot: SaveFile, rendered: { gameState: GameState | null; currentGameState: GameState | null; gameHistory: ChatMessage[]; gameLog: string[]; combatLog: string[]; lastJsonResponse: string | null; sceneImagePrompt: string | null }): boolean {
    // A superseded task can append a local system warning after restoration.
    // Its suffix is safe; the authoritative history must still be the prefix.
    const historyMatches = Array.isArray(snapshot.gameHistory) && rendered.gameHistory.length >= snapshot.gameHistory.length &&
        snapshot.gameHistory.every((entry, index) => rendered.gameHistory[index] === entry) &&
        rendered.gameHistory.slice(snapshot.gameHistory.length).every(entry => entry.sender === 'system');
    // Cinema or an image job can finish independently during synchronization.
    // Permit those presentation-only fields; all gameplay fields must still
    // match. The state setter re-filters these two collections, so
    // compare their entries rather than their array identities.
    const actual = rendered.gameState, expected = snapshot.gameState;
    const sameEntries = (a: unknown, b: unknown) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((entry, i) => entry === b[i]);
    const stateMatches = actual === expected || !!actual && !!expected &&
        Object.keys(actual).length === Object.keys(expected).length &&
        Object.keys(actual).every(key => Object.prototype.hasOwnProperty.call(expected, key)) &&
        Object.keys(expected).every(key => key === 'cinematics' || key === 'imageCache' ||
            ((key === 'encounteredNPCs' || key === 'encounteredFactions') && sameEntries((actual as any)[key], (expected as any)[key])) ||
            (actual as any)[key] === (expected as any)[key]);
    return stateMatches && rendered.currentGameState === rendered.gameState &&
        historyMatches && rendered.gameLog === snapshot.gameLog &&
        rendered.combatLog === snapshot.combatLog && rendered.lastJsonResponse === snapshot.lastJsonResponse &&
        rendered.sceneImagePrompt === snapshot.sceneImagePrompt;
}

export function commitClientSnapshot(pending: PendingClientSync | null, rendered: Parameters<typeof snapshotMatchesRendered>[1]): TurnSyncStamp | null {
    return pending && snapshotMatchesRendered(pending.snapshot, rendered) ? pending.stamp : null;
}

// Invalidate the usable grant before restoration. A grant is made usable only
// by the React post-commit effect after all snapshot fields have rendered.
export function stageHostFullSync(message: NetworkMessage, identity: { role: NetworkRole; myPeerId: string; hostPeerId: string }, props: Pick<MultiplayerManagerProps, 'observedHostStampRef' | 'clientTurnStampRef' | 'pendingClientSyncRef' | 'activeTurnRef' | 'abortControllerRef' | 'turnPhaseRef' | 'restoreFromSaveData' | 'setError' | 'setIsLoading' | 'scheduleClientSyncCommit' | 't'>): 'staged' | 'ignored' | 'failed' {
    const decision = acceptHostStamp(props.observedHostStampRef.current, message.payload?.protocol);
    if (decision === 'invalid') { props.setError(props.t('network_protocol_incompatible')); return 'failed'; }
    if (decision !== 'accept') return 'ignored';
    const previousObservedStamp = props.observedHostStampRef.current;
    props.clientTurnStampRef.current = null;
    props.pendingClientSyncRef.current = null;
    if (props.activeTurnRef.current) props.abortControllerRef.current?.abort();
    else props.turnPhaseRef.current = 'idle';
    props.setIsLoading(true);
    try {
        const snapshot = props.restoreFromSaveData(message.payload.saveFile, true, identity);
        const stamp = message.payload.protocol as TurnSyncStamp;
        props.pendingClientSyncRef.current = { stamp, snapshot };
        props.observedHostStampRef.current = stamp;
        props.setIsLoading(true);
        props.scheduleClientSyncCommit();
        return 'staged';
    } catch (error) {
        // Restore can have partially scheduled updates. Keep the grant unusable,
        // but do not advance the observed stamp: the same snapshot may be retried.
        props.observedHostStampRef.current = previousObservedStamp;
        props.pendingClientSyncRef.current = null;
        props.setError(`${props.t('network_sync_restore_failed')}\n\n${formatError(error)}`);
        props.setIsLoading(false);
        return 'failed';
    }
}


export const applyPlayerTurnResult = async (message: NetworkMessage, connectionId: string, {
    gameStateRef, restoreFromSaveData, broadcastFullSync, setError, setGameHistory, t, hostTurnAuthority, activeTurnRef
}: Pick<MultiplayerManagerProps, 'gameStateRef' | 'restoreFromSaveData' | 'broadcastFullSync' | 'setError' | 'setGameHistory' | 't' | 'hostTurnAuthority' | 'activeTurnRef'>, acknowledge: (payload: any) => Promise<void>) => {
    const current = gameStateRef.current;
    const submission = message.payload?.submission;
    const decision = message.payload?.saveFile && current
        ? hostTurnAuthority.accept(submission, message.senderId, connectionId, current.players[current.activePlayerIndex]?.playerId, activeTurnRef.current !== null)
        : 'invalid';
    const reply = async (status: string) => {
        try { await acknowledge({ turnId: submission?.turnId, status }); }
        catch (error) { console.warn('Could not deliver turn acknowledgement:', error); }
    };
    if (decision !== 'accepted') { await reply(decision); return; }
    let restored = false;
    try {
        const snapshot = restoreFromSaveData(message.payload.saveFile, true);
        restored = true;
        // Acknowledgement is a receipt, not proof that every peer received sync.
        void reply('accepted').catch(() => {});
        await broadcastFullSync(snapshot);
    } catch (err) {
        // The grant was consumed even if restoration failed; never replay blindly.
        if (!restored) { hostTurnAuthority.markUnknown(submission.turnId); void reply('unknown'); }
        const error = `${t(restored ? 'error_turn_applied_followup' : 'error_turn_delivery_unknown')}\n\n${formatError(err)}`;
        setError(error);
        setGameHistory(prev => [...prev, { sender: 'system', content: `Error: ${error}` }]);
    }
};

export const createMultiplayerManager = (
    {
        setGameState,
        setGameStateForConnection,
        setGameHistory,
        setError,
        t,
        initializeAndRunFirstTurn,
        restoreFromSaveData,
        packageSaveData,
        broadcastFullSync,
        addPlayer,
        removePlayer,
        passTurnToPlayer,
        gameContextRef,
        peerRef,
        connectionsRef,
        hostConnectionRef,
        setIsLoading,
        activeTurnRef,
        abortControllerRef,
        turnPhaseRef,
        hostTurnAuthority,
        clientTurnStampRef,
        pendingNetworkTurnRef,
        observedHostStampRef,
        pendingClientSyncRef,
        scheduleClientSyncCommit,
        clearHostRestorePending,
        syncNewPeerRef,
        sendMessageRef,
        gameStateRef,
        onChatMessage
    }: MultiplayerManagerProps
) => {

    const requestSyncFromHost = () => {
        const currentGameState = gameStateRef.current;
        if (!currentGameState || currentGameState.networkRole !== 'player' || !hostConnectionRef.current) {
            return;
        }
        const message: NetworkMessage = {
            type: 'request_full_sync',
            payload: {},
            // FIX: Corrected property 'myPlayerId' to 'myPeerId' as defined in the GameState interface.
            senderId: currentGameState.myPeerId!,
        };
        clientTurnStampRef.current = null;
        void sendOnOpenConnection(hostConnectionRef.current, message).catch(error =>
            setError(`${t('error_sync_failed')}\n\n${formatError(error)}`));
        const systemMessage: ChatMessage = { sender: 'system', content: t('requesting_sync_from_host') };
        setGameHistory(prev => [...prev, systemMessage]);
    };

    const startHost = (creationData: any) => {
        clearHostRestorePending();
        hostTurnAuthority.reset();
        clientTurnStampRef.current = null;
        observedHostStampRef.current = null;
        pendingClientSyncRef.current = null;
        pendingNetworkTurnRef.current = null;
        setIsLoading(true);
        setError(null);
        if (peerRef.current) {
            peerRef.current.destroy();
        }
        const peer = new Peer();
        peerRef.current = peer;

        (peer as any).on('open', (id: string) => {
            console.log('PeerJS Host open. ID:', id);
            initializeAndRunFirstTurn(creationData, { role: 'host', peerId: id });
            const hostMessage: ChatMessage = { sender: 'system', content: t('hosting_started_message', { hostId: id }) };
            setGameHistory(prev => [...prev, hostMessage]);
        });

        (peer as any).on('connection', (conn: DataConnection) => {
            console.log(`Incoming connection from ${conn.peer}`);

            (conn as any).on('open', () => {
                connectionsRef.current.set(conn.peer, conn);
                syncNewPeerRef.current(conn);
            });

            (conn as any).on('data', (data: any) => {
                const message = data as NetworkMessage;
                console.log(`Data from ${conn.peer}:`, message.type);
                switch (message.type) {
                    case 'turn_result_from_player': {
                        void applyPlayerTurnResult(message, conn.peer, { gameStateRef, restoreFromSaveData, broadcastFullSync, setError, setGameHistory, t, hostTurnAuthority, activeTurnRef }, payload => sendOnOpenConnection(conn, { type: 'turn_result_ack', payload }));
                        break;
                    }
                    case 'new_player_character_data': {
                        addPlayer(message.payload.playerCharacter);
                        break;
                    }
                    case 'request_full_sync': {
                        console.log(`Received sync request from ${conn.peer}. Broadcasting full state.`);
                        hostTurnAuthority.revoke();
                        const saveData = packageSaveData(gameStateRef.current);
                        if (saveData) {
                            Promise.resolve(broadcastFullSync(saveData)).then(() => {
                                const systemMessage: ChatMessage = { sender: 'system', content: t('sync_requested_by_player', { name: conn.metadata.playerName }) };
                                setGameHistory(prev => [...prev, systemMessage]);
                            }).catch(error => setError(`${t('error_sync_failed')}\n\n${formatError(error)}`));
                        }
                        break;
                    }
                    case 'chat_message': {
                        onChatMessage(message.payload); // Add to host's history
                        // Broadcast to all clients
                        connectionsRef.current.forEach(c => {
                            c.send(message);
                        });
                        break;
                    }
                    case 'request_collective_action': {
                        const { participantIds, prompt, initiatorId, initiatorName } = message.payload;
                        setGameState(prevState => {
                            if (!prevState) return null;
                            const newCollectiveState: CollectiveActionState = {
                                isActive: true,
                                initiatorId: initiatorId,
                                initiatorName: initiatorName,
                                prompt: prompt,
                                participantIds: participantIds,
                                actions: {}
                            };
                            return { ...prevState, collectiveActionState: newCollectiveState };
                        });
                        break;
                    }
                    case 'submit_collective_action': {
                        const { action } = message.payload;
                        const senderId = message.senderId!;
                        setGameState(prevState => {
                            if (!prevState || !prevState.collectiveActionState?.isActive) return prevState;
                            const newActions = { ...prevState.collectiveActionState.actions, [senderId]: action };
                            const newCollectiveState = { ...prevState.collectiveActionState, actions: newActions };
                            return { ...prevState, collectiveActionState: newCollectiveState };
                        });
                        break;
                    }
                    case 'request_simultaneous_action': {
                        setGameState(prevState => {
                            if (!prevState) return null;
                            const newSimultaneousState: SimultaneousActionState = {
                                isActive: true,
                                actions: {}
                            };
                            return { ...prevState, simultaneousActionState: newSimultaneousState };
                        });
                        break;
                    }
                    case 'simultaneous_action_submit': {
                        const { action } = message.payload;
                        const senderId = message.senderId!;
                        setGameState(prevState => {
                            if (!prevState || !prevState.simultaneousActionState?.isActive) return prevState;
                            const newActions = { ...prevState.simultaneousActionState.actions, [senderId]: action };
                            const newSimultaneousState = { ...prevState.simultaneousActionState, actions: newActions };
                            return { ...prevState, simultaneousActionState: newSimultaneousState };
                        });
                        break;
                    }
                }
            });

            (conn as any).on('close', () => {
                console.log(`Connection from ${conn.peer} closed.`);
                connectionsRef.current.delete(conn.peer);
                setGameState(prev => {
                    if (!prev) return null;
                    const peerThatLeft = prev.peers.find(p => p.id === conn.peer);
                    const disconnectMessage: ChatMessage = { sender: 'system', content: t('player_has_disconnected', { name: peerThatLeft?.name || conn.peer }) };
                    setGameHistory(p => [...p, disconnectMessage]);
                    return { ...prev, peers: prev.peers.filter(p => p.id !== conn.peer) };
                });
            });
        });

        (peer as any).on('error', (err: any) => {
            console.error('PeerJS error:', err);
            setError(`Network error: ${err.message}`);
            setIsLoading(false);
        });
    };

    const joinGame = (hostPeerId: string, role: NetworkRole, playerName: string) => {
        clearHostRestorePending();
        clientTurnStampRef.current = null;
        observedHostStampRef.current = null;
        pendingClientSyncRef.current = null;
        pendingNetworkTurnRef.current = null;
        setIsLoading(true);
        setError(null);
        if (peerRef.current) {
            peerRef.current.destroy();
        }
        
        const connectMessage: ChatMessage = { sender: 'system', content: t('Connecting to host {hostId}...', { hostId: hostPeerId }) };
        setGameHistory([connectMessage]);
        
        const peer = new Peer();
        peerRef.current = peer;

        (peer as any).on('open', (id: string) => {
            console.log('PeerJS Client open. My ID:', id, 'Connecting to host:', hostPeerId);
            
            const conn = peer.connect(hostPeerId, {
                metadata: { playerName: playerName || `Player-${id.slice(-4)}`, role },
                reliable: true,
            });
            hostConnectionRef.current = conn;
            
            (conn as any).on('open', () => {
                console.log('Connection to host established.');
            });
            
            (conn as any).on('data', (data: any) => {
                const message = data as NetworkMessage;
                console.log('Received data from host:', message.type);
                
                switch(message.type) {
                    case 'full_sync': {
                        if (hostConnectionRef.current !== conn) break;
                        stageHostFullSync(message, { role, myPeerId: id, hostPeerId }, {
                            observedHostStampRef, clientTurnStampRef, pendingClientSyncRef,
                            activeTurnRef, abortControllerRef, turnPhaseRef, restoreFromSaveData,
                            setError, setIsLoading, scheduleClientSyncCommit, t
                        });
                        break;
                    }

                    case 'turn_result_ack': {
                        const { turnId, status } = message.payload || {};
                        if (typeof turnId !== 'string' || pendingNetworkTurnRef.current !== turnId) break;
                        if (status === 'accepted') break; // Wait for the authoritative full sync.
                        pendingNetworkTurnRef.current = null;
                        const warning = t(status === 'duplicate' ? 'network_turn_duplicate' : status === 'unknown' ? 'error_turn_delivery_unknown' : 'network_turn_rejected');
                        setError(warning);
                        setGameHistory(prev => [...prev, { sender: 'system', content: warning }]);
                        if (activeTurnRef.current && turnPhaseRef.current === 'sending') abortControllerRef.current?.abort();
                        else setIsLoading(false);
                        requestSyncFromHost();
                        break;
                    }

                    case 'chat_message':
                        onChatMessage(message.payload);
                        break;
                }
            });
            
            (conn as any).on('close', () => {
                if (hostConnectionRef.current !== conn) return;
                hostConnectionRef.current = null;
                console.log('Connection to host lost.');
                setError(t('connection_lost'));
                setIsLoading(activeTurnRef.current !== null);
                if (activeTurnRef.current) abortControllerRef.current?.abort();
                setGameStateForConnection(prev => prev ? ({ ...prev, isConnectedToHost: false }) : null);
            });

            (conn as any).on('error', (err: any) => {
                 console.error('PeerJS connection error:', err);
                setError(`Connection error: ${err.message}`);
                setIsLoading(activeTurnRef.current !== null);
            });
        });

        (peer as any).on('error', (err: any) => {
            console.error('PeerJS client error:', err);
            setError(`Network error: ${err.message}`);
            setIsLoading(false);
        });
    };

    const sendNewCharacterToHost = (creationData: any) => {
        const currentGameState = gameStateRef.current;
        const currentGameSettings = gameContextRef.current?.gameSettings;
        if (!currentGameState || !currentGameSettings || !hostConnectionRef.current) return;

        const newPlayer = createNewPlayerCharacter(
            creationData,
            currentGameSettings,
            {
                partyLevel: currentGameState.playerCharacter.level,
                shareCharacteristics: currentGameSettings.multiplePersonalitiesSettings?.shareCharacteristics ?? false,
                templatePlayer: creationData.templatePlayer
            }
        );
        newPlayer.playerId = currentGameState.myPeerId!;

        const message: NetworkMessage = {
            type: 'new_player_character_data',
            payload: { playerCharacter: newPlayer },
            senderId: currentGameState.myPeerId,
        };
        hostConnectionRef.current.send(message);

        setGameState(prev => prev ? { ...prev, playerNeedsToCreateCharacter: false } : null);
        const sentMessage: ChatMessage = { sender: 'system', content: 'Character data sent to host. Waiting for game state sync...' };
        setGameHistory(prev => [...prev, sentMessage]);
    };

    const assignCharacterToPeer = (characterId: string, newPeerId: string | null) => {
        const currentGameState = gameStateRef.current;
        if (currentGameState?.networkRole !== 'host') return;

        setGameState(prevState => {
            if (!prevState) return null;

            const newPlayers = JSON.parse(JSON.stringify(prevState.players)) as PlayerCharacter[];
            
            const characterToMoveIndex = newPlayers.findIndex(p => p.playerId === characterId);
            if (characterToMoveIndex === -1) {
                console.warn(`assignCharacterToPeer: Character with ID ${characterId} not found.`);
                return prevState;
            }

            if (newPeerId) {
                newPlayers.forEach((p, index) => {
                    if (p.playerId === newPeerId && index !== characterToMoveIndex) {
                        p.playerId = generateId('unassigned-player');
                    }
                });
            }

            const movedCharName = newPlayers[characterToMoveIndex].name;
            const newPeer = newPeerId ? prevState.peers.find(p => p.id === newPeerId) : null;
            const newPeerName = newPeer ? newPeer.name : t('Unassigned');

            newPlayers[characterToMoveIndex].playerId = newPeerId || generateId('unassigned-player');

            const newState = { ...prevState, players: newPlayers };
            
            const systemMessage: ChatMessage = {
                sender: 'system',
                content: t('character_assigned_to_player', { charName: movedCharName, playerName: newPeerName }),
            };
            setGameHistory(prev => [...prev, systemMessage]);

            return newState;
        });
    };

    const startHostingFromLocalGame = () => {
        const currentGameSettings = gameContextRef.current?.gameSettings;
        if (!currentGameSettings) return;
        if (currentGameSettings.cooperativeGameType === 'None') {
            setError(t('hosting_disabled_coop_none'));
            return;
        }

        clearHostRestorePending();
        hostTurnAuthority.reset();
        clientTurnStampRef.current = null;
        observedHostStampRef.current = null;
        pendingClientSyncRef.current = null;
        pendingNetworkTurnRef.current = null;
        setIsLoading(true);
        setError(null);
        if (peerRef.current) {
            peerRef.current.destroy();
        }
        const peer = new Peer();
        peerRef.current = peer;

        (peer as any).on('open', (id: string) => {
            console.log('PeerJS Host started from local game. ID:', id);
            setGameState(prev => {
                if (!prev) return null;

                const newPlayers = [...prev.players];
                const activePlayerIndex = prev.activePlayerIndex;

                const updatedActivePlayer = {
                    ...newPlayers[activePlayerIndex],
                    playerId: id,
                };

                newPlayers[activePlayerIndex] = updatedActivePlayer;

                if (gameContextRef.current) {
                    gameContextRef.current.playerCharacter = updatedActivePlayer;
                    gameContextRef.current.players = newPlayers;
                }

                return {
                    ...prev,
                    players: newPlayers,
                    playerCharacter: updatedActivePlayer,
                    networkRole: 'host',
                    myPeerId: id,
                    isConnectedToHost: true,
                };
            });
            const hostMessage: ChatMessage = { sender: 'system', content: t('hosting_started_message', { hostId: id }) };
            setGameHistory(prev => [...prev, hostMessage]);
            console.log('Setting isLoading to false...');
            setIsLoading(false); // ВАЖНО: Убрать loading состояние после успешной настройки
        });

        (peer as any).on('connection', (conn: DataConnection) => {
            console.log(`Incoming connection from ${conn.peer}`);
            
            (conn as any).on('open', () => {
                connectionsRef.current.set(conn.peer, conn);
                syncNewPeerRef.current(conn);
            });

            (conn as any).on('data', (data: any) => {
                const message = data as NetworkMessage;
                console.log(`Data from ${conn.peer}:`, message.type);
                switch (message.type) {
                    case 'turn_result_from_player': {
                        void applyPlayerTurnResult(message, conn.peer, { gameStateRef, restoreFromSaveData, broadcastFullSync, setError, setGameHistory, t, hostTurnAuthority, activeTurnRef }, payload => sendOnOpenConnection(conn, { type: 'turn_result_ack', payload }));
                        break;
                    }
                    case 'new_player_character_data': {
                        addPlayer(message.payload.playerCharacter);
                        break;
                    }
                    case 'chat_message': {
                        onChatMessage(message.payload); // Add to host's history
                        // Broadcast to all clients
                        connectionsRef.current.forEach(c => {
                            c.send(message);
                        });
                        break;
                    }
                    case 'request_full_sync': {
                        console.log(`Received sync request from ${conn.peer}. Broadcasting full state.`);
                        hostTurnAuthority.revoke();
                        const saveData = packageSaveData(gameStateRef.current);
                        if (saveData) {
                            Promise.resolve(broadcastFullSync(saveData)).then(() => {
                                const systemMessage: ChatMessage = { sender: 'system', content: t('sync_requested_by_player', { name: conn.metadata.playerName }) };
                                setGameHistory(prev => [...prev, systemMessage]);
                            }).catch(error => setError(`${t('error_sync_failed')}\n\n${formatError(error)}`));
                        }
                        break;
                    }
                    case 'request_collective_action': {
                        const { participantIds, prompt, initiatorId, initiatorName } = message.payload;
                        setGameState(prevState => {
                            if (!prevState) return null;
                            const newCollectiveState: CollectiveActionState = {
                                isActive: true,
                                initiatorId: initiatorId,
                                initiatorName: initiatorName,
                                prompt: prompt,
                                participantIds: participantIds,
                                actions: {}
                            };
                            return { ...prevState, collectiveActionState: newCollectiveState };
                        });
                        break;
                    }
                    case 'submit_collective_action': {
                        const { action } = message.payload;
                        const senderId = message.senderId!;
                        setGameState(prevState => {
                            if (!prevState || !prevState.collectiveActionState?.isActive) return prevState;
                            const newActions = { ...prevState.collectiveActionState.actions, [senderId]: action };
                            const newCollectiveState = { ...prevState.collectiveActionState, actions: newActions };
                            return { ...prevState, collectiveActionState: newCollectiveState };
                        });
                        break;
                    }
                    case 'request_simultaneous_action': {
                        setGameState(prevState => {
                            if (!prevState) return null;
                            const newSimultaneousState: SimultaneousActionState = {
                                isActive: true,
                                actions: {}
                            };
                            return { ...prevState, simultaneousActionState: newSimultaneousState };
                        });
                        break;
                    }
                    case 'simultaneous_action_submit': {
                        const { action } = message.payload;
                        const senderId = message.senderId!;
                        setGameState(prevState => {
                            if (!prevState || !prevState.simultaneousActionState?.isActive) return prevState;
                            const newActions = { ...prevState.simultaneousActionState.actions, [senderId]: action };
                            const newSimultaneousState = { ...prevState.simultaneousActionState, actions: newActions };
                            return { ...prevState, simultaneousActionState: newSimultaneousState };
                        });
                        break;
                    }
                }
            });

            (conn as any).on('close', () => {
                console.log(`Connection from ${conn.peer} closed.`);
                connectionsRef.current.delete(conn.peer);
                setGameState(prev => {
                    if (!prev) return null;
                    const peerThatLeft = prev.peers.find(p => p.id === conn.peer);
                    const disconnectMessage: ChatMessage = { sender: 'system', content: t('player_has_disconnected', { name: peerThatLeft?.name || conn.peer }) };
                    setGameHistory(p => [...p, disconnectMessage]);
                    return { ...prev, peers: prev.peers.filter(p => p.id !== conn.peer) };
                });
            });
        });

        (peer as any).on('error', (err: any) => {
            console.error('PeerJS error:', err);
            setError(`Network error: ${err.message}`);
            setIsLoading(false);
        });
    };

    const disconnect = () => {
        clientTurnStampRef.current = null;
        observedHostStampRef.current = null;
        pendingClientSyncRef.current = null;
        pendingNetworkTurnRef.current = null;
        clearHostRestorePending();
        hostTurnAuthority.reset();
        const role = gameStateRef.current?.networkRole;
        
        setGameHistory(prev => [...prev, { sender: 'system', content: t('disconnecting_message') }]);
    
        if (hostConnectionRef.current) {
            hostConnectionRef.current.close();
            hostConnectionRef.current = null;
        }
        connectionsRef.current.forEach(conn => conn.close());
        connectionsRef.current.clear();
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }
    
        setIsLoading(false);
        setError(null);

        if (activeTurnRef.current) abortControllerRef.current?.abort();
        if (role === 'player' || role === 'spectator' || role === 'host') {
            setGameStateForConnection(prev => {
                if (!prev) return null;
                const newState: GameState = {
                    ...prev,
                    networkRole: 'none',
                    myPeerId: null,
                    hostPeerId: null,
                    peers: [],
                    isConnectedToHost: true, 
                };
                
                if (gameContextRef.current) {
                    gameContextRef.current.networkRole = 'none';
                    gameContextRef.current.peers = [];
                    gameContextRef.current.isConnectedToHost = true;
                }
    
                return newState;
            });
        }
    };

    return {
        startHost,
        joinGame,
        sendNewCharacterToHost,
        assignCharacterToPeer,
        startHostingFromLocalGame,
        disconnect,
        requestSyncFromHost
    };
};
