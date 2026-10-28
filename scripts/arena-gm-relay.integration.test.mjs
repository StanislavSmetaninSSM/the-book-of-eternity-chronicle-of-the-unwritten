import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server;
let baseUrl;
let relayDirectory;

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
