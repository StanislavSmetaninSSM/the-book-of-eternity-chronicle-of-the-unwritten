/**
 * Cuts the game-master rulebook into one file per top-level section.
 *
 * The rulebook is a few megabytes of prose that every stage needs verbatim, so it
 * used to live in a single module the browser had to download and parse in one piece.
 * The sections are byte-identical to the original text: the assembled guide still
 * hashes to the digest pinned in scripts/prompt-separation.test.mjs.
 *
 *   node scripts/split-main-prompt.mjs --split         rewrite the section files from prompts/mainPromptModule.js
 *   node scripts/split-main-prompt.mjs --check         the sections still assemble into the pinned rulebook
 *   node scripts/split-main-prompt.mjs --print-digest  print the digest of the assembled guide
 *
 * After an intentional rulebook edit, run --print-digest and put the new digest into
 * scripts/prompt-separation.test.mjs in the same commit; that test is the review gate.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const monolithPath = path.join(repositoryRoot, 'prompts', 'mainPromptModule.js');
const sectionDirectory = path.join(repositoryRoot, 'prompts', 'mainPromptModule');
const testPath = path.join(repositoryRoot, 'scripts', 'prompt-separation.test.mjs');
const MAX_SECTION_BYTES = 400 * 1024;

const sha256 = text => createHash('sha256').update(text).digest('hex');

/** A section may only begin on a top-level or first-level opening tag. */
const isSectionStart = line => /^<[A-Za-z_]/.test(line) || /^ {4}<[A-Za-z_]/.test(line);

const escape = text => text
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${')
  .replace(/\r/g, '\\r');

const readPinnedDigest = async () => {
  const testSource = await readFile(testPath, 'utf8');
  const match = /assert\.equal\(sha256\(guide\), '([0-9a-f]{64})'\)/.exec(testSource);
  if (!match) throw new Error(`No pinned rulebook digest found in ${path.relative(repositoryRoot, testPath)}.`);
  return match[1];
};

const readAssembledGuide = async (modulePath) => {
  const module = await import(pathToFileURL(modulePath).href);
  return module.getGameMasterGuideRules();
};

const sectionNames = async () => (await readdir(sectionDirectory)).filter(name => /^section-\d+\.js$/.test(name)).sort();

const check = async () => {
  const assembled = await readAssembledGuide(path.join(sectionDirectory, 'index.js'));
  const digest = sha256(assembled);
  const pinned = await readPinnedDigest();
  if (digest !== pinned) {
    throw new Error(`The sections no longer assemble into the pinned rulebook (${digest} != ${pinned}). Restore the text, or update the digest in scripts/prompt-separation.test.mjs as part of a reviewed edit.`);
  }
  console.log(`OK: ${(await sectionNames()).length} sections assemble into the reviewed rulebook (${Buffer.byteLength(assembled, 'utf8')} bytes, ${digest}).`);
};

const split = async () => {
  const guide = await readAssembledGuide(monolithPath);
  const pinned = await readPinnedDigest();
  if (sha256(guide) !== pinned) {
    throw new Error(`Refusing to cut a rulebook that already differs from the pinned digest (${sha256(guide)} != ${pinned}).`);
  }
  const lines = guide.split('\n');

  const starts = [0];
  let bytes = 0;
  for (let index = 1; index < lines.length; index++) {
    bytes += Buffer.byteLength(lines[index], 'utf8') + 1;
    if (isSectionStart(lines[index]) && bytes > MAX_SECTION_BYTES) {
      starts.push(index);
      bytes = 0;
    }
  }
  const sections = starts.map((start, index) => ({
    start,
    end: starts[index + 1] ?? lines.length,
  })).map(section => ({ ...section, text: lines.slice(section.start, section.end).join('\n') }));

  await rm(sectionDirectory, { recursive: true, force: true });
  await mkdir(sectionDirectory, { recursive: true });
  const names = sections.map((_, index) => `section-${String(index + 1).padStart(2, '0')}.js`);
  for (const [index, section] of sections.entries()) {
    const openers = section.text.split('\n').filter(isSectionStart);
    const summary = openers.slice(0, 2).map(line => line.trim().slice(0, 72)).join(' … ') || 'preamble';
    await writeFile(path.join(sectionDirectory, names[index]), [
      `/* Section ${index + 1} of ${sections.length} of the game-master rulebook: ${summary}.`,
      `   Lines ${section.start + 1}-${section.end} (${Buffer.byteLength(section.text, 'utf8')} bytes) of the assembled guide.`,
      '   index.js joins the sections verbatim, so keep the text between the backticks character-exact;',
      '   scripts/split-main-prompt.mjs --check proves the result is still the reviewed rulebook.',
      '*/',
      `export const section = \`${escape(section.text)}\`;`,
      '',
    ].join('\n'), 'utf8');
  }

  await writeFile(path.join(sectionDirectory, 'index.js'), [
    '/*',
    ' * The game-master rulebook: the JSON schema and the per-stage instruction blocks.',
    ' *',
    ' * prompts/mainPromptModule.js re-exports this module. The text is stored as one file per',
    ' * section so the browser fetches the rulebook in parallel and a rules edit only invalidates',
    ' * the section it touched. Joining the sections with a newline reproduces the reviewed guide',
    ' * byte for byte; scripts/prompt-separation.test.mjs pins its digest and',
    ' * scripts/split-main-prompt.mjs --check runs that gate on demand.',
    ' */',
    sections.map((_, index) => `import { section as section${index + 1} } from './${names[index]}';`).join('\n'),
    '',
    '/**',
    ' * The complete guide. It is deliberately independent of the turn: every {{context.path}}',
    ' * reference stays symbolic and is resolved from the CurrentGameContext document the stage',
    ' * prompt carries. The context argument is accepted for call-site symmetry only.',
    ' */',
    'export const getGameMasterGuideRules = () => GAME_MASTER_GUIDE_SECTIONS.join(\'\\n\');',
    '',
    '/** The rulebook as its sections, in document order. */',
    'export const GAME_MASTER_GUIDE_SECTIONS = [',
    sections.map((_, index) => `  section${index + 1},`).join('\n'),
    '];',
    '',
  ].join('\n'), 'utf8');

  await writeFile(monolithPath, [
    '/*',
    ' * The rulebook lives in ./mainPromptModule/, one file per top-level section, so the guide',
    ' * downloads as several parallel chunks instead of one multi-megabyte file. This re-export',
    ' * keeps `import \'./mainPromptModule.js\'` working for the client, the relay rule bundle and',
    ' * the prompt tests; edit the section files, not this one.',
    ' */',
    "export { getGameMasterGuideRules, GAME_MASTER_GUIDE_SECTIONS } from './mainPromptModule/index.js';",
    '',
  ].join('\n'), 'utf8');

  await check();
  console.log(sections.map((section, index) => `  ${names[index]}: ${Math.round(Buffer.byteLength(section.text, 'utf8') / 1024)}k`).join('\n'));
};

const argument = process.argv[2];
if (argument === '--split') await split();
else if (argument === '--check') await check();
else if (argument === '--print-digest') console.log(sha256(await readAssembledGuide(path.join(sectionDirectory, 'index.js'))));
else {
  console.log('usage: node scripts/split-main-prompt.mjs --split | --check | --print-digest');
  await check();
}
