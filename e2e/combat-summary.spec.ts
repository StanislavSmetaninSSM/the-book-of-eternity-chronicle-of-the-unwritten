import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(e2eDirectory, 'fixtures', 'full-party-save.json');
const exportsDirectory = path.join(e2eDirectory, '..', 'test-results', 'exports');

/**
 * The combat panel reads the fight back from the state and re-computes the arithmetic the turn
 * logged. The fixture below is a synthetic save: two enemies whose numbers add up, one of the
 * logged calculations deliberately wrong, and an inventory heavy enough to overload the player.
 */
const enemies = [
  {
    NPCId: 'goblin-1', name: 'Goblin', description: 'A small creditor with a knife.', type: 'Weak',
    maxHealth: '100%', currentHealth: '40%', actions: [], wounds: [],
  },
  {
    name: 'Wolf pack', isGroup: true, count: 2, healthStates: ['60%', '60%'],
    description: 'Two wolves, both fed.', type: 'Frail', maxHealth: '60%', currentHealth: '60%', actions: [],
  },
];

function writeCombatSave(): string {
  const save = JSON.parse(readFileSync(fixturePath, 'utf8'));
  save.gameContext.gameSettings = { ...(save.gameContext.gameSettings || {}), language: 'en' };
  save.gameState.enemiesData = enemies;
  save.gameState.alliesData = [];
  save.gameLog = [
    'Wolf pack weight: 30 + 15 = 45kg',
    'Goblin armor: 40 * 0.7 = 27%',
  ];
  // One item so heavy that the character is overloaded by it: the panel must say so, because the
  // flag is now recomputed while the save is being read rather than trusted from the file.
  const player = save.gameState.playerCharacter;
  player.inventory = [...(player.inventory || []), { existedId: 'lead', name: 'Sack of lead', weight: 999, count: 1, quality: 'Common' }];
  player.isOverloaded = false;
  mkdirSync(exportsDirectory, { recursive: true });
  const target = path.join(exportsDirectory, 'combat-summary-save.json');
  writeFileSync(target, JSON.stringify(save));
  return target;
}

async function importSave(page: Page, file: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([{ name: path.basename(file), mimeType: 'application/json', buffer: readFileSync(file) }]);
}

test('the combat panel sums the fight up and flags the calculation that does not add up', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  const save = writeCombatSave();
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await importSave(page, save);
  await expect(page.getByTestId('chat-window')).toBeVisible();

  await page.getByTestId('side-tab-Combat').click();

  const summary = page.getByTestId('combat-summary');
  await expect(summary).toBeVisible();
  // 40% of the goblin and 100% of each wolf average out to 70%; both are still standing.
  await expect(summary).toContainText('2 of 2 standing · 70% health · 0 wounds · 0 effects');
  await expect(summary).toContainText('You: 100% health');
  await expect(summary).toContainText('overloaded');
  await expect(summary).toContainText('1 of 2 logged calculations do not add up');
  await expect(summary).toContainText('Goblin armor: 40 * 0.7 = 27% · 27 ≠ 28');
  // The enemy lists are untouched by the summary: the cards are still there below it.
  await expect(page.getByText('Goblin').first()).toBeVisible();
  await expect(page.getByText('Wolf pack').first()).toBeVisible();

  expect(errors).toEqual([]);
});
