/**
 * The starting descriptions of the optional systems (cultivation, magic, hunger, psionics,
 * ...) are long prose: about 546 KB of source together, and the start screen used to pull all
 * of it into the first bundle. A player only ever configures one universe at a time, so each
 * universe keeps its own pack and the pack is fetched when that universe is selected.
 */
export type PresetRuleText = { en: string; ru: string };
export type PresetRuleTexts = Record<string, PresetRuleText>;

const packs: Record<string, () => Promise<PresetRuleTexts>> = {
  fantasy: () => import('./fantasy/pack').then(module => module.fantasyPresetRules),
  sci_fi: () => import('./sci_fi/pack').then(module => module.sciFiPresetRules),
  post_apocalypse: () => import('./post_apocalypse/pack').then(module => module.postApocalypsePresetRules),
  modern: () => import('./modern/pack').then(module => module.modernPresetRules),
  history: () => import('./history/pack').then(module => module.historyPresetRules),
  myths: () => import('./myths/pack').then(module => module.mythsPresetRules),
};

const loaded = new Map<string, PresetRuleTexts>();

export const loadPresetRuleTexts = (universe: string): Promise<PresetRuleTexts> => {
  const cached = loaded.get(universe);
  if (cached) return Promise.resolve(cached);
  const load = packs[universe];
  if (!load) return Promise.resolve({});
  return load().then(texts => {
    loaded.set(universe, texts);
    return texts;
  });
};

/** Test hook: forget cached packs so a check can observe the loader again. */
export const resetPresetRuleCache = () => { loaded.clear(); };
