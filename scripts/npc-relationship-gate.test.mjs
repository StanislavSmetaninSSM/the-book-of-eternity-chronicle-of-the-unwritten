import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assessWorld } from '../utils/worldAssessment.js';
import { getTestServer, closeTestServer } from './helpers/testServer.mjs';
import { getGameMasterGuideRules } from '../prompts/mainPromptModule.js';

/**
 * #19.F writes a locked relationship as one transaction: the gate is set to the cap or the floor, and
 * the standing is clamped to that same number - "You MUST clamp the 'relationshipLevel' to the exact
 * cap value", and for a negative gate "You MUST clamp the 'relationshipLevel' to this floor value".
 * So a locked person standing past their gate is not a disagreement about the story: it is a state the
 * transaction cannot write, and it is the state where the panel shows a number the next turn silently
 * takes back. Both directions are read, because a cap and a floor hold the same number from opposite
 * sides - and the interface already explains a floor as a lock, while only the ceiling was enforced.
 *
 * The margin on which a gate should open again is not read: #19.F gives it as an example ("e.g., by 15
 * or more points"), and a boundary the guide states as an example is a judgement.
 *
 * Run from the repository root with: node --test scripts/npc-relationship-gate.test.mjs
 */

const locked = (level, currentCap, extra = {}) => ({
  name: 'Elara', NPCId: 'npc-elara', relationshipLevel: level,
  relationshipLock: { isLocked: true, currentCap, breakthroughQuestId: null },
  ...extra,
});

const notesFor = npc => assessWorld({ npcs: [npc] }).notes.map(note => note.key.replace('world_notes_', ''));

test('a locked gate holds the standing on its side, in both directions', () => {
  assert.deepEqual(notesFor(locked(100, 100)), [], 'standing at the cap the gate was closed at says nothing');
  assert.deepEqual(notesFor(locked(40, 100)), [], 'and neither does the open side of it');
  assert.deepEqual(notesFor(locked(-200, -200)), [], 'a floor reached is the same fact from below');
  assert.deepEqual(notesFor(locked(-50, -200)), [], 'and standing above a floor is free ground');

  const past = assessWorld({ npcs: [locked(130, 100)] }).notes;
  assert.deepEqual(notesFor(locked(130, 100)), ['relationship_level_beyond_gate'], 'a cap is a ceiling');
  assert.deepEqual(past[0].params, { subject: 'Elara', value: 130, gate: 100 }, 'and the line carries both numbers it compared');
  assert.deepEqual(assessWorld({ npcs: [locked(-300, -200)] }).notes[0].params, { subject: 'Elara', value: -300, gate: -200 },
    'a floor is the same question the other way round');
});

test('a gate that holds nothing is not questioned', () => {
  assert.deepEqual(notesFor({ name: 'Elara', relationshipLevel: 130 }), [], 'no lock, no gate, no claim to check');
  assert.deepEqual(notesFor({ ...locked(130, 100), relationshipLock: { isLocked: false, currentCap: 100 } }), [],
    'a gate opened again lets the standing walk away from the number it once stopped at');
  assert.deepEqual(notesFor(locked(130, undefined)), [], 'a lock without a number is missing data, not a contradiction');
  assert.deepEqual(notesFor(locked(undefined, 100)), [], 'and a standing nobody stated is not read as a zero');
  assert.deepEqual(notesFor({ name: 'Elara', relationshipLevel: 130, relationshipLock: 'locked' }), [],
    'a field that is not a lock is skipped rather than guessed at');
  assert.deepEqual(notesFor(locked('130', '100')), ['relationship_level_beyond_gate'],
    'numbers written as text are still the numbers the panel shows');
});

test('the clamp the guide orders is enforced from both sides', async () => {
  const server = await getTestServer();
  const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
  const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
  const context = createInitialContext({
    universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start',
    startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear',
  }, 'en');
  const player = context.playerCharacter;

  const apply = (npc, level) => {
    const base = {
      playerCharacter: player, players: [player], activePlayerIndex: 0,
      currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [],
      encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [],
      playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {},
    };
    const result = processAndApplyResponse(
      { NPCRelationshipChanges: [{ NPCId: npc.NPCId, newRelationshipLevel: level }] },
      base, context.gameSettings, key => key, true, 1, context.worldMap,
    );
    return { npc: result.newState.encounteredNPCs.find(n => n.NPCId === npc.NPCId), logs: result.logsToAdd };
  };

  const ceiling = apply(locked(90, 100), 130);
  assert.equal(ceiling.npc.relationshipLevel, 100, 'a cap keeps the ceiling it was closed at');
  const floorCase = apply(locked(-50, -200), -300);
  assert.equal(floorCase.npc.relationshipLevel, -200, 'and a floor keeps its own, which the interface had been told about while nothing enforced it');
  const free = apply({ name: 'Riven', NPCId: 'npc-riven', relationshipLevel: 130 }, 180);
  assert.equal(free.npc.relationshipLevel, 180, 'a turn that crosses no gate is written exactly as it was reported');
});

