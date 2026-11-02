import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getNarrativeRuleReference } from '../utils/arenaRuleReference.js';
import { ensureRuleBundle, verifyRuleBundle } from '../utils/arenaRuleBundle.js';
import { getGameMasterGuideRules } from '../prompts/mainPromptModule.js';
import narrative from '../prompts/narrativeStyleGuide.js';
import world from '../prompts/worldLogicGuide.js';

test('versioned bundle is complete, verified and repaired when corrupted', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rule-bundle-'));
  try {
    const bundle = await ensureRuleBundle(dir);
    assert.equal(await readFile(bundle.files.rules, 'utf8'), getGameMasterGuideRules());
    assert.equal(await readFile(bundle.files.narrative, 'utf8'), narrative.getGuide());
    assert.equal(await readFile(bundle.files.world, 'utf8'), world.getGuide());
    assert.equal(await verifyRuleBundle(dir, bundle.id), true);
    await writeFile(bundle.files.world, 'corrupted');
    assert.equal(await verifyRuleBundle(dir, bundle.id), false);
    assert.equal((await ensureRuleBundle(dir)).id, bundle.id);
    assert.equal(await verifyRuleBundle(dir, bundle.id), true);
    await writeFile(bundle.index, 'corrupted');
    assert.equal(await verifyRuleBundle(dir, bundle.id), false);
    assert.equal((await ensureRuleBundle(dir)).id, bundle.id);
    assert.equal(await verifyRuleBundle(dir, bundle.id), true);
    await writeFile(bundle.files.narrative, 'corrupted');
    assert.equal(await verifyRuleBundle(dir, bundle.id), false);
    assert.equal((await ensureRuleBundle(dir)).id, bundle.id);
    assert.equal(await verifyRuleBundle(dir, bundle.id), true);
    assert.equal(await verifyRuleBundle(dir, '../bad'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('mismatched or unavailable manifests do not cause the client to omit rules', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ version: 1, id: 'a'.repeat(64), hashes: { rules: 'b'.repeat(64), narrative: 'c'.repeat(64), index: 'd'.repeat(64) }, files: { rules: '/rules', narrative: '/style' }, index: '/index' });
    assert.equal(await getNarrativeRuleReference('actual rules', 'actual style'), null);
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal(await getNarrativeRuleReference('actual rules', 'actual style'), null);
  } finally { globalThis.fetch = oldFetch; }
});
