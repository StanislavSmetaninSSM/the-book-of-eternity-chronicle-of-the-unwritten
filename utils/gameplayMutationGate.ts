import type { NetworkRole } from '../types';

/** Starting a local edit while a result is in flight cannot revoke that send. */
export function beginGameplayMutation(
    revision: { current: number }, pending: { current: boolean },
    role: NetworkRole | undefined, phase: string
): number | null {
    if (role === 'player' && (phase === 'sending' || phase === 'awaiting-sync')) return null;
    pending.current = true;
    return ++revision.current;
}

/** Only release the submission barrier after all queued edits have committed. */
export function gameplayMutationCommitted(
    pending: { current: boolean }, applied: { current: number }, revision: { current: number },
    renderedState: unknown, currentState: unknown
): boolean {
    if (!pending.current || applied.current !== revision.current || renderedState !== currentState) return false;
    pending.current = false;
    return true;
}
