import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('host cannot start a turn or question until an accepted player snapshot commits', async () => {
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
    const { applyPlayerTurnResult, snapshotMatchesRendered } = await server.ssrLoadModule('/hooks/logic/multiplayer.ts');
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
      const noop = () => {}; const hostPending = { current: null }, hostRef = { current: base }, broadcastDone = deferred();
      const conn = { open: true, on: noop, off: noop, send: () => { sendCount++; sent.resolve(); return sendGate.promise; } };
      const buildManager = (currentState, currentHistory) => createTurnManager({ gameState: currentState, setGameState: v => { state = typeof v === 'function' ? v(state) : v; }, gameHistory: currentHistory, setGameHistory: v => { history = typeof v === 'function' ? v(history) : v; }, isLoading: false, setIsLoading: v => { loading = v; }, setError: v => { error = v; }, setLastJsonResponse: noop, setLastRequestJson: noop, setGameLog: v => { gameLog = typeof v === 'function' ? v(gameLog) : v; }, setCombatLog: v => { combatLog = typeof v === 'function' ? v(combatLog) : v; }, setSceneImagePrompt: v => { image = v; }, setSuggestedActions: v => { suggested = v; }, setWorldMap: noop, setVisitedLocations: noop, setWorldState: noop, setTurnNumber: noop, gameContextRef: contextRef, abortControllerRef: { current: null }, syncRevisionRef: revision, activeTurnRef: active, setSuperInstructions: noop, setGameSettings: noop, setLanguage: noop, t: (k, r) => translate('en', k, r), turnStartTimeRef: { current: null }, setTurnTime: noop, setCurrentStep: noop, setCurrentModel: noop, language: 'en', gameSettings: context.gameSettings, hostConnectionRef: { current: conn }, gameStateRef: hostRef, hostRestorePendingRef: hostPending, broadcastFullSync: () => { broadcastDone.resolve(); }, combatLog: ['Old battle'], gameLog: ['Old log'] });
      const authority = new HostTurnAuthority(() => 'host-session'); const stamp = authority.issue();
      const hostState = { ...base, playerCharacter: { ...p, currentHealth: 70 } };
      const freshHistory = [{sender:'gm',content:'Remote authoritative'}];
      const snapshot = {gameState:hostState, gameHistory:freshHistory, gameLog:['New log'], combatLog:['New battle'], lastJsonResponse:null, sceneImagePrompt:null};
      const incoming = {type:'turn_result_from_player',senderId:'p',payload:{submission:{turnId:'remote-result-0000000001',base:stamp},saveFile:snapshot}};
      let ack, restores = 0;
      const props={gameStateRef:hostRef,hostTurnAuthority:authority,activeTurnRef:active,restoreFromSaveData:save=>{restores++; revision.current++; hostPending.current={snapshot:save, release:authority.beginMutation()}; contextRef.current={...context,playerCharacter:hostState.playerCharacter}; return save;},broadcastFullSync:noop,setError:noop,setGameHistory:noop,t:k=>k};
      await applyPlayerTurnResult(incoming,'p',props,async a=>{ack=a.status;});
      assert.equal(ack,'accepted'); assert.equal(hostRef.current.playerCharacter.currentHealth,40); assert.equal(authority.issue(),null);
      await applyPlayerTurnResult(incoming,'p',props,async a=>{ack=a.status;}); assert.equal(ack,'duplicate'); assert.equal(restores,1);
      const blocked=buildManager(base,[]);
      if (question) await blocked.askQuestion('Heal?'); else blocked.sendMessage('Heal');
      assert.equal(error,translate('en','host_sync_not_ready')); assert.equal(active.current,null); assert.equal(state.playerCharacter.currentHealth,40);
      // Model React committing the previously queued state and logs.
      hostRef.current=hostState; state=hostState; history=freshHistory; gameLog=snapshot.gameLog; combatLog=snapshot.combatLog; image=null;
      assert.equal(snapshotMatchesRendered(snapshot,{gameState:state,currentGameState:hostRef.current,gameHistory:history,gameLog,combatLog,lastJsonResponse:null,sceneImagePrompt:image}),true);
      hostPending.current.release(); hostPending.current=null; assert.ok(authority.issue());
      const after=buildManager(hostState,freshHistory);
      const pending = question ? after.askQuestion('Heal?') : after.sendMessage('Heal');
      await responseStarted.promise; savedGate.resolve(); if (question) await pending; else await broadcastDone.promise;
      assert.equal(state.playerCharacter.currentHealth,80); assert.ok(history.some(m=>m.content==='Stale GM response'));

    }
  } finally { globalThis.fetch = oldFetch; if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; await server.close(); }
});
