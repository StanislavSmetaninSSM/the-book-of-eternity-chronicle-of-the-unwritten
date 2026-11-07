import base from './playwright.config';
import { defineConfig } from '@playwright/test';

/**
 * Config for environments without the Playwright browser download and without the system
 * NSS libraries (the Arena sandbox). Prepare a Chromium first:
 *
 *   npm i --no-save @sparticuz/chromium puppeteer-core
 *   node scripts/prepare-sandbox-chromium.mjs
 *   LD_LIBRARY_PATH=/tmp/al2023/lib npx playwright test --config=playwright.sandbox.config.ts
 *
 * CI keeps using `playwright.config.ts` with a regular Playwright browser.
 */
const libraryPath = process.env.SANDBOX_CHROMIUM_LIBS || '/tmp/al2023/lib';

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    // The sandbox has no Playwright-managed ffmpeg, so recording is off here.
    video: 'off',
    trace: 'off',
    launchOptions: {
      executablePath: process.env.SANDBOX_CHROMIUM_PATH || '/tmp/chromium',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      env: { ...process.env, LD_LIBRARY_PATH: libraryPath } as Record<string, string>,
    },
  },
});
