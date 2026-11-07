import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const exportsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'exports');
const fixturePath = (name: string) => path.join(fixturesDirectory, name);

async function importFiles(page: Page, ...files: string[]): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files.map(file => ({ name: path.basename(file), mimeType: 'application/json', buffer: readFileSync(file) })));
}

const readAutosave = (page: Page) => page.evaluate(async () => {
  const openDb = (name: string) => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const saves = await openDb('gemini-rpg-db');
  const record = await new Promise<any>((resolve, reject) => {
    const request = saves.transaction('autosaves', 'readonly').objectStore('autosaves').get('current_autosave');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  saves.close();
  return JSON.stringify(record?.saveData?.gameState?.imageCache ?? {});
});

const readSlotImages = (page: Page) => page.evaluate(async () => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('gemini-rpg-db');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const records = await new Promise<any[]>((resolve, reject) => {
    const request = database.transaction('save_slots', 'readonly').objectStore('save_slots').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return JSON.stringify(records[0]?.saveData?.gameState?.imageCache ?? null);
});

const countStoredImages = (page: Page) => page.evaluate(async () => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('gemini-rpg-images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const count = await new Promise<number>((resolve, reject) => {
    const request = database.transaction('images', 'readonly').objectStore('images').count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return count;
});

/** Reads a prepared export out of the dialog's blob URL, without downloading it. */
const readExport = (page: Page, labelPart: string) => page.evaluate(async part => {
  const link = Array.from(document.querySelectorAll('a[download]'))
    .find(anchor => (anchor.textContent || '').includes(part)) as HTMLAnchorElement | undefined;
  if (!link) return null;
  const response = await fetch(link.href);
  return { filename: link.getAttribute('download') || '', body: await response.json() };
}, labelPart);

const clearDatabases = (page: Page) => page.evaluate(async () => {
  for (const name of ['gemini-rpg-db', 'gemini-rpg-images']) {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  }
});

test.describe('images across a real browser session', () => {
  test('a reloaded page shows images that were stored as references', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/');
    await importFiles(page, fixturePath('save-with-image.json'));
    await expect(page.getByTestId('chat-window')).toBeVisible();

    // The autosave written for the imported game keeps references, not payloads.
    await expect.poll(() => readAutosave(page), { timeout: 15_000 }).toContain('blob:');
    expect(await readAutosave(page)).not.toContain('data:image');
    expect(await countStoredImages(page)).toBeGreaterThan(0);

    // A reload starts a new module instance: only the store can bring the image back.
    await page.reload();
    await page.getByRole('button', { name: /^Load Autosave/ }).click();
    await expect(page.getByTestId('chat-window')).toBeVisible();

    await page.getByTestId('side-tab-ImageCache').click();
    await expect(page.locator('img[src^="data:image/png"]').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('an autosave written with inline base64 is migrated on startup', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('start-screen')).toBeVisible();

    // Seed an old-style record: the image sits inside the save as a data URL.
    const legacy = readFileSync(fixturePath('save-with-image.json'), 'utf8');
    await page.evaluate(async raw => {
      const save = JSON.parse(raw);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('gemini-rpg-db', 3);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('autosaves')) db.createObjectStore('autosaves', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('save_slots')) db.createObjectStore('save_slots', { keyPath: 'slotId' });
          if (!db.objectStoreNames.contains('interrupted_turns')) db.createObjectStore('interrupted_turns', { keyPath: 'id' });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('autosaves', 'readwrite');
          transaction.objectStore('autosaves').put({ id: 'current_autosave', saveData: save });
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onerror = () => { db.close(); reject(transaction.error); };
        };
      });
    }, legacy);
    expect(await readAutosave(page)).toContain('data:image');

    // Startup migration moves the bytes into the image store and rewrites the record.
    await page.reload();
    await expect(page.getByTestId('start-screen')).toBeVisible();
    await expect.poll(() => readAutosave(page), { timeout: 20_000 }).toContain('blob:');
    expect(await readAutosave(page)).not.toContain('data:image');
    expect(await countStoredImages(page)).toBeGreaterThan(0);

    await page.getByRole('button', { name: /^Load Autosave/ }).click();
    await expect(page.getByTestId('chat-window')).toBeVisible();
    await page.getByTestId('side-tab-ImageCache').click();
    await expect(page.locator('img[src^="data:image/png"]').first()).toBeVisible();
  });

  test('the images file can be imported separately from the save', async ({ page }) => {
    await page.goto('/');
    await importFiles(page, fixturePath('save-with-image.json'));
    await expect(page.getByTestId('chat-window')).toBeVisible();

    await page.getByRole('button', { name: 'Save to File' }).first().click();
    await expect(page.getByText('Save file is ready')).toBeVisible();
    const images = await readExport(page, 'Images file');
    const save = await readExport(page, 'Save file without images');
    expect(images, 'the export offers the images file').not.toBeNull();
    expect(save, 'the export offers the save without images').not.toBeNull();

    mkdirSync(exportsDirectory, { recursive: true });
    const imagesPath = path.join(exportsDirectory, 'pair-images.json');
    const savePath = path.join(exportsDirectory, 'pair-save.json');
    writeFileSync(imagesPath, JSON.stringify(images!.body));
    writeFileSync(savePath, JSON.stringify(save!.body));

    // Start from an empty browser: nothing of the original session survives.
    await page.reload();
    await clearDatabases(page);
    await page.reload();
    await expect(page.getByTestId('start-screen')).toBeVisible();

    await importFiles(page, savePath);
    await expect(page.getByText(/Some images were not found/)).toBeVisible();
    await expect(page.getByTestId('chat-window')).toBeVisible();

    // Now the real two-step flow: images first, then the save.
    await page.reload();
    await clearDatabases(page);
    await page.reload();
    await expect(page.getByTestId('start-screen')).toBeVisible();

    await importFiles(page, imagesPath);
    await expect(page.getByText(/Images were added/)).toBeVisible();
    await expect(page.getByTestId('start-screen')).toBeVisible();

    await importFiles(page, savePath);
    await expect(page.getByTestId('chat-window')).toBeVisible();
    await page.getByTestId('side-tab-ImageCache').click();
    await expect(page.locator('img[src^="data:image/png"]').first()).toBeVisible();
  });

  test('every side panel tab renders without a page error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/');
    await importFiles(page, fixturePath('save-with-image.json'));
    await expect(page.getByTestId('chat-window')).toBeVisible();

    await expect(page.locator('[data-testid^="side-tab-"]').first()).toBeVisible();
    const tabIds = await page.locator('[data-testid^="side-tab-"]')
      .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid') as string));
    expect(tabIds.length).toBeGreaterThan(5);

    for (const tabId of tabIds) {
      await page.getByTestId(tabId).click();
      // Selecting a tab replaces the grid with that panel and its back link.
      const back = page.getByRole('button', { name: 'Back to Menu' });
      await expect(back, `tab "${tabId}" did not open a panel`).toBeVisible();
      expect(errors, `tab "${tabId}" threw`).toEqual([]);
      await back.click();
      await expect(page.getByTestId(tabId)).toBeVisible();
    }
  });
});

