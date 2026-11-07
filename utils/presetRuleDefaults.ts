import type { PresetRuleTexts } from './translations/presetRules';
import type { Language } from '../types';

/**
 * Fills the starting descriptions of the optional systems for the selected universe.
 *
 * A description counts as untouched when it is empty or still equal to the shipped preset in
 * either language, which is what lets a language switch translate the text without touching a
 * description the player wrote or edited.
 */
export const fillPresetRuleDefaults = <T extends Record<string, unknown>>(
  data: T,
  texts: PresetRuleTexts,
  language: Language
): T => {
  const updates: Record<string, string> = {};
  for (const [field, text] of Object.entries(texts)) {
    const current = data[field];
    if (typeof current === 'string' && current && current !== text.en && current !== text.ru) continue;
    const localized = language === 'ru' ? text.ru : text.en;
    if (localized && localized !== current) updates[field] = localized;
  }
  return Object.keys(updates).length > 0 ? { ...data, ...updates } : data;
};
