/**
 * Autosave once per completed turn, and again whenever generated or uploaded images
 * change. Image generation can finish after the turn save has already been written.
 */
export function shouldAutosaveGameState(
  turnNumber: number,
  lastSavedTurn: number | null,
  imageCache: unknown,
  lastSavedImageCache: unknown,
): boolean {
  return turnNumber > 0 && (turnNumber !== lastSavedTurn || imageCache !== lastSavedImageCache);
}
