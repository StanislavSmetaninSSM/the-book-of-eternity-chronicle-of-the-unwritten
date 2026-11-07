// Prepares a Chromium that runs without the system NSS libraries Debian usually provides.
// Playwright downloads its own browser, but in a sandbox with no network to the Playwright
// CDN and no libnss3/libnspr4/libnssutil3, the npm-hosted `@sparticuz/chromium` build plus
// its bundled AL2023 libraries is the smallest working substitute.
//
// Usage:
//   npm i --no-save @sparticuz/chromium puppeteer-core   # not a project dependency
//   node scripts/prepare-sandbox-chromium.mjs
//   LD_LIBRARY_PATH=/tmp/al2023/lib npx playwright test --config=playwright.sandbox.config.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const LIB_DIRECTORY = '/tmp/al2023/lib';

const chromium = await import('@sparticuz/chromium').then(module => module.default ?? module.chromium).catch(() => null);
if (!chromium) {
  console.error('@sparticuz/chromium is not installed. Run: npm i --no-save @sparticuz/chromium');
  process.exit(1);
}

const executablePath = await chromium.executablePath();
console.log(`Chromium: ${executablePath}`);

// The package restricts its `exports`, so resolve the entry point and walk to `bin/`.
const packageRoot = path.dirname(path.dirname(require.resolve('@sparticuz/chromium')));
const archive = path.join(packageRoot, 'bin', 'al2023.tar.br');
const tarball = '/tmp/al2023.tar';
writeFileSync(tarball, brotliDecompressSync(readFileSync(archive)));
mkdirSync('/tmp/al2023', { recursive: true });
execFileSync('tar', ['-xf', tarball, '-C', '/tmp/al2023']);
console.log(`Shared libraries: ${LIB_DIRECTORY}`);
console.log('If chromium still cannot find libnss3, check that the extracted directory matches the path above.');
