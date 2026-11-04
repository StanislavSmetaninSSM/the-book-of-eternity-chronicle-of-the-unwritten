import { HostTurnAuthority, isTurnSyncStamp, type TurnSyncStamp } from './networkTurnProtocol';

export type ClientEditCommand = {
    version: 1;
    sessionId: string;
    commandId: string;
    playerId: string;
    base: TurnSyncStamp;
    command: { type: 'equip'; itemId: string; slot: string } | { type: 'unequip'; itemId: string };
};
export type EditOutcome = 'pending' | 'committed' | 'rejected' | 'unknown';
export type EditDecision = EditOutcome | 'reserved' | 'invalid' | 'unauthorized' | 'expired' | 'collision' | 'busy' | 'stale' | 'capacity';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value: Record<string, unknown>, keys: string[]) => {
    const actual = Object.keys(value).sort();
    return actual.length === keys.length && keys.slice().sort().every((key, i) => key === actual[i]);
};
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value) && value.trim() === value;

/** Strict wire validation. No arbitrary state, extra fields or callback payload. */
export function isClientEditCommand(input: unknown): input is ClientEditCommand {
    try {
        if (!object(input) || new TextEncoder().encode(JSON.stringify(input)).length > 4096 ||
            !fields(input, ['version', 'sessionId', 'commandId', 'playerId', 'base', 'command']) || input.version !== 1 ||
            !identifier(input.sessionId) || !identifier(input.playerId) || typeof input.commandId !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.commandId) ||
            !object(input.base) || !fields(input.base, ['version', 'sessionId', 'revision']) || !isTurnSyncStamp(input.base) ||
            input.base.sessionId !== input.sessionId || !object(input.command) || !identifier(input.command.itemId)) return false;
        if (input.command.type === 'equip') return fields(input.command, ['type', 'itemId', 'slot']) && identifier(input.command.slot);
        if (input.command.type === 'unequip') return fields(input.command, ['type', 'itemId']);
        return false;
    } catch { return false; }
}

// Canonical field order makes JSON object key ordering irrelevant for dedupe.
const fingerprint = (c: ClientEditCommand) => JSON.stringify([
    c.version, c.sessionId, c.commandId, c.playerId, c.base.version, c.base.sessionId, c.base.revision,
    c.command.type, c.command.itemId, c.command.type === 'equip' ? c.command.slot : null,
]);

type Connection = { peer: string; open: boolean; metadata?: { role?: string } };
type Context = { connection: Connection; connections: Map<string, Connection>; state: { networkRole?: string; myPeerId?: string | null; players?: Array<{ playerId?: string }> } | null; busy: boolean };
type Entry = { sessionId: string; actor: string; fingerprint: string; outcome: EditOutcome; release: () => void };

/** In-memory session ledger. Calling settle('committed') is reserved for the
 * integration's post-React-commit barrier, never for send or queue receipt. */
