import type { WorldData } from '../types';
import { isRecord } from './typeGuards';

export type { WorldData } from '../types';

/**
 * The universe table: `gameData` itself, a configuration file, or a JSON round-trip of either.
 * Loaded files may add universes the build does not ship, so it is keyed by string.
 */
export type WorldSource = Record<string, unknown>;

/** History, myths and custom universes keep one world per era; the others are single worlds. */
export const isEraUniverse = (universe: string): boolean =>
    universe === 'history' || universe === 'myths' || universe === 'custom';

/** The era table of a history, myths or custom universe. */
export const getEraWorlds = (source: WorldSource, universe: string): Record<string, WorldData> | undefined => {
    const table = source[universe];
    return isRecord(table) ? (table as Record<string, WorldData>) : undefined;
};

/** The single world of a fantasy, sci-fi, post-apocalypse or urban-myth universe. */
export const getUniverseWorld = (source: WorldSource, universe: string): WorldData | undefined => {
    const world = source[universe];
    return isRecord(world) ? (world as unknown as WorldData) : undefined;
};

/** Resolves the world a universe and era point at; the caller supplies any fallback. */
export const resolveWorldFor = (source: WorldSource, universe: string, era?: string | null): WorldData | undefined => {
    if (isEraUniverse(universe)) {
        const eras = getEraWorlds(source, universe);
        return era ? eras?.[era] : undefined;
    }
    return getUniverseWorld(source, universe);
};

/** A stored world blob (save settings, loaded file) seen as a world. */
export const asWorld = (value: unknown): WorldData | undefined =>
    isRecord(value) ? (value as unknown as WorldData) : undefined;
