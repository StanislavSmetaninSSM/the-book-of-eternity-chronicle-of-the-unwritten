import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(e2eDirectory, 'fixtures', 'full-party-save.json');
const exportsDirectory = path.join(e2eDirectory, '..', 'test-results', 'exports');

function writeCinemaSave(): string {
  const save = JSON.parse(readFileSync(fixturePath, 'utf8'));
  save.gameState.cinematics = [
    {
      id: 'cin-1',
      title: 'Ashes over the guild',
      frames: [
        { imageUrl: '', subtitle: 'The first frame' },
        { imageUrl: '', subtitle: 'The second frame' },
      ],
      // A cinematic with a soundtrack: this is what used to be impossible to silence.
      audio_base64: 'AAAA',
    },
  ];
  save.gameContext.cinematics = save.gameState.cinematics;
  mkdirSync(exportsDirectory, { recursive: true });
  const target = path.join(exportsDirectory, 'cinema-save.json');
  writeFileSync(target, JSON.stringify(save));
  return target;
}

async function importSave(page: Page, file: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([{ name: path.basename(file), mimeType: 'application/json', buffer: readFileSync(file) }]);
}

test('a cinematic with sound can be muted and unmuted without rewinding', async ({ page }) => {
  const save = writeCinemaSave();
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await importSave(page, save);
  await expect(page.getByTestId('chat-window')).toBeVisible();

  await page.getByTestId('side-tab-CinemaHall').click();
  // Cards show their actions only when expanded.
  await page.getByText('Ashes over the guild').click();
  await page.getByRole('button', { name: /^Play$/ }).first().click();

  const mute = page.getByTestId('cinema-mute');
  await expect(mute).toBeVisible();
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await expect(mute).toHaveAttribute('aria-label', 'Mute');
  const subtitle = await page.locator('.cinema-subtitle').textContent();

  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect(mute).toHaveAttribute('aria-label', 'Unmute');
  await expect(page.locator('.cinema-subtitle')).toHaveText(subtitle || '');

  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await expect(mute).toHaveAttribute('aria-label', 'Mute');
});
