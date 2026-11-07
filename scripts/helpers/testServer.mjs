import { createServer } from 'vite';

// Tests that only read pure game logic used to boot a fresh Vite server per test case,
// which dominated their run time. One server per test file keeps the module graph warm.
// `getTestServer()` hands back a proxy whose `close()` is a no-op, so an existing
// `finally { await server.close(); }` keeps working while the real server lives until the
// file's `after` hook; files that manipulate storage or need a pristine module registry
// still create their own server instead.
let serverPromise = null;
let sharedProxy = null;

export async function getTestServer() {
  serverPromise ??= createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  });
  const server = await serverPromise;
  if (!sharedProxy) {
    sharedProxy = new Proxy(server, {
      get(target, property) {
        if (property === 'close') return async () => undefined;
        if (property === 'forceClose') return async () => undefined;
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
  return sharedProxy;
}

export async function closeTestServer() {
  if (!serverPromise) return;
  const server = await serverPromise;
  serverPromise = null;
  sharedProxy = null;
  await server.close();
}
