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

    // The typefaces are bundled too: no Google Fonts request, and Inter really renders.
    const externalAssets = await page.evaluate(() => performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(url => /fonts\.(googleapis|gstatic)\.com|cdn\.tailwindcss\.com/.test(url)));
    expect(externalAssets).toEqual([]);
    const fonts = await page.evaluate(async () => {
      const [inter, lora] = await Promise.all([
        document.fonts.load('16px Inter'),
        document.fonts.load('16px Lora'),
        document.fonts.load('italic 16px Lora'),
      ]);
      const woff2 = performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(url => url.endsWith('.woff2'));
      return { inter: inter.length, lora: lora.length, downloaded: woff2.length, external: woff2.filter(url => !url.startsWith(location.origin)) };
    });
    expect(fonts.inter).toBeGreaterThan(0);
    expect(fonts.lora).toBeGreaterThan(0);
    expect(fonts.downloaded).toBeGreaterThan(0);
    expect(fonts.external).toEqual([]);
  });
});
