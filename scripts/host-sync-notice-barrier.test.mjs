import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';import vm from 'node:vm';
test('host sync requests queue a protected notice independently of broadcast completion',async()=>{
 const text=await readFile(new URL('../hooks/logic/multiplayer.ts',import.meta.url),'utf8'),src=ts.createSourceFile('m.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),handlers=[];
 function visit(n){if(ts.isCallExpression(n)&&n.arguments.length===2&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text==='data'&&ts.isArrowFunction(n.arguments[1]))handlers.push(n.arguments[1]);ts.forEachChild(n,visit)}visit(src);assert.equal(handlers.length,3);
 for(const handler of [handlers[0],handlers[2]]){
  const js=ts.transpileModule(`const onData=${handler.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;let broadcasts=0,rawHistory=0,revokes=0,notices=[];
  const conn={peer:'p',open:true,metadata:{playerName:'Alice'}},state={networkRole:'host'},scope={conn,connectionsRef:{current:new Map([['p',conn]])},hostTurnAuthority:{revoke:()=>revokes++},gameStateRef:{current:state},packageSaveData:()=>({gameState:state}),broadcastFullSync:()=>{broadcasts++;return Promise.resolve()},queueHostSyncNotice:name=>notices.push(name),setGameHistory:()=>rawHistory++,setError:()=>{},t:k=>k,console:{log:()=>{}}};
  vm.runInNewContext(`${js}\nonData(data)`,{...scope,data:{type:'request_full_sync',senderId:'p',payload:{syncRequestId:'req'}}});await Promise.resolve();await Promise.resolve();
  assert.equal(revokes,1);assert.equal(broadcasts,1);assert.deepEqual(notices,['Alice']);assert.equal(rawHistory,0,'unprotected history must never be appended after an in-flight sync');
 }
});

test('queued request notices wait for idle host and acquire history authority before React schedules',async()=>{
 const {createServer}=await import('vite');const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  const {HostTurnAuthority}=await server.ssrLoadModule('/utils/networkTurnProtocol.ts');const {beginGameplayMutation,clientLocalEditBlocked}=await server.ssrLoadModule('/utils/gameplayMutationGate.ts');
  const source=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let effect,setter;
  function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(src)==='useEffect'&&n.arguments[0]?.getText(src).includes('pendingHostSyncNoticesRef.current.splice'))effect=n.arguments[0].getText(src);if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='setUserGameHistory')setter=n.initializer.arguments[0].getText(src);ts.forEachChild(n,visit)}visit(src);assert.ok(effect);assert.ok(setter);
  const js=ts.transpileModule(`const setUserGameHistory=${setter}; const flush=${effect};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const authority=new HostTurnAuthority(()=> 'session'),stamp=authority.issue(),state={networkRole:'host'},pendingHostSyncNoticesRef={current:[{sender:'system',content:'request'}]},hostRestorePendingRef={current:null},gameplayMutationPendingRef={current:false},activeTurnRef={current:Symbol('turn')};let scheduled=[],aborted=0;
  const scope={gameState:state,gameStateRef:{current:state},isLoading:false,activeTurnRef,hostRestorePendingRef,gameplayMutationPendingRef,pendingHostSyncNoticesRef,clientLocalEditBlocked,beginGameplayMutation,gameplayMutationRevisionRef:{current:0},historyMutationRevisionRef:{current:0},historyMutationAppliedRef:{current:0},gameplayMutationAppliedRef:{current:0},turnPhaseRef:{current:'generating'},pendingClientSyncRef:{current:null},pendingNetworkTurnRef:{current:null},clientTurnStampRef:{current:null},hostHistoryHoldRef:{current:null},hostTurnAuthorityRef:{current:authority},setGameHistory:fn=>scheduled.push(fn),setGameplayMutationEpoch:()=>{},abortControllerRef:{current:{abort:()=>aborted++}},mutationMessageRef:{current:{}},setError:()=>{}};
  const run=()=>vm.runInNewContext(`(()=>{${js}\nflush()})()`,scope);run();assert.equal(scheduled.length,0);assert.equal(authority.issue().revision,stamp.revision);assert.equal(aborted,0);
  activeTurnRef.current=null;hostRestorePendingRef.current={};run();assert.equal(scheduled.length,0);hostRestorePendingRef.current=null;
  gameplayMutationPendingRef.current=true;run();assert.equal(scheduled.length,0);gameplayMutationPendingRef.current=false;
  run();assert.equal(scheduled.length,1);assert.equal(pendingHostSyncNoticesRef.current.length,0);assert.equal(authority.issue(),null,'history hold must be in place before scheduled update');assert.equal(aborted,0);assert.deepEqual(Array.from(scheduled[0]([]),x=>x.content),['request']);
 }finally{await server.close()}
});
