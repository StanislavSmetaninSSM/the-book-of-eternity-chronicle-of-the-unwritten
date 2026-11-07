import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

// Per-universe dictionaries are ~2 MB of source and only one of the six is ever used at
// a time, so they load on demand: the start-up bundle must not contain them.
test('world dictionaries load only for the universe in play',async()=>{
 const {createServer}=await import('vite');
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const dom=new JSDOM('<div></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 try{
  const translationsModule=await vite.ssrLoadModule('/utils/localizationTranslations.ts');
  const {translations,worldPackIdForUniverse,isWorldTranslationsLoaded,ensureWorldTranslations,ensureAllWorldTranslations}=translationsModule;
  const {translate}=await vite.ssrLoadModule('/utils/localization.ts');

  // Universe ids map to their dictionary, including the legacy name and pack ids.
  assert.equal(worldPackIdForUniverse('fantasy'),'fantasy');
  assert.equal(worldPackIdForUniverse('sci_fi'),'sci_fi');
  assert.equal(worldPackIdForUniverse('post_apocalypse'),'post_apocalypse');
  assert.equal(worldPackIdForUniverse('urban_myth'),'modern');
  assert.equal(worldPackIdForUniverse('modern'),'modern');
  assert.equal(worldPackIdForUniverse('history'),'history');
  assert.equal(worldPackIdForUniverse('myths'),'myths');
  assert.equal(worldPackIdForUniverse('custom'),null,'custom universes define literal names');
  assert.equal(worldPackIdForUniverse(undefined),null);
  assert.equal(isWorldTranslationsLoaded('custom'),true,'nothing to wait for');

  // UI strings are available immediately; world strings are not.
  assert.equal(isWorldTranslationsLoaded('fantasy'),false);
  const keysBefore=Object.keys(translations.ru).length;
  assert.equal(translate('ru','Elf'),'Elf','an unloaded dictionary falls back to the key');

  // A concurrent pair of requests shares one load.
  await Promise.all([ensureWorldTranslations('fantasy'),ensureWorldTranslations('fantasy')]);
  assert.equal(isWorldTranslationsLoaded('fantasy'),true);
  assert.ok(Object.keys(translations.ru).length>keysBefore+100,'fantasy entries were merged');
  assert.notEqual(translate('ru','Elf'),'Elf','the race name is translated once the pack is loaded');
  assert.equal(isWorldTranslationsLoaded('history'),false,'other universes stay deferred');

  // Idempotent: a second call does not duplicate or reload anything.
  const keysAfterFantasy=Object.keys(translations.ru).length;
  await ensureWorldTranslations('fantasy');
  assert.equal(Object.keys(translations.ru).length,keysAfterFantasy);

  // Saving a game records the universe so the next load only asks for that dictionary.
  const {createInitialContext}=await vite.ssrLoadModule('/utils/gameContext.ts');
  const context=createInitialContext({universe:'sci_fi',playerName:'P',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');
  assert.equal(context.gameSettings.gameWorldInformation.universe,'sci_fi');

  // Legacy saves without a recorded universe load every dictionary.
  await ensureAllWorldTranslations();
  assert.equal(isWorldTranslationsLoaded('myths'),true);
  assert.equal(isWorldTranslationsLoaded('sci_fi'),true);

  // The source keeps the packs behind dynamic imports, and the UI waits for them.
  const source=await readFile(new URL('../utils/localizationTranslations.ts',import.meta.url),'utf8');
  assert.equal(/^import .*worlds\/.*_loc/m.test(source),false,'world dictionaries must not be static imports');
  assert.equal((source.match(/import\('\.\/translations\/worlds\//g)||[]).length,6);
  const app=await readFile(new URL('../App.tsx',import.meta.url),'utf8');
  assert.match(app,/useWorldTranslations\(activeUniverse\)/);
  assert.match(app,/if \(!worldTranslationsReady\)/);
  const start=await readFile(new URL('../components/StartScreen.tsx',import.meta.url),'utf8');
  assert.match(start,/useWorldTranslations\(formData\.universe\)/);
  assert.match(start,/worldTranslationsReady && <CreationForm/);
 }finally{
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});
  dom.window.close();await vite.close();
 }
});
