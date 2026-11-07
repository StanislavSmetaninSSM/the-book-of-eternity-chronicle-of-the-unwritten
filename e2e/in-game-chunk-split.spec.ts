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
