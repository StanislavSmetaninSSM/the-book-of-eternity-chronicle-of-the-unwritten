import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import 'fake-indexeddb/auto';

const viteModule = async () => {
  const {createServer} = await import('vite');
  return createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
};

const dataUrl = (seed) => `data:image/png;base64,${'A'.repeat(2048)}${seed}`;

test('a save keeps only the budgeted images and reports what it dropped',async()=>{
 const vite=await viteModule();
 try{
  const budget=await vite.ssrLoadModule('/utils/saveImageBudget.ts');
  // Entry limit and priority retention.
  const cache={};
  for(let index=0;index<30;index++) cache[`prompt-${index}`]=dataUrl(index);
  const trimmed=budget.applyImageBudget(cache,{maxEntries:20,priorityKeys:['prompt-29']});
  assert.equal(Object.keys(trimmed.cache).length,20);
  assert.equal(trimmed.omittedCount,10);
  assert.ok(trimmed.cache['prompt-29'],'priority images survive the budget');
  assert.equal(trimmed.keptKeys.length,20);
  assert.ok(trimmed.keptKeys.includes('prompt-29'),'priority images are kept first');
  assert.ok(!trimmed.cache['prompt-19'],'lower priority images are shed to stay within the entry limit');
  assert.ok(trimmed.cache['prompt-0']);

  // Byte limit.
  const byteTrimmed=budget.applyImageBudget(cache,{maxEntries:100,maxBytes:6000});
  assert.ok(budget.imageCacheBytes(byteTrimmed.cache)<=6000);
  assert.ok(byteTrimmed.omittedCount>0);

  // The very first image survives even when it alone exceeds the byte budget.
  const oversized=budget.applyImageBudget({'only':dataUrl('x')},{maxBytes:10});
  assert.deepEqual(Object.keys(oversized.cache),['only']);

  // Non-base64 payloads are measured by their length instead of being ignored.
  assert.equal(budget.estimateBase64Bytes('plain'),5);
  const sample=dataUrl(1);
  const payload=sample.length-sample.indexOf(',')-1;
  assert.equal(budget.estimateBase64Bytes(sample),Math.ceil(payload*0.75));

  // Quota fallback drops every image but remembers how many there were.
  const stripped=budget.stripImagesForQuota({gameState:{imageCache:cache},gameHistory:[]});
  assert.deepEqual(stripped.gameState.imageCache,{});
  assert.equal(stripped.imagesOmittedForQuota,true);
  assert.equal(stripped.omittedImageCount,30);
  assert.ok(budget.isQuotaError(Object.assign(new Error('x'),{name:'QuotaExceededError'})));
  assert.equal(budget.isQuotaError(new Error('unrelated')),false);
 }finally{await vite.close()}
});

test('the packaged save respects the image budget',async()=>{
 const vite=await viteModule();
 const dom=new JSDOM('<div></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 try{
  const {createSaveLoadManager}=await vite.ssrLoadModule('/hooks/logic/saveLoad.ts');
  const {MAX_IMAGES_PER_SAVE}=await vite.ssrLoadModule('/utils/saveImageBudget.ts');
  const imageCache={};
  const inventory=[];
  for(let index=0;index<MAX_IMAGES_PER_SAVE+8;index++){
   const prompt=`item-${index}`;
   imageCache[prompt]=dataUrl(index);
   inventory.push({id:`item-${index}`,name:`Item ${index}`,image_prompt:prompt});
  }
  imageCache['scene-prompt']=dataUrl('scene');
  imageCache['hero-portrait']=dataUrl('portrait');
  const gameState={playerCharacter:{playerId:'p1',name:'Hero',image_prompt:'hero-portrait',inventory},players:[],encounteredNPCs:[],encounteredFactions:[],enemiesData:[],alliesData:[],currentLocationData:null,cinematics:[],imageCache};
  const gameContext={visitedLocations:[],worldMap:{}};
  const manager=createSaveLoadManager({
   gameContextRef:{current:gameContext},gameStateRef:{current:gameState},
   gameHistory:[],gameLog:[],combatLog:[],lastJsonResponse:null,sceneImagePrompt:'scene-prompt',
   restoreFromSaveData:()=>{},t:(key)=>key,setAutosaveTimestamp:()=>{},setDbSaveSlots:()=>{},
   beginLocalLoad:()=>()=>true,setIsSaving:()=>{},
  });
  const saved=manager.packageSaveData(gameState,true);
  const keptKeys=Object.keys(saved.gameState.imageCache);
  assert.ok(keptKeys.length<=MAX_IMAGES_PER_SAVE,`expected a bounded cache, got ${keptKeys.length}`);
  assert.ok(keptKeys.includes('scene-prompt'),'the current scene always keeps its image');
  assert.ok(keptKeys.includes('hero-portrait'),'the active portrait always keeps its image');
  assert.equal(saved.omittedImageCount,Object.keys(imageCache).length-keptKeys.length);
  // The live state must not be mutated by packaging.
  assert.equal(Object.keys(gameState.imageCache).length,Object.keys(imageCache).length);
  // Non-GC packaging (relay/checkpoint) keeps the cache untouched.
  const full=manager.packageSaveData(gameState,false);
  assert.equal(Object.keys(full.gameState.imageCache).length,Object.keys(imageCache).length);
  assert.equal(full.omittedImageCount,undefined);
 }finally{
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});
  dom.window.close();await vite.close();
 }
});

