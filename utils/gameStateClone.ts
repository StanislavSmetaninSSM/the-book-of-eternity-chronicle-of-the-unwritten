import type { GameState } from '../types';

/**
 * Deep copy of the parts of a game state that a gameplay edit may mutate.
 *
 * The image cache is carried by reference on purpose: entries are base64 image
 * payloads (megabytes each) that are only ever replaced as whole objects, never
 * edited in place. Cloning them on every turn pass or inventory action cost tens
 * of milliseconds per action and doubled peak memory, so the cache is detached
 * from the JSON round trip. Everything else keeps the previous deep-clone
 * semantics exactly.
 */
export function cloneGameStateForEdit(state: GameState): GameState {
    const { imageCache, ...rest } = state;
    const clone = JSON.parse(JSON.stringify(rest)) as GameState;
    return imageCache === undefined ? clone : { ...clone, imageCache };
}
