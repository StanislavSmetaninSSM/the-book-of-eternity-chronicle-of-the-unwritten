import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { createArenaChatBridgeServer, loadOrCreatePairingToken } from './arena-chat-bridge.mjs';
import { ensureRuleBundle } from '../utils/arenaRuleBundle.js';

const TOKEN = 'a'.repeat(43);
const ORIGIN = `chrome-extension://${'a'.repeat(32)}`;

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'boe-chat-bridge-'));
  const relay = path.join(root, '.arena-gm-relay');
  await mkdir(relay, { recursive: true });
  const server = createArenaChatBridgeServer({ root, token: TOKEN, port: 0 });
  await once(server, 'listening');
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  async function request(route, { method = 'GET', body, token = TOKEN, origin = ORIGIN } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (origin) headers.Origin = origin;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response, payload: response.status === 204 ? null : await response.json() };
  }
  async function pending(packet) { await writeFile(path.join(relay, 'pending.json'), JSON.stringify(packet)); }
  return { root, relay, server, request, pending, async close() { server.close(); await once(server, 'close'); await rm(root, { recursive: true, force: true }); } };
}

const stepPacket = overrides => ({
  kind: 'arena-gm-step', protocolVersion: 1, correlationId: 'stage_123', stepName: 'Step6_NarrativeGeneration_TaskGuide',
  prompt: 'Return a short scene.', instructions: 'Follow the current stage contract.', ...overrides,
});

test('bridge requires a pairing token and rejects non-extension browser origins', async t => {
  const app = await setup(); t.after(app.close);
  const unauthenticated = await app.request('/v1/status', { token: '' });
  assert.equal(unauthenticated.response.status, 401);
  const wrongOrigin = await app.request('/v1/status', { origin: 'https://evil.example' });
  assert.equal(wrongOrigin.response.status, 403);
  const connected = await app.request('/v1/status');
  assert.equal(connected.response.status, 200);
  assert.deepEqual(connected.payload, { ok: true, hasPending: false, correlationId: null, kind: null });
});

test('pending tool returns only the active packet; correlated step response is written once', async t => {
  const app = await setup(); t.after(app.close);
  await app.pending(stepPacket());
  const pending = await app.request('/v1/tool', { method: 'POST', body: { tool: 'game.pending', arguments: {} } });
  assert.equal(pending.response.status, 200);
  assert.equal(pending.payload.result.pending.correlationId, 'stage_123');

  const wrongId = await app.request('/v1/tool', { method: 'POST', body: { tool: 'game.respond', arguments: {
    correlationId: 'other_stage', response: { kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: 'other_stage', output: {} },
  } } });
  assert.equal(wrongId.response.status, 409);

  const response = { kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: 'stage_123', output: { scene: 'The lantern wakes.' } };
  const accepted = await app.request('/v1/tool', { method: 'POST', body: { tool: 'game.respond', arguments: { correlationId: 'stage_123', response } } });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.payload.result.accepted, true);
  const stored = JSON.parse(await readFile(path.join(app.relay, 'responses', 'stage_123.json'), 'utf8'));
  assert.deepEqual(stored, response);

  const duplicate = await app.request('/v1/tool', { method: 'POST', body: { tool: 'game.respond', arguments: { correlationId: 'stage_123', response } } });
  assert.equal(duplicate.response.status, 409);
});

test('turn responses use their distinct response envelope and image work fails closed', async t => {
  const app = await setup(); t.after(app.close);
  await app.pending({ kind: 'arena-gm-turn', protocolVersion: 1, correlationId: 'turn_1', turn: {} });
  const wrong = await app.request('/v1/tool', { method: 'POST', body: { tool: 'game.respond', arguments: { correlationId: 'turn_1', response: {
    kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: 'turn_1', output: {},
  } } } });
  assert.equal(wrong.response.status, 409);
  const accepted = await app.request('/v1/tool', { method: 'POST', body: { tool: 'game.respond', arguments: { correlationId: 'turn_1', response: {
    kind: 'arena-gm-response', protocolVersion: 1, correlationId: 'turn_1', response: { response: 'The door opens.' },
  } } } });
  assert.equal(accepted.response.status, 200);

  await app.pending({ kind: 'arena-gm-image', protocolVersion: 1, correlationId: 'image_1' });
  const image = await app.request('/v1/tool', { method: 'POST', body: { tool: 'game.respond', arguments: { correlationId: 'image_1', response: {
    kind: 'arena-gm-image-response', protocolVersion: 1, correlationId: 'image_1',
  } } } });
  assert.equal(image.response.status, 501);
});

