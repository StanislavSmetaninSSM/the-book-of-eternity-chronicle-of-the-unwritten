/**
 * The wait an NPC action owes, who counts it, and what the combat panel may say about it.
 *
 * #6.1.6.7 states the rule ("cannot be used again for 3 turns after its use") and #12.9.3 states the
 * channel ("cooldownsUsed" - names, never a counter). The client keeps the count, because a number
 * the GM re-derives every turn is a second owner of one fact; the panel reads back only what the
 * state contradicts.
 *
 * Run from the repository root with: node --test scripts/combat-cooldowns.test.mjs
 */
import test, { after } from 'node:test';
import { getTestServer, closeTestServer } from './helpers/testServer.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { applyCooldownUses, assessCooldowns, cooldownStatuses, dedupeCooldowns, readyFromTurnOf } from '../utils/combatCooldowns.js';
import { getGameMasterGuideRules } from '../prompts/mainPromptModule.js';

const npcs = [{
    NPCId: 'npc-1', name: 'Kaelen',
    activeSkills: [
        { skillName: 'Shield Bash', cooldownTurns: 3 },
        { skillName: 'Taunt' },
        { skillName: 'Riposte', cooldownTurns: '2' },
    ],
}];

/** One turn of bookkeeping, called the way the response hands a combatant over. */
const use = (names, turn, cooldowns) => {
    const combatant = {
        NPCId: 'npc-1', name: 'Kaelen',
        ...(names ? { cooldownsUsed: names } : {}),
        ...(cooldowns ? { cooldowns } : {}),
    };
    applyCooldownUses({
        combatant,
        previousCombatant: cooldowns ? { cooldowns } : null,
        npcs,
        currentTurnNumber: turn,
    });
    return combatant;
};

test('the client counts the wait, and the response key does not outlive its turn', () => {
    const first = use(['Shield Bash'], 1);

    assert.deepEqual(first.cooldowns, [{
        actionName: 'Shield Bash', lastUsedTurnNumber: 1, cooldownTurns: 3, readyFromTurn: 4,
    }], 'the length is read from the skill of that name, and the wait is the turn of the use plus it');
    assert.equal('cooldownsUsed' in first, false, 'a stored claim would say "used this turn" forever');
    assert.equal(assessCooldowns(first.cooldowns, 'Kaelen').notes.length, 0, 'a use that only opens a wait contradicts nothing');
    assert.equal(readyFromTurnOf(1, 3), 4);
});

test('a reuse inside the wait is recorded as the pair of numbers it contradicts', () => {
    const first = use(['Shield Bash'], 1);
    const early = use(['Shield Bash'], 2, first.cooldowns);

    assert.deepEqual(assessCooldowns(early.cooldowns, 'Kaelen').notes, [{
        key: 'cooldown_notes_early_use',
        kind: 'early_use',
        subject: 'Kaelen',
        params: { subject: 'Kaelen', action: 'Shield Bash', used: 2, ready: 4 },
    }], 'the note names the action and both turns, and judges nothing else');
    assert.equal(early.cooldowns[0].lastUsedTurnNumber, 2, 'and the count restarts from the use that happened');

    // "for 3 turns after its use" and "the number of turns that must pass" differ by one turn, so a
    // reuse on the boundary is left alone: it is a reading, not a contradiction.
    assert.equal('earlyUseTurnNumber' in use(['Shield Bash'], 4, first.cooldowns).cooldowns[0], false);
    assert.equal(assessCooldowns(use(['Shield Bash'], 5, first.cooldowns).cooldowns).notes.length, 0, 'and a late one even less so');

    // A later, legitimate use does not erase the contradiction before it.
    const after = use(['Shield Bash'], 9, early.cooldowns);
    assert.deepEqual(assessCooldowns(after.cooldowns).notes.map(note => note.params), [{ subject: '', action: 'Shield Bash', used: 2, ready: 4 }]);
});

