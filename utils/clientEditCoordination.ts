/** Browser-wide exclusion for a host's client turn, edit send, and discard.
 * Never queue a user action silently: the caller explains a busy lock instead.
 * Browsers without Web Locks may continue legacy turns, but cannot send new
 * client edits, because their other tabs cannot coordinate safely. */
export class ClientCoordinationUnavailable extends Error {}
export class ClientCoordinationBusy extends Error {}
export async function withClientHostLock<T>(hostId: string, requireLock: boolean, work: () => Promise<T>): Promise<T> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (!locks?.request) {
        if (requireLock) throw new ClientCoordinationUnavailable();
        return work();
    }
    return locks.request(`book-client-host:${hostId}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new ClientCoordinationBusy();
        return work();
    });
}
