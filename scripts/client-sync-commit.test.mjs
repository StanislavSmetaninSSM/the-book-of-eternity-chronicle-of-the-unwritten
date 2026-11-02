import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import 'fake-indexeddb/auto';

test('a host grant is unusable until the exact client snapshot commits, and failed restores can retry', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  const storage = new Map();
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  let gmPacket;
  globalThis.fetch = async (url, init = {}) => {
    if (url === '/__arena_gm/cancel') return new Response('{}');
    if (url === '/__arena_gm/turn') { gmPacket = JSON.parse(init.body); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const output = gmPacket.stepName === 'Step0_AnalysisAndPlanning_TaskGuide' ? { _internal_flags_: { isSimpleTurn: true } } : { response: 'GM result', currentHealthChange: 10 };
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: gmPacket.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { createTurnManager } = await server.ssrLoadModule('/hooks/logic/turn.ts');
    const { stageHostFullSync, commitClientSnapshot, applyPlayerTurnResult } = await server.ssrLoadModule('/hooks/logic/multiplayer.ts');
    const { HostTurnAuthority } = await server.ssrLoadModule('/utils/networkTurnProtocol.ts');
    for (const question of [false, true]) {
      const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
      context.currentTurnNumber = 2;
      const p = { ...context.playerCharacter, playerId: 'p', currentHealth: 40 }; context.playerCharacter = p; context.players = [p];
      const oldState = { playerCharacter: p, players: [p], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'player', myPeerId: 'p', peers: [], isConnectedToHost: true };
      const newPlayer = { ...p, currentHealth: 70 }, newState = { ...oldState, playerCharacter: newPlayer, players: [newPlayer], cinematics: [] };
      const newContext = { ...context, playerCharacter: newPlayer, players: [newPlayer] };
      const oldHistory = [{ sender: 'gm', content: 'old' }], newHistory = [{ sender: 'gm', content: 'host state' }], newLogs = ['host log'], battles = [];
      const snapshot = { gameState: newState, gameContext: newContext, gameHistory: newHistory, gameLog: newLogs, combatLog: battles, lastJsonResponse: null, sceneImagePrompt: null, timestamp: 'now' };
      const authority = new HostTurnAuthority(() => 'session-test'); const oldStamp = authority.issue(); authority.revoke(); const fresh = authority.issue();
      const stampRef = { current: oldStamp }, observed = { current: oldStamp }, pending = { current: null }, stateRef = { current: oldState }, contextRef = { current: context }, active = { current: null }, controller = { current: null }, phase = { current: 'idle' }, revision = { current: 0 };
      let history = oldHistory, loading = false, error = null, queuedState = null, restores = 0, fail = false, sends = [];
      const noop = () => {};
      const syncProps = { observedHostStampRef: observed, clientTurnStampRef: stampRef, pendingClientSyncRef: pending, activeTurnRef: active, abortControllerRef: controller, turnPhaseRef: phase, setError: v => { error = v; }, setIsLoading: v => { loading = v; }, scheduleClientSyncCommit: noop, t: k => k,
        restoreFromSaveData: (file, network, identity) => { restores++; revision.current++; assert.equal(network, true); assert.equal(identity.myPeerId, 'p'); if (fail) throw Error('bad snapshot'); contextRef.current = file.gameContext; queuedState = file.gameState; return file; } };
      const identity = { role: 'player', myPeerId: 'p', hostPeerId: 'host' };
      const message = { type: 'full_sync', payload: { protocol: fresh, saveFile: snapshot } };
      assert.equal(stageHostFullSync(message, identity, syncProps), 'staged');
      assert.equal(stampRef.current, null); assert.equal(stateRef.current.playerCharacter.currentHealth, 40); assert.equal(loading, true);
      const conn = { open: true, on: noop, off: noop, send: msg => { sends.push(msg); } };
      const manager = (state, hist, isLoading = false) => createTurnManager({ gameState: state, setGameState: noop, gameHistory: hist, setGameHistory: v => { history = typeof v === 'function' ? v(history) : v; }, isLoading, setIsLoading: noop, setError: v => { error = v; }, setLastJsonResponse: noop, setLastRequestJson: noop, setGameLog: noop, setCombatLog: noop, setSceneImagePrompt: noop, setSuggestedActions: noop, setWorldMap: noop, setVisitedLocations: noop, setWorldState: noop, setTurnNumber: noop, gameContextRef: contextRef, abortControllerRef: controller, syncRevisionRef: revision, activeTurnRef: active, turnPhaseRef: phase, clientTurnStampRef: stampRef, pendingNetworkTurnRef: { current: null }, setSuperInstructions: noop, setGameSettings: noop, setLanguage: noop, t: k => k, turnStartTimeRef: { current: null }, setTurnTime: noop, setCurrentStep: noop, setCurrentModel: noop, language: 'en', gameSettings: context.gameSettings, hostConnectionRef: { current: conn }, gameStateRef: stateRef, broadcastFullSync: noop, combatLog: battles, gameLog: newLogs });
      const before = manager(oldState, oldHistory); if (question) await before.askQuestion('Heal?'); else await before.resumeInterruptedTurn({ context, baseState: oldState, history: oldHistory });
      assert.equal(sends.length, 0); assert.equal(error, 'network_sync_not_ready'); assert.equal(stateRef.current, oldState);
      let render = { gameState: oldState, currentGameState: oldState, gameHistory: oldHistory, gameLog: newLogs, combatLog: battles, lastJsonResponse: null, sceneImagePrompt: null };
      assert.equal(commitClientSnapshot(pending.current, render), null);
      render = { ...render, gameState: queuedState, currentGameState: queuedState }; // state alone is insufficient
      assert.equal(commitClientSnapshot(pending.current, render), null);
      stateRef.current = queuedState; history = newHistory; render.gameHistory = [...newHistory, { sender: 'system', content: 'superseded' }];
      // A concurrent cinema completion changes only cinematics (and the
      // wrapper re-filters the NPC/faction arrays). This is safe to commit.
      const cinemaState = { ...queuedState, cinematics: [{ id: 'cinema' }], encounteredNPCs: [...queuedState.encounteredNPCs], encounteredFactions: [...queuedState.encounteredFactions] };
      assert.deepEqual(commitClientSnapshot(pending.current, { ...render, gameState: cinemaState, currentGameState: cinemaState }), fresh);
      // Background image generation can complete in the same interval.
      const withImage = { ...cinemaState, imageCache: { generated: { src: 'image' } } };
      assert.deepEqual(commitClientSnapshot(pending.current, { ...render, gameState: withImage, currentGameState: withImage }), fresh);
      const unsafe = { ...cinemaState, playerCharacter: { ...cinemaState.playerCharacter, currentHealth: 20 } };
      assert.equal(commitClientSnapshot(pending.current, { ...render, gameState: unsafe, currentGameState: unsafe }), null);
      stampRef.current = commitClientSnapshot(pending.current, render); pending.current = null;
      assert.deepEqual(stampRef.current, fresh);
      const after = manager(newState, newHistory);
      if (question) await after.askQuestion('Heal?'); else await after.resumeInterruptedTurn({ context: newContext, baseState: newState, history: newHistory });
      assert.equal(sends.length, 1); assert.equal(sends[0].payload.saveFile.gameState.playerCharacter.currentHealth, 80);
      const hostRef = { current: { ...newState, networkRole: 'host' } }; let decision;
      await applyPlayerTurnResult(sends[0], 'p', { gameStateRef: hostRef, hostTurnAuthority: authority, activeTurnRef: { current: null }, restoreFromSaveData: file => { hostRef.current = file.gameState; return file; }, broadcastFullSync: noop, setError: noop, setGameHistory: noop, t: k => k }, async ack => { decision = ack.status; });
      assert.equal(decision, 'accepted'); assert.equal(hostRef.current.playerCharacter.currentHealth, 80);
      authority.revoke(); const retryStamp = authority.issue(); const retry = { ...message, payload: { ...message.payload, protocol: retryStamp } };
      fail = true; assert.equal(stageHostFullSync(retry, identity, syncProps), 'failed'); assert.equal(stampRef.current, null); assert.equal(observed.current, fresh); assert.equal(pending.current, null); assert.match(error, /network_sync_restore_failed/);
      fail = false; assert.equal(stageHostFullSync(retry, identity, syncProps), 'staged'); assert.equal(restores, 3); assert.equal(observed.current, retryStamp);
      assert.equal(stageHostFullSync(message, identity, syncProps), 'ignored'); assert.equal(observed.current, retryStamp);
    }
  } finally { globalThis.fetch = oldFetch; if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; await server.close(); }
});
