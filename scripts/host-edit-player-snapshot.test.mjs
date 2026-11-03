import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';import vm from 'node:vm';import {createServer} from 'vite';
test('a host local equipment edit updates its uniquely identified player snapshot even when another player is active',async()=>{
 const source=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let callback;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='setGameState')callback=n.initializer.arguments[0].getText(src);ts.forEachChild(n,visit)}visit(src);assert.ok(callback);
 const code=ts.transpileModule(`this.setGameState=${callback}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  const {reconcileHostEditedCharacter}=await server.ssrLoadModule('/utils/hostEditedCharacter.ts');const {beginGameplayMutation,clientLocalEditBlocked}=await server.ssrLoadModule('/utils/gameplayMutationGate.ts');const {createInventoryActions}=await server.ssrLoadModule('/hooks/logic/inventoryActions.ts');const {createInitialContext}=await server.ssrLoadModule('/utils/gameContext.ts');
  const ctx=createInitialContext({universe:'fantasy',playerName:'Host',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');
  const item={existedId:'sword',name:'Sword',durability:'100%',equipmentSlot:'MainHand',weight:0,volume:0,count:1},host={...ctx.playerCharacter,playerId:'host',inventory:[item]},other={...ctx.playerCharacter,playerId:'other',name:'Other'};
  let state={networkRole:'host',myPeerId:'host',playerCharacter:host,players:[host,other],activePlayerIndex:1,encounteredNPCs:[],encounteredFactions:[]};const original=structuredClone(state),ref={current:state};ctx.playerCharacter=host;let errors=[];
  const scope={reconcileHostEditedCharacter,gameStateRef:ref,hostRestorePendingRef:{current:null},clientLocalEditBlocked,beginGameplayMutation,gameplayMutationRevisionRef:{current:0},gameplayMutationPendingRef:{current:false},turnPhaseRef:{current:'idle'},pendingClientSyncRef:{current:null},pendingNetworkTurnRef:{current:null},clientTurnStampRef:{current:null},stateMutationRevisionRef:{current:0},stateMutationAppliedRef:{current:0},gameplayMutationAppliedRef:{current:0},mutationMessageRef:{current:{}},setGameStateInternal:fn=>{state=fn(state);ref.current=state},setGameplayMutationEpoch:()=>{},activeTurnRef:{current:null},abortControllerRef:{current:null},setError:e=>errors.push(e)};vm.runInNewContext(code,scope);
  const manager=createInventoryActions({gameState:state,setGameState:scope.setGameState,gameContextRef:{current:ctx},t:k=>k});manager.equipItem(item,'MainHand');
  assert.equal(state.playerCharacter.equippedItems.MainHand,'sword');assert.equal(state.players[0].equippedItems.MainHand,'sword','host snapshot must match edit before sync or restore');assert.equal(state.players[0],state.playerCharacter);assert.deepEqual(state.players[1],JSON.parse(JSON.stringify(other)));assert.equal(host.equippedItems.MainHand,null);assert.deepEqual(original.players[0].equippedItems.MainHand,null);assert.deepEqual(errors,[]);
  const own=state.playerCharacter;const others=state.players[1];
  const edit={...state,playerCharacter:{...own,name:'Changed'}};const reconciled=reconcileHostEditedCharacter(state,edit);
  assert.equal(reconciled.players[0].name,'Changed');assert.equal(reconciled.players[1],others);assert.notEqual(reconciled.players,edit.players);
  const duplicate={...edit,players:[own,own]};assert.equal(reconcileHostEditedCharacter(state,duplicate),duplicate,'ambiguous legacy IDs must not be guessed');
  const switching={...state,playerCharacter:others};assert.equal(reconcileHostEditedCharacter(state,switching),switching,'turn switching is not a host edit');
  const local={...state,networkRole:'none'},localEdit={...edit,networkRole:'none'};assert.equal(reconcileHostEditedCharacter(local,localEdit),localEdit,'local personality semantics remain unchanged');
 }finally{await server.close()}
});
