import { defineConfig, Plugin } from 'vite';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const relayDirectory = path.resolve(process.cwd(), '.arena-gm-relay');
const pendingPath = path.join(relayDirectory, 'pending.json');
const responsePath = path.join(relayDirectory, 'response.json');
const MAX_BODY_BYTES = 12 * 1024 * 1024;

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

        try {
          if (url.pathname === '/__arena_gm/turn' && req.method === 'POST') {
            let raw = '';
            for await (const chunk of req) {
              raw += chunk.toString();
              if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
                send(413, { error: 'Turn packet is too large.' });
                return;
              }
            }
            const packet = JSON.parse(raw);
            if (!['arena-gm-turn', 'arena-gm-step', 'arena-gm-image'].includes(packet?.kind) || packet?.protocolVersion !== 1 || typeof packet?.correlationId !== 'string') {
              send(400, { error: 'Invalid Arena GM relay packet.' });
              return;
            }
            if (packet.kind === 'arena-gm-step' && (typeof packet.prompt !== 'string' || typeof packet.stepName !== 'string')) {
              send(400, { error: 'Arena GM step packet is missing its prompt or step name.' });
              return;
            }
            await mkdir(relayDirectory, { recursive: true });
            if (packet.kind === 'arena-gm-image') {
              if (typeof packet.prompt !== 'string' || !Number.isFinite(packet.width) || !Number.isFinite(packet.height)) {
                send(400, { error: 'Arena GM image packet is missing prompt or dimensions.' });
                return;
              }
              await mkdir(path.join(relayDirectory, 'images'), { recursive: true });
            }
            await rm(responsePath, { force: true });
            await writeFile(pendingPath, JSON.stringify(packet, null, 2), 'utf8');
            send(202, { accepted: true, correlationId: packet.correlationId });
            return;
          }

          if (url.pathname === '/__arena_gm/response' && req.method === 'GET') {
            const correlationId = url.searchParams.get('correlationId');
            if (!correlationId) { send(400, { error: 'correlationId is required.' }); return; }
            let text: string;
            try { text = await readFile(responsePath, 'utf8'); }
            catch { res.statusCode = 204; res.end(); return; }
            let packet: any;
            try { packet = JSON.parse(text); }
            catch { send(500, { error: 'Relay response file contains invalid JSON.' }); return; }
            if (packet?.correlationId !== correlationId) { res.statusCode = 204; res.end(); return; }
            await rm(responsePath, { force: true });
            await rm(pendingPath, { force: true });
            send(200, packet);
            return;
          }

          if (url.pathname === '/__arena_gm/image' && req.method === 'GET') {
            const correlationId = url.searchParams.get('correlationId') || '';
            if (!/^[0-9a-f-]{36}$/i.test(correlationId)) {
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
            send(200, { enabled: true });
            return;
          }
          send(404, { error: 'Unknown relay endpoint.' });
        } catch (error) {
          send(500, { error: error instanceof Error ? error.message : 'Relay server error.' });
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
