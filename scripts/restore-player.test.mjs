import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

test('loading recalculates the saved player regardless of level-up and preserves peer identities', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { restorePlayerStats } = await server.ssrLoadModule('/utils/restorePlayer.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const pc = { ...context.playerCharacter, playerId: 'me', maxHealth: 999, totalWeight: 999, isOverloaded: true, experience: 0, inventory: [] };
    const state = { playerCharacter: pc, players: [pc], activePlayerIndex: 0, networkRole: 'none', myPeerId: null };
    const logs = restorePlayerStats(state, key => key, false);
    assert.deepEqual(logs, []);
    assert.notEqual(state.playerCharacter.maxHealth, 999);
    assert.equal(state.playerCharacter.totalWeight, 0);
    assert.equal(state.playerCharacter.isOverloaded, false);
    assert.equal(state.playerCharacter.criticalExcessWeight, 15);
    assert.equal(state.players[0], state.playerCharacter);

    const other = { ...pc, playerId: 'other', name: 'Other' };
    const network = { playerCharacter: pc, players: [other, pc], activePlayerIndex: 0, networkRole: 'player', myPeerId: 'me' };
    restorePlayerStats(network, key => key, true);
    assert.equal(network.players[0], other);
    assert.equal(network.players[1], network.playerCharacter);
    assert.notEqual(network.players[1].maxHealth, 999);

    const missing = { playerCharacter: pc, players: [other], activePlayerIndex: 0, networkRole: 'player', myPeerId: 'not-joined' };
    restorePlayerStats(missing, key => key, true);
    assert.equal(missing.players[0], other);

    const levelPc = { ...pc, level: 1, experience: 100, experienceForNextLevel: 100 };
    const levelState = { ...state, playerCharacter: levelPc, players: [levelPc] };
    const levelLogs = restorePlayerStats(levelState, key => key, false);
    assert.equal(levelState.playerCharacter.level, 2);
    assert.equal(levelState.players[0], levelState.playerCharacter);
    assert.equal(levelLogs.length, 1);

    const hook = await readFile(new URL('../hooks/useGameLogic.ts', import.meta.url), 'utf8');
    assert.match(hook, /restorePlayerStats\(loadedGameState, t, isNetworkSync\)/);
    assert.match(hook, /finalGameLog = \[\.\.\.finalGameLog, \.\.\.levelUpLogs\]/);
  } finally { await server.close(); }
});
