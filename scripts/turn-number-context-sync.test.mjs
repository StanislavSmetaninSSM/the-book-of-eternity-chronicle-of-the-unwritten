import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import 'fake-indexeddb/auto';

// A manual party pass advances the turn counter without a GM turn. The counter
// shown to the player, the one saved, and the one the GM sees must not diverge.
test('manual pass turn persists the advanced turn counter',async()=>{
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,localStorage:globalThis.localStorage,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 globalThis.window=dom.window;globalThis.document=dom.window.document;Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.localStorage=dom.window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let root;
 try{
  const {createInitialContext}=await vite.ssrLoadModule('/utils/gameContext.ts');
  const {saveToDBSlot}=await vite.ssrLoadModule('/utils/fileManager.ts');
  const {useGameLogic}=await vite.ssrLoadModule('/hooks/useGameLogic.ts');
  const {LocalizationProvider}=await vite.ssrLoadModule('/context/LocalizationContext.tsx');
  const c=createInitialContext({universe:'fantasy',playerName:'First',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');
  c.currentTurnNumber=3;c.gameSettings.cooperativeGameType='FullParty';
  const p={...c.playerCharacter,playerId:'p',name:'First'},q={...p,playerId:'q',name:'Second'};
  c.playerCharacter=p;c.players=[p,q];
  const state={playerCharacter:p,players:[p,q],activePlayerIndex:0,currentLocationData:c.currentLocation,activeQuests:[],completedQuests:[],encounteredNPCs:[],encounteredFactions:[],enemiesData:[],alliesData:[],playerCustomStates:[],plotOutline:null,worldStateFlags:[],worldEventsLog:[],imageCache:{}};
  await saveToDBSlot(1,{gameContext:c,gameState:state,gameHistory:[],gameLog:[],combatLog:[],lastJsonResponse:null,sceneImagePrompt:null,timestamp:new Date().toISOString()});
  let api;function Harness(){api=useGameLogic({language:'en',setLanguage:()=>{}});return null}
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(LocalizationProvider,null,React.createElement(Harness))));
  await act(async()=>{assert.equal(await api.loadGameFromSlot(1),true)});
  assert.equal(api.turnNumber,3);
  await act(async()=>api.passTurnToPlayer(1));
  await act(async()=>api.passTurnToPlayer(0));
  assert.equal(api.turnNumber,4);
  const save=api.packageSaveData(api.gameState,false);
  assert.equal(save.gameContext.currentTurnNumber,4);
  await saveToDBSlot(2,save);
  await act(async()=>{assert.equal(await api.loadGameFromSlot(2),true)});
  assert.equal(api.turnNumber,4);
  assert.equal(api.packageSaveData(api.gameState,false).gameContext.currentTurnNumber,4);
 }finally{
  if(root)await act(async()=>root.unmount());
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});
  globalThis.localStorage=old.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;
  dom.window.close();await vite.close();
 }
});
