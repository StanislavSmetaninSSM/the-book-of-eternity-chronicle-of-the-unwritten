/** A GM request cannot override the player's world-progression setting. */
export function shouldRunWorldProgression(requested, settings) {
    return requested === true && settings?.doNotUseWorldEvents !== true;
}
