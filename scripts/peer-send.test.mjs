import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'vite';

test('peer send detects closed connections and synchronous or async failures; broadcast tries every peer', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { sendOnOpenConnection, broadcastToConnections } = await server.ssrLoadModule('/utils/peerSend.ts');
    function connection(open, send) { const conn = new EventEmitter(); conn.open = open; conn.send = send.bind(conn); return conn; }
    let attempted = 0;
    const closed = connection(false, () => { attempted++; });
    await assert.rejects(sendOnOpenConnection(closed, {}), /not open/); assert.equal(attempted, 0);
    const emitted = connection(true, function() { this.emit('error', new Error('peer error event')); });
    await assert.rejects(sendOnOpenConnection(emitted, {}), /peer error event/); assert.equal(emitted.listenerCount('error'), 0);
    const rejected = connection(true, () => Promise.reject(new Error('async failure')));
    await assert.rejects(sendOnOpenConnection(rejected, {}), /async failure/); assert.equal(rejected.listenerCount('error'), 0);
    const closing = connection(true, function() { this.open = false; });
    await assert.rejects(sendOnOpenConnection(closing, {}), /delivery is unknown/);
    const stalled = connection(true, () => new Promise(() => {}));
    const timed = await Promise.race([sendOnOpenConnection(stalled, {}, 10).then(() => 'sent', error => error.message), new Promise(resolve => setTimeout(() => resolve('not timed out'), 100))]);
    assert.match(timed, /Send timed out/); assert.equal(stalled.listenerCount('error'), 0, 'timeout removes the temporary listener');
    const good1 = connection(true, () => { attempted++; });
    const good2 = connection(true, () => { attempted++; });
    await assert.rejects(broadcastToConnections([closed, good1, emitted, good2], { type: 'full_sync' }), error => {
      assert.equal(error.errors.length, 2); return /2 connection/.test(error.message);
    });
    assert.equal(attempted, 2); assert.equal(emitted.listenerCount('error'), 0);
    await broadcastToConnections([good1, good2], {}); assert.equal(attempted, 4);
  } finally { await server.close(); }
});
