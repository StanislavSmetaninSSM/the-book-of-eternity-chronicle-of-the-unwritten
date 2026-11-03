import type { NetworkRole } from '../types';

/** Until host-authoritative edit commands exist, never make a client-only
 * gameplay or history change that a later host snapshot can silently erase. */
export function clientLocalEditBlocked(role: NetworkRole | undefined): boolean {
    return role === 'player' || role === 'spectator';
}

/** Starting a local edit while a result is in flight cannot revoke that send. */
export function beginGameplayMutation(
    revision: { current: number }, pending: { current: boolean },
    role: NetworkRole | undefined, phase: string, syncPending = false
): number | null {
    if (role === 'player' && (syncPending || phase === 'sending' || phase === 'awaiting-sync')) return null;
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

/** Guard whole user actions, including writes outside the GameState setter. */
export function guardGameplayActions<T extends Record<string, (...args: any[]) => unknown>>(
    actions: T, blocked: () => boolean
): { [K in keyof T]: (...args: Parameters<T[K]>) => ReturnType<T[K]> | undefined } {
    return Object.fromEntries(Object.entries(actions).map(([key, action]) => [key, (...args: any[]) => {
        if (!blocked()) return action(...args);
        return undefined;
    }])) as { [K in keyof T]: (...args: Parameters<T[K]>) => ReturnType<T[K]> | undefined };
}
