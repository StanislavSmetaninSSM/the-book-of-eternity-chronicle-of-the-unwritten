/**
 * What the living world states about itself, read back.
 *
 * The game master advances projects, off-screen activities, reputations, wounds and effects; the
 * interface stores the numbers it is given. Some of those numbers are bounded by the rules
 * themselves: effort written into a tracker cannot fall below zero, a task whose spent time reached its cost is a
 * finished task, the reputation scale runs from -400 to +400, and a wound whose treatment reached
 * `progressNeeded` has changed state rather than stopped at the threshold. Effects are read by
 * `./effectAssessment.js`, which the NPC lists below feed, and every chronicle entry of a
 * location is read for the stamp #18.A.0 puts at its head. A record that contradicts one of those
 * is not a disagreement about the fiction - it is a state no rule produces, and the panel says so
 * in one line.
 *
 * Nothing is repaired here. The client cannot know which of the two numbers the turn meant to
 * write: the cost, or the time spent against it. So it names the pair and stays quiet about
 * everything it cannot read off the state - judgement calls (an abandoned project, a bonus the GM
 * granted by hand) are never reported, and a number that is absent is not treated as a zero.
 */

import { assessEffects, groupNotesBySubject, statedNumber } from './effectAssessment.js';

/** @typedef {import('./effectAssessment.js').StateNote} StateNote */

/** The lines of the world read-back live in their own namespace of the UI strings. */
const worldNote = (kind, subject, params) => ({ key: `world_notes_${kind}`, kind, subject, params });

/**
 * The two ends of the scale both world powers and people are measured on: "the reputation scale is
 * -400 to +400" for factions, and "The final 'relationshipLevel' must be capped within the range of
 * -400 to +400" for NPCs.
 */
export const REPUTATION_FLOOR = -400;
export const REPUTATION_CEILING = 400;

/**
 * A tracker the rules let the world carry: a faction's active project or an NPC's current activity.
 * Both are updated by the same two sentences - the new total "(Cannot go below 0)", and "THE
 * COMPLETION CHECK: isComplete = (newTimeSpentMinutes >= totalTimeCostMinutes)".
 */
function assessTrackerInto(tracker, subject, notes) {
    if (!tracker || typeof tracker !== 'object') return;
    // 'Abandoned' is a decision, not a contradiction: the completion check is only owed to a task
    // the world still expects to finish.
    const active = tracker.activeState === undefined || tracker.activeState === 'Active';
    const spent = statedNumber(tracker.timeSpentMinutes);
    const cost = statedNumber(tracker.totalTimeCostMinutes);
    if (spent !== null && spent < 0) {
        notes.push(worldNote('negative_effort', subject, { subject, minutes: spent }));
    }
    if (active && spent !== null && cost !== null && cost > 0 && spent >= cost) {
        notes.push(worldNote('completed_but_active', subject, { subject, spent, cost }));
    }
}

/**
 * What one tracker states about itself: for the card that shows exactly that project or activity,
 * where the list around it is not the subject and nothing has to be read as a whole.
 * @param {object} tracker
 * @param {string} subject - the name the note should be read as talking about
 * @returns {{ notes: StateNote[] }}
 */
export const assessTracker = (tracker, subject) => {
    const notes = [];
    assessTrackerInto(tracker, subject, notes);
    return { notes };
};

/**
 * The wound rule on its own, over the list a card actually renders: for the views that show a
 * fighter's wounds without being a record of the whole character.
 * @param {object[]} wounds
 * @param {string} subject
 * @returns {{ notes: StateNote[] }}
 */
export const assessWoundProgress = (wounds, subject) => {
    const notes = [];
    assessWoundList(wounds, subject, notes);
    return { notes };
};

/** The bounds a character's standing with the world has to stay inside. */
function assessStanding(value, subject, notes) {
    const reputation = statedNumber(value);
    if (reputation === null) return;
    if (reputation < REPUTATION_FLOOR || reputation > REPUTATION_CEILING) {
        notes.push(worldNote('standing_out_of_range', subject, {
            subject, value: reputation, floor: REPUTATION_FLOOR, ceiling: REPUTATION_CEILING,
        }));
    }
}

