import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const fixturePath = (name: string) => path.join(fixturesDirectory, name);

/** The app imports saves through a transient <input type="file">, so use the file chooser. */
async function importSave(page: Page, fixtureName: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(fixturePath(fixtureName));
}

test.describe('single-player chronicle', () => {
  test('a full-party save opens, shows both characters and hands the turn over', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      // Fonts and the Tailwind CDN are unreachable in offline sandboxes; that is not an
      // application error, and CI loads them normally.
      if (/fonts\.googleapis\.com|cdn\.tailwindcss\.com/.test(message.location()?.url || '')) return;
      pageErrors.push(message.text());
    });

    await page.goto('/');
    await expect(page.getByTestId('start-screen')).toBeVisible();

    await importSave(page, 'full-party-save.json');
    await expect(page.getByTestId('chat-window')).toContainText('Aetheria');

    await page.getByTestId('side-tab-Characters').click();
    await expect(page.getByTestId('players-panel')).toBeVisible();
    await expect(page.getByTestId('players-panel')).toContainText('Aria');
    await expect(page.getByTestId('players-panel')).toContainText('Borin');

    // The active character cannot hand the turn to itself.
    await expect(page.getByTestId('pass-turn-0')).toBeDisabled();
    await expect(page.getByTestId('pass-turn-1')).toBeEnabled();

    await page.getByTestId('pass-turn-1').click();
    await expect(page.getByTestId('pass-turn-1')).toBeDisabled();
    await expect(page.getByTestId('pass-turn-0')).toBeEnabled();
    await expect(page.getByTestId('chat-window')).toContainText('Borin');

    expect(pageErrors.filter(message => !/favicon/i.test(message))).toEqual([]);
  });

  test('a legacy networked save opens as a local party without network controls', async ({ page }) => {
    await page.goto('/');
    await importSave(page, 'legacy-network-save.json');

    await expect(page.getByTestId('chat-window')).toBeVisible();
    await page.getByTestId('side-tab-Characters').click();
    await expect(page.getByTestId('players-panel')).toContainText('Cyra');

    // The removed networking UI must not come back in any form.
    await expect(page.getByRole('button', { name: /host|join|connect|sync|peer/i })).toHaveCount(0);
    await expect(page.getByText(/waiting for the host|connected to host|sync/i)).toHaveCount(0);
  });

  test('a save with an image exports the save and its images as two files', async ({ page }) => {
    await page.goto('/');
    await importSave(page, 'save-with-image.json');
    await expect(page.getByTestId('chat-window')).toBeVisible();

    // In the browser the save keeps references and the bytes live in their own store.
    const readStorage = () => page.evaluate(async () => {
      const openDb = (name: string) => new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const saves = await openDb('gemini-rpg-db');
      const record = await new Promise<{ saveData?: { gameState?: { imageCache?: Record<string, unknown> } } } | undefined>((resolve, reject) => {
        const request = saves.transaction('autosaves', 'readonly').objectStore('autosaves').get('current_autosave');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      saves.close();
      const images = await openDb('gemini-rpg-images');
      const storedImages = await new Promise<number>((resolve, reject) => {
        const request = images.transaction('images', 'readonly').objectStore('images').count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      images.close();
      return {
        cache: JSON.stringify(record?.saveData?.gameState?.imageCache ?? {}),
        storedImages,
      };
    });
    await expect.poll(async () => (await readStorage()).cache, { timeout: 15_000 }).toContain('blob:');
    const storage = await readStorage();
    expect(storage.cache).not.toContain('data:image');
    expect(storage.storedImages).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Save to File' }).first().click();
    await expect(page.getByText('Save file is ready')).toBeVisible();

    /** Reads a prepared export straight from the blob URL the dialog offers. */
    const readExport = (labelPart: string) => page.evaluate(async part => {
      const link = Array.from(document.querySelectorAll('a[download]'))
        .find(anchor => (anchor.textContent || '').includes(part)) as HTMLAnchorElement | undefined;
      if (!link) return null;
      const response = await fetch(link.href);
      return { filename: link.getAttribute('download'), body: await response.json() };
    }, labelPart);

    const images = await readExport('Images file');
    expect(images, 'the dialog offers a separate images file').not.toBeNull();
    expect(images!.filename).toMatch(/-images\.json$/);
    expect(images!.body.format).toBe('book-of-eternity-image-bundle');
    const references = Object.keys(images!.body.images);
    expect(references.length).toBeGreaterThan(0);
    expect(references[0]).toMatch(/^blob:[0-9a-f]{64}$/);
    expect(String(images!.body.images[references[0]])).toMatch(/^data:image\/png;base64,/);

    const pairSave = await readExport('Save file without images');
    expect(pairSave!.filename).toMatch(/-save\.json$/);
    expect(JSON.stringify(pairSave!.body)).not.toContain('data:image');
    expect(JSON.stringify(pairSave!.body)).toContain('blob:');

    const portable = await readExport('Download save file');
    expect(JSON.stringify(portable!.body)).toContain('data:image/png;base64,');
  });

  // The start screen hands a request to the game host instead of mounting the game itself.
  test('a new chronicle starts from the creation form and reaches the game host', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.getByTestId('start-screen')).toBeVisible();

    await page.locator('#playerName').fill('Wanderer');
    await page.locator('#characterDescription').fill('A traveller of the unwritten roads.');
    await page.locator('#initialPrompt').fill('I open the book.');
    await page.getByTestId('begin-adventure').click();

    await expect(page.getByTestId('chat-window')).toBeVisible({ timeout: 20_000 });
    // The creation data reached the game host: the lone adventurer's tab shows the name.
    await page.getByTestId('side-tab-Character').click();
    await expect(page.getByText('Wanderer').first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
