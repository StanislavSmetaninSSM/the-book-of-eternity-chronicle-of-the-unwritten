/**
 * The dev server answers requests for prompt modules straight from disk (see
 * `servePromptSourcesVerbatim` in vite.config.ts), because the transform pipeline can
 * only add a sourcemap to them, and megabytes of prose make that map six times the text.
 *
 * That shortcut is only correct while these modules stay plain, self-contained ESM, so
 * this test keeps them that way. It guards the dev-server config, not the text: the
 * rulebook's content is pinned in scripts/prompt-separation.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const promptsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

const collectJavaScriptModules = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJavaScriptModules(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files.sort();
};

/**
 * esbuild reads the module as plain JavaScript — TypeScript or JSX syntax is an error —
 * and its metafile reports the real import specifiers, which a textual scan cannot do here:
 * the rulebook is prose and mentions `from '...'` inside its own sentences.
 */
const analyze = async (file) => {
  const code = await readFile(file, 'utf8');
  const result = esbuild.buildSync({
    stdin: { contents: code, resolveDir: path.dirname(file), sourcefile: path.basename(file), loader: 'js' },
    bundle: true,
    // Nothing is followed; the point is the specifier list, not the graph.
    external: ['*'],
    metafile: true,
    write: false,
    format: 'esm',
    target: 'esnext',
    logLevel: 'silent',
  });
  const input = Object.entries(result.metafile.inputs).find(([id]) => id.endsWith(path.basename(file)));
  return (input?.[1]?.imports ?? []).map(entry => entry.path);
};

test('every prompt module is plain JavaScript a browser can run verbatim', async () => {
  const files = await collectJavaScriptModules(promptsDirectory);
  assert.ok(files.length >= 8, `expected the prompt modules to be found, saw ${files.length}`);
  for (const file of files) {
    const relative = path.relative(promptsDirectory, file);
    await assert.doesNotReject(async () => analyze(file), undefined, `${relative}: must parse as plain JavaScript`);
  }
});

test('every prompt module imports only relative paths a browser can resolve itself', async () => {
  for (const file of await collectJavaScriptModules(promptsDirectory)) {
    const relative = path.relative(promptsDirectory, file);
    for (const specifier of await analyze(file)) {
      assert.match(
        specifier,
        /^\.{1,2}\/[^'"]+\.js$/,
        `${relative}: "${specifier}" needs Vite's import rewriting, so it may not be served verbatim`,
      );
    }
  }
});
