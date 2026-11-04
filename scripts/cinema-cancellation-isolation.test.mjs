import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

test('cinema generation and game turns use separate cancellation scopes', async () => {
  const source = await readFile(new URL('../hooks/useGameLogic.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('useGameLogic.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const variables = new Map();
  const visit = node => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) variables.set(node.name.text, node.getText(ast)); ts.forEachChild(node, visit); };
  visit(ast);
  for (const name of ['generateFilmTrailer', 'continueFilmTrailer']) {
    const operation = variables.get(name); assert.ok(operation, name);
    assert.match(operation, /cinemaAbortControllerRef\.current = cinemaController/);
    assert.match(operation, /cinemaController\.signal/);
    assert.doesNotMatch(operation, /\babortControllerRef\b/);
    assert.match(operation, /cinemaAbortControllerRef\.current === cinemaController/);
  }
  const cancel = variables.get('cancelCinemaGeneration');
  assert.match(cancel, /cinemaAbortControllerRef\.current\.abort\(\)/);
  assert.doesNotMatch(cancel, /\babortControllerRef\b/);
  const turn = new AbortController(), cinema = new AbortController();
  cinema.abort(); assert.equal(turn.signal.aborted, false); assert.equal(cinema.signal.aborted, true);
  const otherCinema = new AbortController(); turn.abort(); assert.equal(otherCinema.signal.aborted, false);
});
