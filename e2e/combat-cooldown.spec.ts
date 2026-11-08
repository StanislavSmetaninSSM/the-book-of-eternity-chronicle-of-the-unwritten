import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(e2eDirectory, 'fixtures', 'full-party-save.json');
const exportsDirectory = path.join(e2eDirectory, '..', 'test-results', 'exports');

/**
 * #6.1.6.7 makes the wait of an NPC action strict and #12.9.3 has the client count it, so the card of
 * the fighter is where two facts about one action meet: the wait itself is shown on the row of the
 * action that waits, and a use that landed inside it is named under the card's header.
 *
 * The world is put on turn 7: 'Shield Bash' may be used again from turn 10 (and carries a recorded
 * early use), while 'Gore' is already free again from turn 6 and must say nothing.
 */
function writeCooldownSave(): string {
  const save = JSON.parse(readFileSync(fixturePath, 'utf8'));
  save.gameContext.gameSettings = { ...(save.gameContext.gameSettings || {}), language: 'en' };
  save.gameContext.currentTurnNumber = 7;
  save.gameState.enemiesData = [
    {
      NPCId: 'npc-kaelen', name: 'Kaelen the Guard', description: 'A guard with a timer.', type: 'Moderate',
      maxHealth: '100%', currentHealth: '100%',
      actions: [
        { actionName: 'Shield Bash', effects: [{ effectType: 'Control', value: '20%', targetType: 'stun', duration: 1, effectDescription: 'Stuns.' }] },
        { actionName: 'Gore', effects: [] },
      ],
      cooldowns: [
        {
          actionName: 'Shield Bash', lastUsedTurnNumber: 7, cooldownTurns: 3, readyFromTurn: 10,
          earlyUseTurnNumber: 7, earlyUseAgainstReadyFrom: 9,
        },
        { actionName: 'Gore', lastUsedTurnNumber: 2, cooldownTurns: 3, readyFromTurn: 5 },
      ],
    },
    {
      NPCId: 'npc-boar', name: 'Wild Boar', description: 'Short-tempered, unburdened.', type: 'Weak',
      maxHealth: '60%', currentHealth: '60%', actions: [{ actionName: 'Tusk', effects: [] }],
    },
  ];
  save.gameState.alliesData = [];
  mkdirSync(exportsDirectory, { recursive: true });
  const target = path.join(exportsDirectory, 'combat-cooldown-save.json');
  writeFileSync(target, JSON.stringify(save));
  return target;
}

async function importSave(page: Page, file: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([{ name: path.basename(file), mimeType: 'application/json', buffer: readFileSync(file) }]);
}

test('the card shows the wait on the action that waits, and names the use that arrived inside it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await importSave(page, writeCooldownSave());
  await expect(page.getByTestId('chat-window')).toBeVisible();

  await page.getByTestId('side-tab-Combat').click();

  // One chip in the fight: the action that is still waiting. The other one is free, and silence is
  // the correct reading of a cooldown that has run out.
  const chip = page.getByTestId('action-cooldown-chip');
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText("'Shield Bash' · ready from turn 10");

  // And the contradiction the count recorded is named under the header of the same card.
  const note = page.getByText('is reported used on turn 7');
  await expect(note).toHaveCount(1);
  await expect(note).toContainText('until turn 9');
  await expect(page.getByTestId('world-state-notes-inline')).toHaveCount(1);
  await expect(page.getByTestId('world-state-notes')).toHaveCount(0);
  await expect(page.getByText(/cooldown_notes_/)).toHaveCount(0);

  expect(errors).toEqual([]);
});
