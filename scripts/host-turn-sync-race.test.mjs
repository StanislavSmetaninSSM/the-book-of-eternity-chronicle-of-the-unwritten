import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('busy host rejects remote result and aborts superseded host generation', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  const storage = new Map();
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  let packet, gate, responseStarted;
  globalThis.fetch = async (url, init) => {
    if (url === '/__arena_gm/turn') { packet = JSON.parse(init.body); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const request = packet;
      if (request.stepName !== 'Step0_AnalysisAndPlanning_TaskGuide' && gate) { responseStarted.resolve(); await gate.promise; gate = null; }
      const output = request.stepName === 'Step0_AnalysisAndPlanning_TaskGuide'
        ? { _internal_flags_: { isSimpleTurn: true }, items_and_stat_calculations: ['Stale calculation'] }
        : { response: 'Stale GM response', currentHealthChange: 10, items_and_stat_calculations: ['Stale calculation'], combatLogEntries: ['Stale battle'] };
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: request.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { createTurnManager } = await server.ssrLoadModule('/hooks/logic/turn.ts');
    const { applyPlayerTurnResult } = await server.ssrLoadModule('/hooks/logic/multiplayer.ts');
    const { HostTurnAuthority } = await server.ssrLoadModule('/utils/networkTurnProtocol.ts');
    const { translate } = await server.ssrLoadModule('/utils/localization.ts');
    // Verify the production wiring in addition to the controlled race below.
    const hook = await readFile(new URL('../hooks/useGameLogic.ts', import.meta.url), 'utf8');
    const network = await readFile(new URL('../hooks/logic/multiplayer.ts', import.meta.url), 'utf8');
    assert.match(hook, /restoreFromSaveData = useCallback\([^]*?syncRevisionRef\.current \+= 1/);
    assert.match(hook, /gameContextRef, abortControllerRef, syncRevisionRef, activeTurnRef/);
    assert.match(hook, /setIsLoading\(activeTurnRef\.current !== null\)/);
    assert.match(network, /if \(props\.activeTurnRef\.current\) props\.abortControllerRef\.current\?\.abort\(\)/);
    for (const phase of ['before-send']) for (const question of [false, true]) {
      const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
      context.currentTurnNumber = 2;
      const p = { ...context.playerCharacter, playerId: 'p', currentHealth: 40 }; context.playerCharacter = p; context.players = [p];
      const base = { playerCharacter: p, players: [p], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'host', myPeerId: 'p', peers: [], isConnectedToHost: true };
      let state = base, history = [], gameLog = ['Old log'], combatLog = ['Old battle'], error = null, loading = null, image = 'Original', suggested = [], sendCount = 0;
      const contextRef = { current: context }, revision = { current: 0 }, active = { current: null }, sent = deferred(), sendGate = deferred();
      gate = phase === 'before-send' ? deferred() : null; const savedGate = gate; responseStarted = deferred();
      const noop = () => {};
      const conn = { open: true, on: noop, off: noop, send: () => { sendCount++; sent.resolve(); return sendGate.promise; } };
      const manager = createTurnManager({ gameState: base, setGameState: v => { state = typeof v === 'function' ? v(state) : v; }, gameHistory: [], setGameHistory: v => { history = typeof v === 'function' ? v(history) : v; }, isLoading: false, setIsLoading: v => { loading = v; }, setError: v => { error = v; }, setLastJsonResponse: noop, setLastRequestJson: noop, setGameLog: v => { gameLog = typeof v === 'function' ? v(gameLog) : v; }, setCombatLog: v => { combatLog = typeof v === 'function' ? v(combatLog) : v; }, setSceneImagePrompt: v => { image = v; }, setSuggestedActions: v => { suggested = v; }, setWorldMap: noop, setVisitedLocations: noop, setWorldState: noop, setTurnNumber: noop, gameContextRef: contextRef, abortControllerRef: { current: null }, syncRevisionRef: revision, activeTurnRef: active, setSuperInstructions: noop, setGameSettings: noop, setLanguage: noop, t: (k, r) => translate('en', k, r), turnStartTimeRef: { current: null }, setTurnTime: noop, setCurrentStep: noop, setCurrentModel: noop, language: 'en', gameSettings: context.gameSettings, hostConnectionRef: { current: conn }, gameStateRef: { current: base }, broadcastFullSync: noop, combatLog: ['Old battle'], gameLog: ['Old log'] });
      const pending = question ? manager.askQuestion('Heal?') : manager.resumeInterruptedTurn({ context, baseState: base, history: [] });
      if (phase === 'before-send') await responseStarted.promise; else await sent.promise;
      assert.ok(active.current);
      const authority = new HostTurnAuthority(() => 'host-session'); const stamp = authority.issue();
      const hostState = { ...base, playerCharacter: { ...p, currentHealth: 70 } };
      const incoming = { type:'turn_result_from_player', senderId:'p', payload:{submission:{turnId:'remote-result-0000000001',base:stamp},saveFile:{gameState:hostState,gameHistory:[{sender:'gm',content:'Remote authoritative'}]}}};
      let acknowledgement, restores = 0;
      await applyPlayerTurnResult(incoming, 'p', {gameStateRef:{current:base},hostTurnAuthority:authority,activeTurnRef:active,restoreFromSaveData:save => { restores++; revision.current++; state=save.gameState; history=save.gameHistory; return save; },broadcastFullSync:noop,setError:noop,setGameHistory:noop,t:k=>k}, async ack=>{acknowledgement=ack.status;});
      assert.equal(acknowledgement,'pending'); assert.equal(restores,0); assert.equal(state.playerCharacter.currentHealth,40);
      // Another restore/load can still supersede the running host GM task.
      revision.current++; state=hostState; history=incoming.payload.saveFile.gameHistory;
      contextRef.current = { ...context, playerCharacter: hostState.playerCharacter };
      savedGate.resolve(); await pending;
      assert.equal(state.playerCharacter.currentHealth, 70); assert.deepEqual(history[0].content, 'Remote authoritative');
      assert.ok(!history.some(m => m.content === 'Stale GM response')); assert.equal(active.current, null);

    }
  } finally { globalThis.fetch = oldFetch; if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; await server.close(); }
});
