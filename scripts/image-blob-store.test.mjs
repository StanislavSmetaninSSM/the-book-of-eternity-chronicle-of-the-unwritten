import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { getTestServer, closeTestServer } from './helpers/testServer.mjs';

// Images used to be embedded in every stored save as base64. They now live in a
// content-addressed IndexedDB store and saves only keep `blob:` references.
const dom = new JSDOM('<div></div>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

after(async () => { await closeTestServer(); dom.window.close(); });

const png = (seed, bytes = 768) => `data:image/png;base64,${Buffer.alloc(bytes, seed).toString('base64')}`;

const makeSave = (imageCache) => ({
  gameContext: { currentTurnNumber: 1, gameSettings: {}, visitedLocations: [], worldMap: {} },
  gameState: {
    playerCharacter: { name: 'Hero', level: 1, image_prompt: 'portrait' },
    currentLocationData: { name: 'Harbour' },
    imageCache,
  },
  gameHistory: [], gameLog: [], combatLog: [], lastJsonResponse: null,
  sceneImagePrompt: 'scene', timestamp: new Date().toISOString(),
});

const openGameDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('gemini-rpg-db');
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('The game database is blocked.'));
  request.onsuccess = () => resolve(request.result);
});

/** Runs one request against a store of the app database and closes the connection. */
const gameStore = async (storeName, mode, run) => {
  const db = await openGameDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      let result;
      const request = run(transaction.objectStore(storeName));
      if (request) request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
};

const readRawRecord = (storeName, key) => gameStore(storeName, 'readonly', store => store.get(key));

const clearSaves = async () => {
  for (const storeName of ['autosaves', 'save_slots', 'interrupted_turns']) {
    await gameStore(storeName, 'readwrite', store => store.clear());
  }
};

const clearImageStore = async (store) => {
  const stats = await store.getImageStoreStats();
  await store.deleteStoredImages(stats.ids);
  store.resetImageStoreForTests();
  return stats;
};

