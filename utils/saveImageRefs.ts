
import type { ImageCacheEntry } from '../types';
import { isImageRef, readImageDataUrl, storeImageDataUrl } from './imageBlobStore';

type ImageCache = Record<string, ImageCacheEntry | string | null | undefined>;

export interface DehydratedCache {
    cache: ImageCache;
    stored: number;
    referenced: string[];
}

export interface HydratedCache {
    cache: ImageCache;
    restored: number;
    dropped: number;
}

const entrySource = (entry: ImageCacheEntry | string | null | undefined): string | null => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && typeof entry.src === 'string') return entry.src;
    return null;
};

const replaceEntrySource = (entry: ImageCacheEntry | string | null | undefined, source: string): ImageCacheEntry | string => {
    if (typeof entry === 'string') return source;
    return { ...(entry as ImageCacheEntry), src: source };
};

/**
 * Moves inline base64 images of a cache into the image store and leaves references
 * behind. The cache keeps its keys and metadata; only the payload moves.
 */
export async function dehydrateImageCache(cache: ImageCache | null | undefined): Promise<DehydratedCache> {
    if (!cache || typeof cache !== 'object') return { cache: cache ?? {}, stored: 0, referenced: [] };
    const entries = Object.entries(cache);
    // Resolve every distinct payload concurrently; a save re-walks the live cache, so
    // duplicates are common and only the first copy should be hashed and written.
    const resolved = new Map<string, Promise<string>>();
    const resolve = (source: string): Promise<string> => {
        let pending = resolved.get(source);
        if (!pending) { pending = storeImageDataUrl(source); resolved.set(source, pending); }
        return pending;
    };
    await Promise.all(entries.map(([, entry]) => {
        const source = entrySource(entry);
        return source && !isImageRef(source) && source.startsWith('data:') ? resolve(source) : undefined;
    }));

    const next: ImageCache = {};
    let stored = 0;
    const referenced: string[] = [];
    for (const [key, entry] of entries) {
        const source = entrySource(entry);
        if (!source) { next[key] = entry; continue; }
        if (isImageRef(source)) {
            next[key] = entry;
            referenced.push(source);
            continue;
        }
        if (!source.startsWith('data:')) { next[key] = entry; continue; }
        const ref = (await resolved.get(source)) ?? source;
        if (!isImageRef(ref)) { next[key] = entry; continue; }
        next[key] = replaceEntrySource(entry, ref);
        referenced.push(ref);
        stored += 1;
    }
    return { cache: next, stored, referenced };
}

/**
 * Reads referenced images back into data URLs. An entry whose bytes are gone is dropped:
 * the picture can be generated again, and a broken reference must never reach a renderer.
 */
export async function hydrateImageCache(cache: ImageCache | null | undefined): Promise<HydratedCache> {
    if (!cache || typeof cache !== 'object') return { cache: {}, restored: 0, dropped: 0 };
    const entries = Object.entries(cache);
    const reads = new Map<string, Promise<string | null>>();
    const read = (ref: string): Promise<string | null> => {
        let pending = reads.get(ref);
        if (!pending) { pending = readImageDataUrl(ref); reads.set(ref, pending); }
        return pending;
    };
    await Promise.all(entries.map(([, entry]) => {
        const source = entrySource(entry);
        return source && isImageRef(source) ? read(source) : undefined;
    }));

    const next: ImageCache = {};
    let restored = 0;
    let dropped = 0;
    for (const [key, entry] of entries) {
        const source = entrySource(entry);
        if (!source || !isImageRef(source)) { next[key] = entry; continue; }
        const dataUrl = await reads.get(source);
        if (!dataUrl) { dropped += 1; continue; }
        next[key] = replaceEntrySource(entry, dataUrl);
        restored += 1;
    }
    return { cache: next, restored, dropped };
}

interface HasImageCache { imageCache?: ImageCache | null }

export async function dehydrateStateImages<TState extends HasImageCache>(state: TState): Promise<TState> {
    if (!state?.imageCache) return state;
    const { cache, stored } = await dehydrateImageCache(state.imageCache);
    if (stored === 0) return state;
    return { ...state, imageCache: cache as TState['imageCache'] };
}

export async function hydrateStateImages<TState extends HasImageCache>(state: TState): Promise<TState> {
    if (!state?.imageCache) return state;
    const { cache, restored, dropped } = await hydrateImageCache(state.imageCache);
    if (restored === 0 && dropped === 0) return state;
    return { ...state, imageCache: cache as TState['imageCache'] };
}

interface HasMissingCount { missingImageCount?: number }

interface HasGameState extends HasImageCache { gameState?: HasImageCache | null }

export async function dehydrateSaveImages<TSave extends HasGameState & HasMissingCount>(save: TSave): Promise<TSave> {
    if (!save?.gameState) return save;
    const gameState = await dehydrateStateImages(save.gameState);
    // `missingImageCount` describes one particular load, not the save itself: keeping it
    // would make every later load report images that were already accounted for.
    const { missingImageCount, ...rest } = save as TSave & HasMissingCount;
    if (gameState === save.gameState && missingImageCount === undefined) return save;
    return { ...rest, gameState } as TSave;
}

export async function hydrateSaveImages<TSave extends HasGameState & HasMissingCount>(save: TSave): Promise<TSave> {
    if (!save?.gameState?.imageCache) return save;
    const { cache, restored, dropped } = await hydrateImageCache(save.gameState.imageCache);
    if (restored === 0 && dropped === 0) return save;
    const next: TSave = {
        ...save,
        gameState: { ...save.gameState, imageCache: cache as HasImageCache['imageCache'] } as TSave['gameState'],
    };
    if (dropped > 0) next.missingImageCount = (Number(save.missingImageCount) || 0) + dropped;
    return next;
}

/** Every `blob:` reference inside a value, used to decide which stored images are alive. */
export function collectImageRefs(value: unknown, into: Set<string> = new Set<string>()): Set<string> {
    if (typeof value === 'string') {
        if (isImageRef(value)) into.add(value);
        return into;
    }
    if (Array.isArray(value)) {
        value.forEach(item => collectImageRefs(item, into));
        return into;
    }
    if (value && typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach(item => collectImageRefs(item, into));
    }
    return into;
}
