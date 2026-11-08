/**
 * The read-back over active effects: what an effect object states about its own duration, its
 * identity and the wound it leans on.
 *
 * Run from the repository root with: node --test scripts/effect-assessment.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    assessEffects,
    PERSISTENT_EFFECT_DURATION,
    TIME_LIMITED_EFFECT_TYPES,
} from '../utils/effectAssessment.js';
import { assessWorld } from '../utils/worldAssessment.js';

/** The type whose persistence the rules express with a fixed duration. */
const WOUND = 'WoundReference';

/** One character, one effect, the shortest state that can contradict the rules. */
const assess = (effect, extra = {}) => assessEffects({
    characters: [{
        name: 'Kest',
        effects: [effect],
        wounds: [],
        ...extra,
    }],
});

test('an effect listed past its own expiry is named with the duration it states', () => {
    const { notes } = assess({ effectType: 'Buff', targetType: 'strength', duration: 0 });

    assert.equal(notes.length, 1);
    assert.equal(notes[0].kind, 'expired_but_listed');
    assert.deepEqual(notes[0].params, { subject: 'Kest', label: "Buff 'strength'", duration: 0 });
});

test('only the types the rules hold to a duration are asked for one', () => {
    for (const effectType of TIME_LIMITED_EFFECT_TYPES) {
        const { notes } = assess({ effectType, targetType: 'strength' });
        assert.deepEqual(notes.map(note => note.kind), ['duration_missing'], `${effectType} has to state one`);
    }

    // 'DamageReduction' is required to carry a duration only when it is temporary, and the state
    // does not say which it is; 'Damage'/'Heal' are instantaneous and omit it on purpose.
    for (const effectType of ['DamageReduction', 'Damage', 'Heal', 'Passive']) {
        const { notes } = assess({ effectType, targetType: 'health' });
        assert.equal(notes.length, 0, `${effectType} without a duration is not a contradiction`);
    }
});

test('a duration has to be a whole number, and a written one is never read as absent', () => {
    assert.deepEqual(assess({ effectType: 'Debuff', targetType: 'stun', duration: 2.5 }).notes.map(n => n.kind), ['duration_not_whole']);
    const unreadable = assess({ effectType: 'Debuff', targetType: 'stun', duration: 'two turns' });
    assert.equal(unreadable.notes.length, 1);
    assert.equal(unreadable.notes[0].kind, 'duration_not_whole');
    assert.equal(unreadable.notes[0].params.duration, 'two turns');

    assert.equal(assess({ effectType: 'Debuff', targetType: 'stun', duration: '2' }).notes.length, 0, 'a numeric string is the number it states');
    assert.equal(assess({ effectType: 'Buff', targetType: 'strength', duration: 3 }).notes.length, 0);
});

test('the persistent duration is fixed by the rules, not counted down', () => {
    const wound = { woundId: 'w1', woundName: 'Frost wound', healingState: { currentState: 'Recovering' } };
    const kept = assess({ effectType: WOUND, sourceWoundId: 'w1', duration: PERSISTENT_EFFECT_DURATION }, { wounds: [wound] });
    assert.equal(kept.notes.length, 0, 'the value the rules ask for says nothing');

    const ticking = assess({ effectType: WOUND, sourceWoundId: 'w1', duration: 5 }, { wounds: [wound] });
    assert.deepEqual(ticking.notes.map(note => note.kind), ['wound_reference_duration'], 'one line, not one per rule it breaks');
    assert.deepEqual(ticking.notes[0].params, {
        subject: 'Kest',
        label: WOUND,
        duration: 5,
        expected: PERSISTENT_EFFECT_DURATION,
    });

    const unstated = assess({ effectType: WOUND, sourceWoundId: 'w1' }, { wounds: [wound] });
    assert.deepEqual(unstated.notes.map(note => note.kind), ['wound_reference_duration_missing']);
});

