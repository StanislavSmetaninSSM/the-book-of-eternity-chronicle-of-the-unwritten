import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('late, replayed, concurrent and incompatible player results cannot overwrite host state', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { HostTurnAuthority, acceptHostStamp } = await server.ssrLoadModule('/utils/networkTurnProtocol.ts');
    const { applyPlayerTurnResult } = await server.ssrLoadModule('/hooks/logic/multiplayer.ts');
    let session = 0;
    const authority = new HostTurnAuthority(() => `session-${++session}`);
    const stateRef = { current: { networkRole: 'host', players: [{ playerId: 'p' }], activePlayerIndex: 0, playerCharacter: { currentHealth: 40 } } };
    let history = ['old'], restores = 0; const acks = [];
    const props = { hostTurnAuthority: authority, gameStateRef: stateRef, restoreFromSaveData: snapshot => { restores++; stateRef.current = snapshot.gameState; history = snapshot.gameHistory; const finish = authority.beginMutation(); finish(); return snapshot; }, broadcastFullSync: async () => {}, setError: () => {}, setGameHistory: () => {}, t: k => k };
    const ack = async payload => { acks.push(payload); };
    const packet = (turnId, stamp, hp) => ({ type: 'turn_result_from_player', senderId: 'p', payload: { submission: { turnId, base: stamp }, saveFile: { gameState: { ...stateRef.current, playerCharacter: { currentHealth: hp } }, gameHistory: [`hp:${hp}`] } } });
    const first = authority.issue();
    const delayed = packet('old-turn-00000000000001', first, 50);
    authority.revoke(); // Host received request_full_sync before delayed send arrived.
    const synchronized = authority.issue();
    const newer = packet('new-turn-00000000000002', synchronized, 70);
    await applyPlayerTurnResult(newer, 'p', props, ack);
    await applyPlayerTurnResult(delayed, 'p', props, ack);
    assert.equal(stateRef.current.playerCharacter.currentHealth, 70); assert.deepEqual(history, ['hp:70']);
    assert.deepEqual(acks.map(a => a.status), ['accepted', 'stale']); assert.equal(restores, 1);
    await applyPlayerTurnResult(newer, 'p', props, ack); assert.equal(acks.at(-1).status, 'duplicate'); assert.equal(restores, 1);
    const next = authority.issue(); const a = packet('concurrent-turn-00000003', next, 80), b = packet('concurrent-turn-00000004', next, 90);
    await Promise.all([applyPlayerTurnResult(a, 'p', props, ack), applyPlayerTurnResult(b, 'p', props, ack)]);
    assert.equal(stateRef.current.playerCharacter.currentHealth, 80); assert.equal(acks.at(-1).status, 'stale');
    await applyPlayerTurnResult(packet('spoofed-turn-0000000005', authority.issue(), 999), 'other-connection', props, ack);
    assert.equal(acks.at(-1).status, 'unauthorized'); assert.equal(stateRef.current.playerCharacter.currentHealth, 80);
    await applyPlayerTurnResult({ type:'turn_result_from_player', senderId:'p', payload:{saveFile: delayed.payload.saveFile} }, 'p', props, ack);
    assert.equal(acks.at(-1).status, 'invalid');
    const beforeMutation = authority.issue(); const finish = authority.beginMutation();
    assert.equal(authority.issue(), null); await applyPlayerTurnResult(packet('during-update-000000006', beforeMutation, 10), 'p', props, ack); assert.equal(acks.at(-1).status, 'pending');
    finish(); assert.equal(authority.accept({turnId:'late-update-0000000007', base:beforeMutation}, 'p','p','p'), 'stale');
    // If the delayed packet wins the race, it is committed exactly once and
    // the subsequently requested sync must represent that committed state.
    const beforeRequest = authority.issue();
    const wonRace = packet('arrived-before-sync-009', beforeRequest, 95);
    await applyPlayerTurnResult(wonRace, 'p', props, async () => { throw new Error('ACK lost'); });
    assert.equal(stateRef.current.playerCharacter.currentHealth, 95); assert.deepEqual(history, ['hp:95']);
    authority.revoke(); const afterRequest = authority.issue();
    assert.ok(afterRequest.revision > beforeRequest.revision);
    const appliedCount = restores;
    await applyPlayerTurnResult(wonRace, 'p', props, ack);
    assert.equal(acks.at(-1).status, 'duplicate'); assert.equal(restores, appliedCount);
    // A retransmission remains a duplicate even after the active player changes.
    assert.equal(authority.accept(wonRace.payload.submission, 'p', 'p', 'different-player'), 'duplicate');
    const failStamp = authority.issue(); const failed = packet('restore-failure-00000010', failStamp, 100);
    const failProps = { ...props, restoreFromSaveData: () => { throw new Error('restore failed'); } };
    await applyPlayerTurnResult(failed, 'p', failProps, ack); await Promise.resolve();
    assert.equal(acks.at(-1).status, 'unknown');
    await applyPlayerTurnResult(failed, 'p', props, ack);
    assert.equal(acks.at(-1).status, 'unknown'); assert.equal(stateRef.current.playerCharacter.currentHealth, 95);
    const oldSession = authority.issue(); authority.reset(); const newSession = authority.issue();
    assert.equal(authority.accept({turnId:'old-session-00000000008',base:oldSession},'p','p','p'), 'stale');
    assert.equal(acceptHostStamp(null, oldSession), 'accept'); assert.equal(acceptHostStamp(oldSession, oldSession), 'duplicate');
    assert.equal(acceptHostStamp(synchronized, first), 'stale'); assert.equal(acceptHostStamp(oldSession, newSession), 'invalid');
    assert.equal(acceptHostStamp(null, {}), 'invalid');
  } finally { await server.close(); }
});
