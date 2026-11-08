
import { gameData } from './localizationGameData';
import { translations } from './localizationTranslations';
import { Language } from '../types';

/**
 * The language a toggle switches to. The game ships two languages, so this is
 * the only place that has to know that.
 */
export const nextLanguage = (language: Language): Language => (language === 'ru' ? 'en' : 'ru');

/** The BCP-47 tag the speech synthesiser needs for a language. */
export const speechLanguageCode = (language: Language): string => (language === 'ru' ? 'ru-RU' : 'en-US');

/** One of the two variants of a shipped string. */
export const pickLocalized = <T>(variants: Record<Language, T>, language: Language): T =>
  variants[language] ?? variants.en;

export const translate = (lang: Language, key: string, replacements?: Record<string, string | number>): string => {
  if (typeof key !== 'string' || !key) {
    return '';
  }
  let translation = translations[lang]?.[key] || translations['en']?.[key] || key;
  
  if (replacements) {
    Object.keys(replacements).forEach(rKey => {
      translation = translation.replace(`{${rKey}}`, String(replacements[rKey]));
    });
  }

  // Defensive patch for malformed newline characters in translation files.
  if (translation.includes('|n')) {
    translation = translation.replace(/\|n/g, '\n');
  }

  return translation;
};

export { gameData };