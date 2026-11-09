import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assessHierarchy, assessWorld, rankRowKey } from '../utils/worldAssessment.js';
import { getGameMasterGuideRules } from '../prompts/mainPromptModule.js';

/**
 * #21.2.5 asks a faction to hold a ladder of ranks whose `requiredReputation` sits on the -400..+400
 * scale, and promotes whoever reaches it; #21.2.6 lets a rank awarded for a great deed be invented on
 * the spot, inserted "usually at the very top" with the reputation the player already has. A threshold
 * outside the scale therefore can never be met, a threshold that is not a number cannot be compared,
 * and a rank named as held but absent from the ladder leaves the panel with nothing to highlight. The
 * order of the thresholds is left alone, because the second rule decides it on purpose.
 *
 * Run from the repository root with: node --test scripts/faction-hierarchy.test.mjs
 */

const rank = (name, requiredReputation) => ({
    rankNameMale: name,
    rankNameFemale: `${name}a`,
    ...(requiredReputation === undefined ? {} : { requiredReputation }),
    benefits: [],
});

const branch = (ranks, branchId = 'core') => ({ branchId, displayName: 'Watch', isCoreBranch: true, ranks });
const faction = (ranks, extra = {}) => ({
    factionId: 'fac-mill', name: 'Mill Watch', reputation: 210, isPlayerMember: true,
    playerRank: 'Member', playerBranch: 'core',
    // an array is one branch of ranks, an object is already the shape `faction.ranks` holds
    ranks: Array.isArray(ranks) ? { branches: [branch(ranks)] } : ranks,
    ...extra,
});

const kindsOf = (result) => result.notes.map(note => `${note.key.replace('world_notes_', '')}:${note.params.rank}`);

test('a ladder the rules could have drawn says nothing', () => {
  const standard = faction([rank('Initiate', 125), rank('Member', 200), rank('Veteran', 275), rank('Champion', 350)]);
  assert.deepEqual(assessHierarchy(standard, 'Mill Watch').notes, [], 'the example progression of #21.2.5 is the shape of a whole ladder');
  assert.deepEqual(assessHierarchy(faction([rank('Initiate', '200'), rank('Member', 0)]), 'Mill Watch').notes, [],
    'a threshold written as text is still the number the panel quotes, and zero is on the scale');
});

test('a threshold the scale cannot reach is named with both its ends', () => {
  const result = assessHierarchy(faction([rank('Initiate', 125), rank('Member', 200), rank('Legend', 450)]), 'Mill Watch');
  assert.deepEqual(kindsOf(result), ['rank_threshold_out_of_range:Legend'], 'the rank out of reach is the one asked about');
  assert.deepEqual(result.notes[0].params, { subject: 'Mill Watch', rank: 'Legend', value: 450, floor: -400, ceiling: 400 },
    'and the line carries the pair the reader compared against');

  const below = assessHierarchy(faction([rank('Outcast', -500), rank('Initiate', 125), rank('Member', 200)]), 'Mill Watch');
  assert.deepEqual(kindsOf(below), ['rank_threshold_out_of_range:Outcast'], 'the other end of the scale is a threshold too');

  const atTheEnd = assessHierarchy(faction([rank('Initiate', 125), rank('Member', 200), rank('Legend', 400)]), 'Mill Watch');
  assert.deepEqual(atTheEnd.notes, [], 'the end of the scale is inside it');
});

test('a rank that states no threshold cannot be compared against', () => {
  const result = assessHierarchy(faction([rank('Initiate'), rank('Member', 'two hundred')]), 'Mill Watch');
  assert.deepEqual(kindsOf(result), ['rank_threshold_unreadable:Initiate', 'rank_threshold_unreadable:Member'],
    'an absent number and a number written as words are the same silence in the promotion rule');
  assert.equal(result.notes[0].params.value, undefined, 'and nothing is invented for a value that was not stated');
});

test('the ladder the story rearranged is not a contradiction', () => {
  const unique = faction([rank('Initiate', 125), rank('Member', 200), rank('Champion', 350), rank('Hero of the Mill', 100)]);
  assert.deepEqual(assessHierarchy(unique, 'Mill Watch').notes, [],
    '#21.2.6 puts a rank awarded for a great deed at the top with the standing the player has, above a higher number');
  const twins = faction([rank('Member', 200), rank('Hero', 200)]);
  assert.deepEqual(assessHierarchy(twins, 'Mill Watch').notes, [], 'two ranks at one threshold are the same decision, not an error');
});

