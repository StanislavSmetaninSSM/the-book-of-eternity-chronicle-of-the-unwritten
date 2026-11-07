import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTestServer, closeTestServer } from './helpers/testServer.mjs';

/**
 * `t()` returns its own key when a translation is missing. That is harmless for a readable
 * English key, but a key like `turn_passed_to` reaches the player as a raw identifier with
 * its interpolated values dropped - which is exactly what happened to the turn handover
 * message. This guard keeps such keys out of the source.
 */
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceRoots = ['components', 'hooks', 'utils'];
const skip = /[\\/]utils[\\/]translations[\\/]/;

const collectFiles = (directory, files = []) => {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) collectFiles(full, files);
    else if (/\.(ts|tsx)$/.test(entry) && !skip.test(full)) files.push(full);
  }
  return files;
};

const usedKeys = () => {
  const keys = new Map();
  for (const directory of sourceRoots) {
    for (const file of collectFiles(path.join(root, directory))) {
      const source = readFileSync(file, 'utf8');
      const pattern = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
      let match;
      while ((match = pattern.exec(source))) {
        const key = match[2];
        if (!key || key.length > 200 || key.includes('\n')) continue;
        if (!keys.has(key)) keys.set(key, new Set());
        keys.get(key).add(path.relative(root, file));
      }
    }
  }
  return keys;
};

/**
 * A readable label such as "Items" or "kg" needs no dictionary entry: the key is already
 * the text. Identifiers do: `turn_passed_to` (snake_case) or `questBackground` (camelCase).
 */
const isOpaque = (key) => !/\s/.test(key)
  && (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(key) || /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(key));

test('every identifier-like translation key is defined', async () => {
  const vite = await getTestServer();
  try {
    const { translations } = await vite.ssrLoadModule('/utils/localizationTranslations.ts');
    const keys = usedKeys();
    assert.ok(keys.size > 500, `expected a broad sample of keys, got ${keys.size}`);

    const missing = [...keys.entries()]
      .filter(([key]) => isOpaque(key) && !(key in translations.en))
      .map(([key, files]) => `${key} (${[...files].slice(0, 2).join(', ')})`);
    assert.deepEqual(missing, [], `add these keys to the dictionaries: ${missing.join('; ')}`);

    // English is the source of truth for the UI; a key added there must exist in Russian.
    const untranslated = Object.keys(translations.en).filter(key => !(key in translations.ru));
    assert.deepEqual(untranslated.slice(0, 10), [], 'these keys exist in en but not in ru');
  } finally {
    await closeTestServer();
  }
});
