import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('cancelling a queued GM turn lease removes it without blocking the next turn', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { acquireArenaGmTurnLease } = await server.ssrLoadModule('/utils/arenaGmRelay.ts');
    const releaseFirst = await acquireArenaGmTurnLease();
    const controller = new AbortController();
    const cancelled = acquireArenaGmTurnLease(controller.signal);
    const next = acquireArenaGmTurnLease();
    controller.abort();
    await assert.rejects(cancelled, error => error.name === 'AbortError');
    releaseFirst();
    const releaseNext = await Promise.race([next, new Promise((_, reject) => setTimeout(() => reject(new Error('lease blocked')), 2000))]);
    releaseNext();
    const alreadyAborted = new AbortController(); alreadyAborted.abort();
    await assert.rejects(acquireArenaGmTurnLease(alreadyAborted.signal), error => error.name === 'AbortError');
    const releaseLast = await acquireArenaGmTurnLease(); releaseLast();
  } finally { await server.close(); }
});