/**
 * A wound whose treatment reached what it needed: the rules make that the moment the state
 * changes, so a wound left where it was has either the wrong progress or the wrong threshold.
 */
function assessWoundList(wounds, subject, notes) {
    for (const wound of Array.isArray(wounds) ? wounds : []) {
        const state = wound?.healingState;
        if (!state || state.currentState === 'Healed') continue;
        const progress = statedNumber(state.treatmentProgress);
        const needed = statedNumber(state.progressNeeded);
        if (progress === null || needed === null || needed <= 0) continue;
        if (progress >= needed) {
            notes.push(worldNote('wound_awaiting_transition', subject, { subject, progress, needed }));
            return;
        }
    }
}

/**
 * Reads the living world back: factions with their projects, the NPCs met so far with their
 * activities, standing and wounds, and the threats left working in the places already discovered.
 *
 * The client already enforces two of these invariants on a processed turn (a project that reaches
 * its cost is archived, standing is capped to the ends of the scale), so those two lines mostly
 * surface a record that did not come from a processed turn: an edited history entry or a state
 * written by an older build. Effort and wound progress are written down as the game master states
 * them, and those two lines are the ones a player will actually meet.
 * @param {{ factions?: object[], npcs?: object[], threats?: object[] }} input
 * @returns {{ notes: StateNote[], bySubject: Record<string, StateNote[]> }}
 */
export function assessWorld({ factions = [], npcs = [], threats = [] } = {}) {
    const notes = [];
    for (const faction of Array.isArray(factions) ? factions : []) {
        if (!faction || typeof faction !== 'object') continue;
        const subject = faction.name || faction.factionId || '?';
        for (const project of Array.isArray(faction.activeProjects) ? faction.activeProjects : []) {
            assessTrackerInto(project, subject, notes);
        }
        assessStanding(faction.reputation, subject, notes);
    }
    for (const npc of Array.isArray(npcs) ? npcs : []) {
        if (!npc || typeof npc !== 'object') continue;
        const subject = npc.name || npc.NPCId || '?';
        assessTrackerInto(npc.currentActivity, subject, notes);
        assessStanding(npc.relationshipLevel, subject, notes);
        assessWoundList(npc.wounds, subject, notes);
        // A person's own effects are read by the same reader the character sheet uses, so a buff
        // listed in the world and in the sheet cannot disagree about what it states.
        notes.push(...assessEffects({
            characters: [{ name: subject, effects: npc.activeEffects, wounds: npc.wounds }],
        }).notes);
    }
    for (const threat of Array.isArray(threats) ? threats : []) {
        if (!threat || typeof threat !== 'object') continue;
        assessTrackerInto(threat.currentActivity, threat.name || threat.threatId || '?', notes);
    }

    return { notes, bySubject: groupNotesBySubject(notes) };
}

/**
 * A chronicle entry of a location, read back for #18.A.0 - "The Timestamping Protocol: Anchoring
 * Yourself in Time": "EVERY historical entry you write for 'lastEventsDescription' (and which will
 * be archived in 'eventDescriptions') MUST begin with a precise timestamp in the following
 * MANDATORY format", and the format is "#[Turn Number] - [DayOfMonth] [MonthName] [Year] г.,
 * [HH:MM]: [Event Text]".
 *
 * A missing stamp is not only a broken convention: the location archive reads the turn out of that
 * prefix (`getTurnNumber` in `components/DetailRenderer/LocationDetailsRenderer.tsx`), sorts by it,
 * and the "keep the latest N entries" rule deletes from the bottom of that order. An entry whose
 * turn cannot be read is sorted as -1, which makes it both the oldest event of the world and the
 * first one to be thrown away.
 *
 * The reader asks two questions and nothing else - is a turn written where the rule puts it, and is
 * the hour with it. Month names, the year suffix and the wording of an entry are nobody's business
 * here: entries have to be translated into the player's language, and arguing with a word would be
 * arguing with a language.
 */