test('the image store keeps identical bytes once and hands data URLs back', async () => {
  const vite = await getTestServer();
  const store = await vite.ssrLoadModule('/utils/imageBlobStore.ts');
  await clearImageStore(store);

  const first = await store.storeImageDataUrl(png(7));
  const second = await store.storeImageDataUrl(png(7));
  assert.ok(store.isImageRef(first), 'a stored image is referenced, not inlined');
  assert.equal(first, second, 'identical images share one reference');
  assert.equal(store.imageRefId(first).length, 64, 'references are content hashes');

  const stats = await store.getImageStoreStats();
  assert.equal(stats.count, 1, 'identical payloads are stored once');
  assert.equal(stats.bytes, 768);

  await store.storeImageDataUrl(png(8));
  assert.equal((await store.getImageStoreStats()).count, 2);

  assert.equal(await store.readImageDataUrl(first), png(7), 'the bytes round-trip unchanged');
  assert.equal(await store.readImageDataUrl('blob:missing'), null);
  assert.equal(await store.storeImageDataUrl('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(store.isImageRef('data:image/png;base64,AAA'), false);
});

test('a stored save keeps references and loads the images back', async () => {
  const vite = await getTestServer();
  const store = await vite.ssrLoadModule('/utils/imageBlobStore.ts');
  const fileManager = await vite.ssrLoadModule('/utils/fileManager.ts');
  await clearImageStore(store);

  const cache = { scene: png(1), portrait: png(2), npc: png(2) };
  await fileManager.saveToDB(makeSave(cache));

  const raw = await readRawRecord('autosaves', 'current_autosave');
  const rawPayload = JSON.stringify(raw.saveData.gameState.imageCache);
  assert.ok(!rawPayload.includes('data:image'), 'no base64 leaks into the stored save');
  assert.ok(rawPayload.includes('"blob:'), 'the save keeps references');
  assert.equal((await store.getImageStoreStats()).count, 2, 'duplicated images are stored once');

  const restored = await fileManager.loadFromDB();
  assert.equal(restored.gameState.imageCache.scene, png(1), 'the scene image is restored');
  assert.equal(restored.gameState.imageCache.portrait, png(2));
  assert.equal(restored.gameState.imageCache.npc, png(2));

  // Slots share the same bytes instead of duplicating them.
  await fileManager.saveToDBSlot(101, makeSave(cache));
  await fileManager.saveToDBSlot(102, makeSave(cache));
  assert.equal((await store.getImageStoreStats()).count, 2, 'slots reuse the stored images');
  const slot = await fileManager.loadFromDBSlot(102);
  assert.equal(slot.gameState.imageCache.scene, png(1));
  const rawSlot = await readRawRecord('save_slots', 102);
  assert.ok(!JSON.stringify(rawSlot.saveData.gameState.imageCache).includes('data:image'));

  // The exported file stays portable: it carries the images themselves.
  const originalCreateObjectURL = URL.createObjectURL;
  let exported = null;
  URL.createObjectURL = (blob) => { exported = blob; return 'blob:export'; };
  try {
    fileManager.prepareSaveGameFile(slot);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
  }
  assert.ok(exported, 'the export produced a file');
  assert.ok((await exported.text()).includes('data:image/png;base64,'), 'an exported save keeps inline images');
});

test('a lost image is dropped instead of breaking the load', async () => {
  const vite = await getTestServer();
  const store = await vite.ssrLoadModule('/utils/imageBlobStore.ts');
  const fileManager = await vite.ssrLoadModule('/utils/fileManager.ts');
  await clearImageStore(store);

  await fileManager.saveToDB(makeSave({ scene: png(3), portrait: png(4) }));
  const stats = await store.getImageStoreStats();
  const sceneId = (await store.storeImageDataUrl(png(3))).slice('blob:'.length);
  await store.deleteStoredImages([sceneId]);
  assert.equal((await store.getImageStoreStats()).count, stats.count - 1);

  const restored = await fileManager.loadFromDB();
  assert.ok(restored, 'the save still loads');
  assert.equal(restored.gameState.imageCache.scene, undefined, 'the unreadable image is dropped');
  assert.equal(restored.gameState.imageCache.portrait, png(4), 'the rest of the cache survives');
  assert.equal(restored.missingImageCount, 1, 'the load reports how many images were lost');

  // The report is about that load only; it must not stick to the stored save.
  await fileManager.saveToDB(restored);
  const rawAgain = await readRawRecord('autosaves', 'current_autosave');
  assert.equal(rawAgain.saveData.missingImageCount, undefined);
  assert.equal((await fileManager.loadFromDB()).missingImageCount, undefined);
});

test('saves written before the store existed are migrated once', async () => {
  const vite = await getTestServer();
  const store = await vite.ssrLoadModule('/utils/imageBlobStore.ts');
  const fileManager = await vite.ssrLoadModule('/utils/fileManager.ts');
  await clearImageStore(store);

  // Simulate a legacy record: base64 in the payload, nothing in the image store.
  const legacySave = makeSave({ scene: png(5), portrait: png(6) });
  await clearSaves();
  await gameStore('autosaves', 'readwrite', store => store.put({ id: 'current_autosave', saveData: legacySave }));

  const beforeMigration = await fileManager.loadFromDB();
  assert.equal(beforeMigration.gameState.imageCache.scene, png(5), 'legacy saves stay readable');
  assert.equal((await store.getImageStoreStats()).count, 0);

  const result = await fileManager.migrateInlineImagesToImageStore();
  assert.equal(result.records, 1, 'the legacy record was rewritten');
  assert.equal(result.images, 2, 'both images moved into the store');
  const raw = await readRawRecord('autosaves', 'current_autosave');
  assert.ok(!JSON.stringify(raw.saveData.gameState.imageCache).includes('data:image'), 'the payload no longer embeds base64');

  // Running the migration again is a no-op.
  const secondRun = await fileManager.migrateInlineImagesToImageStore();
  assert.equal(secondRun.records, 0);
  assert.equal((await fileManager.loadFromDB()).gameState.imageCache.portrait, png(6));
});

test('images survive while any save refers to them and are swept afterwards', async () => {
  const vite = await getTestServer();
  const store = await vite.ssrLoadModule('/utils/imageBlobStore.ts');
  const fileManager = await vite.ssrLoadModule('/utils/fileManager.ts');
  await clearImageStore(store);

  const shared = { scene: png(9), portrait: png(10) };
  await fileManager.saveToDB(makeSave(shared));
  await fileManager.saveToDBSlot(201, makeSave(shared));
  assert.equal((await store.getImageStoreStats()).count, 2);

  // The autosave alone still keeps both images alive.
  await fileManager.deleteDBSlot(201);
  assert.equal((await store.getImageStoreStats()).count, 2, 'referenced images are not swept');

  // Nothing refers to them any more: the next sweep reclaims the space.
  await gameStore('autosaves', 'readwrite', store => store.delete('current_autosave'));
  // A fresh page load has no in-memory grace list, which is what the sweep sees.
  store.resetImageStoreForTests();
  const swept = await fileManager.sweepUnusedImages();
  assert.equal(swept, 2, 'both unreferenced images were reclaimed');
  assert.equal((await store.getImageStoreStats()).count, 0);
});

test('recovery checkpoints store references and restore readable images', async () => {
  const vite = await getTestServer();
  const store = await vite.ssrLoadModule('/utils/imageBlobStore.ts');
  const fileManager = await vite.ssrLoadModule('/utils/fileManager.ts');
  await clearImageStore(store);

  const save = makeSave({ scene: png(11), portrait: png(12), 'npc-1': png(13) });
  await fileManager.saveCrashRecoveryPoint(save, 'stable');
  const crashRaw = await readRawRecord('autosaves', 'last_known_good_save');
  assert.ok(!JSON.stringify(crashRaw.saveData.gameState.imageCache).includes('data:image'), 'the crash copy keeps references');
  const crash = await fileManager.loadCrashRecoveryPoint();
  assert.equal(crash.gameState.imageCache.scene, png(11));
  assert.equal(crash.gameState.imageCache.portrait, png(12));

  await fileManager.saveInterruptedTurnRecovery({ context: save.gameContext, baseState: save.gameState, history: [] });
  const checkpointRaw = await readRawRecord('interrupted_turns', 'pending-turn');
  assert.ok(!JSON.stringify(checkpointRaw.baseState.imageCache).includes('data:image'), 'the checkpoint keeps references');
  const checkpoint = await fileManager.loadInterruptedTurnRecovery();
  assert.equal(checkpoint.baseState.imageCache.scene, png(11));
  assert.ok(checkpoint.checkpointId, 'the checkpoint identity survives the rewrite');
});

test('a save and its images can travel as two separate files', async () => {
  const vite = await getTestServer();
  const store = await vite.ssrLoadModule('/utils/imageBlobStore.ts');
  const fileManager = await vite.ssrLoadModule('/utils/fileManager.ts');
  const bundleModule = await vite.ssrLoadModule('/utils/saveBundle.ts');
  await clearImageStore(store);

  const save = makeSave({ scene: png(21), portrait: png(22) });
  const { saveData: referenced, bundle } = await bundleModule.splitSaveImages(save);
  assert.ok(bundle, 'the images are exported separately');
  assert.equal(Object.keys(bundle.images).length, 2);
  assert.ok(!JSON.stringify(referenced).includes('data:image'), 'the save document keeps references only');
  assert.equal(bundleModule.isSaveDocument(referenced), true);
  assert.equal(bundleModule.isImageBundleDocument(bundle), true);
  assert.equal(bundleModule.isSaveDocument(bundle), false, 'an images file is not mistaken for a save');
  assert.equal(bundleModule.isImageBundleDocument(referenced), false);

  // The exported filenames tell the player which file is which.
  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = () => 'blob:export';
  let prepared;
  try {
    prepared = await fileManager.prepareSaveFiles(save);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
  }
  assert.ok(prepared.images, 'the pair is offered when the save has images');
  assert.match(prepared.single.filename, /-save-\d{4}-\d{2}-\d{2}\.json$/);
  assert.match(prepared.save.filename, /-save\.json$/);
  assert.match(prepared.images.filename, /-images\.json$/);

  // Losing the local bytes and importing both documents restores the images.
  await clearImageStore(store);
  const imported = await bundleModule.applySaveBundleDocuments([bundle, referenced]);
  assert.equal(imported.imagesImported, 2);
  assert.equal(imported.missingImages, 0);
  assert.equal(imported.saveData.gameState.imageCache.scene, png(21));
  assert.equal(imported.saveData.gameState.imageCache.portrait, png(22));
  assert.equal((await store.getImageStoreStats()).count, 2, 'the imported images are stored once');

  // Importing the save alone reports what is missing instead of failing.
  await clearImageStore(store);
  const withoutImages = await bundleModule.applySaveBundleDocuments([referenced]);
  assert.equal(withoutImages.missingImages, 2);
  assert.deepEqual(withoutImages.saveData.gameState.imageCache, {});

  // A bundle whose keys are not content hashes still resolves its images.
  const aliasBundle = {
    format: 'book-of-eternity-image-bundle', version: 1, createdAt: new Date().toISOString(),
    images: { 'blob:ff00ff00': png(23) },
  };
  const aliasedSave = makeSave({ scene: 'blob:ff00ff00' });
  const aliased = await bundleModule.applySaveBundleDocuments([aliasBundle, aliasedSave]);
  assert.equal(aliased.missingImages, 0);
  assert.equal(aliased.saveData.gameState.imageCache.scene, png(23));

  // The imported save keeps working through the normal fileManager path.
  await fileManager.saveToDB(imported.saveData);
  assert.equal((await fileManager.loadFromDB()).gameState.imageCache.scene, png(21));

  // The images file may also be imported first, on its own, and the save afterwards.
  await clearImageStore(store);
  await gameStore('autosaves', 'readwrite', store_ => store_.clear());
  const imagesOnly = await bundleModule.applySaveBundleDocuments([bundle]);
  assert.equal(imagesOnly.saveData, null, 'an images-only pick loads no save');
  assert.equal(imagesOnly.imagesImported, 2);
  assert.equal((await store.getImageStoreStats()).count, 2, 'the bytes are stored for the next step');

  const laterSave = await bundleModule.applySaveBundleDocuments([referenced]);
  assert.equal(laterSave.imagesImported, 0);
  assert.equal(laterSave.missingImages, 0, 'the previously imported images are reused');
  assert.equal(laterSave.saveData.gameState.imageCache.scene, png(21));

  // A file that is neither a save nor an images bundle is still rejected.
  assert.equal(await bundleModule.applySaveBundleDocuments([{ hello: 'world' }]), null);
});
