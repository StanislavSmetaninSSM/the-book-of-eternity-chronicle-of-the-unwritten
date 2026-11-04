import { HostTurnAuthority, isTurnSyncStamp, type TurnSyncStamp } from './networkTurnProtocol';
import type { GameState } from '../types';

/** Preparatory wire contract; not advertised or dispatched until host execution,
 * durable client intents and snapshot-linked completion are integrated. */
export type HostTurnCommand = {
    version: 1; sessionId: string; commandId: string; playerId: string; base: TurnSyncStamp;
    kind: 'action' | 'question'; text: string; image: { data: string; mimeType: string } | null;
};
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fields = (x: Record<string, unknown>, keys: string[]) => {
    const actual = Object.keys(x).sort();
    return actual.length === keys.length && keys.slice().sort().every((key, i) => actual[i] === key);
};
const id = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128 && x.trim() === x && !/[\u0000-\u001f\u007f]/.test(x);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxImageBytes = 4 * 1024 * 1024;
export function isHostTurnCommand(x: unknown): x is HostTurnCommand {
    try {
        if (!object(x) || !fields(x, ['version', 'sessionId', 'commandId', 'playerId', 'base', 'kind', 'text', 'image']) || x.version !== 1 ||
            !id(x.sessionId) || !id(x.playerId) || typeof x.commandId !== 'string' || !uuid.test(x.commandId) ||
            !object(x.base) || !fields(x.base, ['version', 'sessionId', 'revision']) || !isTurnSyncStamp(x.base) || x.base.sessionId !== x.sessionId ||
            (x.kind !== 'action' && x.kind !== 'question') || typeof x.text !== 'string' || !x.text.trim() || x.text.length > 32000) return false;
        if (x.image === null) return true;
        if (!object(x.image) || !fields(x.image, ['data', 'mimeType']) || typeof x.image.data !== 'string' ||
            typeof x.image.mimeType !== 'string' || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(x.image.mimeType)) return false;
        const data = x.image.data;
        if (!data || data.length > Math.ceil(maxImageBytes / 3) * 4 || data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return false;
        return data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0) <= maxImageBytes;
    } catch { return false; }
}
type Connection = { peer: string; open: boolean; metadata?: { role?: string } };
type Context = { connection: Connection; connections: Map<string, Connection>; state: GameState | null; busy: boolean };
type Outcome = 'pending' | 'committed' | 'rejected' | 'unknown';
type Entry = { actor: string; digest: string; baseRevision: number; resultRevision?: number; outcome: Outcome; release: () => void };
export class HostTurnCommandLedger {
    private entries = new Map<string, Entry>();
    private sessionId: string;
    constructor(private authority: HostTurnAuthority, private limit = 64,
        private digest: (data: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer> = data => crypto.subtle.digest('SHA-256', data)) {
        if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid turn ledger limit');
        this.sessionId = authority.getSessionId();
    }
    private refresh() {
        const session = this.authority.getSessionId();
        if (session !== this.sessionId) { this.entries.clear(); this.sessionId = session; }
    }
    private authorized(ctx: Context, actor: string): boolean {
        const c = ctx.connection, state = ctx.state;
        if (!c?.open || c.peer !== actor || c.metadata?.role !== 'player' || ctx.connections?.get(c.peer) !== c ||
            state?.networkRole !== 'host' || !state.myPeerId || actor === state.myPeerId || !Array.isArray(state.players)) return false;
        const ids = state.players.map(p => p?.playerId);
        return ids.every(id) && new Set(ids).size === ids.length && ids.includes(actor) && ids.includes(state.myPeerId);
    }
    async begin(raw: unknown, getContext: () => Context): Promise<{ status: 'reserved'; command: HostTurnCommand } | { status: Outcome | 'invalid' | 'unauthorized' | 'expired' | 'collision' | 'busy' | 'stale' | 'capacity' }> {
        this.refresh();
        if (!isHostTurnCommand(raw)) return { status: 'invalid' };
        // Copy before awaiting the digest; mutation of the caller's object can
        // never change either the validated operation or its fingerprint.
        const command: HostTurnCommand = Object.freeze({ version: 1, sessionId: raw.sessionId, commandId: raw.commandId, playerId: raw.playerId,
            base: Object.freeze({ ...raw.base }), kind: raw.kind, text: raw.text, image: raw.image ? Object.freeze({ ...raw.image }) : null });
        if (!this.authorized(getContext(), command.playerId)) return { status: 'unauthorized' };
        let hash: string;
        try {
            const bytes = new TextEncoder().encode(JSON.stringify(command));
            hash = Array.from(new Uint8Array(await this.digest(bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        } catch { return { status: 'invalid' }; }
        this.refresh();
        const ctx = getContext();
        if (!this.authorized(ctx, command.playerId)) return { status: 'unauthorized' };
        if (command.sessionId !== this.sessionId) return { status: 'expired' };
        const previous = this.entries.get(command.commandId);
        if (previous) return { status: previous.actor !== command.playerId ? 'unauthorized' : previous.digest === hash ? previous.outcome : 'collision' };
        const state = ctx.state!;
        if (!Number.isSafeInteger(state.activePlayerIndex) || state.players[state.activePlayerIndex]?.playerId !== command.playerId) return { status: 'unauthorized' };
        if (this.entries.size >= this.limit) return { status: 'capacity' };
        const reservation = this.authority.beginEdit(command.base, ctx.busy);
        if (reservation.status !== 'pending') return { status: reservation.status };
        this.entries.set(command.commandId, { actor: command.playerId, digest: hash, baseRevision: command.base.revision, outcome: 'pending', release: reservation.release });
        return { status: 'reserved', command };
    }
    /** A caller may settle committed only after the complete host snapshot has committed. */
    settle(session: string, commandId: string, outcome: Exclude<Outcome, 'pending'>): boolean {
        this.refresh();
        const entry = this.entries.get(commandId);
        if (session !== this.sessionId || !entry || entry.outcome !== 'pending' || !['committed', 'rejected', 'unknown'].includes(outcome)) return false;
        entry.outcome = outcome; entry.release(); return true;
    }
    status(session: string, commandId: string, ctx: Context): Outcome {
        this.refresh();
        const entry = this.entries.get(commandId);
        return session === this.sessionId && entry && this.authorized(ctx, entry.actor) ? entry.outcome : 'unknown';
    }
    receipts(stamp: TurnSyncStamp): Array<{ version: 1; sessionId: string; commandId: string; resultRevision: number }> {
        this.refresh();
        if (!isTurnSyncStamp(stamp) || stamp.sessionId !== this.sessionId) return [];
        const result: Array<{ version: 1; sessionId: string; commandId: string; resultRevision: number }> = [];
        for (const [commandId, entry] of this.entries) {
            if (entry.outcome !== 'committed' || stamp.revision <= entry.baseRevision) continue;
            entry.resultRevision ??= stamp.revision;
            if (stamp.revision >= entry.resultRevision) result.push({ version: 1, sessionId: this.sessionId, commandId, resultRevision: entry.resultRevision });
        }
        return result;
    }
}
