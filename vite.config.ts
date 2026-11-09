import { defineConfig, Plugin, type Connect } from 'vite';
import type { ServerResponse } from 'node:http';
import { asRecord } from './utils/typeGuards';
import { mkdir, open, readFile, rename, rm, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
// @ts-ignore -- server-only JS module
import { ensureRuleBundle, verifyRuleBundle } from './utils/arenaRuleBundle.js';

const relayDirectory = path.resolve(process.env.ARENA_GM_RELAY_DIR || path.join(process.cwd(), '.arena-gm-relay'));
const pendingPath = path.join(relayDirectory, 'pending.json');
const legacyResponsePath = path.join(relayDirectory, 'response.json');
const activeRequestPath = path.join(relayDirectory, 'active-request.json');
const requestQueueDirectory = path.join(relayDirectory, 'request-queue');
const responseDirectory = path.join(relayDirectory, 'responses');
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const ACTIVE_REQUEST_LEASE_MS = Math.max(30_000, Number(process.env.ARENA_GM_RELAY_ACTIVE_LEASE_MS) || 5 * 60_000);
// Image clients must keep polling while they still own a request. A much shorter
// heartbeat lease clears orphan portraits without relying on an empty turn queue.
const IMAGE_REQUEST_LEASE_MS = Math.max(5_000, Number(process.env.ARENA_GM_RELAY_IMAGE_LEASE_MS) || 30_000);
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** A packet as the browser posts it; which fields are set depends on `kind`. */
interface RelayPacket {
  kind?: string;
  protocolVersion?: number;
  correlationId?: string;
  createdAt?: string;
  stepName?: string;
  modelName?: string;
  attempt?: number;
  prompt?: string;
  ruleBundleId?: string;
  width?: number;
  height?: number;
  turn?: Record<string, unknown>;
  [key: string]: unknown;
}

interface QueuedRelayRequest {
  queuedAt: number;
  lastHeartbeatAt?: number;
  packet: RelayPacket;
}

let relayOperations: Promise<unknown> = Promise.resolve();
function serializeRelayOperation<T>(operation: () => Promise<T>): Promise<T> {
  const current = relayOperations.then(operation, operation);
  relayOperations = current.then(() => undefined, () => undefined);
  return current;
}

async function readJsonIfPresent<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error: unknown) {
    if (asRecord(error)?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function requestPriority(packet: RelayPacket): number {
  return packet.kind === 'arena-gm-image' ? 1 : 0;
}

async function readActiveRequest(): Promise<QueuedRelayRequest | null> {
  return readJsonIfPresent<QueuedRelayRequest>(activeRequestPath);
}

async function dispatchNextRequest(): Promise<QueuedRelayRequest | null> {
  let active = await readActiveRequest();
  if (active) {
    const heartbeatAt = active.lastHeartbeatAt ?? active.queuedAt;
    const activeLeaseMs = active.packet.kind === 'arena-gm-image' ? IMAGE_REQUEST_LEASE_MS : ACTIVE_REQUEST_LEASE_MS;
    if (Number.isFinite(heartbeatAt) && Date.now() - heartbeatAt > activeLeaseMs) {
      const staleId = active.packet.correlationId;
      console.warn(`Expiring stale Arena GM request ${staleId}: no browser heartbeat for ${Date.now() - heartbeatAt}ms (lease ${activeLeaseMs}ms).`);
      await rm(activeRequestPath, { force: true });
      const visiblePending = await readJsonIfPresent<RelayPacket>(pendingPath);
      if (visiblePending?.correlationId === staleId) await rm(pendingPath, { force: true });
      await removeResponseForCorrelation(staleId);
      if (active.packet.kind === 'arena-gm-image') {
        await rm(path.join(relayDirectory, 'images', `${staleId}.png`), { force: true });
      }
      active = null;
    } else {
      const visiblePending = await readJsonIfPresent<RelayPacket>(pendingPath);
      if (visiblePending?.correlationId !== active.packet.correlationId) {
        await writeJsonAtomically(pendingPath, active.packet);
      }
      return active;
    }
  }

  await mkdir(requestQueueDirectory, { recursive: true });
  const names = (await readdir(requestQueueDirectory)).filter(name => name.endsWith('.json'));
  const queued: Array<{ name: string; entry: QueuedRelayRequest }> = [];
  for (const name of names) {
    const filePath = path.join(requestQueueDirectory, name);
    try {
      const entry = await readJsonIfPresent<QueuedRelayRequest>(filePath);
      if (!entry?.packet || typeof entry.packet.correlationId !== 'string') continue;
      if (entry.packet.kind === 'arena-gm-image') {
        const heartbeatAt = entry.lastHeartbeatAt ?? entry.queuedAt;
        if (Number.isFinite(heartbeatAt) && Date.now() - heartbeatAt > IMAGE_REQUEST_LEASE_MS) {
          const staleId = entry.packet.correlationId;
          console.warn(`Expiring orphaned queued Arena GM image ${staleId}: no browser heartbeat for ${Date.now() - heartbeatAt}ms.`);
          await rm(filePath, { force: true });
          await removeResponseForCorrelation(staleId);
          await rm(path.join(relayDirectory, 'images', `${staleId}.png`), { force: true });
          continue;
        }
      }
      queued.push({ name, entry });
    } catch (error) {
      console.error(`Ignoring unreadable Arena GM queue entry ${name}:`, error);
    }
  }
  queued.sort((a, b) => requestPriority(a.entry.packet) - requestPriority(b.entry.packet)
    || a.entry.queuedAt - b.entry.queuedAt
    || (a.entry.packet.correlationId ?? '').localeCompare(b.entry.packet.correlationId ?? ''));

  const next = queued[0];
  if (!next) return null;
  const queuePath = path.join(requestQueueDirectory, next.name);
  try {
    // The active file is a durable claim. If the process restarts after this rename,
    // the next request can reconstruct pending.json from the active packet.
    await rename(queuePath, activeRequestPath);
  } catch (error: unknown) {
    if (asRecord(error)?.code === 'ENOENT') return dispatchNextRequest();
    throw error;
  }
  await writeJsonAtomically(pendingPath, next.entry.packet);
  return next.entry;
}

async function removeResponseForCorrelation(correlationId: string): Promise<void> {
  await rm(path.join(responseDirectory, `${correlationId}.json`), { force: true });
  const legacy = await readJsonIfPresent<RelayPacket>(legacyResponsePath).catch(() => null);
  if (legacy?.correlationId === correlationId) await rm(legacyResponsePath, { force: true });
}

function registerRelayMiddleware(server: { middlewares: { use: (handler: Connect.NextHandleFunction) => void } }): void {
  server.middlewares.use(async (req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        const url = new URL(req.url || '/', 'http://vite.local');
        if (!url.pathname.startsWith('/__arena_gm/')) return next();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const send = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.end(payload === null ? '' : JSON.stringify(payload));
        };
        const readBody = async (): Promise<RelayPacket> => {
          let raw = '';
          for await (const chunk of req) {
            raw += chunk.toString();
            if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
          }
          return JSON.parse(raw || '{}');
        };

        try {
          if (url.pathname === '/__arena_gm/rules' && req.method === 'GET') {
            send(200, await ensureRuleBundle(relayDirectory));
            return;
          }
          if (url.pathname === '/__arena_gm/turn' && req.method === 'POST') {
            const packet = await readBody();
            const correlationId = packet?.correlationId;
            if (!['arena-gm-turn', 'arena-gm-step', 'arena-gm-image'].includes(packet?.kind ?? '') || packet?.protocolVersion !== 1 || typeof correlationId !== 'string' || !CORRELATION_ID_PATTERN.test(correlationId)) {
              send(400, { error: 'Invalid Arena GM relay packet.' });
              return;
            }
            if (packet.kind === 'arena-gm-step' && (typeof packet.prompt !== 'string' || typeof packet.stepName !== 'string')) {
              send(400, { error: 'Arena GM step packet is missing its prompt or step name.' });
              return;
            }
            if (packet.kind === 'arena-gm-step' && packet.ruleBundleId !== undefined &&
                !(await verifyRuleBundle(relayDirectory, packet.ruleBundleId))) {
              send(409, { error: 'Rule bundle unavailable or changed; retry with full rules.' });
              return;
            }
            if (packet.kind === 'arena-gm-turn' && (!packet.turn || typeof packet.turn !== 'object')) {
              send(400, { error: 'Arena GM turn packet is missing its turn data.' });
              return;
            }
            const { width, height } = packet;
            if (packet.kind === 'arena-gm-image' && (typeof packet.prompt !== 'string' || typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096)) {
              send(400, { error: 'Arena GM image packet is missing a valid prompt or dimensions.' });
              return;
            }

            const accepted = await serializeRelayOperation(async () => {
              await mkdir(relayDirectory, { recursive: true });
              await mkdir(requestQueueDirectory, { recursive: true });
              await mkdir(responseDirectory, { recursive: true });
              if (packet.kind === 'arena-gm-image') await mkdir(path.join(relayDirectory, 'images'), { recursive: true });

              const active = await readActiveRequest();
              if (active?.packet.correlationId === packet.correlationId) {
                const sameRequest = JSON.stringify(active.packet) === JSON.stringify(packet);
                return { duplicate: true, sameRequest, queued: false };
              }
              const queuePath = path.join(requestQueueDirectory, `${packet.correlationId}.json`);
              const queuedRequest = await readJsonIfPresent<QueuedRelayRequest>(queuePath);
              if (queuedRequest) {
                const sameRequest = JSON.stringify(queuedRequest.packet) === JSON.stringify(packet);
                return { duplicate: true, sameRequest, queued: true };
              }
              const handle = await open(queuePath, 'wx');
              try {
                await handle.writeFile(JSON.stringify({ queuedAt: Date.now(), packet } satisfies QueuedRelayRequest, null, 2), 'utf8');
              } finally {
                await handle.close();
              }
              // A running image job is lower priority than every game-turn stage. Yield
              // its active slot without cancelling or deleting it so its owner can keep
              // heartbeating and consume its response after the turn has drained.
              if (packet.kind !== 'arena-gm-image' && active?.packet?.kind === 'arena-gm-image') {
                const imageId = active.packet.correlationId;
                const imageQueuePath = path.join(requestQueueDirectory, `${imageId}.json`);
                const alreadyQueuedImage = await readJsonIfPresent<QueuedRelayRequest>(imageQueuePath);
                if (alreadyQueuedImage && JSON.stringify(alreadyQueuedImage.packet) !== JSON.stringify(active.packet)) {
                  throw new Error('Cannot yield active image: its correlation ID is already assigned to a different queued packet.');
                }
                if (alreadyQueuedImage) await rm(activeRequestPath, { force: true });
                else await rename(activeRequestPath, imageQueuePath);
                const visiblePending = await readJsonIfPresent<RelayPacket>(pendingPath);
                if (visiblePending?.correlationId === imageId) await rm(pendingPath, { force: true });
              }

              const activeAfterDispatch = await dispatchNextRequest();
              return { duplicate: false, queued: activeAfterDispatch?.packet.correlationId !== packet.correlationId };
            });
            if (accepted.duplicate && !accepted.sameRequest) {
              send(409, { error: 'The correlationId is already assigned to a different relay request.' });
              return;
            }
            send(202, {
              accepted: true,
              queued: accepted.queued,
              duplicate: accepted.duplicate,
              correlationId: packet.correlationId,
            });
            return;
          }

          if (url.pathname === '/__arena_gm/cancel' && req.method === 'POST') {
            const body = await readBody();
            const correlationId = body?.correlationId;
            if (typeof correlationId !== 'string' || !CORRELATION_ID_PATTERN.test(correlationId)) {
              send(400, { error: 'A valid correlationId is required.' });
              return;
            }
            const result = await serializeRelayOperation(async () => {
              await mkdir(relayDirectory, { recursive: true });
              const queuedPath = path.join(requestQueueDirectory, `${correlationId}.json`);
              let wasQueued = false;
              try {
                await rm(queuedPath);
                wasQueued = true;
              } catch (error: unknown) {
                if (asRecord(error)?.code !== 'ENOENT') throw error;
              }
              const active = await readActiveRequest();
              const wasActive = active?.packet.correlationId === correlationId;
              if (wasActive) {
                await rm(activeRequestPath, { force: true });
                await rm(pendingPath, { force: true });
                await removeResponseForCorrelation(correlationId);
                await dispatchNextRequest();
              } else if (wasQueued) {
                await removeResponseForCorrelation(correlationId);
              }
              return { wasQueued, wasActive };
            });
            send(200, { cancelled: result.wasQueued || result.wasActive, ...result });
            return;
          }

          if (url.pathname === '/__arena_gm/response' && req.method === 'GET') {
            const correlationId = url.searchParams.get('correlationId');
            if (!correlationId || !CORRELATION_ID_PATTERN.test(correlationId)) { send(400, { error: 'A valid correlationId is required.' }); return; }
            const result = await serializeRelayOperation(async () => {
              await mkdir(responseDirectory, { recursive: true });
              const active = await dispatchNextRequest();
              if (active?.packet.correlationId !== correlationId) {
                const queuedPath = path.join(requestQueueDirectory, `${correlationId}.json`);
                const queued = await readJsonIfPresent<QueuedRelayRequest>(queuedPath);
                if (queued) {
                  queued.lastHeartbeatAt = Date.now();
                  await writeJsonAtomically(queuedPath, queued);
                  return null;
                }
                return { relayExpired: true };
              }
              active.lastHeartbeatAt = Date.now();
              await writeJsonAtomically(activeRequestPath, active);

              let response = await readJsonIfPresent<RelayPacket>(path.join(responseDirectory, `${correlationId}.json`));
              let responseSource: 'correlated' | 'legacy' | null = response ? 'correlated' : null;
              if (!response) {
                const legacy = await readJsonIfPresent<RelayPacket>(legacyResponsePath);
                if (legacy?.correlationId === correlationId) {
                  response = legacy;
                  responseSource = 'legacy';
                }
              }
              if (!response || response.correlationId !== correlationId) return null;

              if (responseSource === 'correlated') await rm(path.join(responseDirectory, `${correlationId}.json`), { force: true });
              if (responseSource === 'legacy') await rm(legacyResponsePath, { force: true });
              await rm(activeRequestPath, { force: true });
              await rm(pendingPath, { force: true });
              await dispatchNextRequest();
              return response;
            });
            if (result === null) { res.statusCode = 204; res.end(); return; }
            if (result !== null && typeof result === 'object' && 'relayExpired' in result) { send(410, { error: 'Relay request expired or was cancelled before its response was consumed.' }); return; }
            send(200, result);
            return;
          }

          if (url.pathname === '/__arena_gm/image' && req.method === 'GET') {
            const correlationId = url.searchParams.get('correlationId') || '';
            if (!CORRELATION_ID_PATTERN.test(correlationId)) {
              send(400, { error: 'Invalid correlationId.' });
              return;
            }
            try {
              const image = await readFile(path.join(relayDirectory, 'images', `${correlationId}.png`));
              res.statusCode = 200;
              res.setHeader('Content-Type', 'image/png');
              res.end(image);
            } catch {
              send(404, { error: 'Generated image is not available.' });
            }
            return;
          }

          if (url.pathname === '/__arena_gm/status' && req.method === 'GET') {
            const relayStatus = await serializeRelayOperation(async () => {
              const active = await dispatchNextRequest();
              const queuedNames = await readdir(requestQueueDirectory).catch(() => [] as string[]);
              const queuedRequests = await Promise.all(queuedNames
                .filter(name => name.endsWith('.json'))
                .map(name => readJsonIfPresent<QueuedRelayRequest>(path.join(requestQueueDirectory, name))));
              const queuedTurnCount = queuedRequests.filter(request => request?.packet?.kind !== 'arena-gm-image').length;
              return {
                enabled: true,
                activeCorrelationId: active?.packet.correlationId || null,
                activeKind: active?.packet.kind || null,
                queuedCount: queuedRequests.filter(Boolean).length,
                queuedTurnCount,
              };
            });
            send(200, relayStatus);
            return;
          }
          send(404, { error: 'Unknown relay endpoint.' });
        } catch (error: unknown) {
          const statusCode = asRecord(error)?.statusCode;
          send(typeof statusCode === 'number' ? statusCode : 500, { error: error instanceof Error ? error.message : 'Relay server error.' });
        }
  });
}

/**
 * A prompt module request in dev. Every one of them is prose plus small arrow
 * functions, addressed by a relative path with its extension.
 */
const isPromptSourceUrl = (pathname: string): boolean => pathname.startsWith('/prompts/') && pathname.endsWith('.js');

/**
 * The rulebook and the step guides are megabytes of template literals. Vite's dev
 * transform inlines source maps that repeat this prose, multiplying each module response
 * and the total guide download on the first turn of every session.
 *
 * These modules are therefore answered straight from disk. They can be: each one is
 * plain JavaScript whose only specifiers are relative paths with extensions, so the
 * browser resolves them without help. `scripts/prompt-sources-are-plain-js.test.mjs`
 * enforces exactly that. A prompt edit still reloads the page: Vite keeps the module as
 * a dependency of the game code that imports it, it just has nothing to transform.
 */
function servePromptSourcesVerbatim(): Plugin {
  return {
    name: 'serve-prompt-sources-verbatim',
    apply: 'serve',
    configureServer(server) {
      const promptDirectory = path.join(server.config.root, 'prompts');
      server.middlewares.use((req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        const pathname = req.method === 'GET' && req.url ? decodeURIComponent(req.url.split('?')[0]) : '';
        if (!isPromptSourceUrl(pathname)) return next();
        // Normalising first is what rejects a `../` request: it no longer starts with the directory.
        const file = path.normalize(path.join(server.config.root, pathname));
        if (!file.startsWith(promptDirectory + path.sep)) return next();
        readFile(file, 'utf8').then((source) => {
          // No immutable cache and no version query: the text is the file, and it changes.
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(source);
        }, () => next());
      });
    },
  };
}

function arenaGmFilesystemRelay(): Plugin {
  return {
    name: 'arena-gm-filesystem-relay',
    configureServer(server) {
      registerRelayMiddleware(server);
    },
    configurePreviewServer(server) {
      registerRelayMiddleware(server);
    },
  };
}

export default defineConfig({
  plugins: [servePromptSourcesVerbatim(), arenaGmFilesystemRelay()],
  build: {
    rollupOptions: {
      output: {
        // The rulebook is megabytes of prose every stage needs verbatim, and it is loaded
        // lazily on top of that. Keeping one file per section lets the browser fetch the
        // rulebook in parallel and means a reviewed rules edit invalidates only the section
        // it touched, not the whole guide.
        manualChunks: (id) => {
          const section = /[\\/]prompts[\\/]mainPromptModule[\\/]section-(\d+)\.js$/.exec(id);
          if (section) return `game-master-guide-section-${section[1]}`;
          // Keep static shell dictionaries separate while leaving the larger *_loc imports lazy.
          if (/[\\/]utils[\\/]translations[\\/]ui[\\/]/.test(id)) return 'localization-ui';
          const worldBase = /[\\/]utils[\\/]translations[\\/]worlds[\\/](?:[^\\/]+|(?:history|myths)[\\/][^\\/]+)\.ts$/.exec(id);
          if (worldBase && !/[\\/]([^\\/]+)_loc\.ts$/.test(id)) return 'localization-world-base';
          if (/[\\/]node_modules[\\/]react-dom[\\/]/.test(id)) return 'vendor-react-dom';
          return undefined;
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
