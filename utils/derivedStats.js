/**
 * The four numbers a character is described by, computed from the characteristics the rules
 * say to use.
 *
 * Rule #5.7.3 derives them from the permanently modified values - the standard value plus the
 * permanent, flat bonuses of equipment and passive skills - and rule #5.7.4 then applies the
 * conditional and percentage modifiers on top. Two places in the interface need these numbers:
 * the recalculation that runs after every change, and the sheet built at character creation,
 * before any gear exists. They used to carry the formulas side by side, which meant a correction
 * had to be remembered twice; now both ask here, so a character starts with exactly the numbers
 * the engine will keep them at.
 *
 * Each formula rounds the terms the way the rule writes them: health, energy and the critical
 * multiplier round every contribution apart, while carrying capacity rounds its two terms
 * together, so a decomposition that rounds them apart is one kilogram off for some characters.
 */

/** Percentage of health a character has before toughness and muscles add to it. */
export const BASE_HEALTH_PERCENT = 100;

/** Percentage of energy a character has before the four contributing characteristics add to it. */
export const BASE_ENERGY_PERCENT = 100;

/** Kilograms every character can carry, before strength and constitution are counted. */
export const CARRY_CAPACITY_BASE_WEIGHT = 30;

/** The smallest roll on a d20 there is: luck can make a critical hit certain, not easier than a 1. */
export const MINIMUM_CRITICAL_HIT_THRESHOLD = 1;

/** The roll a critical hit needs without any luck at all. */
export const NATURAL_TWENTY_CRITICAL_THRESHOLD = 20;

const value = (characteristic) => Number.isFinite(characteristic) ? characteristic : 1;

/**
 * Maximum health as a percentage, from the permanently modified characteristics (#5.7.3.3).
 * @param {number|undefined} constitution
 * @param {number|undefined} strength
 * @returns {number}
 */
export function maxHealthPercent(constitution, strength) {
    return BASE_HEALTH_PERCENT + Math.floor(value(constitution) * 2.0) + Math.floor(value(strength) * 1.0);
}

/**
 * Maximum energy as a percentage, from the permanently modified characteristics (#5.7.3.2).
 * @param {number|undefined} constitution
 * @param {number|undefined} intelligence
 * @param {number|undefined} wisdom
 * @param {number|undefined} faith
 * @returns {number}
 */
export function maxEnergyPercent(constitution, intelligence, wisdom, faith) {
    return BASE_ENERGY_PERCENT
        + Math.floor(value(constitution) * 0.75)
        + Math.floor(value(intelligence) * 0.75)
        + Math.floor(value(wisdom) * 0.75)
        + Math.floor(value(faith) * 0.75);
}

/**
 * What a character carries without becoming overloaded, in kilograms (#5.7.3.1). Strength and
 * constitution form one term that is rounded once, after permanent bonuses are folded in.
 * @param {number|undefined} strength
 * @param {number|undefined} constitution
 * @returns {number}
 */
export function maxCarryWeight(strength, constitution) {
    const str = value(strength);
    const con = value(constitution);
    return CARRY_CAPACITY_BASE_WEIGHT + Math.floor(str * 1.8 + con * 0.4);
}

/**
 * How much luck lowers the roll a critical hit needs (#5.7.3.4).
 * @param {number|undefined} luck permanently modified luck
 * @returns {number}
 */
export function critChanceBuffFromLuck(luck) {
    return Math.floor(value(luck) / 20);
}

/**
 * The minimum d20 roll that scores a critical hit (#5.7.3.4). The result stays inside the die:
 * no amount of luck makes a roll better than 1, and luck driven below zero - a cursed item can
 * do that - must not raise the requirement past a natural 20, which is a critical hit for every
 * combatant in this game, nameless ones included.
 * @param {number|undefined} luck permanently modified luck
 * @returns {number} between 1 and 20
 */
export function criticalHitThreshold(luck) {
    const threshold = NATURAL_TWENTY_CRITICAL_THRESHOLD - critChanceBuffFromLuck(luck);
    return Math.min(NATURAL_TWENTY_CRITICAL_THRESHOLD, Math.max(MINIMUM_CRITICAL_HIT_THRESHOLD, threshold));
}
