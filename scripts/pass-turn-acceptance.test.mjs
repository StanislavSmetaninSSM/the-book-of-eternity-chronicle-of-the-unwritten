import {test} from 'node:test';import assert from 'node:assert/strict';import React,{act,StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {JSDOM} from 'jsdom';import {createServer} from 'vite';import 'fake-indexeddb/auto';
// Acceptance for the manual turn hand-over: the boolean returned by passTurnToPlayer
// means "accepted for commit", invalid targets are refused, and exactly one commit
// carries the new active character, the roster slot and the system message.
test('a manual pass is accepted once, refused twice and committed consistently',async()=>{
 const vite=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,localStorage:globalThis.localStorage,act:globalThis.IS_REACT_ACT_ENVIRONMENT};globalThis.window=dom.window;globalThis.document=dom.window.document;Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.localStorage=dom.window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;let root;
 try{
 const {createInitialContext}=await vite.ssrLoadModule('/utils/gameContext.ts'),{saveToDBSlot}=await vite.ssrLoadModule('/utils/fileManager.ts'),{useGameLogic}=await vite.ssrLoadModule('/hooks/useGameLogic.ts'),{LocalizationProvider}=await vite.ssrLoadModule('/context/LocalizationContext.tsx');
 const c=createInitialContext({universe:'fantasy',playerName:'First',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');c.currentTurnNumber=3;c.gameSettings.cooperativeGameType='FullParty';const p={...c.playerCharacter,playerId:'p',name:'First'},q={...p,playerId:'q',name:'Second'};c.playerCharacter=p;c.players=[p,q];
 const state={playerCharacter:p,players:[p,q],activePlayerIndex:0,currentLocationData:c.currentLocation,activeQuests:[],completedQuests:[],encounteredNPCs:[],encounteredFactions:[],enemiesData:[],alliesData:[],playerCustomStates:[],plotOutline:null,worldStateFlags:[],worldEventsLog:[],imageCache:{},networkRole:'none',myPeerId:null,hostPeerId:null,peers:[],isConnectedToHost:true};
 await saveToDBSlot(1,{gameContext:c,gameState:state,gameHistory:[],gameLog:[],combatLog:[],lastJsonResponse:null,sceneImagePrompt:null,timestamp:new Date().toISOString()});
 let api;function Harness(){api=useGameLogic({language:'en',setLanguage:()=>{}});return null}root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(StrictMode,null,React.createElement(LocalizationProvider,null,React.createElement(Harness)))));await act(async()=>{assert.equal(await api.loadGameFromSlot(1),true)});
 assert.equal(api.gameState.activePlayerIndex,0);
 const historyBefore=api.gameHistory.length;

 // Invalid targets are refused without touching the history.
 await act(async()=>{assert.equal(api.passTurnToPlayer(0),false,'passing to the active player is a no-op')});
 await act(async()=>{assert.equal(api.passTurnToPlayer(7),false,'an out-of-range target is refused')});
 await act(async()=>{assert.equal(api.passTurnToPlayer(-1),false,'a negative target is refused')});
 assert.equal(api.gameHistory.length,historyBefore,'refused passes must not write a system message');
 assert.equal(api.gameState.activePlayerIndex,0);

 // One accepted pass: the return value means "queued", the commit happens on the next render.
 await act(async()=>{
   assert.equal(api.passTurnToPlayer(1),true);
   assert.equal(api.gameState.activePlayerIndex,0,'the state is not mutated mid-render');
   assert.equal(api.passTurnToPlayer(0),false,'a second transition cannot overtake the pending one');
 });
 assert.equal(api.gameState.activePlayerIndex,1);
 assert.equal(api.gameState.playerCharacter.playerId,'q');
 assert.equal(api.gameState.players[1].playerId,'q');
 assert.equal(api.gameState.players[0].name,'First');
 assert.equal(api.gameHistory.length,historyBefore+1);
 assert.equal(api.gameHistory[api.gameHistory.length-1].sender,'system');
 assert.equal(api.turnNumber,3,'handing over inside the same round does not advance the turn');

 // The next hand-over wraps back to the first player and advances the turn number.
 await act(async()=>{assert.equal(api.passTurnToPlayer(0),true)});
 assert.equal(api.gameState.activePlayerIndex,0);
 assert.equal(api.gameState.playerCharacter.playerId,'p');
 assert.equal(api.turnNumber,4);
 assert.equal(api.gameHistory.length,historyBefore+2);

 // The same transition works twice in a row: no stuck pending marker.
 await act(async()=>{assert.equal(api.passTurnToPlayer(1),true)});
 assert.equal(api.gameState.playerCharacter.playerId,'q');
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50))});
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});globalThis.localStorage=old.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;dom.window.close();await vite.close()}
});
