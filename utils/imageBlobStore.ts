
/**
 * Generated images used to be stored as base64 data URLs inside every save, so the same
 * picture was copied into the autosave, the crash-recovery point, the interrupted-turn
 * checkpoint and each slot. They now live once in their own IndexedDB store and saves
 * only carry a `blob:<id>` reference; the bytes are read back when a save is loaded.
 *
 * The store is content-addressed: identical pictures share one record no matter how many
 * saves reference them.
 */

const IMAGE_DB_NAME = 'gemini-rpg-images';
const IMAGE_DB_VERSION = 1;
const IMAGE_STORE_NAME = 'images';

/** Prefix that marks an image cache entry as a reference into this store. */
export const IMAGE_REF_PREFIX = 'blob:';

/** Newly written images are protected from a concurrent sweep for this long. */
const SWEEP_GRACE_MS = 60_000;

export interface StoredImageRecord {
    id: string;
    blob: Blob;
    mime: string;
    bytes: number;
    createdAt: number;
    lastUsedAt: number;
}

let imageDbPromise: Promise<IDBDatabase | null> | null = null;
const recentlyWritten = new Map<string, number>();
// Saves are written every turn and re-walk the same live cache, so remembering which
// data URL produced which reference keeps hashing off the hot path.
const refByDataUrl = new Map<string, string>();
const REF_CACHE_LIMIT = 128;

const rememberRef = (dataUrl: string, ref: string): void => {
    refByDataUrl.delete(dataUrl);
    refByDataUrl.set(dataUrl, ref);
    while (refByDataUrl.size > REF_CACHE_LIMIT) {
        const oldest = refByDataUrl.keys().next();
        if (oldest.done) break;
        refByDataUrl.delete(oldest.value);
    }
};

const openImageDb = (): Promise<IDBDatabase | null> => {
    if (imageDbPromise) return imageDbPromise;
    imageDbPromise = new Promise(resolve => {
        if (typeof indexedDB === 'undefined') { resolve(null); return; }
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);
        } catch (error) {
            console.error('Could not open the image store', error);
            resolve(null);
            return;
        }
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) db.createObjectStore(IMAGE_STORE_NAME, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { console.error('Could not open the image store', request.error); resolve(null); };
        request.onblocked = () => { console.warn('The image store upgrade is blocked by another tab.'); };
    });
    return imageDbPromise;
};

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest | null): Promise<T | null> => {
    const db = await openImageDb();
    if (!db) return null;
    try {
        return await new Promise<T | null>((resolve, reject) => {
            const transaction = db.transaction(IMAGE_STORE_NAME, mode);
            let result: T | null = null;
            const request = run(transaction.objectStore(IMAGE_STORE_NAME));
            if (request) {
                request.onsuccess = () => { result = request.result as T; };
            }
            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('Image store transaction aborted.'));
        });
    } catch (error) {
        console.error('Image store operation failed', error);
        return null;
    }
};

export const isImageRef = (value: unknown): value is `blob:${string}` =>
    typeof value === 'string' && value.startsWith(IMAGE_REF_PREFIX);

export const imageRefId = (ref: string): string => ref.slice(IMAGE_REF_PREFIX.length);

const isDataUrl = (value: unknown): value is string =>
    typeof value === 'string' && value.startsWith('data:') && value.includes(',');

const dataUrlMime = (dataUrl: string): string => {
    const header = dataUrl.slice(5, dataUrl.indexOf(','));
    const mime = header.split(';')[0];
    return mime || 'application/octet-stream';
};

const base64ToBytes = (base64: string): Uint8Array => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
    // Chunked so a multi-megabyte image does not blow the argument limit.
    const chunkSize = 0x8000;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
};

const hashBytes = async (bytes: Uint8Array): Promise<string> => {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
        try {
            const digest = await subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
            return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        } catch (error) {
            console.warn('Falling back to a non-cryptographic image hash', error);
        }
    }
    // Content addressing only has to notice identical payloads; this is a fallback for
    // contexts without SubtleCrypto (an insecure origin, for example).
    let first = 0x811c9dc5;
    let second = 0x01000193;
    for (let index = 0; index < bytes.length; index += 1) {
        first = (first ^ bytes[index]) * 0x01000193 >>> 0;
        second = (second + bytes[index] * (index + 1)) >>> 0;
    }
    return `fnv${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}${bytes.length.toString(16)}`;
};

/**
 * Writes one record. Unlike `withStore` this reports failure, because a reference to an
 * image that never reached the store would be lost on the next load.
 */
const putRecord = async (record: StoredImageRecord): Promise<boolean> => {
    const db = await openImageDb();
    if (!db) return false;
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(IMAGE_STORE_NAME, 'readwrite');
            transaction.objectStore(IMAGE_STORE_NAME).put(record);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('Image write was aborted.'));
        });
        return true;
    } catch (error) {
        console.error('Could not store an image', error);
        return false;
    }
};