test('a name no skill carries is left untracked, and a silence keeps the wait', () => {
    const unknown = use(['Bite'], 2);
    assert.equal(unknown.cooldowns, undefined, 'a generic enemy action has no stated cooldown, so nothing is counted');
    assert.equal('cooldownsUsed' in unknown, false, 'and the claim is still consumed');

    assert.equal(use(['Taunt'], 2).cooldowns, undefined, 'a skill with no cooldownTurns needs no wait');
    // A length written as text is still the number the state states.
    assert.equal(use(['Riposte'], 3).cooldowns[0].cooldownTurns, 2);

    const first = use(['Shield Bash'], 1);
    const silent = use(undefined, 3, first.cooldowns);
    assert.deepEqual(silent.cooldowns, first.cooldowns, 'a turn that reports nothing leaves the running wait alone');
    assert.deepEqual(use(['Shield Bash'], 5, first.cooldowns).cooldowns.length, 1, 'and one action is one entry, not two');

    // Without the turn being applied there is no second number, and no note may be built from one.
    const blind = use(['Shield Bash'], undefined, first.cooldowns);
    assert.deepEqual(blind.cooldowns, first.cooldowns, 'nothing is invented');
    assert.equal(assessCooldowns(undefined, 'Kaelen').notes.length, 0, 'and a missing list says nothing');
    assert.equal(assessCooldowns([{ actionName: 'x' }]).notes.length, 0, 'an entry without both numbers is not an accusation');

    // The fold the state is kept in: two copies of one action stay one entry, holding the count of
    // the later use and the contradiction of the earlier one.
    assert.deepEqual(dedupeCooldowns([
      { actionName: 'Shield Bash', lastUsedTurnNumber: 5, cooldownTurns: 3, readyFromTurn: 8 },
      { actionName: 'Shield Bash', lastUsedTurnNumber: 2, cooldownTurns: 3, readyFromTurn: 5, earlyUseTurnNumber: 2, earlyUseAgainstReadyFrom: 4 },
    ]), [{
      actionName: 'Shield Bash', lastUsedTurnNumber: 5, cooldownTurns: 3, readyFromTurn: 8, earlyUseTurnNumber: 2, earlyUseAgainstReadyFrom: 4,
    }], 'a merge that unioned the arrays does not become two accusations');
    assert.equal(dedupeCooldowns([{ actionName: 'x' }, null]).length, 2, 'and an entry this reader cannot use is not deleted by it');
});

