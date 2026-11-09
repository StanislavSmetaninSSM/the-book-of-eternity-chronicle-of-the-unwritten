import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assessFactionArchive, assessWorld } from '../utils/worldAssessment.js';
import { getTestServer, closeTestServer } from './helpers/testServer.mjs';
import { getGameMasterGuideRules } from '../prompts/mainPromptModule.js';

/**
 * Finished work is filed away with a word that says how it ended. A faction keeps `completedProjects`
 * with `finalState: 'Completed' | 'Abandoned'`; a threat and a person keep `completedActivities` with
 * that same field or with `finalOutcome: 'Success' | 'SuccessWithComplication' | 'Failure'`. The panel
 * counts those words by name, and it resolves a record by its id before it looks into the archive, so
 * three things can be read off the state alone: the ending is one the record type holds, an identity is
 * filed once, and an identity is either running or filed - not both.
 *
 * Run from the repository root with: node --test scripts/faction-archive.test.mjs
 */

const project = (projectId, projectName, finalState, rest = {}) => ({
    projectId, projectName, ...(finalState === undefined ? {} : { finalState }), ...rest,
});

const read = (activeProjects, completedProjects) =>
    assessFactionArchive({ name: 'Mill Watch', activeProjects, completedProjects }, 'Mill Watch').notes;

const line = note => `${note.key.replace('world_notes_', '')}:${note.params.record ?? note.params.id}`;

test('an archived record names one of the endings its shape holds', () => {
  assert.deepEqual(read([], [project('p1', 'Granary', 'Completed')]).map(line), [], "a filed project said 'Completed' is the shape of the archive");
  assert.deepEqual(read([], [project('p1', 'Granary', 'Abandoned')]).map(line), [], "and 'Abandoned' is the other half of it");

  const loose = read([], [project('p1', 'Granary', 'completed'), project('p2', 'Gate', 'Done')]);
  assert.deepEqual(loose.map(n => n.key), ['world_notes_archive_state_unknown', 'world_notes_archive_state_unknown'],
    'the words are read as they are spelled, so a project filed as \'completed\' is a third state nothing acts on');
  assert.equal(loose[0].params.allowed, 'Completed / Abandoned', 'and the line names the pair the reader compared against');

  const silent = read([], [project('p1', 'Granary')]);
  assert.deepEqual(silent.map(line), ['archive_state_missing:Granary'], 'a record filed without an ending is work that never ended');
});

test('an identity is filed once, and never while it still runs', () => {
  assert.deepEqual(read([], [project('p1', 'Granary', 'Completed'), project('p1', 'Granary (again)', 'Abandoned')]).map(line),
    ['archive_filed_twice:p1'], 'the second copy of an id is a record no handler reaches');
  assert.deepEqual(read([project('p2', 'Gate', undefined, { timeSpentMinutes: 10, totalTimeCostMinutes: 20 })],
    [project('p2', 'Gate', 'Completed')]).map(line),
    ['archive_running_and_filed:Gate'], 'and a record cannot be both the running one and the filed one');

  assert.deepEqual(read([project('p9', 'Gate', undefined, { timeSpentMinutes: 5, totalTimeCostMinutes: 20 })],
    [project('p8', 'Gate', 'Completed')]).map(line), [], 'the same name under other ids is the same work done twice, which the rules allow');
  assert.deepEqual(read([project('p2', 'Gate')], [project('p3', 'Gate', 'Completed')]).map(line), [],
    'a running record without an id is not matched by name');
});

test('the archive is read as the record lists it, and nothing else is invented', () => {
  assert.deepEqual(read(undefined, undefined).map(line), [], 'a faction with no lists says nothing');
  assert.deepEqual(read([], []).map(line), [], 'and empty ones are the state before the first project');
  assert.deepEqual(read([], [null, 7, 'Granary']).map(line), [], 'entries that are not records are skipped, not guessed at');
  assert.deepEqual(assessFactionArchive(undefined, '?').notes, [], 'no faction, no claims');
  assert.deepEqual(read([], [{ activityName: 'Patrol', finalState: 'Completed' }]).map(line), [],
    'a record without an identity is still read for its ending, and only for that');
});

test('the three owners of an archive are read by the world reader, each on its own card', () => {
  const faction = { name: 'Mill Watch', activeProjects: [], completedProjects: [project('p1', 'Granary', 'Finished')] };
  assert.deepEqual(assessWorld({ factions: [faction] }).notes.map(line), ['archive_state_unknown:Granary'],
    'the card of a faction lists the archive it carries');

  const npc = { name: 'Elara', completedActivities: [{ activityName: 'Patrol', finalOutcome: 'Dusted' }] };
  assert.deepEqual(assessWorld({ npcs: [npc] }).notes.map(n => n.kind), ['archive_state_unknown'],
    'a person is scored by the outcomes their archive holds');
  assert.deepEqual(assessWorld({ npcs: [{ ...npc, completedActivities: [{ activityName: 'Patrol', finalOutcome: 'SuccessWithComplication' }] }] }).notes, [],
    'and the middle of the three outcomes is not an error to be averaged away');

  const threat = {
    name: 'Cult of the Silent Maw', threatId: 't1',
    currentActivity: { activityId: 'a7', activityName: 'Kidnap the heir' },
    completedActivities: [{ activityId: 'a7', activityName: 'Kidnap the heir', finalState: 'Completed' }],
  };
  assert.deepEqual(assessWorld({ threats: [threat] }).notes.map(line), ['archive_running_and_filed:Kidnap the heir'],
    'and a completion command that arrived late is read on the threat it belongs to');
});