test('the rank a faction says its member holds has to be one of its ranks', () => {
  const missing = assessHierarchy(faction([rank('Initiate', 125), rank('Member', 200)], { playerRank: 'Blade of Dawn' }), 'Mill Watch');
  assert.deepEqual(kindsOf(missing), ['rank_unlisted:Blade of Dawn'], 'a name no row carries leaves the highlight of the panel pointing at nothing');
  assert.deepEqual(missing.aboutHeld.length, 1, 'and it is a fact about the member, not about a row, so it comes back apart');

  const elsewhere = assessHierarchy({
      ...faction([rank('Initiate', 125), rank('Member', 200)], { playerRank: 'Shield', playerBranch: 'core' }),
      ranks: { branches: [branch([rank('Initiate', 125)]), branch([rank('Shield', 200)], 'arms')] },
  }, 'Mill Watch');
  assert.deepEqual(elsewhere.notes, [], 'a rank held in another branch of the same faction is held');

  const empty = assessHierarchy(faction([], { playerRank: 'Blade of Dawn', ranks: undefined }), 'Mill Watch');
  assert.deepEqual(empty.notes, [], 'a faction without a hierarchy never promised a row to hold the name');

  const none = assessHierarchy(faction([rank('Initiate', 125)], { playerRank: null }), 'Mill Watch');
  assert.deepEqual(none.notes, [], 'and no rank at all is the state before the first promotion, not a wrong one');
});

test('the marks belong to the row that earned them, and reach the card of the faction', () => {
  const target = faction([rank('Initiate', 125), rank('Legend', 450)]);
  const result = assessHierarchy(target, 'Mill Watch');
  assert.deepEqual(Object.keys(result.byRank), [rankRowKey('core', 1)], 'the row of the rank asked about, not the first one');
  assert.equal(result.byRank[rankRowKey('core', 1)][0].params.rank, 'Legend');
  assert.ok(result.byRank[rankRowKey('arms', 9)] === undefined, 'a row nobody asked about carries no notes');

  const wide = assessHierarchy(faction(
    { branches: [branch([rank('Initiate', 125), rank('Member', 900)], 'core'), branch([rank('Shield', 450)], 'arms')] },
    { playerRank: 'Initiate' },
  ), 'Mill Watch');
  assert.deepEqual(Object.keys(wide.byRank).sort(), [rankRowKey('arms', 0), rankRowKey('core', 1)].sort(),
    'branches are addressed apart, so a row of one branch never borrows the mark of another');
  assert.deepEqual(wide.byRank[rankRowKey('core', 1)].map(n => n.params.rank), ['Member'], 'and each row is asked about by its own name');

  const onCard = faction([rank('Initiate', 125), rank('Legend', 450)], { playerRank: 'Initiate' });
  assert.deepEqual(assessWorld({ factions: [onCard] }).notes.map(n => n.key), ['world_notes_rank_threshold_out_of_range'],
    'the card of the faction reads the ladder through the same reader');
  assert.deepEqual(assessWorld({ factions: [{ ...onCard, reputation: 900 }] }).notes.map(n => n.key),
    ['world_notes_standing_out_of_range', 'world_notes_rank_threshold_out_of_range'],
    'next to the standing it already read, and once for each fact');
});

test('the panel quotes the row it shows and promises only what the ladder holds', () => {
  const view = readFileSync(new URL('../components/DetailRenderer/FactionDetailsRenderer.tsx', import.meta.url), 'utf8');
  const strings = readFileSync(new URL('../utils/translations/ui/faction.ts', import.meta.url), 'utf8');
  const notes = readFileSync(new URL('../utils/translations/ui/common.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(view, /next rank at \{rep\} reputation/,
    'a row used to call its own threshold the next rank, which is a promise about a row further down');
  assert.match(view, /t\('requires \{rep\} reputation', \{ rep: threshold \}\)/, 'so a row states the number it itself asks for');
  assert.match(view, /data-testid="faction-next-rank"[\s\S]{0,160}next rank \{rank\} at \{rep\} reputation/,
    'and the promotion #21.2.5 decides is named once, next to the rank that was reached');
  assert.match(view, /hierarchy\.byRank\[rankRowKey\(activeBranch\.branchId, index\)\]/, 'the mark of a row is read off that row');
  assert.match(view, /hierarchy\.aboutHeld\.length/, 'the held rank is read off the member');

  for (const key of ['requires {rep} reputation', 'next rank {rank} at {rep} reputation']) {
    const asRegex = new RegExp(`^\\s*"${key.replace(/[{}]/g, '\\$&')}":`, 'gm');
    assert.equal((strings.match(asRegex) || []).length, 2, `${key} is answered in both locales`);
  }
  assert.doesNotMatch(strings, /"next rank at \{rep\} reputation"/, 'and the claim that was wrong is not kept as an orphan');

  for (const key of ['rank_threshold_out_of_range', 'rank_threshold_unreadable', 'rank_unlisted']) {
    assert.equal((notes.match(new RegExp(`"world_notes_${key}"`, 'g')) || []).length, 2, `the line for ${key} exists in both locales`);
  }
});

test('the rule the reader leans on is still the rule in the guide', () => {
  const lines = getGameMasterGuideRules().split('\n').map(line => line.trim());
  assert.ok(lines.some(line => line === 'Assign a \'requiredReputation\' for each rank.'),
    '#21.2.5 still asks a threshold per rank');
  assert.ok(lines.some(line => line.includes('-400 to +400 scale')),
    'and still places those thresholds on the scale the reader compares them against');
});
