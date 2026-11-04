import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';import vm from 'node:vm';import {createServer} from 'vite';

test('every exported inventory and player action is blocked before manager side effects for client, spectator and staged host restore',async()=>{
 const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  const {clientLocalEditBlocked,guardGameplayActions}=await server.ssrLoadModule('/utils/gameplayMutationGate.ts');const {createInventoryActions}=await server.ssrLoadModule('/hooks/logic/inventoryActions.ts');const {createPlayerActionsManager}=await server.ssrLoadModule('/hooks/logic/playerActions.ts');
  const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let callback;
  function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='userGameplayActionBlocked'&&n.initializer&&ts.isCallExpression(n.initializer))callback=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(src);assert.ok(callback);
  const js=ts.transpileModule(`const blocked = ${callback.getText(src)};this.blocked=blocked`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  for(const [role,pending] of [['player',false],['spectator',false],['host',true]]){
   let calls=0,errors=[];const context=new Proxy({}, {set(){calls++;throw new Error('unexpected context mutation')}}),ref={current:context},spy=()=>{calls++};
   const props={gameState:{networkRole:role},setGameState:spy,setGameHistory:spy,setUserGameHistory:spy,setGameLog:spy,setCombatLog:spy,setVisitedLocations:spy,setWorldMap:spy,setWorldState:spy,gameSettings:{allowHistoryManipulation:true},gameContextRef:ref,t:k=>k};
   const scope={gameStateRef:{current:{networkRole:role}},hostRestorePendingRef:{current:pending?{}:null},setError:e=>errors.push(e),mutationMessageRef:{current:{client:'client-blocked',host:'host-blocked'}},clientLocalEditBlocked};vm.runInNewContext(js,scope);
   const inventory=guardGameplayActions(createInventoryActions(props),scope.blocked),actions=guardGameplayActions(createPlayerActionsManager(props),scope.blocked);
   assert.ok(Object.keys(inventory).length>=20);assert.ok(Object.keys(actions).length>=45);
   for(const [name,fn] of [...Object.entries(inventory),...Object.entries(actions)]){assert.equal(fn(),undefined,`${role}: ${name}`);assert.equal(calls,0,`${role}: ${name} ran side effects`);}
   assert.equal(errors.length,Object.keys(inventory).length+Object.keys(actions).length);assert.ok(errors.every(error=>error===(pending?'host-blocked':'client-blocked')));
  }
 }finally{await server.close()}
});

test('directly exported character, world and history edit callbacks are gated before writes',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const names=['editLocationData','deleteLocationThreat','updatePlayerPortrait','updateNpcPortrait','deleteActiveSkill','deletePassiveSkill','deleteActiveEffect','forgetHealedWound','forgetActiveWound','clearAllHealedWounds','onEditNpcMemory','onDeleteNpcMemory','clearAllCompletedFactionProjects','clearAllCompletedNpcActivities','onDeleteCurrentActivity','onDeleteCompletedActivity','deleteFactionProject','deleteFactionCustomState','deleteCustomState','deleteNpcCustomState','deleteFactionBonus','clearNpcJournalsNow'];
 const found={};function visit(n){if(ts.isVariableDeclaration(n)&&[...names,'setGameState','userGameplayActionBlocked'].includes(n.name.getText(src))&&n.initializer){const expr=ts.isCallExpression(n.initializer)?n.initializer.arguments[0]:n.initializer;found[n.name.getText(src)]=expr.getText(src)}ts.forEachChild(n,visit)}visit(src);
 const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  const {clientLocalEditBlocked,beginGameplayMutation}=await server.ssrLoadModule('/utils/gameplayMutationGate.ts');
  for(const [role,pending] of [['player',false],['spectator',false],['host',true]]){
   for(const name of names){assert.ok(found[name],name);let error=null,writes=0;const noWrite=()=>{writes++;throw new Error('unexpected mutation')};
    const scope={gameStateRef:{current:{networkRole:role}},hostRestorePendingRef:{current:pending?{}:null},mutationMessageRef:{current:{client:'client-blocked',host:'host-blocked'}},clientLocalEditBlocked,beginGameplayMutation,setError:e=>error=e,setGameStateInternal:noWrite,setUserWorldMap:noWrite,setUserVisitedLocations:noWrite,gameSettings:{allowHistoryManipulation:true},gameContextRef:{current:new Proxy({}, {set:noWrite})},console};
    const js=ts.transpileModule(`const setGameState=${found.setGameState}; const userGameplayActionBlocked=${found.userGameplayActionBlocked}; const action=${found[name]}; action('id','field','value');`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    vm.runInNewContext(js,scope);assert.equal(writes,0,`${role}: ${name}`);assert.equal(error,pending?'host-blocked':'client-blocked',`${role}: ${name}`);
   }
  }
 }finally{await server.close()}
});
