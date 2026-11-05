/** Reserve a gameplay edit until React has committed it. */
export function beginGameplayMutation(revision: { current: number }, pending: { current: boolean }): number {
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

export function guardGameplayActions<T extends Record<string, (...args: any[]) => unknown>>(
    actions: T, blocked: () => boolean
): { [K in keyof T]: (...args: Parameters<T[K]>) => ReturnType<T[K]> | undefined } {
    return Object.fromEntries(Object.entries(actions).map(([key, action]) => [key, (...args: any[]) => {
        if (!blocked()) return action(...args);
        return undefined;
    }])) as { [K in keyof T]: (...args: Parameters<T[K]>) => ReturnType<T[K]> | undefined };
}
