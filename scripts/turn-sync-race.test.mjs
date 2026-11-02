import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('authoritative sync wins over pending player turn and question before or during send', async () => {
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
    const { translate } = await server.ssrLoadModule('/utils/localization.ts');
    // Verify the production wiring in addition to the controlled race below.
    const hook = await readFile(new URL('../hooks/useGameLogic.ts', import.meta.url), 'utf8');
    const network = await readFile(new URL('../hooks/logic/multiplayer.ts', import.meta.url), 'utf8');
    assert.match(hook, /restoreFromSaveData = useCallback\([^]*?syncRevisionRef\.current \+= 1/);
    assert.match(hook, /gameContextRef, abortControllerRef, syncRevisionRef, activeTurnRef/);
    assert.match(network, /setIsLoading\(activeTurnRef\.current !== null\)/);
    for (const phase of ['before-send', 'send-success', 'send-reject']) for (const question of [false, true]) {
      const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
      context.currentTurnNumber = 2;
      const p = { ...context.playerCharacter, playerId: 'p', currentHealth: 40 }; context.playerCharacter = p; context.players = [p];
      const base = { playerCharacter: p, players: [p], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'player', myPeerId: 'p', peers: [], isConnectedToHost: true };
      let state = base, history = [], gameLog = ['Old log'], combatLog = ['Old battle'], error = null, loading = null, image = 'Original', suggested = [], sendCount = 0;
      const contextRef = { current: context }, revision = { current: 0 }, active = { current: null }, sent = deferred(), sendGate = deferred();
      gate = phase === 'before-send' ? deferred() : null; const savedGate = gate; responseStarted = deferred();
      const noop = () => {};
      const conn = { open: true, on: noop, off: noop, send: () => { sendCount++; sent.resolve(); return sendGate.promise; } };
      const manager = createTurnManager({ gameState: base, setGameState: v => { state = typeof v === 'function' ? v(state) : v; }, gameHistory: [], setGameHistory: v => { history = typeof v === 'function' ? v(history) : v; }, isLoading: false, setIsLoading: v => { loading = v; }, setError: v => { error = v; }, setLastJsonResponse: noop, setLastRequestJson: noop, setGameLog: v => { gameLog = typeof v === 'function' ? v(gameLog) : v; }, setCombatLog: v => { combatLog = typeof v === 'function' ? v(combatLog) : v; }, setSceneImagePrompt: v => { image = v; }, setSuggestedActions: v => { suggested = v; }, setWorldMap: noop, setVisitedLocations: noop, setWorldState: noop, setTurnNumber: noop, gameContextRef: contextRef, abortControllerRef: { current: null }, syncRevisionRef: revision, activeTurnRef: active, setSuperInstructions: noop, setGameSettings: noop, setLanguage: noop, t: (k, r) => translate('en', k, r), turnStartTimeRef: { current: null }, setTurnTime: noop, setCurrentStep: noop, setCurrentModel: noop, language: 'en', gameSettings: context.gameSettings, hostConnectionRef: { current: conn }, gameStateRef: { current: base }, broadcastFullSync: noop, combatLog: ['Old battle'], gameLog: ['Old log'] });
      const pending = question ? manager.askQuestion('Heal?') : manager.resumeInterruptedTurn({ context, baseState: base, history: [] });
      if (phase === 'before-send') await responseStarted.promise; else await sent.promise;
      assert.ok(active.current);
      // Simulate restoreFromSaveData: it increments the revision before applying the snapshot.
      revision.current++;
      state = { ...base, playerCharacter: { ...p, currentHealth: 70 } };
      history = [{ sender: 'gm', content: 'Authoritative story' }]; gameLog = ['Authoritative log']; combatLog = ['Authoritative battle'];
      contextRef.current = { ...context, playerCharacter: state.playerCharacter };
      image = 'Authoritative image'; suggested = ['Authoritative option'];
      // A second action cannot start while the superseded task is settling.
      await manager.askQuestion('Should not run');
      assert.equal(history.length, 1);
      if (phase === 'before-send') savedGate.resolve();
      else if (phase === 'send-reject') sendGate.reject(new Error('late send failure'));
      else sendGate.resolve();
      await pending;
      assert.equal(state.playerCharacter.currentHealth, 70, `${phase}, question=${question}`);
      assert.deepEqual(gameLog, ['Authoritative log']); assert.deepEqual(combatLog, ['Authoritative battle']);
      assert.equal(contextRef.current.playerCharacter.currentHealth, 70);
      assert.equal(image, 'Authoritative image'); assert.deepEqual(suggested, ['Authoritative option']);
      assert.equal(history[0].content, 'Authoritative story'); assert.equal(history.length, 2);
      assert.equal(history[1].sender, 'system'); assert.equal(loading, false); assert.equal(active.current, null);
      if (phase === 'before-send') { assert.equal(sendCount, 0); assert.match(error, /not sent/); }
      else { assert.equal(sendCount, 1); assert.match(error, /delivery.*not confirmed/i); }
    }
  } finally { globalThis.fetch = oldFetch; if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; await server.close(); }
});