test('a full storage quota falls back to saving without cached images',async()=>{
 const vite=await viteModule();
 const dom=new JSDOM('<div></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 const originalPut=globalThis.IDBObjectStore.prototype.put;
 let putAttempts=0;
 try{
  const fileManager=await vite.ssrLoadModule('/utils/fileManager.ts');
  // Images now go to their own store, so only autosave writes count here.
  globalThis.IDBObjectStore.prototype.put=function(...args){
   if(this.name!=='autosaves') return originalPut.apply(this,args);
   putAttempts+=1;
   if(putAttempts===1){
    const error=new Error('The quota has been exceeded.');
    error.name='QuotaExceededError';
    throw error;
   }
   return originalPut.apply(this,args);
  };
  const save={gameState:{imageCache:{'prompt-1':dataUrl(1),'prompt-2':dataUrl(2)}},gameHistory:[],timestamp:new Date().toISOString()};
  const result=await fileManager.saveToDB(save);
  assert.equal(putAttempts,2,'the autosave retries once without images');
  assert.equal(result.imagesOmittedForQuota,true,'the caller is told that images had to be dropped');
  const stored=await fileManager.loadFromDB();
  assert.deepEqual(stored.gameState.imageCache,{});
  assert.equal(stored.imagesOmittedForQuota,true);
  assert.equal(stored.omittedImageCount,2);
 }finally{
  globalThis.IDBObjectStore.prototype.put=originalPut;
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});
  dom.window.close();await vite.close();
 }
});

test('recovery checkpoints do not duplicate the whole image cache',async()=>{
 const vite=await viteModule();
 const dom=new JSDOM('<div></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 try{
  const budget=await vite.ssrLoadModule('/utils/saveImageBudget.ts');
  const fileManager=await vite.ssrLoadModule('/utils/fileManager.ts');

  // The helper keeps the scene and the active portrait and leaves the input untouched.
  const cache={};
  for(let index=0;index<20;index++) cache[`prompt-${index}`]=dataUrl(index);
  cache['scene-prompt']=dataUrl('scene');
  cache['portrait']=dataUrl('portrait');
  const state={imageCache:cache,playerCharacter:{image_prompt:'portrait'}};
  const bounded=budget.budgetRecoveryState(state,'scene-prompt');
  assert.ok(Object.keys(bounded.imageCache).length<=budget.RECOVERY_IMAGE_ENTRIES);
  assert.ok(bounded.imageCache['scene-prompt'] && bounded.imageCache['portrait'],'scene and portrait survive');
  assert.equal(Object.keys(state.imageCache).length,22,'the live state is not mutated');
  assert.ok(bounded.omittedImageCount>0);
  const untouched=budget.budgetRecoveryState({imageCache:{only:dataUrl('x')}},'missing');
  assert.equal(untouched.omittedImageCount,undefined);
  assert.ok(budget.imageCacheBytes(bounded.imageCache)<=budget.RECOVERY_IMAGE_BYTES);

  // Crash recovery keeps a bounded copy even when the source save is at the slot budget.
  const context={currentTurnNumber:1,gameSettings:{},visitedLocations:[],worldMap:{}};
  const gameState={playerCharacter:{name:'A',level:1,image_prompt:'portrait'},currentLocationData:{name:'Here'},imageCache:cache};
  const save={gameContext:context,gameState,gameHistory:[],gameLog:[],combatLog:[],lastJsonResponse:null,sceneImagePrompt:'scene-prompt',timestamp:new Date().toISOString()};
  await fileManager.saveCrashRecoveryPoint(save,'stable');
  const restored=await fileManager.loadCrashRecoveryPoint();
  const restoredKeys=Object.keys(restored.gameState.imageCache);
  assert.ok(restoredKeys.length<=budget.RECOVERY_IMAGE_ENTRIES,`crash recovery stored ${restoredKeys.length} images`);
  assert.ok(restoredKeys.includes('scene-prompt')&&restoredKeys.includes('portrait'));

  // Interrupted-turn checkpoints are written before every action: same bound applies.
  await fileManager.saveInterruptedTurnRecovery({context,baseState:gameState,history:[]});
  const interrupted=await fileManager.loadInterruptedTurnRecovery();
  const checkpointKeys=Object.keys(interrupted.baseState.imageCache);
  assert.ok(checkpointKeys.length<=budget.RECOVERY_IMAGE_ENTRIES,`checkpoint stored ${checkpointKeys.length} images`);
  assert.ok(budget.imageCacheBytes(interrupted.baseState.imageCache)<=budget.RECOVERY_IMAGE_BYTES);
 }finally{
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});
  dom.window.close();await vite.close();
 }
});
