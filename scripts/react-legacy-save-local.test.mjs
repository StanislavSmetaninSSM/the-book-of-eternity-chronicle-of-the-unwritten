import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import 'fake-indexeddb/auto';

test('old network saves load via production slots into a usable local party without losing character data', async () => {
  const vite = await createServer({configFile:false, optimizeDeps:{noDiscovery:true,include:[]}, server:{middlewareMode:true}, appType:'custom', logLevel:'silent'});
  const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost/'});
  const old = {window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,localStorage:globalThis.localStorage,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
  globalThis.window=dom.window; globalThis.document=dom.window.document;
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  globalThis.localStorage=dom.window.localStorage; globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  let root;
  try {
    const {createInitialContext} = await vite.ssrLoadModule('/utils/gameContext.ts');
    const {saveToDBSlot} = await vite.ssrLoadModule('/utils/fileManager.ts');
    const {useGameLogic} = await vite.ssrLoadModule('/hooks/useGameLogic.ts');
    const {LocalizationProvider} = await vite.ssrLoadModule('/context/LocalizationContext.tsx');
    let api; function Harness(){api=useGameLogic({language:'en',setLanguage:()=>{}});return null}
    root=createRoot(document.getElementById('root'));
    await act(async()=>root.render(React.createElement(StrictMode,null,React.createElement(LocalizationProvider,null,React.createElement(Harness)))));
    for (const role of ['host','player','spectator']) {
      const c=createInitialContext({universe:'fantasy',playerName:'First',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');
      c.currentTurnNumber=3; c.gameSettings.cooperativeGameType='FullParty';
      const first={...c.playerCharacter,playerId:'peer-first',name:'First'}, second={...first,playerId:'peer-second',name:'Second'};
      c.players=[first,second];c.playerCharacter=first;c.networkRole=role;c.peers=[{id:'peer-first'}];c.isConnectedToHost=false;
      const pending={isActive:true,prompt:'A promise',actions:{'peer-second':'defend'}};
      const state={playerCharacter:first,players:[first,second],activePlayerIndex:1,currentLocationData:c.currentLocation,activeQuests:[],completedQuests:[],encounteredNPCs:[],encounteredFactions:[],enemiesData:[],alliesData:[],playerCustomStates:[],plotOutline:null,worldStateFlags:[],worldEventsLog:[],imageCache:{},networkRole:role,myPeerId:'peer-first',hostPeerId:'host',peers:[{id:'peer-first'}],isConnectedToHost:false,playerNeedsToCreateCharacter:true,collectiveActionState:pending};
      await saveToDBSlot(1,{gameContext:c,gameState:state,gameHistory:[{sender:'gm',content:'Preserved story'}],gameLog:[],combatLog:[],lastJsonResponse:null,sceneImagePrompt:null,timestamp:new Date().toISOString()});
      await act(async()=>assert.equal(await api.loadGameFromSlot(1),true));
      assert.equal(api.gameState.playerCharacter.name,'Second');
      assert.deepEqual(api.gameState.players.map(p=>p.name),['First','Second']);
      assert.equal(api.gameState.networkRole,undefined);
      assert.equal(api.gameState.collectiveActionState,undefined);
      assert.deepEqual(api.gameState.legacyNetworkActions,[pending]);
      assert.equal(api.gameHistory[0].content,'Preserved story');
      const saved = api.packageSaveData(api.gameState, false);
      assert.equal(saved.gameState.networkRole, undefined);
      assert.deepEqual(saved.gameState.legacyNetworkActions, [pending]);
      assert.equal(saved.gameHistory[0].content, 'Preserved story');
      await saveToDBSlot(2, saved);
      await act(async()=>assert.equal(await api.loadGameFromSlot(2),true));
      assert.equal(api.gameState.playerCharacter.name, 'Second');
      assert.deepEqual(api.gameState.legacyNetworkActions, [pending]);
      await act(async()=>api.passTurnToPlayer(0));
      assert.equal(api.gameState.playerCharacter.name,'First');
      await act(async()=>{await new Promise(r=>setTimeout(r,50))});
    }
  } finally {
    if(root)await act(async()=>root.unmount());
    globalThis.window=old.window;globalThis.document=old.document;Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});globalThis.localStorage=old.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;dom.window.close();await vite.close();
  }
});
