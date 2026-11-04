import type { ChatMessage, GameContext, Language, SaveFile } from '../types';
import { executeIsolatedHostTurn } from './isolatedHostTurnExecution';
import { captureHostTurnResult, hostTurnResultCommitted, hostTurnBaseUnchanged } from './hostTurnResultBarrier';
import { HostTurnCommandLedger, type HostTurnCommand } from './hostTurnCommand';

type Context = Parameters<HostTurnCommandLedger['begin']>[1];
type Rendered = Parameters<typeof hostTurnResultCommitted>[1];
type ApplyContext = ReturnType<Context> & { history: ChatMessage[]; gameContext: GameContext | null };
type ApplyContextGetter = () => ApplyContext;
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

    /** Isolated preparation has no live game writes. A failure before apply
     * can therefore be rejected and released; a thrown/partial apply remains
     * unknown and retains the hold. read() must return one committed render;
     * apply() must synchronously enqueue a rebase-safe host restore. */
    startIsolated(raw: unknown, context: ApplyContextGetter, options: {
        read: () => { snapshot: SaveFile; rendered: Rendered };
        apply: (candidate: SaveFile) => SaveFile;
        language: Language;
        t: (key: string, replacements?: any) => string;
        signal?: AbortSignal;
    }): Promise<Awaited<ReturnType<HostTurnCommandLedger['begin']>>> {
        return this.start(raw, context, async (command, stage) => {
            const pending = this.pending;
            if (!pending || pending.command !== command) throw new Error('Missing host turn reservation');
            const rejectBeforeApply = () => {
                if (this.pending !== pending || pending.staged) return;
                this.ledger.settle(command.sessionId, command.commandId, 'rejected');
                this.pending = null;
            };
            let base: Candidate | null;
            let initial: ReturnType<typeof options.read>;
            try {
                initial = options.read();
                base = captureHostTurnResult(initial.snapshot);
                if (!this.canApply(context(), base, initial.rendered)) { rejectBeforeApply(); return; }
            } catch { rejectBeforeApply(); return; }
            const generated = await executeIsolatedHostTurn({ snapshot: initial.snapshot, kind: command.kind,
                text: command.text, image: command.image, language: options.language, t: options.t, signal: options.signal });
            if (generated.status !== 'candidate' || !captureHostTurnResult(generated.saveFile)) { rejectBeforeApply(); return; }
            try {
                if (!this.canApply(context(), base, options.read().rendered)) { rejectBeforeApply(); return; }
            } catch { rejectBeforeApply(); return; }
            // From here on, apply may already have enqueued partial live React
            // writes if it throws. start() must conservatively mark unknown.
            const restored = options.apply(generated.saveFile);
            if (!stage(restored)) throw new Error('Cannot stage host turn result');
        });
    }

    private finishUnknown(pending: Pending): void {
        if (this.pending !== pending) return;
        // Failure may have enqueued history, streamed logs or partial state.
        // Without a post-commit failure barrier, keep the hold indefinitely.
        pending.uncertain = true;
        this.ledger.markUnknownWhileHeld(pending.command.sessionId, pending.command.commandId);
    }

    /** Immediately before scheduling an isolated result, callers must use
     * committed render refs and include every competing mutation in busy.
     * Passing this check does not itself reserve or enqueue a React update. */
    canApply(context: ApplyContext, base: Candidate | null, rendered: Rendered): boolean {
        const pending = this.pending;
        return !!pending && !pending.uncertain && context.state === rendered.currentGameState && context.history === rendered.gameHistory &&
            context.gameContext === rendered.currentContext && this.ledger.canApply(pending.command.sessionId, pending.command.commandId, context) &&
            hostTurnBaseUnchanged(base, rendered);
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
