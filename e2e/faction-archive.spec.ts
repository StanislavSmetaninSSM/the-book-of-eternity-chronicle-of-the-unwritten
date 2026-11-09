import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(e2eDirectory, 'fixtures', 'full-party-save.json');
const exportsDirectory = path.join(e2eDirectory, '..', 'test-results', 'exports');

/**
 * An archived project carries the word that says how it ended - `finalState: 'Completed' | 'Abandoned'`
 * - and the panel reads that word by name: a record saying anything else is drawn as "Abandoned", with
 * the colour and the sentence of a thing given up. So an ending outside the pair is not a typo the player
 * can spot; it is a verdict the interface forms on its own. `projectId` decides the same way twice: a
 * record filed while it still runs is counted in both lists, and the delete handler reaches only one.
 */
function writeArchiveSave(): string {
  const save = JSON.parse(readFileSync(fixturePath, 'utf8'));
  save.gameContext.gameSettings = { ...(save.gameContext.gameSettings || {}), language: 'en' };
  const faction = {
    factionId: 'f-archive',
    name: 'Mill Watch',
    description: 'A watch that keeps the mills of the valley.',
    reputation: 10,
    reputationDescription: 'Neutral',
    isPlayerMember: false,
    playerRank: null,
    activeProjects: [
      {
        projectId: 'p-gate',
        projectName: 'Open the north gate',
        description: 'Clear the rubble from the northern gate.',
        totalTimeCostMinutes: 30,
        timeSpentMinutes: 10,
      },
    ],
    completedProjects: [
      { projectId: 'p-gate', projectName: 'Open the north gate', completionTurn: 4, finalState: 'finished' },
      { projectId: 'p-seal', projectName: 'Seal the vault', completionTurn: 5, finalState: 'Completed' },
    ],
  };
  save.gameContext.encounteredFactions = [faction];
  save.gameState.encounteredFactions = [faction];
  mkdirSync(exportsDirectory, { recursive: true });
  const target = path.join(exportsDirectory, 'faction-archive-save.json');
  writeFileSync(target, JSON.stringify(save));
  return target;
}

async function importSave(page: Page, file: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([{ name: path.basename(file), mimeType: 'application/json', buffer: readFileSync(file) }]);
}

test('an archive is read for the ending it states and the identity it holds', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await importSave(page, writeArchiveSave());
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await page.getByTestId('side-tab-Factions').click();

  // The card of the faction names both facts about one record: a filed project still running, and an
  // ending that is neither of the two words the archive holds.
  const cardNotes = page.getByTestId('world-state-notes-inline');
  await expect(cardNotes).toHaveCount(1);
  await expect(cardNotes.locator('p')).toHaveCount(2);
  await expect(cardNotes).toContainText('filed away and still listed as running');
  await expect(cardNotes).toContainText('"finished"');

  await page.getByRole('button', { name: /Mill Watch/ }).first().click();
  await page.getByRole('button', { name: /^Projects$/ }).first().click();
  await expect(page.getByRole('button', { name: /^Completed \(2\)$/ })).toBeVisible();
  await page.getByRole('button', { name: /^Completed \(2\)$/ }).click();

  const dialog = page.locator('[role="dialog"]');
  const archiveNotes = dialog.getByTestId('world-state-notes-inline');
  await expect(archiveNotes).toHaveCount(1);
  await expect(archiveNotes.locator('p')).toHaveCount(2);

  // The interface draws the unknown ending as a giving-up, and the line sits above the list it describes
  // rather than replacing what the save says.
  const gate = dialog.locator('div[class*="bg-gray-800/60"]').filter({ hasText: 'Open the north gate' });
  await expect(gate).toContainText('Abandoned');
  await expect(gate).not.toContainText('finished');
  await expect(gate.locator('[data-testid="world-state-notes-inline"]')).toHaveCount(0);

  // A record that states one of the two words is left alone.
  const vault = dialog.locator('div[class*="bg-gray-800/60"]').filter({ hasText: 'Seal the vault' });
  await expect(vault).toContainText('Completed on turn 5');
  await expect(vault).not.toContainText('Abandoned');

  // The running list is not where an archive is discussed.
  await page.getByRole('button', { name: /^Active \(1\)$/ }).click();
  await expect(dialog.getByTestId('world-state-notes-inline')).toHaveCount(0);

  await expect(page.getByTestId('world-state-notes')).toHaveCount(0);
  await expect(page.getByText(/world_notes_/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