test('the guide states the channel, and the client is the one holding it', () => {
    const lines = getGameMasterGuideRules().split('\n').map(line => line.trim());
    assert.ok(lines.some(line => line.startsWith('The countdown is kept by the system, not by the GM.')),
        '#6.1.6.7 names the owner of the count, so the panel is not guessing whose fact this is');
    assert.ok(lines.some(line => line.includes("in 'cooldownsUsed' on that combatant's object")),
        '#12.9.3 states the field the client reads');
    assert.ok(lines.some(line => line.includes('no countdown may be invented for it')),
        'and states what a name outside the action list means: nothing');
    assert.ok(lines.some(line => line.startsWith('4.  Logging:')
        && line.includes('Every use of an action that carries a cooldown is written here too')),
        'and #12.9.3 sends the spend itself to the log, so the two numbers are on the record');

    const processor = readFileSync(new URL('../utils/responseProcessor.ts', import.meta.url), 'utf8');
    assert.match(processor, /applyCooldownUses\(\{/, 'the stamping happens while the turn is applied');
    assert.match(processor, /\['enemiesData', 'alliesData'\] as const\)\.forEach\(listKey =>/, 'for both lists the panel shows');
    assert.match(processor, /for \(const combatant of mergedCombatants\)/, 'one call per combatant, after the merge');

    const card = readFileSync(new URL('../components/CombatTracker.tsx', import.meta.url), 'utf8');
    assert.match(card, /assessCooldowns\(combatant\.cooldowns, combatant\.name \|\| '\?'\)/, 'and it is read in the card of that fighter');

    const strings = readFileSync(new URL('../utils/translations/ui/common.ts', import.meta.url), 'utf8');
    assert.equal((strings.match(/"cooldown_notes_early_use":/g) || []).length, 2, 'with the line answered in both locales');
});

test('the turn pipeline counts the wait while it applies the response', async () => {
  const server = await getTestServer();
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({
      universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start',
      startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear',
    }, 'en');

    const npc = { ...context.playerCharacter, name: 'Kaelen', NPCId: 'npc-1', activeSkills: [{ skillName: 'Shield Bash', cooldownTurns: 3 }] };
    const combatant = {
      NPCId: 'npc-1', name: 'Kaelen', description: 'A guard with a timer.', type: 'Moderate',
      maxHealth: '100%', currentHealth: '100%', actions: [{ actionName: 'Shield Bash', effects: [] }],
    };
    const base = {
      playerCharacter: context.playerCharacter, players: [context.playerCharacter], activePlayerIndex: 0,
      currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [],
      encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [combatant], alliesData: [],
      playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {},
    };
    const apply = (changes, turn, from) =>
      processAndApplyResponse(changes, from, context.gameSettings, key => key, true, turn, context.worldMap).newState;

    const used = apply({ enemiesData: [{ ...combatant, cooldownsUsed: ['Shield Bash'] }] }, 1, base);
    const [first] = used.enemiesData;
    assert.deepEqual(first.cooldowns, [{
        actionName: 'Shield Bash', lastUsedTurnNumber: 1, cooldownTurns: 3, readyFromTurn: 4,
    }], 'the name the response stated became a wait in the state, counted from the skill');
    assert.equal('cooldownsUsed' in first, false, 'and the claim itself is not left behind');

    const again = apply({ enemiesData: [{ ...first, cooldownsUsed: ['Shield Bash'] }] }, 2, used);
    assert.deepEqual(assessCooldowns(again.enemiesData[0].cooldowns, 'Kaelen').notes.map(note => note.params), [
        { subject: 'Kaelen', action: 'Shield Bash', used: 2, ready: 4 },
    ], 'a reuse one turn after a three-turn wait is read back, with both turns');
    assert.equal(again.enemiesData[0].cooldowns[0].lastUsedTurnNumber, 2, 'and the count restarts from it');

    const silent = apply({ enemiesData: [{ ...again.enemiesData[0] }] }, 3, again);
    assert.equal(silent.enemiesData[0].cooldowns.length, 1, 'a turn that names nothing adds no claim and no second entry');
    assert.equal(silent.enemiesData[0].cooldowns[0].earlyUseTurnNumber, 2, 'while the recorded contradiction stays where the card reads it');
  } finally { await server.close(); }
});

test('a wait that runs is shown on the action it belongs to, and a finished one not at all', () => {
  const list = [
    { actionName: 'Shield Bash', lastUsedTurnNumber: 5, cooldownTurns: 3, readyFromTurn: 8 },
    { actionName: 'Gore', lastUsedTurnNumber: 1, cooldownTurns: 3, readyFromTurn: 4 },
  ];

  assert.deepEqual(cooldownStatuses(list, 7), [{ actionName: 'Shield Bash', readyFromTurn: 8, turnsLeft: 1 }],
    'on turn 7 one action is still waiting, and its row says until when');
  assert.deepEqual(cooldownStatuses(list, 8), [], 'a wait that has run out is not news, and is not shown');
  assert.deepEqual(cooldownStatuses(list, 4), [{ actionName: 'Shield Bash', readyFromTurn: 8, turnsLeft: 4 }],
    'the boundary belongs to the wait, not to the ready state');
  assert.deepEqual(cooldownStatuses(list, null), [], 'without the turn of the world nothing is counted');
  assert.deepEqual(cooldownStatuses(list, '7'), [], 'and a turn written as text is not a number to subtract from');
  assert.deepEqual(cooldownStatuses(undefined, 7), []);
  assert.equal(cooldownStatuses([...list, list[0]], 7).length, 1, 'one action stays one line, however the state was merged');
  assert.equal(cooldownStatuses([{ actionName: 'x' }, null, 7], 7).length, 0, 'and an entry that is not a cooldown is not a chip');
});

test('the card is handed the turn its waits are counted against', () => {
  const tracker = readFileSync(new URL('../components/CombatTracker.tsx', import.meta.url), 'utf8');
  const side = readFileSync(new URL('../components/SidePanel.tsx', import.meta.url), 'utf8');
  const host = readFileSync(new URL('../components/GameHost.tsx', import.meta.url), 'utf8');
  const combat = readFileSync(new URL('../utils/translations/ui/combat.ts', import.meta.url), 'utf8');

  assert.match(tracker, /cooldownStatuses\(combatant\.cooldowns, turnNumber\)/, 'the card reads the fighter it shows');
  assert.match(tracker, /data-testid="action-cooldown-chip"/, 'as a line on the row of the action itself');
  assert.match(tracker, /t\('cooldown_chip', \{/, 'said in the player’s language, not in numbers alone');

  for (const [name, source] of [['the side panel', side], ['the full-screen view', host]]) {
    assert.match(source, /<CombatTracker\s+turnNumber=\{turnNumber\}/s, `${name} has to hand the combat view the turn it already holds`);
  }

  assert.equal((combat.match(/"cooldown_chip":/g) || []).length, 2, 'and the line is answered in both locales');
});

// The server is shared for the whole file, so it is closed once, here, or the run never ends.
after(async () => { await closeTestServer(); });
