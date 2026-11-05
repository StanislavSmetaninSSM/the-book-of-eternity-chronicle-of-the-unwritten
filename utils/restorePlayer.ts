import type { GameState } from '../types';
import { recalculateDerivedStats } from './gameContext';
import { recalculateAllWeights } from './inventoryManager';
import { checkAndApplyLevelUp } from './responseProcessor';

type TFunction = (key: string, replacements?: Record<string, string | number>) => string;

/** Recalculate the restored character and persist it even when no level-up occurs. */
export function restorePlayerStats(state: GameState, t: TFunction): string[] {
    if (!state.playerCharacter) return [];
    let player = recalculateAllWeights(recalculateDerivedStats(state.playerCharacter));
    player.isOverloaded = player.totalWeight !== undefined && player.maxWeight !== undefined
        ? player.totalWeight > player.maxWeight
        : false;
    if (player.criticalExcessWeight === undefined) player.criticalExcessWeight = 15;

    const result = checkAndApplyLevelUp(player, t);
    player = result.pc;
    state.playerCharacter = player;

    const playerIndex = state.activePlayerIndex;
    if (Array.isArray(state.players) && Number.isSafeInteger(playerIndex) && playerIndex >= 0 && playerIndex < state.players.length) {
        state.players[playerIndex] = player;
    }
    return result.logs;
}
