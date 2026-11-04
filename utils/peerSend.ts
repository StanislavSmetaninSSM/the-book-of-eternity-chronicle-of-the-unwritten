import type { DataConnection } from 'peerjs';

/** A send attempt is not a delivery acknowledgement. */
export async function sendOnOpenConnection(conn: DataConnection, message: unknown, timeoutMs?: number): Promise<void> {
    if (!conn.open) throw new Error('Connection is not open.');
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new Error('Invalid send timeout.');
    let emittedError: unknown;
    const onError = (error: unknown) => { emittedError = error; };
    conn.on('error', onError);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const sending = Promise.resolve(conn.send(message));
        if (timeoutMs !== undefined) {
            await Promise.race([sending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Send timed out; delivery is unknown.')), timeoutMs); })]);
        } else await sending;
        if (emittedError) throw emittedError;
        if (!conn.open) throw new Error('Connection closed during send; delivery is unknown.');
    } finally {
        if (timer !== undefined) clearTimeout(timer);
        conn.off('error', onError);
    }
}

/** Try all peers even if one fails; caller must handle the aggregate failure. */
export async function broadcastToConnections(connections: Iterable<DataConnection>, message: unknown): Promise<void> {
    const results = await Promise.allSettled(Array.from(connections, conn => sendOnOpenConnection(conn, message)));
    const failures = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[];
    if (failures.length) {
        throw new AggregateError(failures.map(result => result.reason), `Could not send sync to ${failures.length} connection(s).`);
    }
}
