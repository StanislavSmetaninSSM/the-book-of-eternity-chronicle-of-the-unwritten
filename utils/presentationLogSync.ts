import type { SaveFile } from '../types';

/** Only log arrays derived from the staged authoritative log are eligible for
 * its commit barrier. Keep evidence on the pending restore, not the snapshot. */
export type PendingPresentationLog = { snapshot: SaveFile | null; allowedGameLogs?: WeakSet<string[]> };
export function recordPresentationLog(pending: PendingPresentationLog | null, previous: string[], next: string[]): void {
    if (!pending?.snapshot || (previous !== pending.snapshot.gameLog && !pending.allowedGameLogs?.has(previous))) return;
    // Presentation events prepend; a clear or replacement must not be treated
    // as evidence that the authoritative log was preserved.
    if (next.length < previous.length || !previous.every((entry, i) => next[next.length - previous.length + i] === entry)) return;
    (pending.allowedGameLogs ??= new WeakSet()).add(next);
}
