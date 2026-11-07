import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skipped = new Set(['node_modules', 'dist', '.git', 'test-results', 'playwright-report']);

// `as any` is only a cast when it ends an expression: followed by `)`, `]`, `}`, `,`, `;`, `[` or
// the end of the line. English prose in a translation ("treated as any other outsider") is not.
const castPattern = /\bas any(?=[)\]},;[]|$)/;

const collect = (directory) => {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipped.has(entry.name)) continue;
      found.push(...collect(path.join(directory, entry.name)));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      found.push(path.join(directory, entry.name));
    }
  }
  return found;
};

/** Every cast that turns a typed value into any, as `file:line` strings. */
const findAnyCasts = () => {
  const hits = [];
  for (const file of collect(root)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (castPattern.test(line)) hits.push(`${path.relative(root, file)}:${index + 1}`);
    });
  }
  return hits;
};

// The game shipped ~280 of these, which silently disabled the checker on the load path, the turn
// processor and the whole start screen. They are gone; the budget stays at zero so they do not
// creep back. Raise it deliberately if a genuine case appears.
const MAX_ANY_CASTS = 0;

test('no source file casts a value to any', () => {
  const hits = findAnyCasts();
  assert.ok(
    hits.length <= MAX_ANY_CASTS,
    `as any casts found (${hits.length}, budget ${MAX_ANY_CASTS}):\n${hits.join('\n')}`
  );
});
