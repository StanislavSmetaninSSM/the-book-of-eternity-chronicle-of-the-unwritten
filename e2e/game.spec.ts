import { test, expect, Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const fixturePath = (name: string) => path.join(fixturesDirectory, name);

/** The app imports saves through a transient <input type="file">, so use the file chooser. */
async function importSave(page: Page, fixtureName: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('load-from-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(fixturePath(fixtureName));
}

test.describe('single-player chronicle', () => {
  test('a full-party save opens, shows both characters and hands the turn over', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });

    await page.goto('/');
    await expect(page.getByTestId('start-screen')).toBeVisible();

    await importSave(page, 'full-party-save.json');
    await expect(page.getByTestId('chat-window')).toContainText('Aetheria');

    await page.getByTestId('side-tab-Characters').click();
    await expect(page.getByTestId('players-panel')).toBeVisible();
    await expect(page.getByTestId('players-panel')).toContainText('Aria');
    await expect(page.getByTestId('players-panel')).toContainText('Borin');

    // The active character cannot hand the turn to itself.
    await expect(page.getByTestId('pass-turn-0')).toBeDisabled();
    await expect(page.getByTestId('pass-turn-1')).toBeEnabled();

    await page.getByTestId('pass-turn-1').click();
    await expect(page.getByTestId('pass-turn-1')).toBeDisabled();
    await expect(page.getByTestId('pass-turn-0')).toBeEnabled();
    await expect(page.getByTestId('chat-window')).toContainText('Borin');

    expect(pageErrors.filter(message => !/favicon/i.test(message))).toEqual([]);
  });

  test('a legacy networked save opens as a local party without network controls', async ({ page }) => {
    await page.goto('/');
    await importSave(page, 'legacy-network-save.json');

    await expect(page.getByTestId('chat-window')).toBeVisible();
    await page.getByTestId('side-tab-Characters').click();
    await expect(page.getByTestId('players-panel')).toContainText('Cyra');

    // The removed networking UI must not come back in any form.
    await expect(page.getByRole('button', { name: /host|join|connect|sync|peer/i })).toHaveCount(0);
    await expect(page.getByText(/waiting for the host|connected to host|sync/i)).toHaveCount(0);
  });
});
