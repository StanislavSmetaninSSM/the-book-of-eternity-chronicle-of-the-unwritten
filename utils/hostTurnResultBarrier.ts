import type { GameContext, SaveFile } from '../types';
import { snapshotMatchesRendered } from '../hooks/logic/multiplayer';
import { sharedSettingsEqual } from './localGamePreferences';

type Rendered = Parameters<typeof snapshotMatchesRendered>[1] & { currentContext: GameContext | null };
/** Capture top-level values before React/context effects can change them. */
export function captureHostTurnResult(snapshot: SaveFile): SaveFile {
    return { ...snapshot, gameState: { ...snapshot.gameState }, gameContext: { ...snapshot.gameContext },
        gameHistory: snapshot.gameHistory.slice(), gameLog: snapshot.gameLog.slice(), combatLog: snapshot.combatLog.slice() };
}
const sameStrings = (a: unknown, b: unknown): boolean => Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((item, index) => typeof item === 'string' && item === b[index]);
/** A staged generation result is not proof of commit. Presentation scene
 * changes may differ, but gameplay, history, logs and context must match. */
export function hostTurnResultCommitted(candidate: SaveFile, rendered: Rendered): boolean {
    const current = rendered.currentContext, expected = candidate.gameContext;
    if (!current || !expected || !sameStrings(candidate.gameLog, rendered.gameLog) || !sameStrings(candidate.combatLog, rendered.combatLog)) return false;
    const keys = Object.keys(expected) as (keyof GameContext)[];
    if (keys.some(key => key === 'gameSettings'
        ? !sharedSettingsEqual(expected.gameSettings, current.gameSettings)
        : current[key] !== expected[key])) return false;
    return snapshotMatchesRendered({ ...candidate, gameLog: rendered.gameLog, combatLog: rendered.combatLog, sceneImagePrompt: rendered.sceneImagePrompt }, rendered);
}
