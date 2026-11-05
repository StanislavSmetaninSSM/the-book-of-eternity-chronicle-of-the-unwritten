import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getGameMasterGuideRules } from '../prompts/mainPromptModule.js';
import narrativeStyleGuide from '../prompts/narrativeStyleGuide.js';
import worldLogicGuide from '../prompts/worldLogicGuide.js';

const digest = text => createHash('sha256').update(text).digest('hex');
const documents = () => ({ rules: getGameMasterGuideRules(), narrative: narrativeStyleGuide.getGuide(), world: worldLogicGuide.getGuide() });
const makeIndex = rules => rules.split('\n').flatMap((line, index) => /<(?:Rule|RuleSet|GameMasterGuide_[A-Za-z]+)\b/.test(line) ? [`${index + 1}: ${line.trim().slice(0, 240)}`] : []).join('\n');

async function atomicWrite(file, text) {
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try { await writeFile(temp, text, { encoding: 'utf8', flag: 'wx' }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}

/** Materialize immutable, content-addressed rules for the local workspace agent. */
export async function ensureRuleBundle(relayDirectory) {
  const docs = documents();
  const hashes = Object.fromEntries(Object.entries(docs).map(([name, text]) => [name, digest(text)]));
  const index = makeIndex(docs.rules);
  hashes.index = digest(index);
  const id = digest(`arena-rule-bundle-v2\n${hashes.rules}\n${hashes.narrative}\n${hashes.world}`);
  const directory = path.resolve(relayDirectory, 'rule-bundles', id);
  const files = { rules: path.join(directory, 'rules.txt'), narrative: path.join(directory, 'narrative.txt'), world: path.join(directory, 'world.txt') };
  await mkdir(directory, { recursive: true });
  for (const name of Object.keys(docs)) {
    let valid = false;
    try { valid = digest(await readFile(files[name], 'utf8')) === hashes[name]; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!valid) await atomicWrite(files[name], docs[name]);
  }
  // Index line references without rewriting, omitting, or splitting source rules.
  const indexPath = path.join(directory, 'index.txt');
  let indexValid = false;
  try { indexValid = digest(await readFile(indexPath, 'utf8')) === hashes.index; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!indexValid) await atomicWrite(indexPath, index);
  return { version: 2, id, hashes, files, index: path.join(directory, 'index.txt') };
}

/** Reject a referenced request if its files changed or no longer exist. */
export async function verifyRuleBundle(relayDirectory, id) {
  if (!/^[a-f0-9]{64}$/.test(id || '')) return false;
  const docs = documents();
  const hashes = { rules: digest(docs.rules), narrative: digest(docs.narrative), world: digest(docs.world) };
  if (id !== digest(`arena-rule-bundle-v2\n${hashes.rules}\n${hashes.narrative}\n${hashes.world}`)) return false;
  try {
    for (const name of Object.keys(docs)) {
      if (digest(await readFile(path.join(relayDirectory, 'rule-bundles', id, `${name}.txt`), 'utf8')) !== hashes[name]) return false;
    }
    if (digest(await readFile(path.join(relayDirectory, 'rule-bundles', id, 'index.txt'), 'utf8')) !== digest(makeIndex(docs.rules))) return false;
    return true;
  } catch { return false; }
}
