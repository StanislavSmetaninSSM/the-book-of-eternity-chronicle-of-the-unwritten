import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import 'fake-indexeddb/auto';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settleQuickly = promise => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('task remained blocked')), 2000))]);

test('cancel and superseding sync stop waiting without claiming an in-flight send was undone', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  const storage = new Map();
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  let packet, responseGate, responseStarted;
  globalThis.fetch = async (url, init = {}) => {
    if (url === '/__arena_gm/cancel') return new Response('{}');
    if (url === '/__arena_gm/turn') { packet = JSON.parse(init.body); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const request = packet;
      if (request.stepName !== 'Step0_AnalysisAndPlanning_TaskGuide' && responseGate) {
        responseStarted.resolve();
        await new Promise((resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (init.signal?.aborted) return abort();
          init.signal?.addEventListener('abort', abort, { once: true });
          responseGate.promise.then(resolve, reject);
        });
        responseGate = null;
      }
      const output = request.stepName === 'Step0_AnalysisAndPlanning_TaskGuide' ? { _internal_flags_: { isSimpleTurn: true } } : { response: 'GM result', currentHealthChange: 10, items_and_stat_calculations: ['New log'] };
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: request.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { createTurnManager } = await server.ssrLoadModule('/hooks/logic/turn.ts');
    const { translate } = await server.ssrLoadModule('/utils/localization.ts');
    for (const scenario of ['cancel-send', 'sync-generate', 'sync-send', 'host-committed', 'awaiting-sync']) for (const question of [false, true]) {
      const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
      context.currentTurnNumber = 2; const p = { ...context.playerCharacter, playerId: 'p', currentHealth: 40 }; context.playerCharacter = p; context.players = [p];
      const role = scenario === 'host-committed' ? 'host' : 'player';
      const base = { playerCharacter: p, players: [p], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: role, myPeerId: 'p', peers: [], isConnectedToHost: true };
      let state = base, history = [], gameLog = ['Old log'], combatLog = ['Old battle'], error = null, loading = null;
      const contextRef = { current: context }, revision = { current: 0 }, active = { current: null }, phase = { current: 'idle' }, controller = { current: null };
      const sent = deferred(), sendGate = deferred(), broadcastStarted = deferred(), broadcastGate = deferred();
      responseGate = scenario === 'sync-generate' ? deferred() : null; responseStarted = deferred();
      const noop = () => {};
      const conn = { open: true, on: noop, off: noop, send: () => { sent.resolve(); return scenario === 'awaiting-sync' ? undefined : sendGate.promise; } };
      const manager = createTurnManager({ gameState: base, setGameState: v => { state = typeof v === 'function' ? v(state) : v; }, gameHistory: [], setGameHistory: v => { history = typeof v === 'function' ? v(history) : v; }, isLoading: false, setIsLoading: v => { loading = v; }, setError: v => { error = v; }, setLastJsonResponse: noop, setLastRequestJson: noop, setGameLog: v => { gameLog = typeof v === 'function' ? v(gameLog) : v; }, setCombatLog: v => { combatLog = typeof v === 'function' ? v(combatLog) : v; }, setSceneImagePrompt: noop, setSuggestedActions: noop, setWorldMap: noop, setVisitedLocations: noop, setWorldState: noop, setTurnNumber: noop, gameContextRef: contextRef, abortControllerRef: controller, syncRevisionRef: revision, activeTurnRef: active, turnPhaseRef: phase, setSuperInstructions: noop, setGameSettings: noop, setLanguage: noop, t: (k,r) => translate('en', k, r), turnStartTimeRef: { current: null }, setTurnTime: noop, setCurrentStep: noop, setCurrentModel: noop, language: 'en', gameSettings: context.gameSettings, hostConnectionRef: { current: conn }, gameStateRef: { current: base }, broadcastFullSync: () => { broadcastStarted.resolve(); return broadcastGate.promise; }, combatLog: ['Old battle'], gameLog: ['Old log'] });
      const pending = question ? manager.askQuestion('Heal?') : manager.resumeInterruptedTurn({ context, baseState: base, history: [] });
      if (scenario === 'sync-generate') await responseStarted.promise;
      else if (scenario === 'host-committed') await broadcastStarted.promise;
      else if (scenario === 'awaiting-sync') await pending;
      else await sent.promise;
      if (scenario.startsWith('sync-')) {
        revision.current++; state = { ...base, playerCharacter: { ...p, currentHealth: 70 } };
        history = [{ sender: 'gm', content: 'Authoritative' }]; gameLog = ['Authoritative log']; combatLog = ['Authoritative battle']; contextRef.current = { ...context, playerCharacter: state.playerCharacter };
        controller.current.abort(); // the full_sync handler does this after restoring
      } else manager.cancelRequest();
      if (scenario === 'host-committed') {
        assert.equal(state.playerCharacter.currentHealth, 50); assert.match(error, /already applied/);
        broadcastGate.resolve(); await settleQuickly(pending);
        assert.equal(state.playerCharacter.currentHealth, 50); assert.match(error, /already applied/);
      } else if (scenario === 'awaiting-sync') {
        assert.equal(state.playerCharacter.currentHealth, 50); assert.match(error, /already sent/); assert.match(error, /Do not repeat/);
      } else {
        await settleQuickly(pending); // send/GM gate deliberately never resolves before the task exits
        assert.equal(loading, false); assert.equal(active.current, null);
        if (scenario === 'cancel-send') {
          assert.equal(state.playerCharacter.currentHealth, 40); assert.deepEqual(gameLog, ['Old log']); assert.deepEqual(combatLog, ['Old battle']);
          assert.ok(!history.some(m => m.sender === 'gm')); assert.match(error, /host may still have received/i); assert.match(error, /Do not repeat/);
          sendGate.resolve(); await Promise.resolve(); assert.equal(state.playerCharacter.currentHealth, 40);
        } else {
          assert.equal(state.playerCharacter.currentHealth, 70); assert.deepEqual(gameLog, ['Authoritative log']); assert.deepEqual(combatLog, ['Authoritative battle']);
          assert.equal(history[0].content, 'Authoritative'); assert.match(error, scenario === 'sync-send' ? /delivery.*not confirmed/i : /not sent/i);
          sendGate.resolve(); if (responseGate) responseGate.resolve();
        }
      }
    }
  } finally { globalThis.fetch = oldFetch; if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; await server.close(); }
});
