/**
 * The read-back over the living world: what the state says about its own projects, activities,
 * standings and wounds, and what the interface is allowed to conclude from it.
 *
 * Run from the repository root with: node --test scripts/world-assessment.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assessWorld, REPUTATION_CEILING, REPUTATION_FLOOR } from '../utils/worldAssessment.js';

/** One faction with one active project, the shortest state that can contradict itself. */
const factionWithProject = (project, extra = {}) => ({
    name: 'The Ashen Circle',
    reputation: 0,
    activeProjects: [project],
    ...extra,
});

test('a project past its own completion check is named with both numbers', () => {
    const { notes, bySubject } = assessWorld({
        factions: [factionWithProject({ projectName: 'Rites of Ash', totalTimeCostMinutes: 120, timeSpentMinutes: 130 })],
    });

    assert.equal(notes.length, 1);
    assert.equal(notes[0].kind, 'completed_but_active');
    assert.equal(notes[0].subject, 'The Ashen Circle');
    assert.deepEqual(notes[0].params, { subject: 'The Ashen Circle', spent: 130, cost: 120 });
    assert.deepEqual(bySubject['The Ashen Circle'].map(note => note.kind), ['completed_but_active']);
});

test('a finished or abandoned task is not an accusation', () => {
    const done = assessWorld({ factions: [factionWithProject({ totalTimeCostMinutes: 120, timeSpentMinutes: 120, activeState: 'Completed' })] });
    assert.equal(done.notes.length, 0, 'a task the state calls completed is allowed to have reached its cost');

    const abandoned = assessWorld({ factions: [factionWithProject({ totalTimeCostMinutes: 120, timeSpentMinutes: 900, activeState: 'Abandoned' })] });
    assert.equal(abandoned.notes.length, 0, 'abandonment is a decision, not a contradiction');

    const fresh = assessWorld({ factions: [factionWithProject({ totalTimeCostMinutes: 120, timeSpentMinutes: 119 })] });
    assert.equal(fresh.notes.length, 0, 'a task still inside its budget says nothing');
});

test('a number the state does not state is not read as a zero', () => {
    const empty = assessWorld({
        factions: [factionWithProject({})],
        npcs: [{ name: 'Kest', currentActivity: { timeSpentMinutes: undefined, totalTimeCostMinutes: 0 } }],
    });
    assert.deepEqual(empty.notes, [], 'a missing cost or a missing tracker is left alone');

    const zeroBudget = assessWorld({ factions: [factionWithProject({ totalTimeCostMinutes: 0, timeSpentMinutes: 0 })] });
    assert.equal(zeroBudget.notes.length, 0, 'spent 0 of 0 minutes is not proof of completion');
});

test('effort written into a tracker cannot fall below zero', () => {
    const { notes } = assessWorld({ factions: [factionWithProject({ totalTimeCostMinutes: 120, timeSpentMinutes: -30 })] });

    assert.equal(notes.length, 1);
    assert.equal(notes[0].kind, 'negative_effort');
    assert.equal(notes[0].params.minutes, -30);
});

test('standing is read off the scale the rules give it', () => {
    const above = assessWorld({ factions: [factionWithProject({ totalTimeCostMinutes: 120, timeSpentMinutes: 10 }, { reputation: REPUTATION_CEILING + 50 })] });
    assert.equal(above.notes.length, 1);
    assert.equal(above.notes[0].kind, 'standing_out_of_range');
    assert.deepEqual(above.notes[0].params, {
        subject: 'The Ashen Circle',
        value: 450,
        floor: REPUTATION_FLOOR,
        ceiling: REPUTATION_CEILING,
    });

    const onTheEdge = assessWorld({ factions: [factionWithProject({ totalTimeCostMinutes: 120 }, { reputation: REPUTATION_CEILING })] });
    assert.equal(onTheEdge.notes.length, 0, 'the two ends of the scale are inside it');

    const npc = assessWorld({ npcs: [{ name: 'Kest', relationshipLevel: -9001 }] });
    assert.deepEqual(npc.notes.map(note => note.kind), ['standing_out_of_range']);
});