test('rule tools return verified bounded excerpts only for the active referenced bundle', async t => {
  const app = await setup(); t.after(app.close);
  const bundle = await ensureRuleBundle(app.relay);
  await app.pending(stepPacket({ ruleBundleId: bundle.id }));
  const search = await app.request('/v1/tool', { method: 'POST', body: { tool: 'game.rules.search', arguments: { correlationId: 'stage_123', query: 'GameMasterGuide' } } });
  assert.equal(search.response.status, 200);
  assert.equal(search.payload.result.totalMatches > 0, true);
  assert.equal(search.payload.result.matches.length <= 60, true);
  const read = await app.request('/v1/tool', { method: 'POST', body: { tool: 'game.rules.read', arguments: { correlationId: 'stage_123', document: 'narrative' } } });
  assert.equal(read.response.status, 200);
  assert.equal(read.payload.result.document, 'narrative');
  assert.equal(read.payload.result.verified, true);
  assert.equal(read.payload.result.text.length > 1000, true);
  const unboundedRules = await app.request('/v1/tool', { method: 'POST', body: { tool: 'game.rules.read', arguments: { correlationId: 'stage_123', document: 'rules' } } });
  assert.equal(unboundedRules.response.status, 400);
  const wrongStage = await app.request('/v1/tool', { method: 'POST', body: { tool: 'game.rules.read', arguments: { correlationId: 'other', document: 'world' } } });
  assert.equal(wrongStage.response.status, 409);
});

test('Arena content adapter exposes only supported tool blocks and requires a manual click', async t => {
  const supported = { bridge: 'book-of-eternity', version: 1, call: { tool: 'game.pending', arguments: {} } };
  const unsupported = { bridge: 'book-of-eternity', version: 1, call: { tool: 'filesystem.read', arguments: { path: '/private' } } };
  const dom = new JSDOM(`<pre><code class="language-arena-tool">${JSON.stringify(supported)}</code></pre><pre><code class="language-arena-tool">${JSON.stringify(unsupported)}</code></pre><pre><code class="language-json">{}</code></pre>`, {
    url: 'https://arena.ai/c/test', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const calls = [];
  let confirmations = 0;
  dom.window.confirm = () => { confirmations += 1; return true; };
  dom.window.chrome = { runtime: { sendMessage: async message => {
    calls.push(message);
    return { ok: true, result: { pending: null, bridgeInstructions: 'No active request.' } };
  } } };
  dom.window.eval(await readFile(path.join(process.cwd(), 'chat_extension', 'content.js'), 'utf8'));
  assert.equal(dom.window.document.querySelectorAll('[data-boe-bridge-widget="true"]').length, 1);
  const pre = dom.window.document.querySelector('pre');
  pre.nextElementSibling.shadowRoot.querySelector('.run').click();
  await new Promise(resolve => dom.window.setTimeout(resolve, 10));
  assert.equal(confirmations, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.call.tool, 'game.pending');
  assert.match(pre.nextElementSibling.shadowRoot.querySelector('textarea').value, /No active request/);
});

test('guided setup command is available and documents the manual browser step', () => {
  const result = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'setup-local-chat-bridge.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm run bridge:setup/);
  assert.match(result.stdout, /loaded once by the user/);
});

test('browser extension permissions stay limited to Arena pages and the loopback bridge', async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), 'chat_extension', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1:8765/*', 'http://localhost:8765/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://arena.ai/*', 'https://www.arena.ai/*']);
  assert.equal(manifest.externally_connectable, undefined);
});

test('pairing token is generated once and kept local to the ignored relay directory', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'boe-token-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await loadOrCreatePairingToken(root);
  const second = await loadOrCreatePairingToken(root);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(second, first);
  const tokenPath = path.join(root, '.arena-gm-relay', 'chat-bridge-token.txt');
  assert.equal((await readFile(tokenPath, 'utf8')).trim(), first);
  assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
});
