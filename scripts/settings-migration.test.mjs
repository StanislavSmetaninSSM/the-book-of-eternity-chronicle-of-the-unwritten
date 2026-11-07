import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import 'fake-indexeddb/auto';

// The automatic turn hand-over used to be called autoPassTurnInCoop, a leftover from the
// removed networked co-op mode. New saves must only carry autoPassTurn, while old saves
// keep loading with the same behaviour; slot metadata must show when images were dropped.
test('the legacy auto-pass setting migrates on load and slots report dropped images',async()=>{
 const {createServer}=await import('vite');
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const dom=new JSDOM('<div></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,localStorage:globalThis.localStorage};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 globalThis.localStorage=dom.window.localStorage;
 try{
  const {migrateGameSettings,hasLegacyAutoPassKey}=await vite.ssrLoadModule('/utils/settingsMigration.ts');
  const {createInitialContext}=await vite.ssrLoadModule('/utils/gameContext.ts');
  const {saveToDBSlot,listDBSlots}=await vite.ssrLoadModule('/utils/fileManager.ts');

  const migratedFalse=migrateGameSettings({gameSettingsVersion:1,autoPassTurnInCoop:false});
  assert.equal(migratedFalse.autoPassTurn,false);
  assert.equal('autoPassTurnInCoop' in migratedFalse,false,'the legacy key is not carried forward');
  assert.equal(migratedFalse.gameSettingsVersion,1,'unrelated settings survive');

  const migratedTrue=migrateGameSettings({autoPassTurnInCoop:true});
  assert.equal(migratedTrue.autoPassTurn,true);

  const bothKeys=migrateGameSettings({autoPassTurn:false,autoPassTurnInCoop:true});
  assert.equal(bothKeys.autoPassTurn,false,'an explicit new value wins over the legacy one');

  assert.equal(migrateGameSettings({}).autoPassTurn,true,'the documented default is on');
  const alreadyClean={autoPassTurn:true};
  assert.equal(migrateGameSettings(alreadyClean),alreadyClean,'migrated settings are not copied again');
  assert.equal(hasLegacyAutoPassKey({autoPassTurnInCoop:true}),true);
  assert.equal(hasLegacyAutoPassKey({autoPassTurn:true}),false);

  // New games write only the new key, whichever input name the setup screen used.
  const fromLegacyKey=createInitialContext({universe:'fantasy',playerName:'P',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear',autoPassTurnInCoop:false},'en');
  assert.equal(fromLegacyKey.gameSettings.autoPassTurn,false);
  assert.equal('autoPassTurnInCoop' in fromLegacyKey.gameSettings,false);
  const fromNewKey=createInitialContext({universe:'fantasy',playerName:'P',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear',autoPassTurn:false},'en');
  assert.equal(fromNewKey.gameSettings.autoPassTurn,false);

  // Save slots remember that cached images had to be dropped.
  const context=fromLegacyKey;
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
  assert.equal(/updateGameSettings\(\{\s*autoPassTurnInCoop/.test(menu),false,'the settings screen must not write the legacy key');
  const hook=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');
  assert.match(hook,/data\.gameContext\.gameSettings = migrateGameSettings\(data\.gameContext\.gameSettings\)/);
 } finally {
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});
  globalThis.localStorage=old.localStorage;
  dom.window.close();await vite.close();
 }
});
