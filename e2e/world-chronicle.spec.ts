import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(e2eDirectory, 'fixtures', 'full-party-save.json');
const exportsDirectory = path.join(e2eDirectory, '..', 'test-results', 'exports');

const CLEAN = '#[10] - 15 Месяца Начал 1024 г., 14:00: A dragon was spotted over the mill.';
const NO_STAMP = 'A dragon was spotted again, and nobody wrote which turn it was.';
const NO_CLOCK = '#[41] - 16 Месяца Начал 1024 г.: the miller barricaded the door.';

/**
 * #18.A.0 puts a timestamp at the head of every chronicle entry, and the location archive reads the
 * turn out of that prefix to sort and prune the log. The card shows the newest entry, the modal shows
 * the whole archive - so the marks have to be picked entry by entry, not handed out over the list.
 *
 * The location is the fixture's own one, copied: `DetailRenderer` only resolves a payload that passes
 * its `isLocation` guard, which asks for a difficulty profile.
 */
function writeChronicleSave(): string {
  const save = JSON.parse(readFileSync(fixturePath, 'utf8'));
  save.gameContext.gameSettings = { ...(save.gameContext.gameSettings || {}), language: 'en' };
  const place = {
    ...(save.gameState.currentLocationData || {}),
    locationId: 'loc-chronicle',
    name: 'The Mill',
    eventDescriptions: [CLEAN, NO_STAMP, NO_CLOCK],
  };
  save.gameContext.visitedLocations = [place];
  mkdirSync(exportsDirectory, { recursive: true });
  const target = path.join(exportsDirectory, 'world-chronicle-save.json');
  writeFileSync(target, JSON.stringify(save));
  return target;
}

async function importSave(page: Page, file: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([{ name: path.basename(file), mimeType: 'application/json', buffer: readFileSync(file) }]);
}

test('the chronicle marks the entries the archive cannot place in time - card and modal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await importSave(page, writeChronicleSave());
  await expect(page.getByTestId('chat-window')).toBeVisible();

  await page.getByTestId('side-tab-Locations').click();
  await expect(page.getByText('Read Full Log')).toHaveCount(1);
  // The card shows the newest entry, and that one is stamped: it owes the player nothing.
  await expect(page.getByTestId('world-state-notes-inline')).toHaveCount(0);

  await page.getByText('Read Full Log').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  // The whole archive is listed, oldest last, and two of the three entries carry a mark of their own.
  const entries = dialog.locator('[class*="border-gray-700/50"][class*="group"]');
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText('A dragon was spotted over the mill');
  await expect(entries.nth(0).locator('[data-testid="world-state-notes-inline"]')).toHaveCount(0);
  await expect(entries.nth(1)).toContainText('no turn can be read out of it');
  await expect(entries.nth(2)).toContainText('the hour is not');

  // Two marks in the page, no band over the chronicle, and no raw key reaches the player.
  await expect(page.getByTestId('world-state-notes-inline')).toHaveCount(2);
  await expect(page.getByTestId('world-state-notes')).toHaveCount(0);
  await expect(page.getByText(/world_notes_/)).toHaveCount(0);

  expect(errors).toEqual([]);
});