/**
 * Stores a base64 data URL and returns the reference to keep in the save. Values that
 * are not data URLs (http links, existing references, keys) are returned unchanged, and
 * so is an image that could not be written: keeping it inline is better than a dead link.
 */
export async function storeImageDataUrl(dataUrl: string): Promise<string> {
    if (!isDataUrl(dataUrl)) return dataUrl;
    const commaIndex = dataUrl.indexOf(',');
    const header = dataUrl.slice(5, commaIndex);
    if (!header.includes(';base64')) return dataUrl;
    const remembered = refByDataUrl.get(dataUrl);
    if (remembered) {
        recentlyWritten.set(imageRefId(remembered), Date.now());
        return remembered;
    }
    let bytes: Uint8Array;
    try {
        bytes = base64ToBytes(dataUrl.slice(commaIndex + 1));
    } catch (error) {
        // A malformed payload must never block saving; it simply stays inline.
        console.warn('Could not decode an inline image; keeping it in the save as is.', error);
        return dataUrl;
    }
    const id = await hashBytes(bytes);
    const ref = `${IMAGE_REF_PREFIX}${id}`;
    const now = Date.now();
    const existing = await withStore<StoredImageRecord>('readonly', store => store.get(id));
    if (existing) {
        recentlyWritten.set(id, now);
        rememberRef(dataUrl, ref);
        return ref;
    }
    const record: StoredImageRecord = {
        id,
        blob: new Blob([bytes], { type: dataUrlMime(dataUrl) }),
        mime: dataUrlMime(dataUrl),
        bytes: bytes.length,
        createdAt: now,
        lastUsedAt: now,
    };
    if (!await putRecord(record)) return dataUrl;
    recentlyWritten.set(id, now);
    rememberRef(dataUrl, ref);
    return ref;
}

/**
 * Browsers encode a Blob to base64 natively, which is much faster than doing it in JS
 * for multi-megabyte images. Contexts without FileReader fall back to manual encoding.
 */
const blobToDataUrl = (blob: Blob): Promise<string | null> => new Promise(resolve => {
    if (typeof FileReader === 'undefined') { resolve(null); return; }
    let reader: FileReader;
    try {
        reader = new FileReader();
    } catch {
        resolve(null);
        return;
    }
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.onabort = () => resolve(null);
    try {
        reader.readAsDataURL(blob);
    } catch {
        resolve(null);
    }
});

/** Reads a referenced image back as a data URL; null when the bytes are gone. */
export async function readImageDataUrl(ref: string): Promise<string | null> {
    if (!isImageRef(ref)) return null;
    const record = await withStore<StoredImageRecord>('readonly', store => store.get(imageRefId(ref)));
    if (!record?.blob) return null;
    const native = await blobToDataUrl(record.blob);
    if (native) {
        recentlyWritten.set(record.id, Date.now());
        rememberRef(native, ref);
        return native;
    }
    try {
        const bytes = new Uint8Array(await record.blob.arrayBuffer());
        recentlyWritten.set(record.id, Date.now());
        const dataUrl = `data:${record.mime || 'image/png'};base64,${bytesToBase64(bytes)}`;
        rememberRef(dataUrl, ref);
        return dataUrl;
    } catch (error) {
        console.error('Could not read a stored image', error);
        return null;
    }
}

export interface ImageStoreStats {
    count: number;
    bytes: number;
    ids: string[];
}

export async function getImageStoreStats(): Promise<ImageStoreStats> {
    const records = await withStore<StoredImageRecord[]>('readonly', store => store.getAll());
    const list = records || [];
    return {
        count: list.length,
        bytes: list.reduce((total, record) => total + (Number(record?.bytes) || 0), 0),
        ids: list.map(record => record?.id).filter(Boolean),
    };
}

export async function deleteStoredImages(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const db = await openImageDb();
    if (!db) return 0;
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(IMAGE_STORE_NAME, 'readwrite');
            const store = transaction.objectStore(IMAGE_STORE_NAME);
            ids.forEach(id => store.delete(id));
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
        ids.forEach(id => recentlyWritten.delete(id));
        return ids.length;
    } catch (error) {
        console.error('Could not delete stored images', error);
        return 0;
    }
}

/**
 * Deletes images no save refers to any more. Recently written records are kept for a
 * grace period so a save that is still being committed cannot lose its bytes.
 */
export async function sweepUnreferencedImages(referencedIds: Iterable<string>): Promise<number> {
    const referenced = new Set(referencedIds);
    const stats = await getImageStoreStats();
    if (!stats.count) return 0;
    const now = Date.now();
    const removable = stats.ids.filter(id => {
        if (referenced.has(id)) return false;
        const writtenAt = recentlyWritten.get(id);
        return !writtenAt || now - writtenAt > SWEEP_GRACE_MS;
    });
    return deleteStoredImages(removable);
}

/** Test helper: forget the cached connection so a fresh database can be opened. */
export function resetImageStoreForTests(): void {
    imageDbPromise = null;
    recentlyWritten.clear();
    refByDataUrl.clear();
}
