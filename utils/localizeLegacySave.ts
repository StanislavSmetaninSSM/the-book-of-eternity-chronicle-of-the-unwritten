import type { GameContext, GameState, SaveFile } from '../types';

/** Convert a pre-single-player snapshot without changing character IDs or history.
 * IDs can be referenced by inventories, quests and party links, so they must not
 * be replaced just because they once also identified a peer. Unfinished network
 * actions are retained as inert archival data rather than silently discarded. */
export function localizeLegacyState(state: GameState, context: GameContext): { state: GameState; context: GameContext } {
    const legacy = state as GameState & { networkRole?: string; myPeerId?: unknown; hostPeerId?: unknown; peers?: unknown; isConnectedToHost?: unknown; playerNeedsToCreateCharacter?: unknown; collectiveActionState?: unknown; simultaneousActionState?: unknown; legacyNetworkActions?: unknown[] };
    const actions = [legacy.collectiveActionState, legacy.simultaneousActionState].filter(Boolean);
    const archived = actions.length ? [...(legacy.legacyNetworkActions || []), ...actions] : legacy.legacyNetworkActions;
    // A host snapshot can display its own character while another character
    // owns the turn. First retain the displayed version in its own roster slot,
    // then make the active roster member the local character.
    let players = state.players;
    let playerCharacter = state.playerCharacter;
    const index = state.activePlayerIndex;
    if (legacy.networkRole && legacy.networkRole !== 'none' && Array.isArray(players) && players.length &&
        Number.isSafeInteger(index) && index >= 0 && index < players.length && players[index]) {
        const displayedId = playerCharacter?.playerId;
        const matches = displayedId ? players.filter(p => p?.playerId === displayedId) : [];
        if (matches.length === 1) players = players.map(p => p.playerId === displayedId ? playerCharacter : p);
        playerCharacter = players[index];
    }
    const cleanState = { ...legacy, players, playerCharacter };
    delete cleanState.networkRole;
    delete cleanState.myPeerId;
    delete cleanState.hostPeerId;
    delete cleanState.peers;
    delete cleanState.isConnectedToHost;
    delete cleanState.playerNeedsToCreateCharacter;
    delete cleanState.collectiveActionState;
    delete cleanState.simultaneousActionState;
    if (archived) cleanState.legacyNetworkActions = archived;
    const cleanContext = { ...context, players, playerCharacter } as GameContext & { networkRole?: unknown; peers?: unknown; isConnectedToHost?: unknown; collectiveActionState?: unknown; simultaneousActionState?: unknown };
    delete cleanContext.networkRole;
    delete cleanContext.peers;
    delete cleanContext.isConnectedToHost;
    delete cleanContext.collectiveActionState;
    delete cleanContext.simultaneousActionState;
    return { state: cleanState, context: cleanContext };
}

export function localizeLegacySave(data: SaveFile): SaveFile {
    const { state, context } = localizeLegacyState(data.gameState, data.gameContext);
    return { ...data, gameState: state, gameContext: context };
}