/** The shape the archive itself parses, anchored at the very start of the line. */
const CHRONICLE_TURN = /^#\[\d+/;
/** The hour the stamp owes the reader. */
const CHRONICLE_CLOCK = /\b\d{1,2}:\d{2}\b/;
/** A one-word event type above the stamp is a shape the location card accepts, so the stamp may sit on line two. */
const CHRONICLE_TYPE_LINE = /^(Exploration|Combat|Social|Quest|Travel|Crafting|Trade)$/;

const stampedLineOf = (entry) => {
    const [first, second] = entry.split('\n');
    const head = (first || '').trim();
    if (CHRONICLE_TURN.test(head)) return head;
    const next = (second || '').trim();
    return CHRONICLE_TYPE_LINE.test(head) && CHRONICLE_TURN.test(next) ? next : head;
};

/**
 * @param {string[]} entries - chronicle strings as the panel shows them, in its own order
 * @param {string} [subject] - unused in the lines themselves: a mark sits under the entry it is about
 * @returns {{ notes: Array<object>, byIndex: Record<number, object[]> }}
 */
export function assessChronicle(entries = [], subject = '') {
    const notes = [];
    const byIndex = {};
    const list = Array.isArray(entries) ? entries : [];
    list.forEach((entry, index) => {
        if (typeof entry !== 'string' || !entry.trim()) return;
        const stamped = stampedLineOf(entry);
        const kind = !CHRONICLE_TURN.test(stamped)
            ? 'chronicle_turn_unreadable'
            : (!CHRONICLE_CLOCK.test(stamped) ? 'chronicle_clock_missing' : null);
        if (!kind) return;
        const note = worldNote(kind, subject, {});
        notes.push(note);
        (byIndex[index] = byIndex[index] || []).push(note);
    });
    return { notes, byIndex };
}

/**
 * One entry of `worldEventsLog`, read back for #30.4.2 - "Field Definitions for World Event Object".
 * Two of its field definitions are worth a check, because the log is what the world treats as fact:
 *
 *   - "turnNumber: (integer) The number of the turn during which this event was generated. You MUST
 *     use the 'currentTurnNumber' value from the Context." A turn that has not arrived cannot own a
 *     record of what has happened, so a stored number above the current one is a contradiction
 *     between two fields of one state - and the panel groups this log by exactly that number.
 *   - "date: (object, MANDATORY) ... timeOfDay: (string) The exact time in \"HH:MM\" format." The
 *     timeline orders the events of one turn by comparing that string, so an event without a clock
 *     is not merely unlabelled: it slides to wherever a missing field puts it.
 *
 * The reader stays out of everything else: the age of an event (Breaking News, Recent, Historical,
 * ABSOLUTE LAW 7) is measured in game days, and the calendar of a universe is a property of that
 * universe, not a number the client may assume.
 */

/** The clock format #30.4.2 names for `date.timeOfDay`. */
const EVENT_CLOCK = /^\d{1,2}:\d{2}$/;

/**
 * @param {object} event - one entry of the world events log
 * @param {number|undefined} currentTurnNumber - the turn the world is on
 * @returns {{ notes: Array<object> }}
 */
export const assessEvent = (event, currentTurnNumber) => {
    const notes = [];
    if (!event || typeof event !== 'object') return { notes };

    const turn = statedNumber(event.turnNumber);
    const now = statedNumber(currentTurnNumber);
    if (turn !== null && now !== null && turn > now) {
        notes.push(worldNote('event_turn_from_the_future', '', { turn, current: now }));
    }

    const date = event.date;
    if (!date || typeof date !== 'object') {
        notes.push(worldNote('event_date_missing', '', {}));
    } else {
        const timeOfDay = typeof date.timeOfDay === 'string' ? date.timeOfDay.trim() : '';
        if (!EVENT_CLOCK.test(timeOfDay)) {
            notes.push(worldNote('event_clock_missing', '', { value: timeOfDay || '—' }));
        }
    }

    return { notes };
};
