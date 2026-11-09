/**
 * What the living world states about itself, read back.
 *
 * The game master advances projects, off-screen activities, reputations, wounds and effects; the
 * interface stores the numbers it is given. Some of those numbers are bounded by the rules
 * themselves: effort written into a tracker cannot fall below zero, a task whose spent time reached its cost is a
 * finished task, the reputation scale runs from -400 to +400, a wound whose treatment reached,
 * and every threshold a rank of a faction ladder asks its member to have.
 * `progressNeeded` has changed state rather than stopped at the threshold. Effects are read by
 * `./effectAssessment.js`, which the NPC lists below feed, and every chronicle entry of a
 * location is read for the stamp #18.A.0 puts at its head. A record that contradicts one of those
 * is not a disagreement about the fiction - it is a state no rule produces, and the panel says so
 * in one line.
 *
 * Nothing is repaired here. The client cannot know which of the two numbers the turn meant to
 * write: the cost, or the time spent against it. So it names the pair and stays quiet about
 * everything it cannot read off the state - judgement calls (an abandoned project, a bonus the GM
 * granted by hand) are never reported, and a number that is absent is not treated as a zero. The order
 * a ladder is written in is a decision of the same kind - #21.2.6 puts a rank granted for a great deed
 * where the story wants it - so a threshold is read on its own and the sequence between them is not.
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
 * One rank of a ladder, read for the two facts its threshold owes the rules. #21.2.5 asks that the
 * requirements of the ranks "be appropriately spaced out along the new -400 to +400 scale", and its
 * point 4 promotes whoever reaches them: a threshold outside the scale can never be met, because the
 * standing of a character is capped to those same ends, and a threshold that is not a number cannot
 * be compared against anything - the panel would only be quoting it.
 */
function assessRankRow(rank) {
    if (!rank || typeof rank !== 'object') return null;
    const threshold = statedNumber(rank.requiredReputation);
    if (threshold === null) return { kind: 'rank_threshold_unreadable' };
    if (threshold < REPUTATION_FLOOR || threshold > REPUTATION_CEILING) {
        return { kind: 'rank_threshold_out_of_range', value: threshold };
    }
    return null;
}

/** A row of the ladder is addressed by the branch it is listed under and its place in that branch. */
export const rankRowKey = (branchId, index) => `${branchId || 'ranks'}#${index}`;

/**
 * The hierarchy of a faction as the panel of that faction shows it: a line per rank row that states an
 * impossible threshold, kept with the row it belongs to, and one line about the rank the faction claims
 * its member holds. The marks are attached row by row because a ladder is long, and a reader has to see
 * which rank is being questioned; the held rank is a fact about the whole faction, so it comes back apart.
 *
 * The sequence of the thresholds is not read. #21.2.5 asks them to increase, while #21.2.6 takes a rank
 * awarded for a great deed and inserts it "usually at the very top" with the reputation the player already
 * has as its threshold - a rank placed above a higher number is the story deciding, and two ranks at one
 * number are legal for the same reason, since the promotion the rules ask for is a narrative event.
 * @param {object} [faction]
 * @param {string} subject
 * @returns {{ notes: StateNote[], byRank: Record<string, StateNote[]>, aboutHeld: StateNote[] }}
 */
