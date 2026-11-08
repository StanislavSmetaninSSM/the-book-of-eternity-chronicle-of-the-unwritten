/**
 * Who counts the cooldown turns, and what a use inside them means.
 *
 * #6.1.6.7 states the rule as a mechanical one: "The 'cooldownTurns' field on an NPC's skills MUST
 * be respected. An ability with a 'cooldownTurns' of 3 cannot be used again for 3 turns after its
 * use". #12.9.3 states what the response owes the client about it: the names the GM used this turn,
 * in `cooldownsUsed` on that combatant's object - and no counter, because a re-counted number is a
 * second owner of one fact. So the turn of a use and the length of its wait are recorded here, from
 * two things the state already holds: the turn the client is applying, and the `cooldownTurns` of
 * the skill whose `skillName` equals the reported name.
 *
 * What may be called early is decided against the turn that *both* readings of the guide leave
 * uncontested: "cannot be used again for 3 turns" and "the number of turns that must pass after
 * using the skill" differ by one turn, and a reuse on exactly that boundary is therefore not
 * reported at all. Nothing is blocked and nothing is repaired - a use that arrived too early is
 * stored as the pair of numbers it contradicts, and the card of that fighter says so.
 */

/** @typedef {import('../types').ActionCooldown} ActionCooldown */

/** The lines of this reader carry their own key, as every other read-back does. */
const cooldownNote = (kind, subject, params) => ({ key: `cooldown_notes_${kind}`, kind, subject, params: { subject, ...params } });

const asArray = value => (Array.isArray(value) ? value : []);

/** A stated, positive whole number of turns; anything else is no length at all. */
const statedTurns = value => {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return Number.isInteger(number) && number > 0 ? number : null;
};

/** The first turn the reuse does not contradict - and the boundary above it is left alone on purpose. */
export const readyFromTurnOf = (lastUsedTurnNumber, cooldownTurns) => lastUsedTurnNumber + cooldownTurns;

/** The names of an NPC's skills, with the wait each one of them owes. */
const skillCooldownsOf = npc => {
    const lengths = new Map();
    for (const skill of asArray(npc?.activeSkills)) {
        const name = typeof skill?.skillName === 'string' ? skill.skillName.trim() : '';
        const turns = statedTurns(skill?.cooldownTurns);
        if (name && turns !== null) lengths.set(name, turns);
    }
    return lengths;
};

/** The combatant this turn's record belongs to, matched the way the panel matches it. */
const byIdThenName = (list, id, name) =>
    asArray(list).find(entry => id && entry?.NPCId === id)
    || asArray(list).find(entry => name && entry?.name === name)
    || null;

/**
 * The countdown the client keeps for one action, read from a use the GM reported.
 * @param {ActionCooldown | undefined} previous what was already known about this action
 * @param {number} usedTurn the turn the response says used it
 * @param {number} cooldownTurns the length the NPC's own skill states
 */
export const nextCooldownEntry = (previous, usedTurn, cooldownTurns) => {
    const entry = { actionName: '', lastUsedTurnNumber: usedTurn, cooldownTurns, readyFromTurn: readyFromTurnOf(usedTurn, cooldownTurns) };
    if (previous && Number.isInteger(previous.lastUsedTurnNumber) && statedTurns(previous.cooldownTurns) !== null) {
        const earliest = readyFromTurnOf(previous.lastUsedTurnNumber, statedTurns(previous.cooldownTurns));
        if (usedTurn < earliest) {
            // Two numbers that cannot both be true: the use, and the wait the earlier use opened.
            entry.earlyUseTurnNumber = usedTurn;
            entry.earlyUseAgainstReadyFrom = earliest;
        }
        // A later use that is not itself too early does not erase the contradiction before it: the
        // panel still has to show it, and the count restarts from the use that just happened.
        if (!Number.isInteger(entry.earlyUseTurnNumber)
            && Number.isInteger(previous.earlyUseTurnNumber)
            && Number.isInteger(previous.earlyUseAgainstReadyFrom)) {
            entry.earlyUseTurnNumber = previous.earlyUseTurnNumber;
            entry.earlyUseAgainstReadyFrom = previous.earlyUseAgainstReadyFrom;
        }
    }
    return entry;
};

/**
 * One action, one entry. The state is merged from a response that may carry the list back, and a
 * merge of two arrays leaves two entries for one action - so the pair is folded here, keeping the
 * count of the later use and the contradiction of the earlier one. An entry that is not a cooldown at
 * all is passed through: this function folds, it never decides what the panel may not see.
 */
