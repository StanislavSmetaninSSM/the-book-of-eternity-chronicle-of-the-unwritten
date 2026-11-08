import type { GameState } from '../types';
import { recalculateDerivedStats } from './gameContext';
import { recalculateAllWeights } from './inventoryManager';
import { DEFAULT_CRITICAL_EXCESS_WEIGHT } from './carryWeight.js';
import { checkAndApplyLevelUp } from './responseProcessor';

type TFunction = (key: string, replacements?: Record<string, string | number>) => string;

/** Recalculate the restored character and persist it even when no level-up occurs. */
export function restorePlayerStats(state: GameState, t: TFunction): string[] {
    if (!state.playerCharacter) return [];
    // The two passes also settle whether what the character carries is too much for them.
    let player = recalculateAllWeights(recalculateDerivedStats(state.playerCharacter));
    if (player.criticalExcessWeight === undefined) player.criticalExcessWeight = DEFAULT_CRITICAL_EXCESS_WEIGHT;

    const result = checkAndApplyLevelUp(player, t);
    player = result.pc;
    state.playerCharacter = player;

    const playerIndex = state.activePlayerIndex;
    if (Array.isArray(state.players) && Number.isSafeInteger(playerIndex) && playerIndex >= 0 && playerIndex < state.players.length) {
        state.players[playerIndex] = player;
    }
    return result.logs;
}
