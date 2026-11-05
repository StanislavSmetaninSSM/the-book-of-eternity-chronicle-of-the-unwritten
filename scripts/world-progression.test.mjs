import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shouldRunWorldProgression } from '../utils/worldProgression.js';

test('world progression requires a request and an enabled setting', () => {
  assert.equal(shouldRunWorldProgression(true, { doNotUseWorldEvents: true }), false);
  assert.equal(shouldRunWorldProgression(true, { doNotUseWorldEvents: false }), true);
  assert.equal(shouldRunWorldProgression(true, {}), true);
  assert.equal(shouldRunWorldProgression(false, {}), false);
  assert.equal(shouldRunWorldProgression(undefined, {}), false);
});

test('question path applies the same gate before requesting world progression', async () => {
  const source = await readFile(new URL('../hooks/logic/turn.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(shouldRunWorldProgression\(finalResponse\.generateWorldProgression, context\.gameSettings\)\)\s*\{/);
});
