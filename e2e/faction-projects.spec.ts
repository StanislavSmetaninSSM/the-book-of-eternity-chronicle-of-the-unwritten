import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(e2eDirectory, 'fixtures', 'full-party-save.json');
const exportsDirectory = path.join(e2eDirectory, '..', 'test-results', 'exports');

const faction = {
  factionId: 'f-action',
  name: 'Ash Guild',
  description: 'A guild of ash merchants that trades in salvage.',
  reputation: 10,
  reputationDescription: 'Neutral',
  isPlayerMember: false,
  playerRank: null,
  activeProjects: [
    {
      projectId: 'p-active',
      projectName: 'Open the north gate',
      description: 'Clear the rubble from the northern gate.',
      totalTimeCostMinutes: 120,
      timeSpentMinutes: 30,
      currentStep: 1,
      totalSteps: 3,
    },
  ],
  completedProjects: [
    { projectId: 'p-completed', projectName: 'Rebuild the granary', completionTurn: 2, finalState: 'Completed' },
  ],
};

function writeFactionSave(): string {
  const save = JSON.parse(readFileSync(fixturePath, 'utf8'));
  save.gameContext.gameSettings = { ...(save.gameContext.gameSettings || {}), allowHistoryManipulation: true };
  save.gameContext.encounteredFactions = [faction];
  save.gameState.encounteredFactions = [faction];
  mkdirSync(exportsDirectory, { recursive: true });
  const target = path.join(exportsDirectory, 'faction-projects-save.json');
  writeFileSync(target, JSON.stringify(save));
  return target;
}

async function importSave(page: Page, file: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([{ name: path.basename(file), mimeType: 'application/json', buffer: readFileSync(file) }]);
}

test('a completed faction project can be deleted from the faction panel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  const save = writeFactionSave();
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await importSave(page, save);
  await expect(page.getByTestId('chat-window')).toBeVisible();

  await page.getByTestId('side-tab-Factions').click();
  await page.getByRole('button', { name: /Ash Guild/ }).first().click();

  // Faction detail panel → its own menu → Projects.
  await page.getByRole('button', { name: /^Projects$/ }).first().click();
  await expect(page.getByRole('button', { name: /^Completed \(1\)$/ })).toBeVisible();
  await page.getByRole('button', { name: /^Completed \(1\)$/ }).click();
  await expect(page.getByText('Rebuild the granary')).toBeVisible();

  const card = page.locator('div.group', { hasText: 'Rebuild the granary' }).first();
  await card.hover();
  await card.getByTitle('Delete Project').click();
  await page.getByRole('button', { name: 'Yes' }).click();

  await expect(page.getByText('Rebuild the granary')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Completed \(0\)$/ })).toBeVisible();

  // Only the completed list changed: the active project is untouched.
  await page.getByRole('button', { name: /^Active \(1\)$/ }).click();
  await expect(page.getByText('Open the north gate')).toBeVisible();
  expect(errors).toEqual([]);
});
