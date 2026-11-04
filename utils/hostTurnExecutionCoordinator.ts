import type { SaveFile } from '../types';
import { captureHostTurnResult, hostTurnResultCommitted } from './hostTurnResultBarrier';
import { HostTurnCommandLedger, type HostTurnCommand } from './hostTurnCommand';

type Context = Parameters<HostTurnCommandLedger['begin']>[1];
type Rendered = Parameters<typeof hostTurnResultCommitted>[1];
type Candidate = NonNullable<ReturnType<typeof captureHostTurnResult>>;
type Pending = { command: HostTurnCommand; candidate: Candidate | null; staged: boolean; finished: boolean; uncertain: boolean; task: Promise<void> };

/** Preparatory coordinator, not yet wired to the network. A reservation owns
 * the authority hold across async GM work AND the React commit barrier. No
 * receipt is produced merely because execution returned or a save was staged. */
export class HostTurnExecutionCoordinator {
    private pending: Pending | null = null;
    constructor(private readonly ledger: HostTurnCommandLedger) {}

    async start(raw: unknown, context: Context,
        execute: (command: HostTurnCommand, stage: (result: SaveFile) => boolean) => Promise<unknown>
    ): Promise<Awaited<ReturnType<HostTurnCommandLedger['begin']>>> {
        // The ledger resolves duplicates and collisions even while a turn is
        // running. A reset may create a fresh reservation; the check below
        // prevents that reservation from running beside an older generation.
        const decision = await this.ledger.begin(raw, context);
        if (decision.status !== 'reserved') return decision;
        if (this.pending) {
            this.ledger.markUnknownWhileHeld(decision.command.sessionId, decision.command.commandId);
            return { status: 'busy' };
        }
        const pending: Pending = { command: decision.command, candidate: null, staged: false, finished: false, uncertain: false, task: Promise.resolve() };
        this.pending = pending;
        const stage = (result: SaveFile): boolean => {
            if (this.pending !== pending || pending.finished) return false;
            if (pending.staged) { pending.candidate = null; return false; }
            pending.staged = true;
            pending.candidate = captureHostTurnResult(result);
            return pending.candidate !== null;
        };
        pending.task = Promise.resolve().then(() => execute(decision.command, stage)).then(
            () => {
                pending.finished = true;
                if (!pending.candidate) this.finishUnknown(pending);
            },
            () => { pending.finished = true; this.finishUnknown(pending); }
        );
        return decision;
    }

    private finishUnknown(pending: Pending): void {
        if (this.pending !== pending) return;
        // Failure may have enqueued history, streamed logs or partial state.
        // Without a post-commit failure barrier, keep the hold indefinitely.
        pending.uncertain = true;
        this.ledger.markUnknownWhileHeld(pending.command.sessionId, pending.command.commandId);
    }

    /** Called from the post-commit effect with *current* committed refs. */
    observe(rendered: Rendered): 'idle' | 'pending' | 'committed' | 'unknown' {
        const pending = this.pending;
        if (!pending) return 'idle';
        if (pending.uncertain) return 'unknown';
        if (!pending.finished || !hostTurnResultCommitted(pending.candidate, rendered)) return 'pending';
        const committed = this.ledger.settle(pending.command.sessionId, pending.command.commandId, 'committed');
        this.pending = null;
        return committed ? 'committed' : 'unknown';
    }

    whenExecutionFinishes(): Promise<void> { return this.pending?.task ?? Promise.resolve(); }
}
