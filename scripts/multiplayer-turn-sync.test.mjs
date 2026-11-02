import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

test('host broadcasts restored player result without reading pending React state or stale packaged history', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { applyPlayerTurnResult } = await server.ssrLoadModule('/hooks/logic/multiplayer.ts');
    const oldState = { players: [{ playerId: 'player' }], activePlayerIndex: 0, playerCharacter: { currentHealth: 40 } };
    const incoming = { gameState: { playerCharacter: { currentHealth: 50 } }, gameContext: { currentTurnNumber: 3 }, gameHistory: [{ sender: 'gm', content: 'Healed' }], gameLog: ['new'], combatLog: ['battle'], timestamp: 'now' };
    const restored = { ...incoming, gameState: { ...incoming.gameState, networkRole: 'host', myPeerId: 'host' }, gameLog: ['new', 'restored level log'] };
    const gameStateRef = { current: oldState }; let sent = null, history = incoming.gameHistory, error = null, restores = 0;
    const props = { gameStateRef, restoreFromSaveData: (data, network) => { restores++; assert.equal(data, incoming); assert.equal(network, true); return restored; }, broadcastFullSync: data => { sent = data; }, setError: v => { error = v; }, setGameHistory: v => { history = typeof v === 'function' ? v(history) : v; }, t: key => key };
    const message = { type: 'turn_result_from_player', senderId: 'player', payload: { saveFile: incoming } };
    applyPlayerTurnResult(message, props);
    assert.equal(gameStateRef.current, oldState, 'React update deliberately remains pending');
    assert.equal(sent, restored); assert.equal(sent.gameState.playerCharacter.currentHealth, 50);
    assert.deepEqual(sent.gameHistory, incoming.gameHistory); assert.deepEqual(sent.gameLog, ['new', 'restored level log']);
    assert.deepEqual(sent.combatLog, incoming.combatLog); assert.equal(error, null);
    sent = null; applyPlayerTurnResult({ ...message, senderId: 'other' }, props);
    assert.equal(sent, null); assert.equal(restores, 1);
    props.broadcastFullSync = () => { throw new Error('peer failed'); };
    applyPlayerTurnResult(message, props);
    assert.match(error, /error_turn_applied_followup/); assert.match(error, /peer failed/);
    assert.equal(history[0].content, 'Healed'); assert.equal(history[1].sender, 'system');
    const hook = await readFile(new URL('../hooks/useGameLogic.ts', import.meta.url), 'utf8');
    const manager = await readFile(new URL('../hooks/logic/multiplayer.ts', import.meta.url), 'utf8');
    assert.match(hook, /return \{ \.\.\.data, gameState: loadedGameState, gameLog: finalGameLog \}/);
    assert.match(hook, /packageSaveData: state => packageSaveDataRef\.current\?\.\(state\)/);
    assert.equal((manager.match(/applyPlayerTurnResult\(message, \{/g) || []).length, 2);
  } finally { await server.close(); }
});
