import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('host broadcasts the restored player result without pending React or stale packaged history', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { applyPlayerTurnResult } = await server.ssrLoadModule('/hooks/logic/multiplayer.ts');
    const { HostTurnAuthority } = await server.ssrLoadModule('/utils/networkTurnProtocol.ts');
    const authority = new HostTurnAuthority(() => 'session-a');
    const stamp = authority.issue();
    const oldState = { players: [{ playerId: 'player' }], activePlayerIndex: 0, playerCharacter: { currentHealth: 40 } };
    const incoming = { gameState: { playerCharacter: { currentHealth: 50 } }, gameContext: { currentTurnNumber: 3 }, gameHistory: [{ sender: 'gm', content: 'Healed' }], gameLog: ['new'], combatLog: ['battle'], timestamp: 'now' };
    const restored = { ...incoming, gameState: { ...incoming.gameState, networkRole: 'host', myPeerId: 'host' }, gameLog: ['new', 'restored level log'] };
    const gameStateRef = { current: oldState }; let sent = null, history = incoming.gameHistory, error = null, restores = 0; const acks = [];
    const props = { gameStateRef, hostTurnAuthority: authority, restoreFromSaveData: (data, network) => { restores++; assert.equal(data, incoming); assert.equal(network, true); return restored; }, broadcastFullSync: data => { sent = data; }, setError: v => { error = v; }, setGameHistory: v => { history = typeof v === 'function' ? v(history) : v; }, t: key => key };
    const message = { type: 'turn_result_from_player', senderId: 'player', payload: { saveFile: incoming, submission: { turnId: 'turn-id-0000000001', base: stamp } } };
    const ack = async payload => { acks.push(payload); };
    await applyPlayerTurnResult(message, 'player', props, ack);
    assert.equal(gameStateRef.current, oldState, 'React update deliberately remains pending');
    assert.equal(sent, restored); assert.equal(sent.gameState.playerCharacter.currentHealth, 50);
    assert.deepEqual(sent.gameHistory, incoming.gameHistory); assert.deepEqual(sent.gameLog, ['new', 'restored level log']);
    assert.deepEqual(sent.combatLog, incoming.combatLog); assert.equal(error, null); assert.equal(acks.at(-1).status, 'accepted');
    sent = null; await applyPlayerTurnResult(message, 'player', props, ack);
    assert.equal(sent, null); assert.equal(restores, 1); assert.equal(acks.at(-1).status, 'duplicate');
    await applyPlayerTurnResult({ ...message, senderId: 'other' }, 'player', props, ack);
    assert.equal(acks.at(-1).status, 'unauthorized');
    const nextStamp = authority.issue();
    props.broadcastFullSync = () => { throw new Error('peer failed'); };
    await applyPlayerTurnResult({ ...message, payload: { ...message.payload, submission: { turnId: 'turn-id-0000000002', base: nextStamp } } }, 'player', props, ack);
    assert.match(error, /error_turn_applied_followup/); assert.match(error, /peer failed/);
    assert.equal(history[0].content, 'Healed'); assert.equal(history[1].sender, 'system');
  } finally { await server.close(); }
});