test('a wound whose treatment reached its threshold is waiting on a state change', () => {
    const atThreshold = assessWorld({
        npcs: [{
            name: 'Kest',
            wounds: [
                { healingState: { currentState: 'Stabilized', treatmentProgress: 20, progressNeeded: 20 } },
                { healingState: { currentState: 'Untreated', treatmentProgress: 40, progressNeeded: 40 } },
            ],
        }],
    });
    assert.equal(atThreshold.notes.length, 1, 'one line per character, not one per wound');
    assert.equal(atThreshold.notes[0].kind, 'wound_awaiting_transition');
    assert.deepEqual(atThreshold.notes[0].params, { subject: 'Kest', progress: 20, needed: 20 });

    const treated = assessWorld({ npcs: [{ name: 'Kest', wounds: [{ healingState: { currentState: 'Untreated', treatmentProgress: 10, progressNeeded: 40 } }] }] });
    assert.equal(treated.notes.length, 0, 'treatment short of the threshold is the normal case');

    const healed = assessWorld({ npcs: [{ name: 'Kest', wounds: [{ healingState: { currentState: 'Healed', treatmentProgress: 80, progressNeeded: 40 } }] }] });
    assert.equal(healed.notes.length, 0, 'the history of a closed wound stays in the record and says nothing');

    const noNumbers = assessWorld({ npcs: [{ name: 'Kest', wounds: [{ healingState: { currentState: 'Untreated' } }] }] });
    assert.equal(noNumbers.notes.length, 0);
});

test('a threat working in a place answers to the same completion check', () => {
    const { notes } = assessWorld({
        threats: [
            { name: 'The Salt Cult', currentActivity: { activityName: 'Digging', totalTimeCostMinutes: 60, timeSpentMinutes: 60 } },
            { name: 'A quiet ferryman', currentActivity: { totalTimeCostMinutes: 60, timeSpentMinutes: 20, activeState: 'Abandoned' } },
            { name: 'A restless barrow', currentActivity: null },
        ],
    });

    assert.equal(notes.length, 1, 'only the tracker that contradicts itself is reported');
    assert.equal(notes[0].subject, 'The Salt Cult');
    assert.equal(notes[0].kind, 'completed_but_active');
});

test('nothing is repaired: the assessment returns notes and leaves the state alone', () => {
    const faction = factionWithProject({ projectName: 'Rites of Ash', totalTimeCostMinutes: 120, timeSpentMinutes: 130 });
    const npc = { name: 'Kest', relationshipLevel: 450, wounds: [] };

    assessWorld({ factions: [faction], npcs: [npc] });

    assert.deepEqual(faction.activeProjects[0], { projectName: 'Rites of Ash', totalTimeCostMinutes: 120, timeSpentMinutes: 130 });
    assert.equal(npc.relationshipLevel, 450);
});

test('every note the assessment can raise has a line in both locales', () => {
    const source = readFileSync(new URL('../utils/worldAssessment.js', import.meta.url), 'utf8');
    const kinds = [...source.matchAll(/worldNote\(\s*'([a-z_]+)'/g)].map(match => match[1]);
    assert.ok(kinds.length >= 4, `the read-back should cover more than ${kinds.length} kind(s)`);

    const file = readFileSync(new URL('../utils/translations/ui/common.ts', import.meta.url), 'utf8');
    const split = file.indexOf('\n  ru: {');
    assert.ok(split > 0, 'the UI strings are expected to be split into an English and a Russian block');
    const [en, ru] = [file.slice(0, split), file.slice(split)];
    for (const kind of kinds) {
        for (const [locale, block] of [['en', en], ['ru', ru]]) {
            assert.ok(block.includes(`"world_notes_${kind}"`), `'world_notes_' + kind is missing from the ${locale} block`);
        }
    }
});

test('the world panels are the ones that read it back', () => {
    const sidePanel = readFileSync(new URL('../components/SidePanel.tsx', import.meta.url), 'utf8');
    assert.match(sidePanel, /<WorldStateNotes factions=\{factions\}/, 'the faction list should carry its own notes');

    const npcLog = readFileSync(new URL('../components/NpcLog.tsx', import.meta.url), 'utf8');
    assert.match(npcLog, /<WorldStateNotes npcs=\{/, 'the NPC list should carry its own notes');

    const locationLog = readFileSync(new URL('../components/LocationLog.tsx', import.meta.url), 'utf8');
    assert.match(locationLog, /<WorldStateNotes\n\s*threats=\{/, 'the location list should read its threats back too');
});