test('a wound reference is tied to a wound, and to an open one', () => {
    const open = { woundId: 'w1', woundName: 'Frost wound', healingState: { currentState: 'Stabilized' } };
    const healed = { woundId: 'w2', woundName: 'Rifle wound', healingState: { currentState: 'Healed' } };

    assert.equal(assess({ effectType: WOUND, sourceWoundId: 'w1', duration: 999 }, { wounds: [open] }).notes.length, 0);

    const outlived = assess({ effectType: WOUND, sourceWoundId: 'w2', duration: 999 }, { wounds: [healed] });
    assert.deepEqual(outlived.notes.map(note => note.kind), ['wound_reference_wound_healed']);
    assert.equal(outlived.notes[0].params.wound, 'Rifle wound');

    const dangling = assess({ effectType: WOUND, sourceWoundId: 'w9', duration: 999 }, { wounds: [open] });
    assert.deepEqual(dangling.notes.map(note => note.kind), ['wound_reference_wound_missing']);
    assert.equal(dangling.notes[0].params.wound, 'w9');

    // Without a list of wounds the state cannot be accused of losing one.
    const noRecord = assessEffects({ characters: [{ name: 'Kest', effects: [{ effectType: WOUND, sourceWoundId: 'w9', duration: 999 }] }] });
    assert.equal(noRecord.notes.length, 0, 'an absent wound list is not an empty one');

    const withoutId = assess({ effectType: WOUND, duration: 999 }, { wounds: [open] });
    assert.deepEqual(withoutId.notes.map(note => note.kind), ['wound_reference_without_id'], 'the mandatory field is named once, and no wound is invented');
});

test('one effect id is one entry in a list', () => {
    const { notes } = assessEffects({
        characters: [{
            name: 'Kest',
            wounds: [],
            effects: [
                { effectId: 'e1', effectType: 'Buff', targetType: 'strength', duration: 2 },
                { effectId: 'e1', effectType: 'Buff', targetType: 'agility', duration: 1 },
                { effectType: 'Buff', targetType: 'luck', duration: 4 },
                { effectType: 'Buff', targetType: 'luck', duration: 4 },
            ],
        }],
    });

    assert.deepEqual(notes.map(note => note.kind), ['duplicate_effect_id'], 'effects without an id are new, and may repeat');
    assert.deepEqual(notes[0].params, { subject: 'Kest', effectId: 'e1', times: 2 });

    const separateLists = assessEffects({
        characters: [
            { name: 'Kest', wounds: [], effects: [{ effectId: 'e1', effectType: 'Buff', targetType: 'strength', duration: 2 }] },
            { name: 'Kest', wounds: [], effects: [{ effectId: 'e1', effectType: 'Debuff', targetType: 'stun', duration: 1 }] },
        ],
    });
    assert.equal(separateLists.notes.length, 0, 'identity is per list, and two lists are not one duplicate');
});

test('the world list reads its people’s effects with the same reader', () => {
    const { notes } = assessWorld({
        npcs: [{
            name: 'Kest',
            currentActivity: { totalTimeCostMinutes: 90, timeSpentMinutes: 10 },
            wounds: [{ woundId: 'w1', woundName: 'Frost wound', healingState: { currentState: 'Recovering' } }],
            activeEffects: [
                { effectType: 'WoundReference', sourceWoundId: 'w1', duration: 4 },
                { effectType: 'Buff', targetType: 'strength', duration: 2 },
            ],
        }],
    });

    assert.deepEqual(notes.map(note => note.kind), ['wound_reference_duration']);
});

test('every note the effect reader can raise has a line in both locales', () => {
    const source = readFileSync(new URL('../utils/effectAssessment.js', import.meta.url), 'utf8');
    const kinds = [...source.matchAll(/effectNote\(\s*'([a-z_]+)'/g)].map(match => match[1]);
    assert.ok(kinds.length >= 8, `the read-back should cover more than ${kinds.length} kind(s)`);

    const file = readFileSync(new URL('../utils/translations/ui/common.ts', import.meta.url), 'utf8');
    const split = file.indexOf('\n  ru: {');
    assert.ok(split > 0, 'the UI strings are expected to be split into an English and a Russian block');
    const [en, ru] = [file.slice(0, split), file.slice(split)];
    for (const kind of kinds) {
        for (const [locale, block] of [['en', en], ['ru', ru]]) {
            assert.ok(block.includes(`"effect_notes_${kind}"`), `'effect_notes_' + kind is missing from the ${locale} block`);
        }
    }
    for (const [locale, block] of [['en', en], ['ru', ru]]) {
        assert.ok(block.includes('"Effect State Check"'), `the heading is missing from the ${locale} block`);
    }
});

test('the sheet shows the notes it is given, under its own heading', () => {
    const view = readFileSync(new URL('../components/CharacterSheet/ConditionsView.tsx', import.meta.url), 'utf8');
    assert.match(view, /assessEffects\(\{ characters: \[\{ name: character\.name, effects, wounds \}\] \}\)/, 'the sheet reads back both of its own lists');
    assert.match(view, /<WorldStateNotes notes=\{effectNotes\} titleKey="Effect State Check"/, 'and shows them above the effects');

    const renderer = readFileSync(new URL('../components/WorldStateNotes.tsx', import.meta.url), 'utf8');
    assert.match(renderer, /givenNotes/, 'the renderer takes notes from the view that holds them');
});
