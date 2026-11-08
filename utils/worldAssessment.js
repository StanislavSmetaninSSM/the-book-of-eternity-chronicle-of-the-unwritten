/**
 * What the living world states about itself, read back.
 *
 * The game master advances projects, off-screen activities, reputations, wounds and effects; the
 * interface stores the numbers it is given. Some of those numbers are bounded by the rules
 * themselves: effort written into a tracker cannot fall below zero, a task whose spent time reached its cost is a
 * finished task, the reputation scale runs from -400 to +400, and a wound whose treatment reached
 * `progressNeeded` has changed state rather than stopped at the threshold. Effects are read by
 * `./effectAssessment.js`, which the NPC lists below feed. A record that contradicts one of those
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
