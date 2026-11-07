import type { Calendar } from '../types';
import { isRecord } from './typeGuards';

/**
 * A world as the creation form, the universe customiser and the prompt builder see it: the
 * shipped universes, a configuration file loaded from disk and a world the player is inventing
 * all have this shape.
 */
export interface WorldData {
    name: string;
    description: string;
    currencyName: string;
    currencyOptions?: string[];
    races: Record<string, { description: string; bonuses: Record<string, number>; availableClasses?: string[] }>;
    classes: Record<string, { description: string; bonuses: Record<string, number> }>;
    calendar?: Calendar;
}

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
