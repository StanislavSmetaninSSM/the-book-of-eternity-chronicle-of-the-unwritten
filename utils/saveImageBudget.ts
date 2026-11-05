
/**
 * Saves embed generated images as base64 data URLs inside `gameState.imageCache`.
 * A long session can accumulate tens of megabytes, and every slot copy and
 * pre-action checkpoint duplicates that payload, which quickly exhausts the
 * IndexedDB quota. These helpers keep a save bounded and let callers shed the
 * cache entirely when the browser reports that the quota is exhausted.
 */

/** Maximum number of cached images kept in a single save. */
export const MAX_IMAGES_PER_SAVE = 20;
/** Maximum estimated base64 payload of cached images kept in a single save. */
export const MAX_IMAGE_BYTES_PER_SAVE = 6 * 1024 * 1024;

type ImageCacheEntry = string | { src?: string; [key: string]: unknown };
type ImageCache = Record<string, ImageCacheEntry>;

export interface ImageBudgetOptions {
    maxEntries?: number;
    maxBytes?: number;
    /** Keys (or data URLs) that must survive the budget: the current scene, portraits. */
    priorityKeys?: Iterable<string | null | undefined>;
}

export interface ImageBudgetResult<T> {
    cache: T;
    keptKeys: string[];
    omittedCount: number;
    bytes: number;
}

const entrySource = (entry: ImageCacheEntry | undefined): string =>
    typeof entry === 'string' ? entry : (typeof entry?.src === 'string' ? entry.src : '');

/** Rough byte size of a base64 data URL (4 characters encode 3 bytes). */
export function estimateBase64Bytes(value: unknown): number {
    if (typeof value !== 'string' || value.length === 0) return 0;
    if (!value.startsWith('data:')) return value.length;
    const commaIndex = value.indexOf(',');
    const payload = commaIndex >= 0 ? value.length - commaIndex - 1 : value.length;
    return Math.ceil(payload * 0.75);
}

export function estimateImageBytes(entry: ImageCacheEntry | undefined): number {
    if (!entry) return 0;
    if (typeof entry === 'string') return estimateBase64Bytes(entry);
    const src = entrySource(entry);
    let total = estimateBase64Bytes(src);
    // Entries may carry extra payload fields alongside the image itself.
    for (const [key, value] of Object.entries(entry)) {
        if (key === 'src') continue;
        if (typeof value === 'string' && value.length > 512) total += estimateBase64Bytes(value);
    }
    return total;
}

export function imageCacheBytes(cache: ImageCache | null | undefined): number {
    if (!cache) return 0;
    let total = 0;
    for (const entry of Object.values(cache)) total += estimateImageBytes(entry);
    return total;
}

/**
 * Keeps the most relevant images within the entry/byte budget. Priority images are
 * kept first; the remaining entries preserve their original insertion order so a
 * save stays deterministic.
 */
export function applyImageBudget<T>(cache: T, options: ImageBudgetOptions = {}): ImageBudgetResult<T> {
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
        return { cache, keptKeys: [], omittedCount: 0, bytes: 0 };
    }
    const entries = cache as unknown as ImageCache;
    const keys = Object.keys(entries);
    if (keys.length === 0) return { cache, keptKeys: [], omittedCount: 0, bytes: 0 };

    const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(0, Number(options.maxEntries)) : MAX_IMAGES_PER_SAVE;
    const maxBytes = Number.isFinite(options.maxBytes) ? Math.max(0, Number(options.maxBytes)) : MAX_IMAGE_BYTES_PER_SAVE;
    const priority = new Set<string>();
    for (const key of options.priorityKeys ?? []) {
        if (typeof key === 'string' && key) priority.add(key.trim());
    }

    const keep = new Set<string>();
    let bytes = 0;
    const consider = (key: string): void => {
        if (keep.size >= maxEntries) return;
        const entryBytes = estimateImageBytes(entries[key]);
        if (keep.size > 0 && bytes + entryBytes > maxBytes) return;
        keep.add(key);
        bytes += entryBytes;
    };
    for (const key of keys) {
        if (priority.has(key.trim()) || priority.has(entrySource(entries[key]).trim())) consider(key);
    }
    // The single most important image always survives even if it alone exceeds the budget.
    for (const key of keys) if (keep.size === 0 && keys.length > 0) consider(key);
    for (const key of keys) if (!keep.has(key)) consider(key);

    const keptKeys: string[] = [];
    const pruned: ImageCache = {};
    for (const key of keys) {
        if (!keep.has(key)) continue;
        pruned[key] = entries[key];
        keptKeys.push(key);
    }
    return { cache: pruned as unknown as T, keptKeys, omittedCount: keys.length - keptKeys.length, bytes };
}

/** Copy of a save without any cached images, used when storage reports a full quota. */
export function stripImagesForQuota<TSave extends { gameState?: any }>(save: TSave): TSave {
    if (!save?.gameState?.imageCache) return save;
    const cachedCount = Object.keys(save.gameState.imageCache).length;
    return {
        ...save,
        gameState: { ...save.gameState, imageCache: {} },
        omittedImageCount: (Number((save as any).omittedImageCount) || 0) + cachedCount,
        imagesOmittedForQuota: true,
    } as TSave;
}

export function isQuotaError(error: unknown): boolean {
    const name = (error as any)?.name || '';
    const code = (error as any)?.code;
    return name === 'QuotaExceededError'
        || name === 'NS_ERROR_DOM_QUOTA_REACHED'
        || code === 22
        || /quota/i.test(String((error as any)?.message || ''));
}
