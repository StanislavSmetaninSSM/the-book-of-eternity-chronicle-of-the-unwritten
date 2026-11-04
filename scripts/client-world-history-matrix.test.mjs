import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

test('world/history audit covers each exported player action and selected UI wiring', async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const [source, doc, hook, app, storage] = await Promise.all([
    read('hooks/logic/playerActions.ts'), read('docs/client-edit-world-history-matrix.md'),
    read('hooks/useGameLogic.ts'), read('App.tsx'), read('components/StorageScreen.tsx'),
  ]);
  const ast = ts.createSourceFile('playerActions.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let manager;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'createPlayerActionsManager') manager = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(manager);
  let result;
  function findReturn(node) {
    if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression) && (!result || node.expression.properties.length > result.properties.length)) result = node.expression;
    ts.forEachChild(node, findReturn);
  }
  findReturn(manager);
  assert.ok(result && result.properties.length >= 45);
  for (const prop of result.properties) {
    assert.ok(ts.isShorthandPropertyAssignment(prop));
    const rows = doc.match(new RegExp('^\\| `' + prop.name.text + '` \\|', 'gm')) || [];
    assert.equal(rows.length, 1, `expected exactly one row for ${prop.name.text}`);
  }
  assert.match(hook, /guardGameplayActions\(createPlayerActionsManager/);
  assert.match(app, /onMoveToStorage=\{moveToLocationStorage\}/);
  assert.match(app, /onRetrieveFromStorage=\{retrieveFromLocationStorage\}/);
  assert.match(storage, /onMoveToStorage\(locationId, currentStorage\.storageId, item, item\.count\)/);
  assert.match(storage, /onRetrieveFromStorage\(locationId, currentStorage\.storageId, item, item\.count\)/);
});
