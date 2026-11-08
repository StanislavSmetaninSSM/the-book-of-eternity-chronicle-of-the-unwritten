import { asRecord } from './typeGuards';

export const stripMarkdown = (text: string | null | undefined): string => {
  if (typeof text !== 'string') return '';
  // This is a simplified stripper. It removes links, images, bold, italics, headers, and code ticks.
  return text
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // links
    .replace(/!\[[^\]]*\]\([^\)]+\)/g, '')   // images
    .replace(/(\*\*|__)(.*?)\1/g, '$2')    // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')       // italics
    .replace(/#{1,6}\s/g, '')              // headers
    .replace(/`/g, '');                    // code
};

export const stripModerationSymbols = (text: string | null | undefined): string => {
  if (typeof text !== 'string') return '';
  // Removes ~~w<!--o-->rd~~ -> word and ~~word~~ -> word
  return text.replace(/<!--(.*?)-->/g, '$1').replace(/~~/g, '');
};

export function deepStripModerationSymbols<T>(obj: T): T {
    if (obj === null || obj === undefined) {
        return obj;
    }

    if (Array.isArray(obj)) {
        // The shape is preserved and only string leaves change, so they are cast back at the end.
        return obj.map(item => deepStripModerationSymbols(item)) as unknown as T;
    }

    const source = asRecord(obj);
    if (source) {
        const newObj: Record<string, unknown> = {};
        for (const key of Object.keys(source)) {
            newObj[key] = deepStripModerationSymbols(source[key]);
        }
        return newObj as unknown as T;
    }

    if (typeof obj === 'string') {
        return stripModerationSymbols(obj) as unknown as T;
    }

    return obj;
}
