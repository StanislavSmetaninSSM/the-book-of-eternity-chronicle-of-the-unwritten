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
    let players = Array.isArray(state.players) && state.players.length ? [...state.players]
        : Array.isArray(context.players) && context.players.length ? [...context.players] : [];
    if (state.players !== undefined && state.players !== null && !Array.isArray(state.players)) {
        throw new Error('Cannot safely load this save: the party roster is unreadable. The original save was not changed.');
    }
    let playerCharacter = state.playerCharacter || context.playerCharacter;
    let index = state.activePlayerIndex;
    if (!players.length && !playerCharacter) {
        throw new Error('Cannot safely load this save: it contains no player character. The original save was not changed.');
    }
    if (players.length) {
        const ids = players.map(p => p?.playerId).filter(Boolean);
        // An empty object carries no identity and no stats: loading it would add
        // a character that cannot be played.
        if (new Set(ids).size !== ids.length || players.some(p => !p || Object.keys(p).length === 0)) {
            throw new Error('Cannot safely load this save: party identities are ambiguous. The original save was not changed.');
        }
        const validIndex = Number.isSafeInteger(index) && index >= 0 && index < players.length;
        const network = legacy.networkRole && legacy.networkRole !== 'none';
        // Some older snapshots kept the roster but lost the separate displayed
        // character. Recover it from the roster instead of refusing the save.
        if (!playerCharacter) {
            if (validIndex) playerCharacter = players[index];
            else if (players.length === 1) { playerCharacter = players[0]; index = 0; }
            else throw new Error('Cannot safely load this save: the active character cannot be identified. The original save was not changed.');
        }
        const matches = playerCharacter.playerId ? players.flatMap((p, i) => p.playerId === playerCharacter.playerId ? [i] : [])
            : players.flatMap((p, i) => JSON.stringify(p) === JSON.stringify(playerCharacter) ? [i] : []);
        if (!validIndex || (!network && matches.length === 1 && matches[0] !== index)) {
            if (matches.length !== 1) throw new Error('Cannot safely load this save: the active character cannot be identified. The original save was not changed.');
            index = matches[0];
        }
        if (matches.length === 0 && players[index] !== playerCharacter) {
            throw new Error('Cannot safely load this save: the displayed character does not match the party. The original save was not changed.');
        }
        if (matches.length === 1) players[matches[0]] = playerCharacter;
        playerCharacter = players[index];
    } else if (playerCharacter) {
        players = [playerCharacter]; index = 0;
    }
    const cleanState = { ...legacy, players, playerCharacter, activePlayerIndex: index };
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
