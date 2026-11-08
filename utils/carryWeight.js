/**
 * The ceiling of a load, shared by the inventory gates, the character sheet and the rules.
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

/** Kilos of extra lift every character has past the overload threshold. */
export const DEFAULT_CRITICAL_EXCESS_WEIGHT = 15;

/**
 * The absolute ceiling in kilograms: a character can carry this much, no more.
 * @param {number|undefined} maxWeight overload threshold of the character
 * @param {number|undefined} criticalExcessWeight recorded extra capacity, if any
 * @returns {number}
 */
export function criticalCarryWeight(maxWeight, criticalExcessWeight) {
    const threshold = Number.isFinite(maxWeight) && maxWeight > 0 ? maxWeight : 0;
    // Extra lift is a capacity, so a negative of it is not a capacity at all: the ceiling it would
    // produce sits below the overload threshold, and the character would be refused a load the same
    // rules call merely burdensome - two statements about one body that cannot both be true. A
    // recorded value that cannot be a capacity falls back to the constant, like a missing one.
    const extra = Number.isFinite(criticalExcessWeight) && criticalExcessWeight >= 0
        ? criticalExcessWeight
        : DEFAULT_CRITICAL_EXCESS_WEIGHT;
    return threshold + extra;
}

/**
 * Whether the character carries more than the threshold they can bear without penalty. The
 * overload flag is a property of the load, never a decision: it is refreshed wherever the
 * weight or the capacity is written, so a save cannot keep claiming a state the inventory
 * has already changed.
 *
 * A character with no stated capacity is not encumbered: nothing has been declared too much
 * for them yet, and an absent number must not be turned into a condition the rules would
 * then apply consequences to.
 * @param {number|undefined} maxWeight overload threshold of the character
 * @param {number|undefined} totalWeight kilograms currently carried
 * @returns {boolean}
 */
export function isEncumbered(maxWeight, totalWeight) {
    if (!Number.isFinite(maxWeight)) return false;
    const carried = Number.isFinite(totalWeight) ? totalWeight : 0;
    return carried > maxWeight;
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
