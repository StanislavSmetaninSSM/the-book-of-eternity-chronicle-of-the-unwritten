import type { DataConnection } from 'peerjs';

/** A send attempt is not a delivery acknowledgement. */
export async function sendOnOpenConnection(conn: DataConnection, message: unknown): Promise<void> {
    if (!conn.open) throw new Error('Connection is not open.');
    let emittedError: unknown;
    const onError = (error: unknown) => { emittedError = error; };
    conn.on('error', onError);
    try {
        await conn.send(message);
        if (emittedError) throw emittedError;
        if (!conn.open) throw new Error('Connection closed during send; delivery is unknown.');
    } finally {
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
