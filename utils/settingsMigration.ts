import type { GameSettings } from '../types';

/**
 * Older saves store the automatic turn hand-over as `autoPassTurnInCoop` - a name left
 * over from the removed networked co-op mode. The setting itself is still used for a
 * local party, so it is renamed to `autoPassTurn` when a save is loaded; new saves only
 * ever write the new key.
 */
export function migrateGameSettings<TSettings extends Partial<GameSettings>>(settings: TSettings): TSettings {
    if (!settings || typeof settings !== 'object') return settings;
    const legacy = settings as TSettings & { autoPassTurnInCoop?: boolean };
    const migratedValue = legacy.autoPassTurn ?? legacy.autoPassTurnInCoop ?? true;
    const { autoPassTurnInCoop: _legacy, ...rest } = legacy;
    if (legacy.autoPassTurn === migratedValue && _legacy === undefined) return settings;
    return { ...rest, autoPassTurn: migratedValue } as TSettings;
}

/** True when the settings object still uses the pre-single-player key. */
export function hasLegacyAutoPassKey(settings: unknown): boolean {
    return Boolean(settings && typeof settings === 'object' && 'autoPassTurnInCoop' in (settings as Record<string, unknown>));
}