export const dedupeCooldowns = list => {
    const kept = [];
    const byName = new Map();
    for (const entry of asArray(list)) {
        const name = typeof entry?.actionName === 'string' ? entry.actionName : '';
        const turn = Number.isInteger(entry?.lastUsedTurnNumber) ? entry.lastUsedTurnNumber : null;
        if (!name || turn === null) { kept.push(entry); continue; }
        const previous = byName.get(name);
        if (!previous) {
            const copy = { ...entry };
            byName.set(name, copy);
            kept.push(copy);
            continue;
        }
        const merged = turn > previous.lastUsedTurnNumber ? { ...entry } : { ...previous };
        const first = [previous.earlyUseTurnNumber, entry.earlyUseTurnNumber]
            .filter(Number.isInteger).sort((a, b) => a - b)[0];
        delete merged.earlyUseTurnNumber;
        delete merged.earlyUseAgainstReadyFrom;
        if (Number.isInteger(first)) {
            const source = previous.earlyUseTurnNumber === first ? previous : entry;
            merged.earlyUseTurnNumber = first;
            merged.earlyUseAgainstReadyFrom = source.earlyUseAgainstReadyFrom;
        }
        byName.set(name, merged);
        kept[kept.indexOf(previous)] = merged;
    }
    return kept;
};

/**
 * One combatant's list of uses, applied to its merged record. `cooldownsUsed` is consumed here: the
 * key belongs to the response, and a stored one would outlive the turn that wrote it.
 * @returns {ActionCooldown[]} the countdown as it now stands
 */
export const applyCooldownUses = ({ combatant, previousCombatant, npcs, currentTurnNumber }) => {
    const claimed = asArray(combatant?.cooldownsUsed)
        .filter(name => typeof name === 'string' && name.trim() !== '')
        .map(name => name.trim());
    if (combatant && 'cooldownsUsed' in combatant) delete combatant.cooldownsUsed;

    const known = dedupeCooldowns([...asArray(combatant?.cooldowns), ...asArray(previousCombatant?.cooldowns)]);
    if (claimed.length === 0) {
        // Nothing was reported this turn: the waits that are already running stay as they are, and
        // a waiting action is not a contradiction.
        if (combatant) combatant.cooldowns = known.length > 0 ? known : undefined;
        return known;
    }

    if (!Number.isInteger(currentTurnNumber)) {
        if (combatant) combatant.cooldowns = known.length > 0 ? known : undefined;
        return known;
    }

    const npc = byIdThenName(npcs, combatant?.NPCId, combatant?.name);
    const lengths = skillCooldownsOf(npc);

    for (const name of new Set(claimed)) {
        const turns = lengths.get(name);
        if (turns === null || turns === undefined) continue; // no skill of that name, or no length stated
        const index = known.findIndex(entry => entry?.actionName === name);
        const entry = { ...nextCooldownEntry(index >= 0 ? known[index] : undefined, currentTurnNumber, turns), actionName: name };
        if (index >= 0) known[index] = entry;
        else known.push(entry);
    }

    combatant.cooldowns = known.length > 0 ? known : undefined;
    return known;
};

/**
 * The read-back: an action whose use was recorded inside the wait its earlier use opened.
 * @param {ActionCooldown[] | undefined} cooldowns
 * @param {string} subject
 */
export const assessCooldowns = (cooldowns, subject = '') => {
    const notes = [];
    // Folded first, because two copies of one action must not become two accusations of it.
    for (const entry of dedupeCooldowns(cooldowns)) {
        const used = entry?.earlyUseTurnNumber;
        const ready = entry?.earlyUseAgainstReadyFrom;
        const action = typeof entry?.actionName === 'string' ? entry.actionName : '?';
        if (!Number.isInteger(used) || !Number.isInteger(ready)) continue;
        notes.push(cooldownNote('early_use', subject, { action, used, ready }));
    }
    return { notes };
};

/**
 * The waits that are still running on a given turn. This is not an accusation - #6.1.6.7 asks a
 * cooldown to be respected, and an action that is waiting is the rule working. It is shown because
 * the client is the one keeping the count, and a player has no other way to see it. A turn that is
 * not stated silences the whole list instead of guessing one, and an action whose wait is over is
 * left out: "ready" is not news.
 * @param {ActionCooldown[] | undefined} cooldowns
 * @param {number | null | undefined} currentTurnNumber
 * @returns {{ actionName: string, readyFromTurn: number, turnsLeft: number }[]}
 */
export const cooldownStatuses = (cooldowns, currentTurnNumber) => {
    if (!Number.isInteger(currentTurnNumber)) return [];
    return dedupeCooldowns(cooldowns)
        .filter(entry => Number.isInteger(entry?.readyFromTurn) && entry.readyFromTurn > currentTurnNumber)
        .map(entry => ({
            actionName: entry.actionName,
            readyFromTurn: entry.readyFromTurn,
            turnsLeft: entry.readyFromTurn - currentTurnNumber,
        }));
};
