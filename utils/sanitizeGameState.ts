import type { GameState } from '../types';

/** Filter malformed entity entries without changing a previously published snapshot. */
export function sanitizeGameState(state: GameState | null): GameState | null {
    if (!state) return state;
    const isObject = (item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item);
    const npcs = state.encounteredNPCs;
    const factions = state.encounteredFactions;
    const cleanNpcs = Array.isArray(npcs) && npcs.some(item => !isObject(item)) ? npcs.filter(isObject) : npcs;
    const cleanFactions = Array.isArray(factions) && factions.some(item => !isObject(item)) ? factions.filter(isObject) : factions;
    if (cleanNpcs === npcs && cleanFactions === factions) return state;
    return { ...state, encounteredNPCs: cleanNpcs, encounteredFactions: cleanFactions };
}