export class HostEditLedger {
    private entries = new Map<string, Entry>();
    private sessionId: string;
    constructor(private readonly authority: HostTurnAuthority, private readonly limit = 256) {
        if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid edit ledger limit');
        this.sessionId = authority.getSessionId();
    }
    private refreshSession() {
        const current = this.authority.getSessionId();
        if (this.sessionId !== current) { this.sessionId = current; this.entries.clear(); }
    }
    private currentConnection(ctx: Context): boolean {
        return !!ctx.connection?.open && ctx.connection.metadata?.role === 'player' &&
            ctx.connections?.get(ctx.connection.peer) === ctx.connection;
    }
    begin(raw: unknown, ctx: Context): { status: Exclude<EditDecision, 'reserved'> } | { status: 'reserved'; command: ClientEditCommand } {
        this.refreshSession();
        if (!isClientEditCommand(raw)) return { status: 'invalid' };
        if (!this.currentConnection(ctx) || raw.playerId !== ctx.connection.peer || ctx.state?.networkRole !== 'host' ||
            !ctx.state.myPeerId || raw.playerId === ctx.state.myPeerId || !Array.isArray(ctx.state.players)) return { status: 'unauthorized' };
        const ids = ctx.state.players.map(p => p?.playerId);
        if (ids.some(id => !identifier(id)) || new Set(ids).size !== ids.length ||
            !ids.includes(raw.playerId) || !ids.includes(ctx.state.myPeerId)) return { status: 'unauthorized' };
        if (raw.sessionId !== this.sessionId) return { status: 'expired' };
        const prior = this.entries.get(raw.commandId);
        if (prior) {
            if (prior.actor !== ctx.connection.peer) return { status: 'unauthorized' };
            return { status: prior.fingerprint === fingerprint(raw) ? prior.outcome : 'collision' };
        }
        if (this.entries.size >= this.limit) return { status: 'capacity' };
        const reservation = this.authority.beginEdit(raw.base, ctx.busy);
        if (reservation.status !== 'pending') return { status: reservation.status };
        const command: ClientEditCommand = Object.freeze({
            version: 1, sessionId: raw.sessionId, commandId: raw.commandId, playerId: raw.playerId,
            base: Object.freeze({ version: 1, sessionId: raw.base.sessionId, revision: raw.base.revision }),
            command: Object.freeze(raw.command.type === 'equip'
                ? { type: 'equip' as const, itemId: raw.command.itemId, slot: raw.command.slot }
                : { type: 'unequip' as const, itemId: raw.command.itemId }),
        });
        this.entries.set(command.commandId, { sessionId: command.sessionId, actor: ctx.connection.peer, fingerprint: fingerprint(command), outcome: 'pending', release: reservation.release });
        return { status: 'reserved', command };
    }
    settle(sessionId: string, commandId: string, outcome: Exclude<EditOutcome, 'pending'>): boolean {
        this.refreshSession();
        if (sessionId !== this.sessionId) return false;
        const entry = this.entries.get(commandId);
        if (!entry || entry.outcome !== 'pending' || !['committed', 'rejected', 'unknown'].includes(outcome)) return false;
        entry.outcome = outcome;
        entry.release();
        return true;
    }
    status(commandId: string, sessionId: string, ctx: Context): EditOutcome {
        this.refreshSession();
        if (sessionId !== this.sessionId || !this.currentConnection(ctx)) return 'unknown';
        const entry = this.entries.get(commandId);
        return entry && entry.actor === ctx.connection.peer ? entry.outcome : 'unknown';
    }
}

/** Capability negotiation is explicit; a turn stamp alone is insufficient. */
export const CLIENT_EDIT_CAPABILITY = Object.freeze({ protocol: 'host-edit', version: 1 } as const);
export function hasClientEditCapability(value: unknown): boolean {
    return object(value) && fields(value, ['protocol', 'version']) && value.protocol === 'host-edit' && value.version === 1;
}

/** The caller must pass the stamp returned by commitClientSnapshot for the
 * same snapshot carrying this receipt, never a receipt/ACK from the wire alone. */
export function canConfirmEdit(
    intent: { sessionId: string; commandId: string; baseRevision: number }, receipt: unknown,
    snapshotStamp: unknown, committedStamp: unknown
): boolean {
    if (!object(receipt) || !fields(receipt, ['version', 'sessionId', 'commandId', 'resultRevision']) ||
        receipt.version !== 1 || receipt.sessionId !== intent.sessionId || receipt.commandId !== intent.commandId ||
        !Number.isSafeInteger(intent.baseRevision) || intent.baseRevision < 0 ||
        !Number.isSafeInteger(receipt.resultRevision) || (receipt.resultRevision as number) <= intent.baseRevision || (receipt.resultRevision as number) < 0 ||
        !isTurnSyncStamp(snapshotStamp) || !isTurnSyncStamp(committedStamp) ||
        snapshotStamp.sessionId !== intent.sessionId || committedStamp.sessionId !== snapshotStamp.sessionId ||
        committedStamp.revision !== snapshotStamp.revision) return false;
    return snapshotStamp.revision >= (receipt.resultRevision as number);
}
