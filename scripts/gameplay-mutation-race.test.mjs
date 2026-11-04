import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('equipment edits invalidate both turn paths while presentation updates survive', async () => {
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
    const { createInventoryActions } = await server.ssrLoadModule('/hooks/logic/inventoryActions.ts');
    const { createPlayerActionsManager } = await server.ssrLoadModule('/hooks/logic/playerActions.ts');
    const { beginGameplayMutation, gameplayMutationCommitted } = await server.ssrLoadModule('/utils/gameplayMutationGate.ts');
    const { translate } = await server.ssrLoadModule('/utils/localization.ts');
    // Verify the production wiring in addition to the controlled race below.
    const hook = await readFile(new URL('../hooks/useGameLogic.ts', import.meta.url), 'utf8');
    assert.match(hook, /restoreFromSaveData = useCallback\([^]*?syncRevisionRef\.current \+= 1/);
    assert.match(hook, /gameContextRef, abortControllerRef, syncRevisionRef, activeTurnRef/);
    for (const mode of ['local-edit', 'history', 'presentation']) for (const question of [false, true]) {
      const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
      context.currentTurnNumber = 2;
      const p = { ...context.playerCharacter, playerId: 'p', currentHealth: 40 }; const item={existedId:'sword-1',name:'Sword',durability:'100%',equipmentSlot:'MainHand',weight:0,volume:0,count:1,requiresTwoHands:false}; p.inventory=[item]; p.equippedItems={...p.equippedItems,MainHand:null}; context.playerCharacter = p; context.players = [p];
      const base = { playerCharacter: p, players: [p], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: mode === 'player-edit' ? 'player' : 'host', myPeerId: 'p', peers: [], isConnectedToHost: true };
      const initialHistory = [{ sender:'gm', content:'Old message' }, { sender:'player', content:'Other message' }];
      let state = base, history = initialHistory, gameLog = ['Old log'], combatLog = ['Old battle'], error = null, loading = null, image = 'Original', suggested = [], sendCount = 0;
      const contextRef = { current: context }, revision = { current: 0 }, active = { current: null }, sent = deferred(), sendGate = deferred();
      gate = deferred(); const savedGate = gate; responseStarted = deferred();
      const noop = () => {}; const hostRef={current:base}, mutationRevision={current:0}, mutationPending={current:false}, mutationApplied={current:0}, phaseRef={current:'idle'}, controller={current:null};
      const conn = { open: true, on: noop, off: noop, send: () => { sendCount++; sent.resolve(); return sendGate.promise; } };
      const manager = createTurnManager({ gameState: base, setGameState: v => { state = typeof v === 'function' ? v(state) : v; }, gameHistory: initialHistory, setGameHistory: v => { history = typeof v === 'function' ? v(history) : v; }, isLoading: false, setIsLoading: v => { loading = v; }, setError: v => { error = v; }, setLastJsonResponse: noop, setLastRequestJson: noop, setGameLog: v => { gameLog = typeof v === 'function' ? v(gameLog) : v; }, setCombatLog: v => { combatLog = typeof v === 'function' ? v(combatLog) : v; }, setSceneImagePrompt: v => { image = v; }, setSuggestedActions: v => { suggested = v; }, setWorldMap: noop, setVisitedLocations: noop, setWorldState: noop, setTurnNumber: noop, gameContextRef: contextRef, abortControllerRef: controller, syncRevisionRef: revision, activeTurnRef: active, turnPhaseRef: phaseRef, gameplayMutationRevisionRef: mutationRevision, gameplayMutationPendingRef: mutationPending, setSuperInstructions: noop, setGameSettings: noop, setLanguage: noop, t: (k, r) => translate('en', k, r), turnStartTimeRef: { current: null }, setTurnTime: noop, setCurrentStep: noop, setCurrentModel: noop, language: 'en', gameSettings: context.gameSettings, hostConnectionRef: { current: conn }, gameStateRef: hostRef, broadcastFullSync: noop, combatLog: ['Old battle'], gameLog: ['Old log'] });
      // A queued React edit blocks starting a task even before its updater runs.
      mutationPending.current = true;
      const blocked = question ? manager.askQuestion('Heal?') : manager.resumeInterruptedTurn({context,baseState:base,history:initialHistory});
      await blocked; assert.equal(active.current,null); assert.match(error,/still being applied/i);
      mutationPending.current = false;
      const pending = question ? manager.askQuestion('Heal?') : manager.resumeInterruptedTurn({ context, baseState: base, history: initialHistory });
      await responseStarted.promise; assert.ok(active.current);
      if (mode === 'presentation') {
        // Presentation setters bypass the gameplay revision and do not abort.
        state={...state, cinematics:[{id:'cinema-1'}],imageCache:{'image':{src:'image-data'}}}; hostRef.current=state;
        assert.equal(controller.current.signal.aborted,false); assert.equal(mutationRevision.current,0);
      } else if (mode === 'history') {
        const actions = createPlayerActionsManager({setGameState:noop, setGameHistory:noop, setUserGameHistory:update=>{
          const rev=beginGameplayMutation(mutationRevision,mutationPending,hostRef.current.networkRole,phaseRef.current);
          assert.notEqual(rev,null); history=typeof update==='function'?update(history):update; mutationApplied.current=rev;
          if(active.current && phaseRef.current==='generating') controller.current.abort();
        }, setGameLog:noop,setCombatLog:noop,setVisitedLocations:noop,setWorldMap:noop,setWorldState:noop,gameSettings:{allowHistoryManipulation:true},gameContextRef:contextRef,t:k=>k});
        actions.deleteMessage(0); assert.ok(!history.some(m=>m.content==='Old message')); assert.equal(controller.current.signal.aborted,true);
        gameplayMutationCommitted(mutationPending,mutationApplied,mutationRevision,state,state);
      } else {
        const inventory = createInventoryActions({gameState:state,gameContextRef:contextRef,t:k=>k,setGameState:update=>{
          const rev=beginGameplayMutation(mutationRevision,mutationPending,hostRef.current.networkRole,phaseRef.current);
          assert.notEqual(rev,null); state=typeof update==='function'?update(state):update; hostRef.current=state; mutationApplied.current=rev;
          if(active.current && phaseRef.current==='generating') controller.current.abort();
        }});
        inventory.equipItem(item,'MainHand'); assert.equal(state.playerCharacter.equippedItems.MainHand,'sword-1');
        assert.equal(controller.current.signal.aborted,true);
        assert.equal(gameplayMutationCommitted(mutationPending,mutationApplied,mutationRevision,base,hostRef.current),false);
        assert.equal(gameplayMutationCommitted(mutationPending,mutationApplied,mutationRevision,state,hostRef.current),true);
      }
      savedGate.resolve(); await pending;
      if (mode==='presentation') {
        assert.equal(state.playerCharacter.currentHealth,50); assert.equal(state.cinematics[0].id,'cinema-1'); assert.equal(state.imageCache.image.src,'image-data');
      } else {
        if (mode === 'history') assert.ok(!history.some(m=>m.content==='Old message'));
        else assert.equal(state.playerCharacter.equippedItems.MainHand,'sword-1'); assert.equal(state.playerCharacter.currentHealth,40);
        assert.ok(!history.some(m=>m.content==='Stale GM response')); assert.match(error,/game state changed/i); assert.equal(sendCount,0);
      }

    }
  } finally { globalThis.fetch = oldFetch; if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; await server.close(); }
});
