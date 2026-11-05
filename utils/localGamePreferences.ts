import type { GameSettings } from '../types';

/** Preferences already treated as local by the settings UI, not game rules. */
export const LOCAL_PREFERENCE_KEYS = [
    'language', 'youtubeApiKey', 'notificationSound', 'showPartyStatusPanel',
    'uiControlScale', 'uiFontScale', 'showImageSourceInfo',
    'generateWorldEventImages', 'disableImageGeneration'
] as const satisfies readonly (keyof GameSettings)[];

export function isLocalPreferenceKey(key: string): boolean {
    return (LOCAL_PREFERENCE_KEYS as readonly string[]).includes(key);
}

/** Compare game-rule fields while allowing independent UI edits. */
export function sharedSettingsEqual(a: GameSettings | null, b: GameSettings | null): boolean {
    if (!a || !b) return a === b;
    const keys = (settings: GameSettings) => Object.keys(settings).filter(key => !isLocalPreferenceKey(key));
    const aKeys = keys(a), bKeys = keys(b);
    return aKeys.length === bKeys.length && aKeys.every(key => Object.prototype.hasOwnProperty.call(b, key) &&
        (a as unknown as Record<string, unknown>)[key] === (b as unknown as Record<string, unknown>)[key]);
}
