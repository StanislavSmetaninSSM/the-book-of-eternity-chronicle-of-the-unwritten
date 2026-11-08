import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skipped = new Set(['node_modules', 'dist', '.git', 'test-results', 'playwright-report']);

// `: any` is an annotation only where a type is expected: after a parameter or
// variable name, a property key, or an arrow function's parameter list. Generic
// arguments such as `Record<string, unknown>` or `Promise<void>` are a separate,
// softer case and are not what this budget measures.
const annotationPattern = /:\s*any(?=\s*[,;)=|>&\]]|\s*$)/;

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

/** Every `: any` annotation, as `file:line` strings. */
const findAnyAnnotations = () => {
  const hits = [];
  for (const file of collect(root)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (annotationPattern.test(line)) hits.push(`${path.relative(root, file)}:${index + 1}`);
    });
  }
  return hits;
};

// The code base carried ~257 of these: every entity that crossed a component
// boundary, every legacy-save migration and the whole model payload were typed
// `any`, so the checker could not see them. They are gone; the budget stays at
// zero so they do not creep back. Raise it deliberately if a genuine case appears.
const MAX_ANY_ANNOTATIONS = 0;

test('no source file annotates a value as any', () => {
  const hits = findAnyAnnotations();
  assert.ok(
    hits.length <= MAX_ANY_ANNOTATIONS,
    `\`: any\` annotations found (${hits.length}, budget ${MAX_ANY_ANNOTATIONS}):\n${hits.join('\n')}`
  );
});
