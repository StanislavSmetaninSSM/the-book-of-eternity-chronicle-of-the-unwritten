import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';import vm from 'node:vm';import {createServer} from 'vite';

test('live role and restore changes gate complete action managers without rebuilding callbacks',async()=>{
 const source=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let callback;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='userGameplayActionBlocked')callback=n.initializer.arguments[0].getText(src);ts.forEachChild(n,visit)}visit(src);assert.ok(callback);
 const code=ts.transpileModule(`this.blocked=${callback}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  const {clientLocalEditBlocked,guardGameplayActions}=await server.ssrLoadModule('/utils/gameplayMutationGate.ts');const {createInventoryActions}=await server.ssrLoadModule('/hooks/logic/inventoryActions.ts');const {createPlayerActionsManager}=await server.ssrLoadModule('/hooks/logic/playerActions.ts');const {createInitialContext}=await server.ssrLoadModule('/utils/gameContext.ts');
  const context=createInitialContext({universe:'fantasy',playerName:'Test',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');const item={existedId:'sword',name:'Sword',durability:'100%',equipmentSlot:'MainHand',weight:0,volume:0,count:1};
  const pc={...context.playerCharacter,inventory:[item]};let state={networkRole:'none',playerCharacter:pc,players:[pc],encounteredNPCs:[],encounteredFactions:[]},history=[{sender:'player',content:'a'},{sender:'gm',content:'b'}],warnings=[];const stateRef={current:state},contextRef={current:{...context,playerCharacter:pc}},pending={current:null};
  const scope={gameStateRef:stateRef,hostRestorePendingRef:pending,clientLocalEditBlocked,mutationMessageRef:{current:{host:'host busy',client:'host only'}},setError:e=>warnings.push(e)};vm.runInNewContext(code,scope);
  const setGameState=update=>{state=update(state);stateRef.current=state},setHistory=update=>{history=update(history)},noop=()=>{};
  const inventory=guardGameplayActions(createInventoryActions({gameState:state,setGameState,gameContextRef:contextRef,t:k=>k}),scope.blocked);
  const actions=guardGameplayActions(createPlayerActionsManager({setGameState,setGameHistory:setHistory,setUserGameHistory:setHistory,setGameLog:noop,setCombatLog:noop,setVisitedLocations:noop,setWorldMap:noop,setWorldState:noop,gameSettings:{allowHistoryManipulation:true},gameContextRef:contextRef,t:k=>k}),scope.blocked);
  const changeRole=role=>{state={...state,networkRole:role};stateRef.current=state};
  inventory.equipItem(item,'MainHand');assert.equal(state.playerCharacter.equippedItems.MainHand,'sword');
  for(const role of ['player','spectator']){changeRole(role);const before=state,oldHistory=history,oldContext=contextRef.current.playerCharacter;inventory.unequipItem(item);actions.deleteMessage(0);assert.equal(state,before);assert.equal(history,oldHistory);assert.equal(contextRef.current.playerCharacter,oldContext);assert.deepEqual(warnings.slice(-2),['host only','host only']);}
  changeRole('host');pending.current={};const before=state;inventory.unequipItem(item);actions.deleteMessage(0);assert.equal(state,before);assert.equal(history.length,2);assert.deepEqual(warnings.slice(-2),['host busy','host busy']);
  pending.current=null;inventory.unequipItem(item);actions.deleteMessage(0);assert.equal(state.playerCharacter.equippedItems.MainHand,null);assert.equal(history.length,1);
  changeRole('none');inventory.equipItem(item,'MainHand');assert.equal(state.playerCharacter.equippedItems.MainHand,'sword');
 }finally{await server.close()}
});
