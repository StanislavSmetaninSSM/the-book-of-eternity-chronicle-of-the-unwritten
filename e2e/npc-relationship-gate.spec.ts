import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(e2eDirectory, 'fixtures', 'full-party-save.json');
const exportsDirectory = path.join(e2eDirectory, '..', 'test-results', 'exports');

/**
 * #19.F locks a relationship at a cap and orders the standing clamped to that number, so a person
 * standing past their own gate is a state the transaction cannot write - and the panel is left showing
 * a number the next turn takes back. The card of that person carries both facts: the gate, said with
 * the wording the character sheet uses, and the pair of numbers the reader compared.
 */
function writeGateSave(): string {
  const save = JSON.parse(readFileSync(fixturePath, 'utf8'));
  save.gameContext.gameSettings = { ...(save.gameContext.gameSettings || {}), language: 'en' };
  save.gameState.encounteredNPCs = [
    {
      NPCId: 'npc-gated', name: 'Elara of the Ford', description: 'A ferrywoman with a ceiling.',
      level: 3, race: 'Human', class: 'Commoner',
      relationshipLevel: 130, attitude: 'Warm',
      relationshipLock: { isLocked: true, currentCap: 100, breakthroughQuestId: null },
    },
    {
      NPCId: 'npc-open', name: 'Bryn the Cooper', description: 'A cooper, still open.',
      level: 2, race: 'Human', class: 'Commoner',
      relationshipLevel: 90, attitude: 'Friendly',
      relationshipLock: { isLocked: true, currentCap: 100, breakthroughQuestId: null },
    },
  ];
  save.gameContext.encounteredNPCs = save.gameState.encounteredNPCs;
  mkdirSync(exportsDirectory, { recursive: true });
  const target = path.join(exportsDirectory, 'npc-relationship-gate-save.json');
  writeFileSync(target, JSON.stringify(save));
  return target;
}

async function importSave(page: Page, file: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([{ name: path.basename(file), mimeType: 'application/json', buffer: readFileSync(file) }]);
}

test('the card of a person names the gate and the standing that escaped it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await importSave(page, writeGateSave());
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await page.getByTestId('side-tab-NPCs').click();

  // Two people stand under the same cap; only the one past it is questioned.
  const gates = page.getByTestId('npc-relationship-gate');
  await expect(gates).toHaveCount(2);
  await expect(gates.nth(0)).toContainText('Cap: 100');

  const notes = page.getByTestId('world-state-notes-inline');
  await expect(notes).toHaveCount(1);
  await expect(notes).toContainText('relationship level 130 lies outside the gate');
  await expect(notes).toContainText('locked at 100');

  // The standing itself is still printed as the state holds it, and nothing is offered as a repair.
  await expect(page.getByText('Relationship: 130')).toHaveCount(1);
  await expect(page.getByText('Relationship: 90')).toHaveCount(1);
  await expect(page.getByTestId('world-state-notes')).toHaveCount(0);
  await expect(page.getByText(/world_notes_/)).toHaveCount(0);

  expect(errors).toEqual([]);
});
