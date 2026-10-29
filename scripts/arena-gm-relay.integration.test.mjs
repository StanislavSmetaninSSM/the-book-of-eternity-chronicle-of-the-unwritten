import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server;
let baseUrl;
let relayDirectory;

class FakeClock {
  now = 1_000;
  nextId = 1;
  timers = new Map();

  setTimeout = (callback, delay = 0) => {
    const id = this.nextId++;
    this.timers.set(id, { callback, at: this.now + Number(delay) });
    return id;
  };

  clearTimeout = id => { this.timers.delete(id); };

  async advance(milliseconds) {
    const target = this.now + milliseconds;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      this.timers.delete(id);
      this.now = timer.at;
      await timer.callback();
      await Promise.resolve();
    }
    this.now = target;
  }
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise(resolve => setImmediate(resolve));
};

const makeStep = correlationId => ({
  kind: 'arena-gm-step',
  protocolVersion: 1,
  correlationId,
  stepName: `step-${correlationId}`,
  prompt: `prompt-${correlationId}`,
});

const makeImage = correlationId => ({
  kind: 'arena-gm-image',
  protocolVersion: 1,
  correlationId,
  prompt: `image-${correlationId}`,
  width: 32,
  height: 32,
});

async function post(endpoint, payload) {
  return fetch(`${baseUrl}/__arena_gm/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function status() {
  return (await fetch(`${baseUrl}/__arena_gm/status`)).json();
}

async function writeStepResponse(correlationId) {
  await writeFile(path.join(relayDirectory, 'responses', `${correlationId}.json`), JSON.stringify({
    kind: 'arena-gm-step-response',
    protocolVersion: 1,
    correlationId,
    output: { step: correlationId },
  }));
}

async function writeImageResponse(correlationId) {
  await writeFile(path.join(relayDirectory, 'responses', `${correlationId}.json`), JSON.stringify({
    kind: 'arena-gm-image-response',
    protocolVersion: 1,
    correlationId,
  }));
}

async function consume(correlationId) {
  return fetch(`${baseUrl}/__arena_gm/response?correlationId=${encodeURIComponent(correlationId)}`);
}

before(async () => {
  relayDirectory = await mkdtemp(path.join(os.tmpdir(), 'arena-gm-relay-test-'));
  process.env.ARENA_GM_RELAY_DIR = relayDirectory;
  server = await createServer({
    configFile: path.resolve('vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, preTransformRequests: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  await server.listen();
  const address = server.httpServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) await server.close();
  if (relayDirectory) await rm(relayDirectory, { recursive: true, force: true });
  delete process.env.ARENA_GM_RELAY_DIR;
});

test('relay queues requests without clobbering, prioritizes turn work, isolates responses, and cancels', async () => {
  const first = await post('turn', makeStep('turn-first'));
  assert.equal(first.status, 202);
  assert.deepEqual(await first.json(), { accepted: true, queued: false, duplicate: false, correlationId: 'turn-first' });
  const duplicateFirst = await post('turn', makeStep('turn-first'));
  assert.equal(duplicateFirst.status, 202);
  assert.equal((await duplicateFirst.json()).correlationId, 'turn-first');
  const conflictingDuplicate = await post('turn', { ...makeStep('turn-first'), prompt: 'different packet' });
  assert.equal(conflictingDuplicate.status, 409);
  assert.equal((await status()).queuedCount, 0);

  const imageQueued = await post('turn', makeImage('image-waiting'));
  assert.equal(imageQueued.status, 202);
  assert.equal((await imageQueued.json()).queued, true);
  const pendingDuringQueue = JSON.parse(await readFile(path.join(relayDirectory, 'pending.json'), 'utf8'));
  assert.equal(pendingDuringQueue.correlationId, 'turn-first');
  assert.deepEqual(await status(), {
    enabled: true,
    activeCorrelationId: 'turn-first',
    activeKind: 'arena-gm-step',
    queuedCount: 1,
    queuedTurnCount: 0,
  });

  const nextTurn = await post('turn', makeStep('turn-priority'));
  assert.equal((await nextTurn.json()).queued, true);
  assert.equal(JSON.parse(await readFile(path.join(relayDirectory, 'pending.json'), 'utf8')).correlationId, 'turn-first');
  assert.equal((await status()).queuedTurnCount, 1);

  await writeStepResponse('turn-first');
  const firstResponse = await consume('turn-first');
  assert.equal(firstResponse.status, 200);
  assert.equal((await firstResponse.json()).correlationId, 'turn-first');
  assert.equal(JSON.parse(await readFile(path.join(relayDirectory, 'pending.json'), 'utf8')).correlationId, 'turn-priority');

  // A response for a queued image must never satisfy or be consumed by another request.
  await writeFile(path.join(relayDirectory, 'responses', 'image-waiting.json'), JSON.stringify({
    kind: 'arena-gm-image-response', protocolVersion: 1, correlationId: 'image-waiting',
  }));
  assert.equal((await consume('turn-priority')).status, 204);
  await writeStepResponse('turn-priority');
  assert.equal((await consume('turn-priority')).status, 200);
  assert.equal(JSON.parse(await readFile(path.join(relayDirectory, 'pending.json'), 'utf8')).correlationId, 'image-waiting');
  const isolatedImageResponse = await consume('image-waiting');
  assert.equal(isolatedImageResponse.status, 200);
  assert.equal((await isolatedImageResponse.json()).correlationId, 'image-waiting');

  await post('turn', makeStep('cancel-active'));
  await post('turn', makeStep('cancel-queued'));
  const cancelQueued = await post('cancel', { correlationId: 'cancel-queued' });
  assert.equal((await cancelQueued.json()).cancelled, true);
  assert.equal((await status()).activeCorrelationId, 'cancel-active');
  assert.equal((await status()).queuedCount, 0);

  const cancelActive = await post('cancel', { correlationId: 'cancel-active' });
  assert.equal((await cancelActive.json()).wasActive, true);
  assert.equal((await status()).activeCorrelationId, null);
});

test('an active image yields to a new turn without losing its request or response', async () => {
  const image = await post('turn', makeImage('portrait-active'));
  assert.equal(image.status, 202);
  assert.equal((await status()).activeCorrelationId, 'portrait-active');
  await writeImageResponse('portrait-active');

  const turn = await post('turn', makeStep('turn-overtakes-portrait'));
  assert.equal(turn.status, 202);
  assert.deepEqual(await status(), {
    enabled: true,
    activeCorrelationId: 'turn-overtakes-portrait',
    activeKind: 'arena-gm-step',
    queuedCount: 1,
    queuedTurnCount: 0,
  });
  assert.equal(JSON.parse(await readFile(path.join(relayDirectory, 'pending.json'), 'utf8')).correlationId, 'turn-overtakes-portrait');
  assert.equal(JSON.parse(await readFile(path.join(relayDirectory, 'responses', 'portrait-active.json'), 'utf8')).correlationId, 'portrait-active');

  const unrelatedCancel = await post('cancel', { correlationId: 'another-users-request' });
  assert.equal((await unrelatedCancel.json()).cancelled, false);
  assert.equal((await status()).activeCorrelationId, 'turn-overtakes-portrait', 'an unrelated cancellation cannot remove a foreign active request');

  await writeStepResponse('turn-overtakes-portrait');
  assert.equal((await consume('turn-overtakes-portrait')).status, 200);
  assert.equal(JSON.parse(await readFile(path.join(relayDirectory, 'pending.json'), 'utf8')).correlationId, 'portrait-active');
  assert.equal((await consume('portrait-active')).status, 200);
  assert.equal((await status()).activeCorrelationId, null);
});

test('a temporary empty server queue does not release an active browser turn lease', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const clock = new FakeClock();
  const calls = [];
  const session = new Map();
  globalThis.window = {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    sessionStorage: {
      setItem: (key, value) => session.set(key, value),
      getItem: key => session.get(key) ?? null,
      removeItem: key => session.delete(key),
    },
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET' });
    if (url.endsWith('/__arena_gm/status')) return Response.json({ enabled: true, activeCorrelationId: null, activeKind: null, queuedCount: 0, queuedTurnCount: 0 });
    if (url.endsWith('/__arena_gm/turn')) return Response.json({ accepted: true, queued: false, duplicate: false }, { status: 202 });
    if (url.endsWith('/__arena_gm/cancel')) return Response.json({ cancelled: true });
    if (url.includes('/__arena_gm/response?')) return new Response(null, { status: 204 });
    throw new Error(`Unexpected test fetch: ${url}`);
  };

  try {
    const relay = await server.ssrLoadModule('/utils/arenaGmRelay.ts');
    const releaseTurn = await relay.acquireArenaGmTurnLease();
    const imageController = new AbortController();
    const imageResult = relay.requestArenaGmImage('cold-start portrait', 32, 32, imageController.signal)
      .then(() => 'resolved', error => error.name);

    await clock.advance(45_000);
    await flushMicrotasks();
    assert.equal(calls.some(call => call.url.endsWith('/__arena_gm/status')), false, 'the lease must not poll an empty relay queue as an ownership signal');
    assert.equal(calls.some(call => call.url.endsWith('/__arena_gm/turn') && call.method === 'POST'), false, 'queued image must remain held while the owner retains the lease');

    releaseTurn();
    await flushMicrotasks();
    assert.equal(calls.filter(call => call.url.endsWith('/__arena_gm/turn') && call.method === 'POST').length, 1);
    imageController.abort();
    assert.equal(await imageResult, 'AbortError');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('a cold-start portrait already in flight yields to the first game turn and retries afterward', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const clock = new FakeClock();
  const calls = [];
  const postedPackets = [];
  const session = new Map();
  globalThis.window = {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    sessionStorage: {
      setItem: (key, value) => session.set(key, value),
      getItem: key => session.get(key) ?? null,
      removeItem: key => session.delete(key),
    },
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET', body: init.body });
    if (url.endsWith('/__arena_gm/turn')) {
      postedPackets.push(JSON.parse(init.body));
      return Response.json({ accepted: true, queued: false, duplicate: false }, { status: 202 });
    }
    if (url.endsWith('/__arena_gm/cancel')) return Response.json({ cancelled: true });
    if (url.includes('/__arena_gm/response?')) {
      const correlationId = new URL(url, 'http://test.local').searchParams.get('correlationId');
      const packet = postedPackets.find(candidate => candidate.correlationId === correlationId);
      if (packet?.kind === 'arena-gm-step') {
        return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId, output: { accepted: true } });
      }
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected test fetch: ${url}`);
  };

  let imageController;
  let releaseTurn;
  try {
    const relay = await server.ssrLoadModule('/utils/arenaGmRelay.ts');
    imageController = new AbortController();
    const imageResult = relay.requestArenaGmImage('new player portrait', 32, 32, imageController.signal)
      .then(() => 'resolved', error => error.name);
    await flushMicrotasks();
    assert.deepEqual(postedPackets.map(packet => packet.kind), ['arena-gm-image'], 'portrait request starts before the first turn lease');

    const leasePromise = relay.acquireArenaGmTurnLease();
    await flushMicrotasks();
    releaseTurn = await leasePromise;
    assert.equal(calls.filter(call => call.url.endsWith('/__arena_gm/cancel')).length, 1, 'only the in-flight portrait attempt is cancelled to yield the slot');
    assert.deepEqual(postedPackets.map(packet => packet.kind), ['arena-gm-image'], 'no portrait retry starts while the turn lease is active');

    const turnStage = relay.requestArenaGmStep('first turn stage', 'Step0_AnalysisAndPlanning_TaskGuide', 'Arena GM', 1);
    await flushMicrotasks();
    assert.deepEqual(postedPackets.map(packet => packet.kind), ['arena-gm-image', 'arena-gm-step'], 'the first game stage enters the relay before the portrait retry');
    await clock.advance(900);
    assert.deepEqual(await turnStage, { text: JSON.stringify({ accepted: true }), thoughtSignature: undefined });

    releaseTurn();
    releaseTurn = null;
    await flushMicrotasks();
    assert.deepEqual(postedPackets.map(packet => packet.kind), ['arena-gm-image', 'arena-gm-step', 'arena-gm-image'], 'portrait retries after the turn lease is explicitly released');
    imageController.abort();
    assert.equal(await imageResult, 'AbortError');
  } finally {
    imageController?.abort();
    releaseTurn?.();
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('relay expires an abandoned active request after its browser heartbeat lease lapses', async () => {
  await post('turn', makeStep('stale-active'));
  await post('turn', makeStep('after-stale'));

  const activePath = path.join(relayDirectory, 'active-request.json');
  const active = JSON.parse(await readFile(activePath, 'utf8'));
  active.lastHeartbeatAt = Date.now() - 6 * 60_000;
  await writeFile(activePath, JSON.stringify(active));
  await writeFile(path.join(relayDirectory, 'responses', 'stale-active.json'), JSON.stringify({
    kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: 'stale-active', output: {},
  }));

  const recovered = await status();
  assert.equal(recovered.activeCorrelationId, 'after-stale');
  assert.equal(recovered.queuedCount, 0);
  assert.equal(JSON.parse(await readFile(path.join(relayDirectory, 'pending.json'), 'utf8')).correlationId, 'after-stale');
  await assert.rejects(readFile(path.join(relayDirectory, 'responses', 'stale-active.json')), { code: 'ENOENT' });
  assert.equal((await consume('stale-active')).status, 410);
});
