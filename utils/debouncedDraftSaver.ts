import type { PlayerActionDraft } from './fileManager';

export type DraftWriter = (key: string, draft: PlayerActionDraft | null) => Promise<void>;

export interface DebouncedDraftSaver {
    /** Queue the latest draft for `key`; rapid calls collapse into one write. */
    schedule(key: string, draft: PlayerActionDraft | null): void;
    /** Write the queued draft now (character switch, unmount). */
    flush(): void;
    /** Drop the queued draft without writing (the submission owns the text). */
    cancel(): void;
    hasPending(): boolean;
}

/**
 * Typing used to open an IndexedDB transaction per keystroke. Writes are
 * debounced here, and every hand-over point flushes explicitly so no edit is
 * lost when a timer is cleared.
 */
export function createDebouncedDraftSaver(
    write: DraftWriter,
    delayMs = 400,
    scheduleTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
    clearTimer: (handle: ReturnType<typeof setTimeout>) => void = clearTimeout,
): DebouncedDraftSaver {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: { key: string; draft: PlayerActionDraft | null } | null = null;

    const stopTimer = () => {
        if (timer) {
            clearTimer(timer);
            timer = null;
        }
    };
    const writePending = () => {
        const queued = pending;
        pending = null;
        if (queued) void write(queued.key, queued.draft).catch(() => undefined);
    };

    return {
        schedule(key, draft) {
            pending = { key, draft };
            stopTimer();
            timer = scheduleTimer(() => {
                timer = null;
                writePending();
            }, delayMs);
        },
        flush() {
            stopTimer();
            writePending();
        },
        cancel() {
            stopTimer();
            pending = null;
        },
        hasPending() {
            return pending !== null;
        },
    };
}
