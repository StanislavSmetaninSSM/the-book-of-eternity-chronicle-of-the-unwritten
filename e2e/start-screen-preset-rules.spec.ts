import { test, expect } from '@playwright/test';

test('the start screen fetches the preset pack of the selected universe only', async ({ page }) => {
  const packRequests: string[] = [];
  page.on('request', request => {
    if (/\/assets\/pack-[^/]*\.js$/.test(request.url())) packRequests.push(request.url());
  });

  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();

  // The description is only visible once the cultivation system is enabled, so the pack has
  // to be in memory by then — it is fetched when the start screen mounts with this universe.
  await page.getByText('Activate Cultivation System').click();
  await expect(page.locator('#cultivationSystemDescription')).toHaveValue(/.{200,}/s);

  expect(new Set(packRequests).size, `requested packs: ${packRequests.join(', ')}`).toBe(1);

  // Switching to another universe fetches its own pack and fills its own fields.
  await page.getByRole('button', { name: /Post-Apocalypse/i }).first().click();
  await page.getByText('Activate Hunger System').click();
  await expect(page.locator('#hungerSystemDescription')).toHaveValue(/.{200,}/s);
  expect(new Set(packRequests).size).toBe(2);
});
