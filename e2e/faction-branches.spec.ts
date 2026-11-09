import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(e2eDirectory, 'fixtures', 'full-party-save.json');
const exportsDirectory = path.join(e2eDirectory, '..', 'test-results', 'exports');

const rank = (name: string, requiredReputation: number, extra = {}) => ({
  rankNameMale: name,
  rankNameFemale: `${name}a`,
  requiredReputation,
  benefits: [`${name} benefit`],
  ...extra,
});

/**
 * A faction is a web of ids the panel itself dereferences: the ladder of the branch a member walks is
 * chosen by `playerBranch`, and the paths a junction rank offers are looked up among the branches of
 * the same faction. #23.A keeps both to ids that exist - "The 'branchId' of the specialized branch the
 * player has chosen. It is 'null' while the player is on the 'coreBranch'", and the array of paths "MUST
 * be present if 'isJunctionPoint' is 'true'" - so a name missing from the faction is not a style choice:
 * the panel falls back to another ladder, and an offered path with no branch behind it is printed to the
 * player as its raw id.
 */
function writeBranchesSave(): string {
  const save = JSON.parse(readFileSync(fixturePath, 'utf8'));
  save.gameContext.gameSettings = { ...(save.gameContext.gameSettings || {}), language: 'en' };
  const faction = {
    factionId: 'f-branches',
    name: 'Mill Watch',
    description: 'A watch that keeps the mills of the valley.',
    reputation: 210,
    reputationDescription: 'Friendly',
    isPlayerMember: true,
    playerRank: 'Initiate',
    // A branch the faction does not have: the view shows its core ladder while the save says otherwise.
    playerBranch: 'cult',
    activeProjects: [],
    completedProjects: [],
    ranks: {
      branches: [
        {
          branchId: 'core',
          displayName: 'Watch',
          isCoreBranch: true,
          ranks: [
            rank('Initiate', 125),
            rank('Elder', 200, { isJunctionPoint: true, availableBranches: [] }),
            rank('Warden', 210, { isJunctionPoint: true, availableBranches: ['arms', 'void'] }),
          ],
        },
        { branchId: 'arms', displayName: 'Arms', isCoreBranch: false, ranks: [rank('Shield', 200)] },
      ],
    },
  };
  save.gameContext.encounteredFactions = [faction];
  save.gameState.encounteredFactions = [faction];
  mkdirSync(exportsDirectory, { recursive: true });
  const target = path.join(exportsDirectory, 'faction-branches-save.json');
  writeFileSync(target, JSON.stringify(save));
  return target;
}

async function importSave(page: Page, file: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([{ name: path.basename(file), mimeType: 'application/json', buffer: readFileSync(file) }]);
}

test('the ids a faction points at are checked where the panel reads them', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await importSave(page, writeBranchesSave());
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await page.getByTestId('side-tab-Factions').click();

  // The card of the faction carries all three: the branch it does not have, and the two junction ranks.
  const cardNotes = page.getByTestId('world-state-notes-inline');
  await expect(cardNotes).toHaveCount(1);
  await expect(cardNotes.locator('p')).toHaveCount(3);
  await expect(cardNotes).toContainText('cult');

  await page.getByRole('button', { name: /Mill Watch/ }).first().click();
  await page.getByRole('button', { name: /^Hierarchy & Standing$/ }).first().click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  const rows = dialog.locator('div[class*="p-4"][class*="rounded-lg"][class*="border-l-4"]');
  await expect(rows).toHaveCount(3);

  // A junction rank with an empty list shows a heading with nothing to pick, and says so.
  const elder = rows.filter({ hasText: 'Elder' });
  await expect(elder).toContainText('Available paths');
  await expect(elder.locator('div[class*="border-t"] ul').locator('li')).toHaveCount(0);
  await expect(elder.locator('[data-testid="world-state-notes-inline"] p')).toHaveCount(1);
  await expect(elder).toContainText('lists no branches to move into');

  // A path that leads to no branch is printed as its raw id - and named as one.
  const warden = rows.filter({ hasText: 'Warden' });
  await expect(warden).toContainText('void');
  await expect(warden.locator('div[class*="border-t"] ul').locator('li')).toHaveCount(2);
  await expect(warden.locator('[data-testid="world-state-notes-inline"] p')).toContainText('offers void');
  await expect(warden.locator('[data-testid="world-state-notes-inline"] p')).toContainText('no such branch');

  // The rank the player holds is highlighted in the ladder shown, while the branch the save names is
  // said once, in the box of the member - the panel fell back, and the line tells the player so.
  await expect(rows.filter({ hasText: 'Initiate' }).locator('[data-testid="world-state-notes-inline"]')).toHaveCount(0);
  const box = dialog.locator('div[class*="bg-cyan-900/40"]');
  await expect(box).toContainText('Your Rank');
  await expect(box.locator('[data-testid="world-state-notes-inline"] p')).toContainText('placed in the branch "cult"');

  await expect(page.getByTestId('world-state-notes')).toHaveCount(0);
  await expect(page.getByText(/world_notes_/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