test('the turn that overshoots a gate says how much it did not count', async () => {
  const server = await getTestServer();
  const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
  const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
  const context = createInitialContext({
    universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start',
    startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear',
  }, 'en');
  const player = context.playerCharacter;

  const cross = level => {
    const npc = { name: 'Sable', NPCId: 'npc-sable', relationshipLevel: 90, attitude: 'Warm' };
    const base = {
      playerCharacter: player, players: [player], activePlayerIndex: 0,
      currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [],
      encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [],
      playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {},
    };
    const result = processAndApplyResponse(
      { NPCRelationshipChanges: [{ NPCId: 'npc-sable', newRelationshipLevel: level }] },
      base, context.gameSettings, (key, params = {}) => `[${key}] ${JSON.stringify(params)}`, true, 1, context.worldMap,
    );
    return { npc: result.newState.encounteredNPCs.find(n => n.NPCId === 'npc-sable'), logs: result.logsToAdd };
  };

  const over = cross(130);
  assert.equal(over.npc.relationshipLevel, 100, 'crossing a cap locks the gate and stops the number at it');
  assert.equal(over.npc.relationshipLock.currentCap, 100);
  const [line] = over.logs.filter(text => text.includes('relationship_locked_auto_msg'));
  assert.ok(line, 'and the player is told about the gate');
  assert.match(line, /relationship_locked_auto_msg_over/, 'with the key that names the overshoot');
  assert.ok(line.includes('"cap":100'), 'the gate the number stopped at');
  assert.ok(line.includes('"claimed":130'), 'the value the turn carried');
  assert.ok(line.includes('"excess":30'), 'and the part of it that was not counted');

  const exact = cross(100);
  const [plain] = exact.logs.filter(text => text.includes('relationship_locked_auto_msg'));
  assert.ok(plain && !plain.includes('_over'), 'a turn that landed on the cap reports the cap and invents no difference');
});

test('the card of a person says the gate is why the number stops', () => {
  const card = readFileSync(new URL('../components/NpcLog.tsx', import.meta.url), 'utf8');
  const overrides = readFileSync(new URL('../utils/translations/ui/ui_overrides.ts', import.meta.url), 'utf8');
  const notes = readFileSync(new URL('../utils/translations/ui/common.ts', import.meta.url), 'utf8');

  assert.match(card, /data-testid="npc-relationship-gate"/, 'the lock is stated where the relationship is watched');
  assert.match(card, /npc\.relationshipLock\?\.isLocked && npc\.relationshipLock\.currentCap !== undefined/,
    'only when a gate with a number is actually closed');
  assert.match(card, /t\(npc\.relationshipLock\.currentCap >= 0 \? 'relationship_locked_positive_cap' : 'relationship_locked_negative_floor', \{ cap:/,
    'and it is named with the wording the character sheet already uses, picked by the side of zero the gate sits on');
  for (const key of ['relationship_locked_auto_msg_over']) {
    assert.equal((overrides.match(new RegExp(`'${key}'`, 'g')) || []).length, 2, `${key} is answered in both locales`);
  }
  assert.equal((notes.match(/"world_notes_relationship_level_beyond_gate"/g) || []).length, 2,
    'and the line of the read-back is answered in both locales');
});

test('the rule the gate is read against is still written in the guide', () => {
  const lines = getGameMasterGuideRules().split('\n').map(line => line.trim());
  assert.ok(lines.some(line => line.includes("You MUST clamp the 'relationshipLevel' to the exact cap value")),
    '#19.F still orders the standing clamped to a cap');
  assert.ok(lines.some(line => line.includes("You MUST clamp the 'relationshipLevel' to this floor value")),
    'and to a floor, which is the half the client had not been enforcing');
});

after(async () => { await closeTestServer(); });
