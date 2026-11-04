import type { GameContext, SaveFile } from '../types';
import { snapshotMatchesRendered } from '../hooks/logic/multiplayer';
import { isLocalPreferenceKey } from './localGamePreferences';

type Rendered = Parameters<typeof snapshotMatchesRendered>[1] & { currentContext: GameContext | null };
type HostTurnCandidate = { snapshot: SaveFile; stateSignature: string; contextSignature: string; historySignature: string };

/** Produce a bounded, lossless structural signature without JSON's lossy
 * treatment of undefined, non-finite numbers, sparse arrays or object types.
 * Reject cycles, accessors, symbols and excessive inputs rather than guess. */
function signature(root: unknown): string {
    const path = new Set<object>(); let nodes = 0, chars = 0;
    const visit = (value: unknown, depth: number): string => {
        if (++nodes > 200000 || depth > 200) throw new Error('Turn candidate too complex');
        if (value === null) return 'n';
        if (typeof value === 'undefined') return 'u';
        if (typeof value === 'boolean') return value ? 't' : 'f';
        if (typeof value === 'string') { chars += value.length; if (chars > 24 * 1024 * 1024) throw new Error('Turn candidate too large'); return `s${JSON.stringify(value)}`; }
        if (typeof value === 'number') return `d${Object.is(value, -0) ? '-0' : String(value)};`;
        if (typeof value !== 'object' || path.has(value)) throw new Error('Non-serializable turn candidate');
        const prototype = Object.getPrototypeOf(value);
        if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new Error('Non-plain turn candidate');
        if (Object.getOwnPropertySymbols(value).length) throw new Error('Symbol turn candidate');
        const keys = Object.keys(value).sort();
        if (Object.getOwnPropertyNames(value).length !== keys.length + (Array.isArray(value) ? 1 : 0)) throw new Error('Non-enumerable turn candidate');
        if (Array.isArray(value) && (keys.length !== value.length || keys.some((key, i) => !Object.prototype.hasOwnProperty.call(value, i)))) throw new Error('Sparse turn candidate');
        path.add(value);
        const parts = keys.map(key => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor)) throw new Error('Accessor turn candidate');
            return `${JSON.stringify(key)}:${visit(descriptor.value, depth + 1)}`;
        });
        path.delete(value);
        return `${Array.isArray(value) ? 'a' : 'o'}{${parts.join(',')}}`;
    };
    return visit(root, 0);
}
const stateForSignature = (state: SaveFile['gameState']) => {
    const { imageCache: _cache, cinematics: _cinematics, ...gameplay } = state;
    return gameplay;
};
const contextForSignature = (context: GameContext) => ({ ...context, gameSettings: Object.fromEntries(
    Object.entries(context.gameSettings).filter(([key]) => !isLocalPreferenceKey(key))
) });
/** Capture before React/context effects can change the candidate. Returning
 * null is fail-closed: no caller may confirm a result it cannot fingerprint. */
export function captureHostTurnResult(snapshot: SaveFile): HostTurnCandidate | null {
    try {
        return { snapshot: { ...snapshot, gameState: { ...snapshot.gameState }, gameContext: { ...snapshot.gameContext },
            gameHistory: snapshot.gameHistory.slice(), gameLog: snapshot.gameLog.slice(), combatLog: snapshot.combatLog.slice() },
            stateSignature: signature(stateForSignature(snapshot.gameState)), contextSignature: signature(contextForSignature(snapshot.gameContext)),
            historySignature: signature(snapshot.gameHistory) };
    } catch { return null; }
}
const sameStrings = (a: unknown, b: unknown): boolean => Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((item, index) => typeof item === 'string' && item === b[index]);
/** A staged generation result is not proof of commit. Presentation scene
 * changes may differ, but gameplay, history, logs and context must match. */
export function hostTurnResultCommitted(candidate: HostTurnCandidate | null, rendered: Rendered): boolean {
    try {
        if (!candidate || !rendered.currentContext || !rendered.gameState) return false;
        const snapshot = candidate.snapshot, current = rendered.currentContext;
        if (!sameStrings(snapshot.gameLog, rendered.gameLog) || !sameStrings(snapshot.combatLog, rendered.combatLog) ||
            candidate.stateSignature !== signature(stateForSignature(rendered.gameState)) ||
            candidate.contextSignature !== signature(contextForSignature(current)) ||
            candidate.historySignature !== signature(rendered.gameHistory.slice(0, snapshot.gameHistory.length))) return false;
        return snapshotMatchesRendered({ ...snapshot, gameLog: rendered.gameLog, combatLog: rendered.combatLog, sceneImagePrompt: rendered.sceneImagePrompt }, rendered);
    } catch { return false; }
}
