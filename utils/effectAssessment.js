/**
 * What an active effect states about itself, read back.
 *
 * Effects are the part of the record the world keeps *ticking*: the rules say a duration counts
 * remaining combat turns, is decremented at the end of each turn of the affected combatant, and
 * expires when it reaches 0. That makes the numbers on an effect both a description and a mechanism,
 * so a record that contradicts them does not just read oddly - it keeps an effect alive that should
 * have ended, or ends one that the rules hold open. The checks below are limited to what the
 * rulebook states about the fields of an effect object (#6.2.1, #6.2.2.0, #6.2.2.4); everything else
 * about an effect - whether the magnitude is fair, whether the GM was right to grant it - is not the
 * client's business and is never reported.
 */

/** The types #6.2.2.4 names as needing a duration because they are limited in time. */
export const TIME_LIMITED_EFFECT_TYPES = Object.freeze(['DamageOverTime', 'HealOverTime', 'Buff', 'Debuff', 'Control']);
/** The type whose persistence the rules express with a fixed number rather than a countdown. */
export const WOUND_REFERENCE_EFFECT_TYPE = 'WoundReference';
/** "For 'effectType: "WoundReference"', 'duration' MUST always be '999'". */
export const PERSISTENT_EFFECT_DURATION = 999;

/**
 * A number the state actually states. Shared with the world read-back: an absent, blank or
 * unparseable value is not a zero, and inventing one would turn a missing field into an accusation.
 */
export const statedNumber = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return null;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

/**
 * A note names the line it will be read from, so the reader and the panel showing it cannot drift
 * apart: the world list and the character sheet show the same note because it is the same note.
 */
const effectNote = (kind, subject, params) => ({ key: `effect_notes_${kind}`, kind, subject, params });

/**
 * One line of the read-back: the UI string it was written for, the object it talks about, and the
 * numbers it quotes. The reader owns all three, so a panel cannot pair a note with another line.
 * @typedef {object} StateNote
 * @property {string} key
 * @property {string} kind
 * @property {string} subject
 * @property {Record<string, string|number>} params
 */

/** Groups notes by the object they talk about, so a card can show only its own lines. */
export const groupNotesBySubject = (notes) => {
    const bySubject = {};
    for (const note of notes) {
        (bySubject[note.subject] = bySubject[note.subject] || []).push(note);
    }
    return bySubject;
};

/** "Buff 'strength'" - type and target are what the state itself uses to name an effect. */
const effectLabel = (effect) => {
    const type = typeof effect.effectType === 'string' && effect.effectType.trim() ? effect.effectType.trim() : '?';
    const target = typeof effect.targetType === 'string' && effect.targetType.trim() ? ` '${effect.targetType.trim()}'` : '';
    return `${type}${target}`;
};

const statedText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function assessEffect(effect, subject, wounds, notes) {
    const label = effectLabel(effect);
    const type = statedText(effect.effectType) || '';
    const rawDuration = effect.duration;
    const durationStated = rawDuration !== undefined && rawDuration !== null;
    const duration = statedNumber(rawDuration);
    // A value that is there but not a number still contradicts "must be a whole number", and naming
    // it as a missing duration would blame the state for a field it did write.
    const shownDuration = duration === null ? String(rawDuration).trim() : duration;
    const isWoundReference = type === WOUND_REFERENCE_EFFECT_TYPE;

    if (isWoundReference) {
        // The rules fix this duration rather than counting it down, and the client keeps an effect
        // untouched at 999: any other value makes a wound's effect expire mid-chronicle.
        if (!durationStated) {
            notes.push(effectNote('wound_reference_duration_missing', subject, {
                subject, label, expected: PERSISTENT_EFFECT_DURATION,
            }));
        } else if (duration !== PERSISTENT_EFFECT_DURATION) {
            notes.push(effectNote('wound_reference_duration', subject, {
                subject, label, duration: shownDuration, expected: PERSISTENT_EFFECT_DURATION,
            }));
        }
        const woundId = statedText(effect.sourceWoundId);
        if (!woundId) {
            notes.push(effectNote('wound_reference_without_id', subject, { subject, label }));
            return;
        }
        if (!Array.isArray(wounds)) return;
        const linked = wounds.find(wound => wound && statedText(wound.woundId) === woundId);
        if (!linked) {
            notes.push(effectNote('wound_reference_wound_missing', subject, { subject, label, wound: woundId }));
        } else if (linked.healingState?.currentState === 'Healed') {
            notes.push(effectNote('wound_reference_wound_healed', subject, {
                subject, label, wound: statedText(linked.woundName) || woundId,
            }));
        }
        return;
    }

    if (!durationStated) {
        if (TIME_LIMITED_EFFECT_TYPES.includes(type)) {
            notes.push(effectNote('duration_missing', subject, { subject, label }));
        }
        return;
    }
    if (duration === null) {
        notes.push(effectNote('duration_not_whole', subject, { subject, label, duration: shownDuration }));
        return;
    }
    if (duration <= 0) {
        notes.push(effectNote('expired_but_listed', subject, { subject, label, duration }));
        return;
    }
    if (!Number.isInteger(duration)) {
        notes.push(effectNote('duration_not_whole', subject, { subject, label, duration }));
    }
}

/**
 * Reads the effect lists back. Each carrier is `{ name, effects, wounds }`: a character together
 * with the list its effects are kept in and the wounds those lists may point at. A caller holding
 * two lists for one character passes two carriers - duplicates are looked for inside one list,
 * which is where the rules place the identity of an effect.
 * @param {{ characters: Array<{ name?: string, subject?: string, effects?: object[],
 *   wounds?: object[] }> }} input
 * @returns {{ notes: StateNote[], bySubject: Record<string, StateNote[]> }}
 */
export function assessEffects({ characters = [] } = {}) {
    const notes = [];
    const list = Array.isArray(characters) ? characters : [];
    for (const carrier of list) {
        if (!carrier || typeof carrier !== 'object') continue;
        const subject = statedText(carrier.name) || statedText(carrier.subject) || '?';
        const effects = Array.isArray(carrier.effects) ? carrier.effects : [];
        const wounds = Array.isArray(carrier.wounds) ? carrier.wounds : null;

        for (const effect of effects) {
            if (!effect || typeof effect !== 'object') continue;
            assessEffect(effect, subject, wounds, notes);
        }

        // "This field is critical for preventing duplicate effects": one identified effect is one
        // entry, so the same id listed twice is the duplication the id exists to stop.
        const seen = new Map();
        for (const effect of effects) {
            const effectId = effect && typeof effect === 'object' ? statedText(effect.effectId) : null;
            if (effectId) seen.set(effectId, (seen.get(effectId) || 0) + 1);
        }
        for (const [effectId, times] of seen) {
            if (times > 1) {
                notes.push(effectNote('duplicate_effect_id', subject, { subject, effectId, times }));
            }
        }
    }

    return { notes, bySubject: groupNotesBySubject(notes) };
}