export function assessHierarchy(faction, subject) {
    const notes = [];
    /** @type {Record<string, StateNote[]>} */
    const byRank = {};
    const aboutHeld = [];
    const branches = Array.isArray(faction?.ranks?.branches) ? faction.ranks.branches : [];
    const names = [];
    // The ids the ladder and the member are allowed to point at. Both are dereferenced by the panel:
    // `playerBranch` picks whose ladder is drawn, and the paths a junction rank offers are looked up
    // in the same list - a name missing from it reaches the player as a raw id.
    const branchIds = new Set(branches.map(b => (typeof b?.branchId === 'string' ? b.branchId.trim() : '')).filter(Boolean));
    for (const branch of branches) {
        if (!branch || typeof branch !== 'object') continue;
        const ranks = Array.isArray(branch.ranks) ? branch.ranks : [];
        ranks.forEach((rank, index) => {
            if (rank && typeof rank === 'object') names.push(rank.rankNameMale, rank.rankNameFemale);
            const found = assessRankRow(rank);
            if (!found) return;
            const rankName = String(rank.rankNameMale || rank.rankNameFemale || '?').trim() || '?';
            const params = found.kind === 'rank_threshold_out_of_range'
                ? { subject, rank: rankName, value: found.value, floor: REPUTATION_FLOOR, ceiling: REPUTATION_CEILING }
                : { subject, rank: rankName };
            const note = worldNote(found.kind, subject, params);
            notes.push(note);
            const key = rankRowKey(branch.branchId, index);
            if (!byRank[key]) byRank[key] = [];
            byRank[key].push(note);
        });
    }
    // The two questions a junction rank owes the shape of a rank: an array of offered branches "MUST be present if
    // 'isJunctionPoint' is 'true'", and it has to hold the 'branchId' values the faction defines - a
    // choice offered to the player that leads to no branch is not a choice.
    const pathsOf = rank => (Array.isArray(rank?.availableBranches) ? rank.availableBranches : [])
        .map(id => (typeof id === 'string' ? id.trim() : '')).filter(Boolean);
    for (const branch of branches) {
        const ranks = Array.isArray(branch?.ranks) ? branch.ranks : [];
        ranks.forEach((rank, index) => {
            if (!rank || typeof rank !== 'object' || rank.isJunctionPoint !== true) return;
            const key = rankRowKey(branch.branchId, index);
            const push = (kind, params) => {
                const note = worldNote(kind, subject, { subject, ...params });
                notes.push(note);
                if (!byRank[key]) byRank[key] = [];
                byRank[key].push(note);
            };
            const paths = pathsOf(rank);
            const rankName = String(rank.rankNameMale || rank.rankNameFemale || '?').trim() || '?';
            if (paths.length === 0) {
                push('junction_without_paths', { rank: rankName });
                return;
            }
            const missing = paths.filter(id => !branchIds.has(id));
            if (missing.length > 0) {
                push('junction_branch_unknown', { rank: rankName, branches: missing.join(', ') });
            }
        });
    }
    const held = typeof faction?.playerRank === 'string' ? faction.playerRank.trim() : '';
    // A name the ladder does not carry. #21.2.6 requires a rank it invents to be inserted into the array,
    // and the panel highlights a row by that very name, so a title outside the ladder has nothing to
    // point at. An empty ladder says nothing of its own: no rank was ever promised there.
    if (held && names.filter(Boolean).length > 0 && !names.filter(Boolean).includes(held)) {
        const note = worldNote('rank_unlisted', subject, { subject, rank: held });
        notes.push(note);
        aboutHeld.push(note);
    }
    // Which ladder the member walks is named by an id, and #23.A keeps it a branch of this faction (or
    // null while the core one is walked): a name the faction does not have leaves the panel choosing a
    // different branch to show, while the save still says something else.
    const walked = typeof faction?.playerBranch === 'string' ? faction.playerBranch.trim() : '';
    if (walked && branchIds.size > 0 && !branchIds.has(walked)) {
        const note = worldNote('branch_unknown', subject, { subject, branch: walked });
        notes.push(note);
        aboutHeld.push(note);
    }
    return { notes, byRank, aboutHeld };
}

/**
 * The gate a relationship is locked behind. #19.F writes the standing and the lock in one transaction
 * and orders the standing clamped to the gate itself - "You MUST clamp the 'relationshipLevel' to the
 * exact cap value" for a cap, "You MUST clamp the 'relationshipLevel' to this floor value" for a floor -
 * so a locked person either stands at the gate or on the open side of it. A number past the gate is a
 * state that transaction cannot produce, and the panel is left holding a standing the next turn clamps
 * back without anyone asking.
 *
 * The other half of the rule is not read: the gate is meant to open again once the standing drops
 * "significantly below" it, and the guide offers its own margin as an example ("e.g., by 15 or more
 * points"). A boundary stated as an example is a judgement, and the client has no business second-
 * guessing how far below the number the turn was meant to land.
 */
function assessGate(npc, subject, notes) {
    const lock = npc?.relationshipLock;
    if (!lock || typeof lock !== 'object' || lock.isLocked !== true) return;
    const gate = statedNumber(lock.currentCap);
    const standing = statedNumber(npc.relationshipLevel);
    if (gate === null || standing === null) return;
    const beyond = gate >= 0 ? standing > gate : standing < gate;
    if (beyond) {
        notes.push(worldNote('relationship_level_beyond_gate', subject, { subject, value: standing, gate }));
    }
}

/**
 * The archive of finished work: the completed projects of a faction, and the completed activities of a
 * threat and of a person. Three questions are asked, each answered by the shape the record itself
 * declares, and none of them by the story.
 *
 * - The ending has to be one of the values the record holds. `finalState` is written as
 *   "'Completed' | 'Abandoned'" and `finalOutcome` as "'Success' | 'SuccessWithComplication' | 'Failure'",
 *   and the interface reads those words by name (`project.activeState === 'Abandoned'`, the "Completed"
 *   and "Abandoned" counts of the archive) - so a third word is an ending nothing acts on, and an entry
 *   with no ending at all is work filed away without ever being finished.
 * - One identity is filed away once. A faction resolves a project by its `projectId` before it looks at
 *   the archive (`locateFactionProject`), so the second copy of an id is a record the player cannot reach.
 * - A record is either running or filed. The delayed completion command can leave the same id in both
 *   lists of one owner, and that is the state where the panel counts the project twice and the delete
 *   handler takes the running copy.
 *
 * Repetition is not duplication: an activity can be carried out twice, so the reader compares identities
 * only when both sides state one (`activityId` is optional, legacy records omit it) and never the
 * wording of a name. The archive of a location is not read: no panel lists those entries, so a mark
 * there would have nowhere to sit.
 */
