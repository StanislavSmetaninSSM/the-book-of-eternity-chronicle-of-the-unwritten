import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

test('network snapshots omit the local YouTube key in both directions without mutating saves', async () => {
    const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    try {
        const { networkSafeSaveFile } = await server.ssrLoadModule('/utils/networkSavePrivacy.ts');
        const save = { gameContext: { gameSettings: { youtubeApiKey: 'private-key', hardMode: true }, worldState: {} }, gameState: {} };
        const safe = networkSafeSaveFile(save);
        assert.equal(Object.hasOwn(safe.gameContext.gameSettings, 'youtubeApiKey'), false);
        assert.equal(safe.gameContext.gameSettings.hardMode, true);
        assert.equal(save.gameContext.gameSettings.youtubeApiKey, 'private-key');
        assert.equal(safe.gameState, save.gameState);
        const hook = await readFile(new URL('../hooks/useGameLogic.ts', import.meta.url), 'utf8');
        const turn = await readFile(new URL('../hooks/logic/turn.ts', import.meta.url), 'utf8');
        assert.match(hook, /saveFile: networkSafeSaveFile\(saveData\)/);
        assert.equal((turn.match(/saveFile: networkSafeSaveFile\(newSaveData\)/g) || []).length, 2);
    } finally { await server.close(); }
});
