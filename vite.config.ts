import { defineConfig, Plugin } from 'vite';
import { access, mkdir, open, readFile, rename, rm, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const relayDirectory = path.resolve(process.env.ARENA_GM_RELAY_DIR || path.join(process.cwd(), '.arena-gm-relay'));
const pendingPath = path.join(relayDirectory, 'pending.json');
const legacyResponsePath = path.join(relayDirectory, 'response.json');
const activeRequestPath = path.join(relayDirectory, 'active-request.json');
const requestQueueDirectory = path.join(relayDirectory, 'request-queue');
const responseDirectory = path.join(relayDirectory, 'responses');
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

interface QueuedRelayRequest {
  queuedAt: number;
  packet: Record<string, any>;
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
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
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

function requestPriority(packet: Record<string, any>): number {
  return packet.kind === 'arena-gm-image' ? 1 : 0;
}

async function readActiveRequest(): Promise<QueuedRelayRequest | null> {
  return readJsonIfPresent<QueuedRelayRequest>(activeRequestPath);
}

async function dispatchNextRequest(): Promise<QueuedRelayRequest | null> {
  const active = await readActiveRequest();
  if (active) {
    const visiblePending = await readJsonIfPresent<Record<string, any>>(pendingPath);
    if (visiblePending?.correlationId !== active.packet.correlationId) {
      await writeJsonAtomically(pendingPath, active.packet);
    }
    return active;
  }

  await mkdir(requestQueueDirectory, { recursive: true });
  const names = (await readdir(requestQueueDirectory)).filter(name => name.endsWith('.json'));
  const queued: Array<{ name: string; entry: QueuedRelayRequest }> = [];
  for (const name of names) {
    const filePath = path.join(requestQueueDirectory, name);
    try {
      const entry = await readJsonIfPresent<QueuedRelayRequest>(filePath);
      if (entry?.packet && typeof entry.packet.correlationId === 'string') queued.push({ name, entry });
    } catch (error) {
      console.error(`Ignoring unreadable Arena GM queue entry ${name}:`, error);
    }
  }
  queued.sort((a, b) => requestPriority(a.entry.packet) - requestPriority(b.entry.packet)
    || a.entry.queuedAt - b.entry.queuedAt
    || a.entry.packet.correlationId.localeCompare(b.entry.packet.correlationId));

  const next = queued[0];
  if (!next) return null;
  const queuePath = path.join(requestQueueDirectory, next.name);
  try {
    // The active file is a durable claim. If the process restarts after this rename,
    // the next request can reconstruct pending.json from the active packet.
    await rename(queuePath, activeRequestPath);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return dispatchNextRequest();
    throw error;
  }
  await writeJsonAtomically(pendingPath, next.entry.packet);
  return next.entry;
}

async function removeResponseForCorrelation(correlationId: string): Promise<void> {
  await rm(path.join(responseDirectory, `${correlationId}.json`), { force: true });
  const legacy = await readJsonIfPresent<Record<string, any>>(legacyResponsePath).catch(() => null);
  if (legacy?.correlationId === correlationId) await rm(legacyResponsePath, { force: true });
}

function arenaGmFilesystemRelay(): Plugin {
  return {
    name: 'arena-gm-filesystem-relay',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://vite.local');
        if (!url.pathname.startsWith('/__arena_gm/')) return next();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const send = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.end(payload === null ? '' : JSON.stringify(payload));
        };
        const readBody = async (): Promise<any> => {
          let raw = '';
          for await (const chunk of req) {
            raw += chunk.toString();
            if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
          }
          return JSON.parse(raw || '{}');
        };

        try {
          if (url.pathname === '/__arena_gm/turn' && req.method === 'POST') {
            const packet = await readBody();
            if (!['arena-gm-turn', 'arena-gm-step', 'arena-gm-image'].includes(packet?.kind) || packet?.protocolVersion !== 1 || typeof packet?.correlationId !== 'string' || !CORRELATION_ID_PATTERN.test(packet.correlationId)) {
              send(400, { error: 'Invalid Arena GM relay packet.' });
              return;
            }
            if (packet.kind === 'arena-gm-step' && (typeof packet.prompt !== 'string' || typeof packet.stepName !== 'string')) {
              send(400, { error: 'Arena GM step packet is missing its prompt or step name.' });
              return;
            }
            if (packet.kind === 'arena-gm-turn' && (!packet.turn || typeof packet.turn !== 'object')) {
              send(400, { error: 'Arena GM turn packet is missing its turn data.' });
              return;
            }
            if (packet.kind === 'arena-gm-image' && (typeof packet.prompt !== 'string' || !Number.isInteger(packet.width) || !Number.isInteger(packet.height) || packet.width < 1 || packet.height < 1 || packet.width > 4096 || packet.height > 4096)) {
              send(400, { error: 'Arena GM image packet is missing a valid prompt or dimensions.' });
              return;
            }

            const accepted = await serializeRelayOperation(async () => {
              await mkdir(relayDirectory, { recursive: true });
              await mkdir(requestQueueDirectory, { recursive: true });
              await mkdir(responseDirectory, { recursive: true });
              if (packet.kind === 'arena-gm-image') await mkdir(path.join(relayDirectory, 'images'), { recursive: true });

              const active = await readActiveRequest();
              if (active?.packet.correlationId === packet.correlationId) return { duplicate: true, queued: false };
              const queuePath = path.join(requestQueueDirectory, `${packet.correlationId}.json`);
              try {
                await access(queuePath);
                return { duplicate: true, queued: false };
              } catch (error: any) {
                if (error?.code !== 'ENOENT') throw error;
              }
              const handle = await open(queuePath, 'wx');
              try {
                await handle.writeFile(JSON.stringify({ queuedAt: Date.now(), packet } satisfies QueuedRelayRequest, null, 2), 'utf8');
              } finally {
                await handle.close();
              }
              const activeAfterDispatch = await dispatchNextRequest();
              return { duplicate: false, queued: activeAfterDispatch?.packet.correlationId !== packet.correlationId };
            });
            if (accepted.duplicate) {
              send(409, { error: 'A relay request with this correlationId is already queued or active.' });
              return;
            }
            send(202, { accepted: true, queued: accepted.queued, correlationId: packet.correlationId });
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
              } catch (error: any) {
                if (error?.code !== 'ENOENT') throw error;
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
              if (active?.packet.correlationId !== correlationId) return null;

              let response = await readJsonIfPresent<Record<string, any>>(path.join(responseDirectory, `${correlationId}.json`));
              let responseSource: 'correlated' | 'legacy' | null = response ? 'correlated' : null;
              if (!response) {
                const legacy = await readJsonIfPresent<Record<string, any>>(legacyResponsePath);
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
            const [active, queuedNames] = await Promise.all([
              readJsonIfPresent<QueuedRelayRequest>(activeRequestPath),
              readdir(requestQueueDirectory).catch(() => [] as string[]),
            ]);
            send(200, { enabled: true, activeCorrelationId: active?.packet.correlationId || null, queuedCount: queuedNames.filter(name => name.endsWith('.json')).length });
            return;
          }
          send(404, { error: 'Unknown relay endpoint.' });
        } catch (error: any) {
          send(error?.statusCode || 500, { error: error instanceof Error ? error.message : 'Relay server error.' });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [arenaGmFilesystemRelay()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
