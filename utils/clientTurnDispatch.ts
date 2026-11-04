import { withClientHostLock } from './clientEditCoordination';
import { createClientTurnIntent, transitionClientTurnIntent, type ClientTurnIntent } from './clientEditIntentStore';
import { isHostTurnCommand, type HostTurnCommand } from './hostTurnCommand';

/** Preparatory client-side dispatcher; not yet used by the production path.
 * The caller owns capability negotiation, identity/epoch checks, status
 * reconciliation and UI. Neither sending nor receiving an ACK is a commit. */
export async function dispatchClientTurn(options: {
    hostPeerId: string;
    command: HostTurnCommand;
    ensureEpoch: () => Promise<boolean>;
    identityCurrent: () => boolean;
    send: (command: HostTurnCommand) => Promise<void>;
    onChange?: (intent: ClientTurnIntent) => void | Promise<void>;
}): Promise<'pending' | 'unknown' | 'conflict' | 'sync-required'> {
    if (!isHostTurnCommand(options.command)) throw new Error('Invalid client turn command');
    const { hostPeerId, ensureEpoch, identityCurrent, send, onChange } = options;
    const c = options.command;
    // Never retain a mutable caller-owned command across IndexedDB/lock awaits.
    const command: HostTurnCommand = Object.freeze({ version: 1, sessionId: c.sessionId, commandId: c.commandId,
        playerId: c.playerId, base: Object.freeze({ version: 1, sessionId: c.base.sessionId, revision: c.base.revision }),
        kind: c.kind, text: c.text, image: c.image ? Object.freeze({ data: c.image.data, mimeType: c.image.mimeType }) : null });
    return withClientHostLock(hostPeerId, true, async () => {
        if (!await ensureEpoch()) return 'sync-required';
        if (!identityCurrent()) return 'conflict';
        const draft = await createClientTurnIntent({ hostPeerId, command });
        await onChange?.(draft);
        const identityAfterDraft = identityCurrent();
        const pending = await transitionClientTurnIntent(draft, 'pending');
        if (!pending) throw new Error('Turn intent changed in another tab');
        await onChange?.(pending);
        if (!identityAfterDraft || !identityCurrent()) {
            const conflict = await transitionClientTurnIntent(pending, 'conflict', 'stale');
            if (!conflict) throw new Error('Turn intent changed in another tab');
            await onChange?.(conflict);
            return 'conflict';
        }
        try {
            // Once the attempt begins, an exception or timeout does not prove
            // that the host failed to receive the command.
            await send(command);
        } catch {
            const unknown = await transitionClientTurnIntent(pending, 'unknown');
            if (!unknown) throw new Error('Turn intent changed while send outcome was unknown');
            await onChange?.(unknown);
            return 'unknown';
        }
        return 'pending';
    });
}
