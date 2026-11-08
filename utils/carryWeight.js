/**
 * Carrying capacity, shared by the inventory gates, the character sheet and the rules.
 *
 * Two numbers describe a load. 'maxWeight' is what the character carries without being
 * overloaded, and every kilo above it makes the character overloaded but does not by itself
 * forbid picking something up. 'criticalExcessWeight' is how far past that threshold the
 * character can still lift, and it is the absolute ceiling: past it, an item is refused.
 *
 * The game master applies the same ceiling (Rule #10.1.0.1 for the player, Rule #19.C for an
 * NPC), so a decision the interface takes alone must not drift from the one the rules describe:
 * a stack that lands exactly on the ceiling is carried, because the ceiling is the maximum
 * weight, and a character whose extra capacity was never recorded gets the universal constant.
 */

/** Kilos every character carries before Strength and constitution start to matter. */
export const CARRY_CAPACITY_BASE_WEIGHT = 30;

/** Kilos of extra lift every character has past the overload threshold. */
export const DEFAULT_CRITICAL_EXCESS_WEIGHT = 15;

/**
 * What a character carries without becoming overloaded (Rule #5.7.3, and the same formula the
 * game master applies): the base capacity plus one term of Strength and constitution rounded
 * together, so that a permanent bonus from gear shifts the whole term rather than each part.
 * @param {number|undefined} strength permanently modified Strength
 * @param {number|undefined} constitution permanently modified Constitution
 * @returns {number} kilograms
 */
export function maxCarryWeight(strength, constitution) {
    const str = Number.isFinite(strength) ? strength : 1;
    const con = Number.isFinite(constitution) ? constitution : 1;
    return CARRY_CAPACITY_BASE_WEIGHT + Math.floor(str * 1.8 + con * 0.4);
}

/**
 * The absolute ceiling in kilograms: a character can carry this much, no more.
 * @param {number|undefined} maxWeight overload threshold of the character
 * @param {number|undefined} criticalExcessWeight recorded extra capacity, if any
 * @returns {number}
 */
export function criticalCarryWeight(maxWeight, criticalExcessWeight) {
    const threshold = Number.isFinite(maxWeight) && maxWeight > 0 ? maxWeight : 0;
    const extra = Number.isFinite(criticalExcessWeight) ? criticalExcessWeight : DEFAULT_CRITICAL_EXCESS_WEIGHT;
    return threshold + extra;
}

/**
 * Whether a load of 'prospectiveWeight' kilograms fits what the character can carry.
 * @param {number|undefined} maxWeight overload threshold of the character
 * @param {number|undefined} criticalExcessWeight recorded extra capacity, if any
 * @param {number|undefined} prospectiveWeight total weight after the move is applied
 * @returns {boolean}
 */
export function canCarryWeight(maxWeight, criticalExcessWeight, prospectiveWeight) {
    const weight = Number.isFinite(prospectiveWeight) ? prospectiveWeight : 0;
    return weight <= criticalCarryWeight(maxWeight, criticalExcessWeight);
}