const ARCHIVE_ENDINGS = ['Completed', 'Abandoned'];
const ARCHIVE_OUTCOMES = ['Success', 'SuccessWithComplication', 'Failure'];

/** A record is addressed by the id it carries, and by name in the line the panel shows. */
const statedIdOf = (record, field) => (typeof record?.[field] === 'string' && record[field].trim() ? record[field].trim() : null);
const namedAs = (record, fallback) => String(record?.projectName ?? record?.activityName ?? '').trim() || fallback;

function assessArchiveInto(subject, archive, { active, idField, stateField, allowed, label, notes }) {
    const filed = Array.isArray(archive) ? archive : [];
    const times = new Map();
    for (const record of filed) {
        if (!record || typeof record !== 'object') continue;
        const name = namedAs(record, label);
        const stated = typeof record[stateField] === 'string' ? record[stateField].trim() : '';
        if (!stated) {
            notes.push(worldNote('archive_state_missing', subject, { subject, record: name }));
        } else if (!allowed.includes(stated)) {
            notes.push(worldNote('archive_state_unknown', subject, { subject, record: name, value: stated, allowed: allowed.join(' / ') }));
        }
        const id = statedIdOf(record, idField);
        if (id) times.set(id, (times.get(id) || 0) + 1);
    }
    for (const [id, count] of times) {
        if (count > 1) notes.push(worldNote('archive_filed_twice', subject, { subject, id, times: count }));
    }
    const running = Array.isArray(active) ? active : (active ? [active] : []);
    for (const record of running) {
        const id = statedIdOf(record, idField);
        if (!id || !times.has(id)) continue;
        notes.push(worldNote('archive_running_and_filed', subject, { subject, record: namedAs(record, label), id }));
    }
}

/**
 * The finished work of one faction, read on its own: for the tab that lists the archive and offers to
 * delete from it, where the row a player points at is the row the line has to describe.
 * @param {object} [faction]
 * @param {string} subject
 * @returns {{ notes: StateNote[] }}
 */
export function assessFactionArchive(faction, subject) {
    const notes = [];
    assessArchiveInto(subject, faction?.completedProjects, {
        active: faction?.activeProjects, idField: 'projectId', stateField: 'finalState',
        allowed: ARCHIVE_ENDINGS, label: 'project', notes,
    });
    return { notes };
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
        assessArchiveInto(subject, faction.completedProjects, {
            active: faction.activeProjects, idField: 'projectId', stateField: 'finalState',
            allowed: ARCHIVE_ENDINGS, label: 'project', notes,
        });
        // The ladder is read by the same reader the hierarchy view uses, so a card of a faction and the
        // view of its ranks cannot disagree about which threshold is impossible.
        notes.push(...assessHierarchy(faction, subject).notes);
    }
    for (const npc of Array.isArray(npcs) ? npcs : []) {
        if (!npc || typeof npc !== 'object') continue;
        const subject = npc.name || npc.NPCId || '?';
        assessTrackerInto(npc.currentActivity, subject, notes);
        assessStanding(npc.relationshipLevel, subject, notes);
        assessGate(npc, subject, notes);
        assessWoundList(npc.wounds, subject, notes);
        assessArchiveInto(subject, npc.completedActivities, {
            active: npc.currentActivity ? [npc.currentActivity] : [], idField: 'activityId',
            stateField: 'finalOutcome', allowed: ARCHIVE_OUTCOMES, label: 'activity', notes,
        });
        // A person's own effects are read by the same reader the character sheet uses, so a buff
        // listed in the world and in the sheet cannot disagree about what it states.
        notes.push(...assessEffects({
            characters: [{ name: subject, effects: npc.activeEffects, wounds: npc.wounds }],
        }).notes);
    }
    for (const threat of Array.isArray(threats) ? threats : []) {
        if (!threat || typeof threat !== 'object') continue;
        assessTrackerInto(threat.currentActivity, threat.name || threat.threatId || '?', notes);
        const threatSubject = threat.name || threat.threatId || '?';
        assessArchiveInto(threatSubject, threat.completedActivities, {
            active: threat.currentActivity ? [threat.currentActivity] : [], idField: 'activityId',
            stateField: 'finalState', allowed: ARCHIVE_ENDINGS, label: 'activity', notes,
        });
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
