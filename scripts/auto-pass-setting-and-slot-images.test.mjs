import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import 'fake-indexeddb/auto';

// The automatic turn hand-over is a plain local setting: the game writes one key, the menu
// wires that same key, and slot metadata must show when cached images were dropped.
test('the auto-pass setting has one name and slots report dropped images',async()=>{
 const {createServer}=await import('vite');
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const dom=new JSDOM('<div></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,localStorage:globalThis.localStorage};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 globalThis.localStorage=dom.window.localStorage;
 try{
  const {createInitialContext}=await vite.ssrLoadModule('/utils/gameContext.ts');
  const {saveToDBSlot,listDBSlots}=await vite.ssrLoadModule('/utils/fileManager.ts');

  // A new game writes the one key it has, and leaves the documented default alone.
  const fromNewKey=createInitialContext({universe:'fantasy',playerName:'P',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear',autoPassTurn:false},'en');
  assert.equal(fromNewKey.gameSettings.autoPassTurn,false);
  const fromNoKey=createInitialContext({universe:'fantasy',playerName:'P',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');
  assert.equal(fromNoKey.gameSettings.autoPassTurn,true,'the documented default is on');

  // Save slots remember that cached images had to be dropped.
  const context=fromNewKey;
  const state={playerCharacter:context.playerCharacter,players:[context.playerCharacter],activePlayerIndex:0,currentLocationData:context.currentLocation,activeQuests:[],completedQuests:[],encounteredNPCs:[],encounteredFactions:[],enemiesData:[],alliesData:[],playerCustomStates:[],plotOutline:null,worldStateFlags:[],worldEventsLog:[],imageCache:{}};
  const baseSave={gameContext:context,gameState:state,gameHistory:[],gameLog:[],combatLog:[],lastJsonResponse:null,sceneImagePrompt:null,timestamp:new Date().toISOString()};
  await saveToDBSlot(1,{...baseSave,omittedImageCount:3});
  await saveToDBSlot(2,{...baseSave,imagesOmittedForQuota:true});
  await saveToDBSlot(3,baseSave);
  const slots=await listDBSlots();
  assert.equal(slots.find(slot=>slot.slotId===1).imagesOmitted,true);
  assert.equal(slots.find(slot=>slot.slotId===2).imagesOmitted,true);
  assert.equal(slots.find(slot=>slot.slotId===3).imagesOmitted,false);

  // The UI reads the flag and writes only the renamed setting.
  const menu=await readFile(new URL('../components/GameMenuView.tsx',import.meta.url),'utf8');
  assert.match(menu,/slot\.imagesOmitted/);
  assert.match(menu,/name="autoPassTurn"/);
  assert.equal(/updateGameSettings\(\{\s*autoPassTurnInCoop/.test(menu),false,'the settings screen has one name for the setting');
  assert.equal(/legacyAutoPassTurn/.test(menu),false,'and no alias to read through');
  const hook=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');
  assert.doesNotMatch(hook,/migrateGameSettings/,'loading a save renames nothing');
 } finally {
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});
  globalThis.localStorage=old.localStorage;
  dom.window.close();await vite.close();
 }
});
