import { test, expect } from '@playwright/test';

test.describe('the build carries its own styles', () => {
  test('no Tailwind CDN is needed and utilities still apply', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('start-screen')).toBeVisible();

    // The CDN script used to be the only source of Tailwind utilities.
    const cdnTags = await page.evaluate(() => Array.from(document.querySelectorAll('script[src], link[href]'))
      .map(node => node.getAttribute('src') || node.getAttribute('href') || '')
      .filter(url => url.includes('cdn.tailwindcss.com')));
    expect(cdnTags).toEqual([]);

    // The stylesheet that styles the app is served from our own origin.
    const ownStylesheets = await page.evaluate(() => Array.from(document.styleSheets)
      .map(sheet => sheet.href)
      .filter((href): href is string => Boolean(href) && href.startsWith(window.location.origin)));
    expect(ownStylesheets.length).toBeGreaterThan(0);

    // `bg-gray-600` from the markup resolves, which proves the utilities are in the bundle.
    await expect(page.getByTestId('load-from-file')).toHaveCSS('background-color', 'rgb(75, 85, 99)');
  });
});