test('the honest completion leaves nothing to say, and the merged one leaves a mark', async () => {
  const server = await getTestServer();
  const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
  const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
  const context = createInitialContext({
    universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start',
    startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear',
  }, 'en');
  const player = context.playerCharacter;
  // Half the budget spent: nothing in the turn moves this project on its own, so each case below is
  // decided by the command the response carried, and not by the sweep that files a finished one.
  const running = project('p-gate', 'Open the north gate', undefined, {
    description: 'Clear the rubble.', timeSpentMinutes: 10, totalTimeCostMinutes: 30,
  });
  const faction = { factionId: 'f-mill', name: 'Mill Watch', reputation: 10, activeProjects: [running], completedProjects: [] };
  const base = {
    playerCharacter: player, players: [player], activePlayerIndex: 0,
    currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [],
    encounteredNPCs: [], encounteredFactions: [faction], enemiesData: [], alliesData: [],
    playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {},
  };
  const apply = changes => {
    const next = processAndApplyResponse(changes, base, context.gameSettings, key => key, true, 4, context.worldMap).newState;
    return next.encounteredFactions.find(f => f.factionId === 'f-mill');
  };

  const moved = apply({ completeFactionProjects: [{ factionId: 'f-mill', projectId: 'p-gate', finalState: 'Completed' }] });
  assert.deepEqual(moved.activeProjects, [], 'the completion command takes the project out of the running list');
  assert.equal(moved.completedProjects.length, 1, 'and files it once, on the turn that finished it');
  assert.equal(moved.completedProjects[0].finalState, 'Completed');
  assert.equal(moved.completedProjects[0].completionTurn, 4, 'with the turn the state was written on');
  assert.deepEqual(assessFactionArchive(moved, 'Mill Watch').notes, [], 'so the archive of an honest transaction says nothing');

  // The other road into the archive is a faction change that files a project by hand: it writes the
  // archive entry and leaves the running one where it stood, and that is a state the panel counts twice -
  // reached without editing any history, by an ordinary response of the game master.
  const refiled = apply({
    factionDataChanges: [{
      factionId: 'f-mill',
      completedProjects: [project('p-gate', 'Open the north gate', 'Abandoned')],
    }],
  });
  const marks = assessFactionArchive(refiled, 'Mill Watch').notes;
  assert.equal(refiled.completedProjects.length, 1, 'the merge recognises the id, so no second copy is filed');
  assert.equal(refiled.completedProjects[0].finalState, 'Abandoned', 'and the word the turn carried wins in the archived record');
  assert.deepEqual(marks.map(line), ['archive_running_and_filed:Open the north gate'],
    'yet the record is still listed as running, and the reader says so');
  assert.deepEqual(marks[0].params, { subject: 'Mill Watch', record: 'Open the north gate', id: 'p-gate' },
    'naming the identity the two lists share');
});

test('the archive speaks where it is read from, in both locales', () => {
  const view = readFileSync(new URL('../components/DetailRenderer/FactionDetailsRenderer.tsx', import.meta.url), 'utf-8');
  const strings = readFileSync(new URL('../utils/translations/ui/common.ts', import.meta.url), 'utf-8');

  assert.match(view, /assessFactionArchive\(faction, faction\.name \|\| faction\.factionId \|\| '\?'\)/,
    'the tab that lists and deletes the archive reads it through the same reader as the card');
  assert.match(view, /\{activeTab === 'completed' && \(\s*<section>\s*\{archiveNotes\.length > 0 && \(\s*<WorldStateNotes/,
    'and the line sits above the list it describes');

  for (const key of ['archive_state_missing', 'archive_state_unknown', 'archive_filed_twice', 'archive_running_and_filed']) {
    assert.equal((strings.match(new RegExp(`"world_notes_${key}"`, 'g')) || []).length, 2, `the line for ${key} exists in both locales`);
  }

  const npcCard = readFileSync(new URL('../components/NpcLog.tsx', import.meta.url), 'utf8');
  assert.match(npcCard, /assessWorld\(\{ npcs: \[npc\] \}\)\.notes/, 'the card of a person needs no new wiring for its own archive');
});

test('the two words the archive is counted by are still written in the guide', () => {
  const guide = getGameMasterGuideRules();
  assert.ok(guide.includes("'Completed' | 'Abandoned'"), 'the ending of a filed project or activity is a pair');
  assert.ok(guide.includes("'Success' | 'SuccessWithComplication' | 'Failure'"),
    'and the outcome of an activity is a triple, the middle value included');
});

after(async () => { await closeTestServer(); });