test.describe('database slots and cache maintenance', () => {
  test('a database slot round-trips its images', async ({ page }) => {
    await page.goto('/');
    await importFiles(page, fixturePath('save-with-image.json'));
    await expect(page.getByTestId('chat-window')).toBeVisible();

    await page.getByTestId('side-tab-System').click();
    await page.getByRole('button', { name: 'Save to New Slot' }).click();
    await expect(page.getByText(/^Slot 1:/)).toBeVisible();
    expect(await page.getByTestId('slot-without-images-1').count()).toBe(0);

    // The slot must be reachable again from a fresh start screen, not only in-game.
    await page.reload();
    await expect(page.getByTestId('start-screen-slots')).toBeVisible();
    await expect(page.getByTestId('start-screen-slots')).toContainText('Slot 1:');
    expect(await page.getByTestId('start-screen-slot-without-images-1').count()).toBe(0);

    await page.getByTestId('start-screen-load-slot-1').click();
    await expect(page.getByTestId('chat-window')).toBeVisible();
    await page.getByTestId('side-tab-ImageCache').click();
    await expect(page.locator('img[src^="data:image/png"]').first()).toBeVisible();
  });

  test('deleting a cached image empties the gallery and the store entry', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/');
    await importFiles(page, fixturePath('save-with-image.json'));
    await expect(page.getByTestId('chat-window')).toBeVisible();
    await expect.poll(() => countStoredImages(page), { timeout: 15_000 }).toBeGreaterThan(0);

    await page.getByTestId('side-tab-ImageCache').click();
    const thumbnail = page.locator('img[src^="data:image/png"]').first();
    await expect(thumbnail).toBeVisible();

    await page.locator('button[title="Delete from cache"]').first().click();
    await page.getByRole('button', { name: 'Yes', exact: true }).click();

    await expect(page.getByText('Image cache is empty.')).toBeVisible();

    // The next save must not carry the deleted image along.
    await page.getByRole('button', { name: 'Back to Menu' }).click();
    await page.getByTestId('side-tab-System').click();
    await page.getByRole('button', { name: 'Save to New Slot' }).click();
    await expect(page.getByText(/^Slot 1:/)).toBeVisible();
    await expect.poll(() => readSlotImages(page), { timeout: 20_000 }).toBe('{}');
    expect(errors).toEqual([]);
  });

  test('a Russian session shows no raw translation keys', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/');
    await importFiles(page, fixturePath('save-with-image.json'));
    await expect(page.getByTestId('chat-window')).toBeVisible();

    await page.getByRole('button', { name: 'Switch Language' }).click();
    await expect(page.locator('[data-testid^="side-tab-"]').first()).toBeVisible();
    const tabIds = await page.locator('[data-testid^="side-tab-"]')
      .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid') as string));
    expect(tabIds.length).toBeGreaterThan(5);

    const leaked: string[] = [];
    const collectLeaks = async (where: string) => {
      const text = await page.locator('[data-testid="side-panel"], body').first().innerText();
      for (const match of text.match(/\b[a-z]{2,}(?:_[a-z]{2,})+\b/g) ?? []) {
        leaked.push(`${where}: ${match}`);
      }
    };

    for (const tabId of tabIds) {
      await page.getByTestId(tabId).click();
      const back = page.getByRole('button', { name: 'Back to Menu' });
      await expect(back, `tab "${tabId}" did not open a panel`).toBeVisible();
      await collectLeaks(tabId);
      await back.click();
    }
    await collectLeaks('chat');
    await expect(page.getByTestId('chat-window')).toBeVisible();

    expect(leaked).toEqual([]);
    expect(errors).toEqual([]);
  });
});
