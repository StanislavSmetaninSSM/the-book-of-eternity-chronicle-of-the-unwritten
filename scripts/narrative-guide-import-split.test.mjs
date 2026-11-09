import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
const gameLogic = read('hooks/useGameLogic.ts');
const gemini = read('utils/gemini.ts');

test('the narrative style guide stays dynamically loaded in the browser', () => {
  assert.match(gameLogic, /import\(['"]\.\.\/prompts\/narrativeStyleGuide\.js['"]\)/);
  assert.doesNotMatch(gameLogic, /^\s*import\s+.*narrativeStyleGuide\.js/m, 'the game hook must not statically import the guide');
  assert.match(gemini, /import\(['"]\.\.\/prompts\/narrativeStyleGuide\.js['"]\)/);
});
