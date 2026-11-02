import type { GameState } from '../types';
import { recalculateDerivedStats } from './gameContext';
import { recalculateAllWeights } from './inventoryManager';
import { checkAndApplyLevelUp } from './responseProcessor';

type TFunction = (key: string, replacements?: Record<string, string | number>) => string;

/** Recalculate the restored character and persist it even when no level-up occurs. */
export function restorePlayerStats(state: GameState, t: TFunction, isNetworkSync: boolean): string[] {
    if (!state.playerCharacter) return [];
    let player = recalculateAllWeights(recalculateDerivedStats(state.playerCharacter));
    player.isOverloaded = player.totalWeight !== undefined && player.maxWeight !== undefined
        ? player.totalWeight > player.maxWeight
        : false;
    if (player.criticalExcessWeight === undefined) player.criticalExcessWeight = 15;

    const result = checkAndApplyLevelUp(player, t);
    player = result.pc;
    state.playerCharacter = player;

    // In a network sync the local player can differ from the player whose turn is active.
    // Never overwrite a different player when our peer has not joined the roster yet.
    const isPeerPlayer = isNetworkSync && (state.networkRole === 'player' || state.networkRole === 'host') && !!state.myPeerId;
    const playerIndex = isPeerPlayer
        ? state.players.findIndex(p => p.playerId === state.myPeerId)
        : state.activePlayerIndex;
    if (playerIndex >= 0 && playerIndex < state.players.length) state.players[playerIndex] = player;
    return result.logs;
}
