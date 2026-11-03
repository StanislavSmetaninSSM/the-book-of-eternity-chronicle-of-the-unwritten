import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';import vm from 'node:vm';
test('queued disconnect cannot remove or announce a peer that has reconnected',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let cb;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='handlePeerDisconnected'&&n.initializer&&ts.isCallExpression(n.initializer))cb=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(src);assert.ok(cb);const js=ts.transpileModule(`const handlePeerDisconnected=${cb.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const state={networkRole:'host',peers:[{id:'p',name:'Peer'}]},connectionsRef={current:new Map()},queued=[],pendingPeerDisconnectCommitsRef={current:new Map()};let history=[];
 const scope={gameStateRef:{current:state},connectionsRef,hostRestorePendingRef:{current:null},pendingRemovedPeersRef:{current:new Set()},pendingPeerDisconnectCommitsRef,setGameState:update=>queued.push(update),setGameHistory:update=>{history=update(history)},t:k=>k};
 vm.runInNewContext(`${js}\nhandlePeerDisconnected('p');`,scope);assert.equal(queued.length,1);connectionsRef.current.set('p',{peer:'p',open:true});
 assert.equal(queued[0](state),state);assert.equal(history.length,0);
});

test('disconnect notice waits for committed removal and is suppressed on reconnect',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let effect;function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(src)==='useEffect'&&n.arguments[0]?.getText(src).includes('pendingPeerDisconnectCommitsRef.current'))effect=n.arguments[0];ts.forEachChild(n,visit)}visit(src);assert.ok(effect);const js=ts.transpileModule(`const publish=${effect.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 for(const reconnect of [false,true]){
  const state={networkRole:'host',peers:[]},ref={current:state},pending={current:true},connections={current:new Map()},notices={current:new Map([['p',{id:'p',name:'Peer'}]])};let history=[];
  const scope={gameState:state,gameStateRef:ref,gameplayMutationPendingRef:pending,hostRestorePendingRef:{current:null},pendingPeerJoinCommitsRef:{current:new Map()},pendingPeerDisconnectCommitsRef:notices,pendingNewPeersRef:{current:new Map()},connectionsRef:connections,syncNewPeerRef:{current:()=>{}},setUserGameHistory:update=>{history=update(history)},t:k=>k};
  vm.runInNewContext(`${js}\npublish();`,{...scope});assert.equal(notices.current.size,1);assert.equal(history.length,0);
  pending.current=false;if(reconnect)connections.current.set('p',{peer:'p',open:true});vm.runInNewContext(`${js}\npublish();`,{...scope});assert.equal(history.length,reconnect?0:1);assert.equal(notices.current.size,0);
 }
});
