import type { SaveFile } from '../types';
import { collectImageRefs, dehydrateSaveImages, hydrateImageCache } from './saveImageRefs';
import { isImageRef, readImageDataUrl, storeImageDataUrl } from './imageBlobStore';

/**
 * In-app saves keep images in a separate store, and a portable export has to move them
 * somehow. Two shapes are supported:
 *  - one self-contained file with base64 inside (simplest for the player to keep);
 *  - a pair of files: a save whose cache holds `blob:` references plus an images bundle
 *    that carries the bytes. The pair mirrors the in-app storage and keeps the save file
 *    small, so the two documents can be moved around separately.
 */

export const IMAGE_BUNDLE_FORMAT = 'book-of-eternity-image-bundle';
export const IMAGE_BUNDLE_VERSION = 1;

export interface ImageBundle {
    format: typeof IMAGE_BUNDLE_FORMAT;
    version: number;
    createdAt: string;
    images: Record<string, string>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

/** A save document (whatever shape it has) is recognised by its two root sections. */
export const isSaveDocument = (value: unknown): value is SaveFile =>
    isPlainObject(value) && isPlainObject(value.gameContext) && isPlainObject(value.gameState);

export const isImageBundleDocument = (value: unknown): value is ImageBundle =>
    isPlainObject(value)
    && value.format === IMAGE_BUNDLE_FORMAT
    && isPlainObject(value.images);

/**
 * Splits a save into the document to store and the images it needs. The document keeps
 * `blob:` references, the bundle maps each reference to its data URL.
 */
export async function splitSaveImages(saveData: SaveFile): Promise<{ saveData: SaveFile; bundle: ImageBundle | null }> {
    const dehydrated = await dehydrateSaveImages(saveData);
    const references = Array.from(collectImageRefs(dehydrated));
    const images: Record<string, string> = {};
    for (const reference of references) {
        const dataUrl = await readImageDataUrl(reference);
        if (dataUrl) images[reference] = dataUrl;
    }
    const bundle: ImageBundle | null = Object.keys(images).length
        ? { format: IMAGE_BUNDLE_FORMAT, version: IMAGE_BUNDLE_VERSION, createdAt: new Date().toISOString(), images }
        : null;
    return { saveData: dehydrated, bundle };
}

/**
 * Puts the images of a bundle into the store. Bundle keys are content hashes, so an
 * imported image keeps its reference; a key that does not match its own content (an
 * edited file, a different hashing fallback) is reported as an alias so the save that
 * references it can be rewritten.
 */
export async function importImageBundle(bundle: ImageBundle): Promise<{ stored: number; aliases: Map<string, string> }> {
    const aliases = new Map<string, string>();
    let stored = 0;
    for (const [reference, dataUrl] of Object.entries(bundle.images)) {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) continue;
        const resolved = await storeImageDataUrl(dataUrl);
        if (!isImageRef(resolved)) continue;
        stored += 1;
        if (resolved !== reference) aliases.set(reference, resolved);
    }
    return { stored, aliases };
}

/** Rewrites references in a save so it points at the imported images. */
export function rewriteImageRefs<T>(value: T, aliases: Map<string, string>): T {
    if (aliases.size === 0) return value;
    const walk = (node: unknown): unknown => {
        if (typeof node === 'string') return aliases.get(node) ?? node;
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object') {
            const next: Record<string, unknown> = {};
            for (const [key, child] of Object.entries(node as Record<string, unknown>)) next[key] = walk(child);
            return next;
        }
        return node;
    };
    return walk(value) as T;
}

export interface SaveBundleImportResult {
    /** Null when only images were picked: they are stored, but there is no save to load. */
    saveData: SaveFile | null;
    imagesImported: number;
    missingImages: number;
}

/**
 * Applies the documents a player picked. Any number of image bundles may accompany the
 * save; the order does not matter. Images the store cannot resolve are reported instead
 * of silently disappearing from the loaded game.
 */
export async function applySaveBundleDocuments(documents: unknown[]): Promise<SaveBundleImportResult | null> {
    const bundles = documents.filter(isImageBundleDocument);
    const saveDocument = documents.find(isSaveDocument);
    if (!saveDocument) {
        // Picking only the images file is a valid step: the bytes are stored and the save
        // that references them can be imported next, in either order.
        if (bundles.length === 0) return null;
        let imagesImported = 0;
        for (const bundle of bundles) imagesImported += (await importImageBundle(bundle)).stored;
        return { saveData: null, imagesImported, missingImages: 0 };
    }

    let imagesImported = 0;
    const aliases = new Map<string, string>();
    for (const bundle of bundles) {
        const imported = await importImageBundle(bundle);
        imagesImported += imported.stored;
        imported.aliases.forEach((target, source) => aliases.set(source, target));
    }

    const rewritten = rewriteImageRefs(saveDocument, aliases);
    const cache = (rewritten.gameState as { imageCache?: Record<string, any> }).imageCache;
    const { cache: hydratedCache, restored, dropped } = await hydrateImageCache(cache);
    if (typeof cache !== 'object' || cache === null || (restored === 0 && dropped === 0)) {
        return { saveData: rewritten, imagesImported, missingImages: 0 };
    }
    return {
        saveData: { ...rewritten, gameState: { ...rewritten.gameState, imageCache: hydratedCache as typeof cache } },
        imagesImported,
        missingImages: dropped,
    };
}
