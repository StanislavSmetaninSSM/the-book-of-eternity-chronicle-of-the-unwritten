import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(e2eDirectory, 'fixtures', 'full-party-save.json');
const exportsDirectory = path.join(e2eDirectory, '..', 'test-results', 'exports');

const rank = (name: string, requiredReputation?: number) => ({
  rankNameMale: name,
  rankNameFemale: `${name}a`,
  ...(requiredReputation === undefined ? {} : { requiredReputation }),
  benefits: [`${name} benefit`],
});

const ladder = [
  rank('Initiate', 125),
  rank('Member', 200),
  rank('Veteran', 275),
  // Above the ends of the scale, which standing is capped to: no promotion can reach it.
  rank('Legend', 450),
  // And a rank that states no threshold at all: the row has no number to quote.
  rank('Ghost'),
];

function writeHierarchySave(rankHeld: string, file: string): string {
  const save = JSON.parse(readFileSync(fixturePath, 'utf8'));
  save.gameContext.gameSettings = { ...(save.gameContext.gameSettings || {}), language: 'en' };
  const member = {
    factionId: 'f-mill',
    name: 'Mill Watch',
    description: 'A watch that keeps the mills of the valley.',
    reputation: 210,
    reputationDescription: 'Friendly',
    isPlayerMember: true,
    playerRank: rankHeld,
    playerBranch: 'core',
    ranks: { branches: [{ branchId: 'core', displayName: 'Watch', isCoreBranch: true, ranks: ladder }] },
    activeProjects: [],
    completedProjects: [],
  };
  save.gameContext.encounteredFactions = [member];
  save.gameState.encounteredFactions = [member];
  mkdirSync(exportsDirectory, { recursive: true });
  const target = path.join(exportsDirectory, file);
  writeFileSync(target, JSON.stringify(save));
  return target;
}

async function importSave(page: Page, file: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([{ name: path.basename(file), mimeType: 'application/json', buffer: readFileSync(file) }]);
}

/** The tab of the factions toggles, so a view that is already open on them must not be closed again. */
async function openHierarchy(page: Page): Promise<ReturnType<Page['locator']>> {
  if (!await page.getByRole('button', { name: /Mill Watch/ }).first().isVisible()) {
    await page.getByTestId('side-tab-Factions').click();
  }
  await page.getByRole('button', { name: /Mill Watch/ }).first().click();
  await page.getByRole('button', { name: /^Hierarchy & Standing$/ }).first().click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  return dialog;
}

const rowsOf = (dialog: ReturnType<Page['locator']>) =>
  dialog.locator('div[class*="p-4"][class*="rounded-lg"][class*="border-l-4"]');

test('the ladder of a faction marks the rows that state an unreachable threshold', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await importSave(page, writeHierarchySave('Member', 'faction-hierarchy-save.json'));
  await expect(page.getByTestId('chat-window')).toBeVisible();

  // The card of the faction already says it: two of its ranks ask for what the rules cannot give, and
  // the card is where the standing and the projects of a faction are listed, so both lines sit there.
  await page.getByTestId('side-tab-Factions').click();
  const cardNotes = page.getByTestId('world-state-notes-inline');
  await expect(cardNotes).toHaveCount(1);
  await expect(cardNotes.locator('p')).toHaveCount(2);
  await expect(cardNotes.locator('p').nth(0)).toContainText('Legend');
  await expect(cardNotes.locator('p').nth(0)).toContainText('450');
  await expect(cardNotes.locator('p').nth(1)).toContainText('Ghost');

  const dialog = await openHierarchy(page);

  // The hierarchy view keeps each mark with the row that earned it, and says nothing about the rest.
  await expect(rowsOf(dialog)).toHaveCount(5);
  await expect(rowsOf(dialog).filter({ hasText: 'Legend' }).locator('[data-testid="world-state-notes-inline"]')).toHaveCount(1);
  await expect(rowsOf(dialog).filter({ hasText: 'Ghost' }).locator('[data-testid="world-state-notes-inline"]')).toHaveCount(1);
  await expect(rowsOf(dialog).filter({ hasText: 'Veteran' }).locator('[data-testid="world-state-notes-inline"]')).toHaveCount(0);
  await expect(rowsOf(dialog).filter({ hasText: 'Member' }).locator('[data-testid="world-state-notes-inline"]')).toHaveCount(0);

  // A row quotes the number it itself asks for, and only where a number was stated.
  await expect(rowsOf(dialog).filter({ hasText: 'Veteran' })).toContainText('requires 275 reputation');
  await expect(rowsOf(dialog).filter({ hasText: 'Ghost /' })).not.toContainText('requires');
  await expect(rowsOf(dialog).filter({ hasText: 'Legend' })).toContainText('requires 450 reputation');

  // What the next rank asks for is named once, beside the rank the player holds - #21.2.5 promotes
  // against that number, and it is no longer printed as the demand of the rank already reached.
  await expect(dialog.getByTestId('faction-next-rank')).toHaveCount(1);
  await expect(dialog.getByTestId('faction-next-rank')).toContainText('next rank Veteran at 275 reputation');

  // One band in the whole panel, no raw keys, no crash.
  await expect(page.getByTestId('world-state-notes')).toHaveCount(0);
  await expect(page.getByText(/world_notes_/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a rank the ladder does not carry is named as a contradiction, not as a highlight', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await importSave(page, writeHierarchySave('Blade of Dawn', 'faction-hierarchy-unlisted-save.json'));
  await expect(page.getByTestId('chat-window')).toBeVisible();

  const dialog = await openHierarchy(page);

  // The panel repeats the title the faction states, and the ladder has no row to mark as held.
  await expect(dialog.getByText('Blade of Dawn').first()).toBeVisible();
  await expect(rowsOf(dialog).filter({ hasText: 'Legend' })).toHaveCount(1);
  await expect(rowsOf(dialog).filter({ hasText: 'Legend' })).not.toHaveClass(/border-cyan-500/);
  await expect(dialog.getByTestId('faction-next-rank')).toHaveCount(0);

  const held = dialog.getByTestId('world-state-notes-inline').first();
  await expect(held).toContainText('Blade of Dawn');
  await expect(held).toContainText('no rank of the faction carries that name');

  await expect(page.getByTestId('world-state-notes')).toHaveCount(0);
  await expect(page.getByText(/world_notes_/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
