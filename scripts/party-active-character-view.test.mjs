import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import { getTestServer, closeTestServer } from './helpers/testServer.mjs';
import {readFile} from 'node:fs/promises';
import 'fake-indexeddb/auto';

// The active roster slot is refreshed on turn and party commits, so edits made
// between turns live only in playerCharacter. Party views must show that copy.

test('live active player replaces only the matching roster slot',async()=>{
 const vite = await getTestServer();
 try{
  const {withLiveActivePlayer}=await vite.ssrLoadModule('/utils/partyView.ts');
  const roster=[{playerId:'p',name:'First',personalNpcReputations:[{NPCId:'n1'}]},{playerId:'q',name:'Second'}];
  const live={playerId:'p',name:'Renamed',currentHealth:5};
  const shown=withLiveActivePlayer(roster,live);
  assert.equal(shown[0].name,'Renamed');
  assert.equal(shown[0].currentHealth,5);
  assert.deepEqual(shown[0].personalNpcReputations,[{NPCId:'n1'}]);
  assert.equal(shown[1].name,'Second');
  assert.equal(roster[0].name,'First');
  assert.equal(withLiveActivePlayer(roster,roster[0]),roster);
  assert.equal(withLiveActivePlayer(roster,{playerId:'unknown'}),roster);
  assert.deepEqual(withLiveActivePlayer(undefined,live),[]);
  const app=await readFile(new URL('../components/GameHost.tsx',import.meta.url),'utf8');
  const sidePanel=await readFile(new URL('../components/SidePanel.tsx',import.meta.url),'utf8');
  // Two party panels plus the image-prompt collector that decides which cached
  // images may survive a save.
  assert.equal((app.match(/withLiveActivePlayer\(gameState\.players, gameState\.playerCharacter\)/g)||[]).length,3);
  const hook=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');
  assert.match(hook,/gameContextRef\.current\.players = withLiveActivePlayer\(gameState\.players, gameState\.playerCharacter\)/);
  const contextBuilder=await readFile(new URL('../utils/gameContext.ts',import.meta.url),'utf8');
  assert.match(contextBuilder,/players: withLiveActivePlayer\(newState\.players, newState\.playerCharacter\)/);
  assert.match(app,/activePlayerName = gameSettings\?\.cooperativeGameType !== 'None' \? gameState\?\.playerCharacter\?\.name/);
  assert.match(sidePanel,/players=\{withLiveActivePlayer\(gameState\.players, gameState\.playerCharacter\)\}/);
 }finally{await vite.close()}
});

test('edits made between turns reach the party view through the live character',async()=>{
 const vite = await getTestServer();
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,localStorage:globalThis.localStorage,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 globalThis.localStorage=dom.window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let root;
 try{
  const {createInitialContext}=await vite.ssrLoadModule('/utils/gameContext.ts');
  const {saveToDBSlot}=await vite.ssrLoadModule('/utils/fileManager.ts');
  const {useGameLogic}=await vite.ssrLoadModule('/hooks/useGameLogic.ts');
  const {LocalizationProvider}=await vite.ssrLoadModule('/context/LocalizationContext.tsx');
  const {withLiveActivePlayer}=await vite.ssrLoadModule('/utils/partyView.ts');
  const c=createInitialContext({universe:'fantasy',playerName:'First',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');
  c.gameSettings.cooperativeGameType='FullParty';c.gameSettings.allowHistoryManipulation=true;
  const p={...c.playerCharacter,playerId:'p',name:'First'},q={...p,playerId:'q',name:'Second'};
  c.playerCharacter=p;c.players=[p,q];
  const state={playerCharacter:p,players:[p,q],activePlayerIndex:0,currentLocationData:c.currentLocation,activeQuests:[],completedQuests:[],encounteredNPCs:[],encounteredFactions:[],enemiesData:[],alliesData:[],playerCustomStates:[],plotOutline:null,worldStateFlags:[],worldEventsLog:[],imageCache:{}};
  await saveToDBSlot(1,{gameContext:c,gameState:state,gameHistory:[],gameLog:[],combatLog:[],lastJsonResponse:null,sceneImagePrompt:null,timestamp:new Date().toISOString()});
  let api;function Harness(){api=useGameLogic({language:'en',setLanguage:()=>{}});return null}
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(LocalizationProvider,null,React.createElement(Harness))));
  await act(async()=>{assert.equal(await api.loadGameFromSlot(1),true)});
  await act(async()=>api.editPlayerData('name','Renamed'));
  await act(async()=>api.editPlayerData('currentHealth',5));
  // The roster copy stays behind until the next commit; the view must not show it.
  assert.equal(api.gameState.playerCharacter.name,'Renamed');
  const shown=withLiveActivePlayer(api.gameState.players,api.gameState.playerCharacter);
  assert.equal(shown[0].name,'Renamed');
  assert.equal(shown[0].currentHealth,5);
  assert.equal(shown[1].name,'Second');
  // The GM prompt and saved context treat `players` as the party snapshot, so the
  // active slot must carry the same live character the GM already receives.
  const save=api.packageSaveData(api.gameState,false);
  assert.equal(save.gameContext.players[0].name,'Renamed');
  assert.equal(save.gameContext.players[0].currentHealth,5);
  assert.equal(save.gameContext.playerCharacter.name,'Renamed');
 }finally{
  if(root)await act(async()=>root.unmount());
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});
  globalThis.localStorage=old.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;
  dom.window.close();await vite.close();
 }
});

after(async () => { await closeTestServer(); });
