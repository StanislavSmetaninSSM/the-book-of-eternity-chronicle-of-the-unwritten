import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
test('cancelling a turn does not unconditionally delete an unrelated checkpoint',async()=>{
 const text=await readFile(new URL('../hooks/logic/turn.ts',import.meta.url),'utf8'),src=ts.createSourceFile('turn.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let callback;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='cancelRequest')callback=n.initializer;ts.forEachChild(n,visit)}visit(src);assert.ok(callback);
 const js=ts.transpileModule(`const run = ${callback.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 let deletes=0;const controller=new AbortController(),sentinel=Symbol('user-cancel');const scope={turnPhaseRef:{current:'generating'},abortControllerRef:{current:controller},activeTurnRef:{current:Symbol('turn')},clearInterruptedTurnRecovery:async()=>{deletes++},USER_CANCELLED_TURN:sentinel,setError:()=>{},setIsLoading:()=>{},setSuggestedActions:()=>{},setGameHistory:()=>{},t:k=>k,console};
 vm.runInNewContext(`${js}\nrun()`,scope);await Promise.resolve();assert.equal(deletes,0);assert.equal(controller.signal.aborted,true);assert.equal(controller.signal.reason,sentinel);
});

test('production turn cancellation only removes its own committed checkpoint',async()=>{
 const {createServer}=await import('vite');await import('fake-indexeddb/auto');const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const oldWindow=globalThis.window;const storage=new Map();globalThis.window={setTimeout,clearTimeout,sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)}};
 try{
  const {createInitialContext}=await server.ssrLoadModule('/utils/gameContext.ts');const {createTurnManager}=await server.ssrLoadModule('/hooks/logic/turn.ts');const {acquireArenaGmTurnLease}=await server.ssrLoadModule('/utils/arenaGmRelay.ts');const {saveInterruptedTurnRecovery,loadInterruptedTurnRecovery,clearInterruptedTurnRecovery}=await server.ssrLoadModule('/utils/fileManager.ts');
  for(const scenario of ['own','replaced']){
   await clearInterruptedTurnRecovery();const context=createInitialContext({universe:'fantasy',playerName:'Test',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');context.message='test-action';const pc=context.playerCharacter;
   const base={playerCharacter:pc,players:[pc],activePlayerIndex:0,currentLocationData:context.currentLocation,activeQuests:[],completedQuests:[],encounteredNPCs:[],encounteredFactions:[],enemiesData:[],alliesData:[],playerCustomStates:[],plotOutline:null,worldStateFlags:[],worldEventsLog:[],imageCache:{}};
   let previous=null;if(scenario==='network')previous=await saveInterruptedTurnRecovery({context:{message:'unrelated'},baseState:base,history:[]});
   const firstLease=await acquireArenaGmTurnLease(),noop=()=>{},controller={current:null},active={current:null},phase={current:'idle'};
   const manager=createTurnManager({gameState:base,setGameState:noop,gameHistory:[],setGameHistory:noop,isLoading:false,setIsLoading:noop,setError:noop,setLastJsonResponse:noop,setLastRequestJson:noop,setGameLog:noop,setCombatLog:noop,setSceneImagePrompt:noop,setSuggestedActions:noop,setWorldMap:noop,setVisitedLocations:noop,setWorldState:noop,setTurnNumber:noop,gameContextRef:{current:context},abortControllerRef:controller,activeTurnRef:active,turnPhaseRef:phase,clientTurnStampRef:{current:{version:1,sessionId:'s',revision:1}},pendingNetworkTurnRef:{current:null},setSuperInstructions:noop,setGameSettings:noop,setLanguage:noop,t:k=>k,turnStartTimeRef:{current:null},setTurnTime:noop,setCurrentStep:noop,setCurrentModel:noop,language:'en',gameSettings:context.gameSettings,hostConnectionRef:{current:null},gameStateRef:{current:base},broadcastFullSync:noop,combatLog:[],gameLog:[]});
   const pending=manager.resumeInterruptedTurn({context,baseState:base,history:[]});
   if(scenario!=='network'){
    let checkpoint=null;for(let i=0;i<30&&!checkpoint;i++){await new Promise(r=>setTimeout(r,10));checkpoint=await loadInterruptedTurnRecovery()};assert.ok(checkpoint,'turn checkpoint was written');
    if(scenario==='replaced')previous=await saveInterruptedTurnRecovery({context:{message:'newer'},baseState:base,history:[]});
   }
   manager.cancelRequest();firstLease();await pending;const after=await loadInterruptedTurnRecovery();
   if(scenario==='own')assert.equal(after,null);else assert.equal(after?.checkpointId,previous.checkpointId,scenario);
  }
 }finally{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;await server.close()}
});
