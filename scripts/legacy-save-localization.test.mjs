import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('legacy host, player and spectator saves become local without losing party, history, or pending actions', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { localizeLegacySave } = await server.ssrLoadModule('/utils/localizeLegacySave.ts');
    for (const role of ['host', 'player', 'spectator', 'none', undefined]) {
      const characters = [{ playerId: 'peer-1', name: 'A' }, { playerId: 'peer-2', name: 'B' }];
      const pending = { isActive: true, prompt: 'Hold the bridge', actions: { 'peer-2': 'Guard' } };
      const original = { gameState: { networkRole: role, myPeerId: 'peer-1', hostPeerId: 'peer-1', peers: [{ id: 'peer-2' }], isConnectedToHost: false, players: characters, playerCharacter: characters[0], activePlayerIndex: 1, playerNeedsToCreateCharacter: true, collectiveActionState: pending }, gameContext: { networkRole: role, peers: [{ id: 'peer-2' }], isConnectedToHost: false }, gameHistory: [{ sender: 'player', content: 'remember this' }] };
      const migrated = localizeLegacySave(original);
      assert.equal(migrated.gameState.networkRole, undefined);
      assert.equal(migrated.gameState.myPeerId, undefined);
      assert.equal(migrated.gameState.hostPeerId, undefined);
      assert.equal(migrated.gameState.peers, undefined);
      assert.equal(migrated.gameState.playerNeedsToCreateCharacter, undefined);
      assert.equal(migrated.gameState.collectiveActionState, undefined);
      assert.deepEqual(migrated.gameState.legacyNetworkActions, [pending]);
      assert.deepEqual(migrated.gameState.players, characters);
      assert.equal(migrated.gameState.activePlayerIndex, role && role !== 'none' ? 1 : 0);
      assert.equal(migrated.gameState.playerCharacter.playerId, role && role !== 'none' ? 'peer-2' : 'peer-1');
      assert.equal(migrated.gameContext.playerCharacter, migrated.gameState.playerCharacter);
      assert.deepEqual(migrated.gameHistory, original.gameHistory);
      assert.equal(migrated.gameContext.networkRole, undefined);
      assert.equal(original.gameState.networkRole, role);
      assert.deepEqual(localizeLegacySave(migrated).gameState.legacyNetworkActions, [pending]);
    }
  } finally { await server.close(); }
});

test('malformed party indices resolve only unambiguous identity without overwriting characters', async () => {
 const server = await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'error'});
 try {
  const {localizeLegacySave}=await server.ssrLoadModule('/utils/localizeLegacySave.ts');
  const a={playerId:'a'}, b={playerId:'b'};
  for (const role of ['host','none',undefined]) {
   const save={gameState:{networkRole:role,players:[a,b],playerCharacter:b,activePlayerIndex:-1},gameContext:{}};
   const result=localizeLegacySave(save);
   assert.deepEqual(result.gameState.players.map(p=>p.playerId),['a','b']);
   assert.equal(result.gameState.activePlayerIndex,1);
   assert.equal(save.gameState.activePlayerIndex,-1);
  }
  assert.throws(()=>localizeLegacySave({gameState:{players:[a,b],playerCharacter:{playerId:'missing'},activePlayerIndex:-1},gameContext:{}}),/Cannot safely load/);
  assert.throws(()=>localizeLegacySave({gameState:{players:[a,a],playerCharacter:a,activePlayerIndex:0},gameContext:{}}),/ambiguous/);
  const fallback=localizeLegacySave({gameState:{playerCharacter:b,activePlayerIndex:-1},gameContext:{players:[a,b],playerCharacter:b}});
  assert.deepEqual(fallback.gameState.players.map(p=>p.playerId),['a','b']);
  assert.throws(()=>localizeLegacySave({gameState:{players:'oops',playerCharacter:a,activePlayerIndex:0},gameContext:{}}),/roster is unreadable/);
  assert.throws(()=>localizeLegacySave({gameState:{players:[],activePlayerIndex:0},gameContext:{}}),/no player character/);
  const emptyRoster={gameState:{players:[],playerCharacter:b,activePlayerIndex:0},gameContext:{}};
  const restoredEmptyRoster=localizeLegacySave(emptyRoster);
  assert.deepEqual(restoredEmptyRoster.gameState.players.map(p=>p.playerId),['b']);
  assert.equal(restoredEmptyRoster.gameState.activePlayerIndex,0);
  assert.deepEqual(emptyRoster.gameState.players,[]);
  // A roster that lost the separate displayed character is healed from the index.
  const healed=localizeLegacySave({gameState:{players:[a,b],activePlayerIndex:1},gameContext:{}});
  assert.equal(healed.gameState.playerCharacter.playerId,'b');
  assert.equal(healed.gameState.activePlayerIndex,1);
  const healedSingle=localizeLegacySave({gameState:{players:[a],activePlayerIndex:7},gameContext:{}});
  assert.equal(healedSingle.gameState.playerCharacter.playerId,'a');
  assert.equal(healedSingle.gameState.activePlayerIndex,0);
  assert.throws(()=>localizeLegacySave({gameState:{players:[a,b],activePlayerIndex:-1},gameContext:{}}),/active character cannot be identified/);
  // An empty roster entry would load as a character without identity or stats.
  assert.throws(()=>localizeLegacySave({gameState:{players:[a,{}],playerCharacter:a,activePlayerIndex:0},gameContext:{}}),/ambiguous/);
 } finally {await server.close()}
});
