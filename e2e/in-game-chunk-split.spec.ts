import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(e2eDirectory, 'fixtures', 'full-party-save.json');

async function importSave(page: Page, file: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([{ name: path.basename(file), mimeType: 'application/json', buffer: readFileSync(file) }]);
}

// The turn log key is a literal of the game core (the hook and the turn processor); it must not
// appear in anything the start screen downloads.
const CORE_MARKER = 'Step3_Logs';

test('the game core is fetched only once a chronicle starts', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', request => requested.push(request.url()));
  const hostChunks = () => requested.filter(url => /\/assets\/GameHost-[^/]*\.js$/.test(url));

  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await page.waitForTimeout(300);
  expect(hostChunks(), `game host requested on the start screen: ${hostChunks().join(', ')}`).toEqual([]);

  const startBundles = requested.filter(url => /\/assets\/[^/]*\.js$/.test(url));
  expect(startBundles.length, 'the start screen should load some code').toBeGreaterThan(0);
  for (const url of startBundles) {
    const body = await page.evaluate(async source => (await fetch(source)).text(), url);
    expect(body.includes(CORE_MARKER), `the game core leaked into ${url}`).toBe(false);
  }

  await importSave(page, fixture);
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect.poll(() => hostChunks().length, { message: 'the game host should load with the chronicle' }).toBe(1);
  const hostBody = await page.evaluate(async source => (await fetch(source)).text(), hostChunks()[0]);
  expect(hostBody).toContain(CORE_MARKER);
});

test('the start screen does not download the in-game screens', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', request => requested.push(request.url()));
  const gameChunk = () => requested.filter(url => /\/assets\/(SidePanel|CharacterSheet)-[^/]*\.js$/.test(url));

  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await page.waitForTimeout(300);
  expect(gameChunk(), `in-game chunks requested on the start screen: ${gameChunk().join(', ')}`).toEqual([]);

  await importSave(page, fixture);
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect.poll(() => gameChunk().length, { message: 'the side panel chunk should load with the chronicle' }).toBeGreaterThan(0);
});
