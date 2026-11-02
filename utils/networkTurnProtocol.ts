export interface TurnSyncStamp {
    version: 1;
    sessionId: string;
    revision: number;
}
export interface TurnSubmission {
    turnId: string;
    base: TurnSyncStamp;
}
export type TurnDecision = 'accepted' | 'duplicate' | 'stale' | 'invalid' | 'unauthorized' | 'pending' | 'unknown';

export const isTurnSyncStamp = (value: any): value is TurnSyncStamp =>
    value?.version === 1 && typeof value.sessionId === 'string' && value.sessionId.length > 0 &&
    Number.isSafeInteger(value.revision) && value.revision >= 0;

/** Authority lives only for one hosting session; stale/legacy peers fail closed. */
export class HostTurnAuthority {
    private sessionId: string;
    private revision = 0;
    private issuedRevision: number | null = null;
    private pendingMutations = 0;
    private accepted = new Map<string, { senderId: string; outcome: 'accepted' | 'unknown' }>();
    constructor(private readonly newId: () => string = () => crypto.randomUUID()) {
        this.sessionId = newId();
    }
    reset(): void {
        this.sessionId = this.newId(); this.revision = 0; this.issuedRevision = null;
        this.pendingMutations = 0; this.accepted.clear();
    }
    /** Invalidate grants before React gets a chance to defer a state update. */
    beginMutation(): () => void {
        this.revision++; this.issuedRevision = null; this.pendingMutations++;
        let finished = false;
        return () => {
            if (finished) return;
            finished = true; this.pendingMutations = Math.max(0, this.pendingMutations - 1);
            this.revision++; this.issuedRevision = null;
        };
    }
    /** Force a new grant when a client requests sync, even if state did not change. */
    revoke(): void { this.revision++; this.issuedRevision = null; }
    issue(): TurnSyncStamp | null {
        if (this.pendingMutations !== 0) return null;
        this.issuedRevision = this.revision;
        return { version: 1, sessionId: this.sessionId, revision: this.revision };
    }
    accept(submission: any, senderId: string | undefined, connectionId: string, activePlayerId: string | undefined, hostBusy = false): TurnDecision {
        if (!senderId || senderId !== connectionId) return 'unauthorized';
        if (!submission || typeof submission.turnId !== 'string' || submission.turnId.length < 16 || submission.turnId.length > 128 || !isTurnSyncStamp(submission.base)) return 'invalid';
        const previous = this.accepted.get(submission.turnId);
        if (previous) return previous.senderId !== senderId ? 'unauthorized' : previous.outcome === 'unknown' ? 'unknown' : 'duplicate';
        if (senderId !== activePlayerId) return 'unauthorized';
        if (hostBusy) return 'pending';
        if (this.pendingMutations !== 0) return 'pending';
        if (submission.base.sessionId !== this.sessionId || submission.base.revision !== this.issuedRevision || this.issuedRevision !== this.revision) return 'stale';
        // Consume before touching React state or awaiting network sends.
        this.accepted.set(submission.turnId, { senderId, outcome: 'accepted' }); this.revision++; this.issuedRevision = null;
        return 'accepted';
    }
    markUnknown(turnId: string): void {
        const entry = this.accepted.get(turnId);
        if (entry) entry.outcome = 'unknown';
    }
}

/** Never restore a reordered snapshot or silently cross hosting sessions. */
export function acceptHostStamp(current: TurnSyncStamp | null, next: unknown): 'accept' | 'duplicate' | 'stale' | 'invalid' {
    if (!isTurnSyncStamp(next)) return 'invalid';
    if (!current) return 'accept';
    if (next.sessionId !== current.sessionId) return 'invalid';
    if (next.revision < current.revision) return 'stale';
    return next.revision === current.revision ? 'duplicate' : 'accept';
}
