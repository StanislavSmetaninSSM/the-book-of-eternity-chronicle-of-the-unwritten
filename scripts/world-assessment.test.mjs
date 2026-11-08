/**
 * The read-back over the living world: what the state says about its own projects, activities,
 * standings, wounds and chronicle entries, and what the interface is allowed to conclude from it.
 *
 * Run from the repository root with: node --test scripts/world-assessment.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assessChronicle, assessTracker, assessWorld, assessWoundProgress, REPUTATION_CEILING, REPUTATION_FLOOR } from '../utils/worldAssessment.js';

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

test('one tracker can be read on its own, for the card that shows it', () => {
    const { notes } = assessTracker({ projectName: 'Rites', totalTimeCostMinutes: 120, timeSpentMinutes: 130 }, 'Rites of Ash');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].key, 'world_notes_completed_but_active');
    assert.equal(notes[0].subject, 'Rites of Ash', 'the card is named by the tracker it shows');

    assert.equal(assessTracker({ totalTimeCostMinutes: 120, timeSpentMinutes: 30 }, 'Rites of Ash').notes.length, 0);
    assert.equal(assessTracker(null, 'Rites of Ash').notes.length, 0, 'a card without a tracker says nothing');
});

test('the wound rule can be read over a list of wounds, without the character around it', () => {
    const stuck = [{ healingState: { currentState: 'Stabilized', treatmentProgress: 20, progressNeeded: 20 } }];
    const { notes } = assessWoundProgress(stuck, 'Frost Troll');
    assert.deepEqual(notes.map(note => note.key), ['world_notes_wound_awaiting_transition']);
    assert.equal(notes[0].params.needed, 20);

    assert.equal(assessWoundProgress([{ healingState: { currentState: 'Healed', treatmentProgress: 80, progressNeeded: 20 } }], 'Troll').notes.length, 0, 'a closed wound is history');
    assert.equal(assessWoundProgress([], 'Troll').notes.length, 0);
    assert.equal(assessWoundProgress(undefined, 'Troll').notes.length, 0, 'a view that shows no list asserts nothing');
});

test('the contradiction is read in the card that shows the numbers', () => {
    const read = name => readFileSync(new URL(`../components/${name}`, import.meta.url), 'utf8');

    const sidePanel = read('SidePanel.tsx');
    assert.match(sidePanel, /const factionNotes = assessWorld\(\{ factions: \[faction\] \}\)\.notes;/, 'the faction card reads its own faction');
    assert.match(sidePanel, /<WorldStateNotes notes=\{factionNotes\} compact/, 'and shows the lines inside the card');
    assert.doesNotMatch(sidePanel, /<WorldStateNotes factions=\{factions\}/, 'nothing is counted over the whole list anymore');

    const npcLog = read('NpcLog.tsx');
    assert.match(npcLog, /const npcNotes = assessWorld\(\{ npcs: \[npc\] \}\)\.notes;/, 'the person’s card reads the person');
    assert.match(npcLog, /<WorldStateNotes notes=\{npcNotes\} compact/);
    assert.doesNotMatch(npcLog, /<WorldStateNotes npcs=\{/, 'and the list keeps no summary of its own');

    const locationLog = read('LocationLog.tsx');
    assert.match(locationLog, /const threatNotes = assessWorld\(\{ threats: loc\.activeThreats \|\| \[\] \}\)\.notes;/, 'the place reads the threats it hosts');
    assert.match(locationLog, /<WorldStateNotes notes=\{threatNotes\} compact/);
    assert.doesNotMatch(locationLog, /name: `\$\{threat\.name\} \(\$\{loc\.name\}\)`/, 'the place no longer has to be spelled into the subject');

    const projects = read('DetailRenderer/FactionDetailsRenderer.tsx');
    assert.doesNotMatch(projects, /<WorldStateNotes[^>]*factions=/, 'the detail view reads the project, not the faction');
    assert.match(projects, /assessTracker\(project, project\.projectName \|\| '\?'\)/, 'the project card reads its own tracker');
    assert.match(projects, /<WorldStateNotes notes=\{projectNotes\} compact/);
});

test('the compact reading stays a line, not a second frame', () => {
    const renderer = readFileSync(new URL('../components/WorldStateNotes.tsx', import.meta.url), 'utf8');
    assert.match(renderer, /data-testid="world-state-notes-inline"/, 'inline notes have their own hook');
    assert.match(renderer, /if \(compact\) \{/, 'and a branch of their own');
    const boxed = renderer.slice(renderer.indexOf('return ('));
    assert.match(boxed, /t\(titleKey\)/, 'while the boxed reading keeps its heading');
});
test('a chronicle entry is read back for the stamp its own archive sorts by', () => {
    // The shapes below are the ones the guide itself prints (#18.A.0 and its examples), plus the one
    // variant the location card accepts on its own: a single word of event type above the stamp.
    const stamped = [
        '#[10] - 15 Месяца Начал 1024 г., 14:00: A dragon was spotted over the mill.',
        '#[150] - 21 Месяца Глубокого Сна 1024 г., 16:30: Группа путешественников вошла в лес.',
        'Combat\n#[10] - 15 Месяца Начал 1024 г., 14:00: The bridge held.',
    ];
    assert.equal(assessChronicle(stamped).notes.length, 0, 'a stamp the archive can read is not an accusation');

    const unreadable = assessChronicle([
        'A dragon was spotted over the mill.',
        '#12 - 3 Месяца Начал 1024 г., 14:00: без скобок',
        '#[41] - 3 Месяца Начал 1024 г.: evening skirmish at the gate',
    ]);
    assert.deepEqual(Object.entries(unreadable.byIndex).map(([i, n]) => `${i}:${n[0].kind}`), [
        '0:chronicle_turn_unreadable',
        // The turn is there for a reader of prose, and the parser the archive sorts by (/^#\[(\d+)/)
        // does not see it - which is the difference the entry has to be warned about.
        '1:chronicle_turn_unreadable',
        '2:chronicle_clock_missing',
    ]);
    assert.equal(unreadable.notes[0].key, 'world_notes_chronicle_turn_unreadable', 'the note brings its own string');
    assert.equal(assessChronicle([null, '', {}, undefined]).notes.length, 0, 'a broken entry is not an accusation');
    assert.equal(assessChronicle([]).byIndex[0], undefined, 'and an empty archive says nothing');
});

test('the mark sits under the entry the archive sorts', () => {
    const card = readFileSync(new URL('../components/LocationLog.tsx', import.meta.url), 'utf8');
    const modal = readFileSync(new URL('../components/DetailRenderer/LocationDetailsRenderer.tsx', import.meta.url), 'utf8');

    assert.match(card, /assessChronicle\(eventText \? \[eventText\] : \[\]\)/, 'the card reads the event text it shows, not the whole archive');
    assert.match(card, /<WorldStateNotes notes=\{chronicleNotes\} compact/, 'as a line under that text');

    assert.match(modal, /assessChronicle\(events\)\.byIndex/, 'the modal reads the list it renders');
    assert.match(modal, /<WorldStateNotes notes=\{chronicleNotes\[index\]\} compact/, 'entry by entry, under each one');
    assert.doesNotMatch(modal, /notes=\{assessChronicle\(events\)\.notes\}/, 'and never as one bar above the chronicle');

    const strings = readFileSync(new URL('../utils/translations/ui/common.ts', import.meta.url), 'utf8');
    for (const key of ['world_notes_chronicle_turn_unreadable', 'world_notes_chronicle_clock_missing']) {
        assert.equal((strings.match(new RegExp(`"${key}"`, 'g')) || []).length, 2, `${key} has to be answered in both locales`);
    }
});

test('the sheet reads its wounds with the reader the fighter’s card uses', () => {
    const sheet = readFileSync(new URL('../components/CharacterSheet/ConditionsView.tsx', import.meta.url), 'utf8');
    const card = readFileSync(new URL('../components/CombatTracker.tsx', import.meta.url), 'utf8');

    assert.match(sheet, /import \{ assessWoundProgress \} from '\.\.\/\.\.\/utils\/worldAssessment\.js';/, 'one module, two panels');
    assert.match(card, /import \{ assessWoundProgress \} from '\.\.\/utils\/worldAssessment\.js';/);
    assert.match(sheet, /assessWoundProgress\(wounds \?\? \[\], character\.name\)/, 'over the list the section prints');
    assert.match(sheet, /<WorldStateNotes notes=\{woundNotes\} titleKey="Wound State Check"/, 'under a heading of its own');

    const strings = readFileSync(new URL('../utils/translations/ui/common.ts', import.meta.url), 'utf8');
    assert.equal((strings.match(/"Wound State Check":/g) || []).length, 2, 'and that heading is answered in both locales');
});
