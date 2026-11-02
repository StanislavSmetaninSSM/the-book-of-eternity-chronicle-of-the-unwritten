import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { useEffect, useState, startTransition, act } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

test('React urgent commit does not release host/client snapshot barriers before deferred context fields', async () => {
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  const dom = new JSDOM('<div id="root"></div>');
  const previousWindow = globalThis.window, previousDocument = globalThis.document, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root;
  try {
    const { snapshotMatchesRendered, commitClientSnapshot } = await server.ssrLoadModule('/hooks/logic/multiplayer.ts');
    const hook = await readFile(new URL('../hooks/useGameLogic.ts', import.meta.url), 'utf8');
    assert.match(hook, /gameContext: \{ \.\.\.data\.gameContext, gameSettings: \{ \.\.\.loadedSettings \}/);
    assert.match(hook, /commitClientSnapshot\(pending, \{[^}]*worldState, gameSettings, superInstructions,[^}]*worldMap, visitedLocations, turnNumber/);
    assert.match(hook, /snapshotMatchesRendered\(pending\.snapshot, \{[^}]*worldState, gameSettings, superInstructions,[^}]*worldMap, visitedLocations, turnNumber/);
    const old = {worldState: {day:1}, gameSettings:{hardMode:false,uiFontScale:1}, superInstructions:'old',worldMap:{old:{}},visitedLocations:[],turnNumber:1};
    const fresh = {worldState:{day:2},gameSettings:{hardMode:true,uiFontScale:1},superInstructions:'new',worldMap:{new:{}},visitedLocations:[{}],turnNumber:2};
    const gameState = {networkRole:'player'}, history=[], gameLog=[], combatLog=[];
    const snapshot = {gameState,gameHistory:history,gameLog,combatLog,lastJsonResponse:null,sceneImagePrompt:null,gameContext:{...fresh,currentTurnNumber:fresh.turnNumber}};
    const stamp = {sessionId:'session',revision:1}; let setters, events=[];
    function Harness() {
      const [state, setState] = useState(null), [worldState,setWorldState] = useState(old.worldState), [gameSettings,setGameSettings] = useState(old.gameSettings);
      const [superInstructions,setInstructions] = useState(old.superInstructions), [worldMap,setWorldMap] = useState(old.worldMap), [visitedLocations,setVisited] = useState(old.visitedLocations), [turnNumber,setTurn] = useState(old.turnNumber);
      setters = {setState,setWorldState,setGameSettings,setInstructions,setWorldMap,setVisited,setTurn};
      useEffect(() => {
        const rendered = {gameState:state,currentGameState:state,gameHistory:history,gameLog,combatLog,lastJsonResponse:null,sceneImagePrompt:null,worldState,gameSettings,superInstructions,worldMap,visitedLocations,turnNumber};
        events.push({state,host:snapshotMatchesRendered(snapshot,rendered),client:commitClientSnapshot({snapshot,stamp},rendered)});
      });
      return null;
    }
    root = createRoot(document.getElementById('root'));
    await act(async () => { root.render(React.createElement(Harness)); });
    await act(async () => {
      startTransition(() => {
        setters.setWorldState(fresh.worldState); setters.setGameSettings(fresh.gameSettings); setters.setInstructions(fresh.superInstructions);
        setters.setWorldMap(fresh.worldMap); setters.setVisited(fresh.visitedLocations); setters.setTurn(fresh.turnNumber);
      });
      flushSync(() => setters.setState(gameState));
      const urgent = events.at(-1);
      assert.equal(urgent.state,gameState);
      // The former barrier checked only state/history/logs here, all already matched.
      assert.equal(urgent.state === snapshot.gameState, true);
      assert.equal(urgent.host,false); assert.equal(urgent.client,null);
    });
    assert.equal(events.at(-1).host,true); assert.deepEqual(events.at(-1).client,stamp);
    await act(async () => { flushSync(() => setters.setGameSettings({...fresh.gameSettings,uiFontScale:2})); });
    assert.equal(events.at(-1).host,true, 'concurrent local display changes do not stall shared rules');
    for (const [key, bad] of [['worldState',old.worldState],['gameSettings',old.gameSettings],['superInstructions',old.superInstructions],['worldMap',old.worldMap],['visitedLocations',old.visitedLocations],['turnNumber',old.turnNumber]]) {
      const rendered = {gameState,currentGameState:gameState,gameHistory:history,gameLog,combatLog,lastJsonResponse:null,sceneImagePrompt:null,...fresh,[key]:bad};
      assert.equal(snapshotMatchesRendered(snapshot,rendered),false,`${key} must be committed`);
    }
  } finally {
    if (root) await act(async () => root.unmount());
    globalThis.window=previousWindow; globalThis.document=previousDocument; globalThis.IS_REACT_ACT_ENVIRONMENT=previousAct;
    dom.window.close(); await server.close();
  }
});
