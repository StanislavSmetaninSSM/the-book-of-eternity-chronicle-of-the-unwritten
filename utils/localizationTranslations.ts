
import { general } from './translations/general';
import { itemQualities } from './translations/itemQualities';
import { damageTypes } from './translations/damageTypes';
import { characteristics } from './translations/characteristics';
import { ui } from './translations/ui/ui';

/**
 * UI strings stay in the start-up bundle; the per-universe dictionaries (races,
 * classes, skills, items, months - about 2 MB of source) are loaded on demand for the
 * universe the player is actually using. Only one of the six is ever needed at a time.
 */
export type WorldTranslationPackId = 'fantasy' | 'sci_fi' | 'post_apocalypse' | 'modern' | 'history' | 'myths';

type WorldTranslationPack = Record<'en' | 'ru', Record<string, string>>;

const worldTranslationPacks: Record<WorldTranslationPackId, () => Promise<WorldTranslationPack>> = {
  fantasy: () => import('./translations/worlds/fantasy_loc').then(module => module.fantasyLoc),
  sci_fi: () => import('./translations/worlds/sci_fi_loc').then(module => module.sciFiLoc),
  post_apocalypse: () => import('./translations/worlds/post_apocalypse_loc').then(module => module.postApocalypseLoc),
  modern: () => import('./translations/worlds/modern_loc').then(module => module.modernLoc),
  history: () => import('./translations/worlds/history_loc').then(module => module.historyLoc),
  myths: () => import('./translations/worlds/myths_loc').then(module => module.mythsLoc),
};

export const translations: Record<string, Record<string, string>> = {
  en: {
    ...general.en,
    ...itemQualities.en,
    ...damageTypes.en,
    ...characteristics.en,
    ...ui.en,
  },
  ru: {
    ...general.ru,
    ...itemQualities.ru,
    ...damageTypes.ru,
    ...characteristics.ru,
    ...ui.ru,
  }
};

const loadedPacks = new Set<WorldTranslationPackId>();
const loadingPacks = new Map<WorldTranslationPackId, Promise<void>>();
const packListeners = new Set<() => void>();

/**
 * Maps a game universe (including the legacy `urban_myth` name and the pack ids
 * themselves) to its dictionary. Custom universes define their own names as literal
 * text, so they need no pack.
 */
export function worldPackIdForUniverse(universe: unknown): WorldTranslationPackId | null {
  if (typeof universe !== 'string') return null;
  switch (universe) {
    case 'fantasy': return 'fantasy';
    case 'sci_fi': return 'sci_fi';
    case 'post_apocalypse': return 'post_apocalypse';
    case 'urban_myth':
    case 'modern': return 'modern';
    case 'history': return 'history';
    case 'myths': return 'myths';
    default: return null;
  }
}

/** True when the dictionary for this universe is already merged (or none is needed). */
export function isWorldTranslationsLoaded(universe: unknown): boolean {
  const packId = worldPackIdForUniverse(universe);
  return !packId || loadedPacks.has(packId);
}

function loadPack(packId: WorldTranslationPackId): Promise<void> {
  const existing = loadingPacks.get(packId);
  if (existing) return existing;
  const task = worldTranslationPacks[packId]()
    .then(pack => {
      Object.assign(translations.en, pack.en);
      Object.assign(translations.ru, pack.ru);
      loadedPacks.add(packId);
    })
    .catch(error => {
      // A missing dictionary must not break the game: messages fall back to keys.
      console.error(`Could not load the ${packId} translation pack`, error);
    })
    .finally(() => {
      loadingPacks.delete(packId);
      packListeners.forEach(listener => {
        try { listener(); } catch (error) { console.error('Translation pack listener failed', error); }
      });
    });
  loadingPacks.set(packId, task);
  return task;
}

/** Merges the dictionary of the given universe; resolves when it is safe to render. */
export function ensureWorldTranslations(universe: unknown): Promise<void> {
  const packId = worldPackIdForUniverse(universe);
  if (!packId || loadedPacks.has(packId)) return Promise.resolve();
  return loadPack(packId);
}

/** Loads every dictionary: used for saves written before the universe was recorded. */
export function ensureAllWorldTranslations(): Promise<void> {
  return Promise.all((Object.keys(worldTranslationPacks) as WorldTranslationPackId[]).map(ensureWorldTranslations)).then(() => undefined);
}

export function subscribeToWorldTranslations(listener: () => void): () => void {
  packListeners.add(listener);
  return () => { packListeners.delete(listener); };
}
