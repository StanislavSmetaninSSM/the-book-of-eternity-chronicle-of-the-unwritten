import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
test('a peer that closes before the queued join cannot appear or be announced',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let cb;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='syncNewPeer'&&n.initializer&&ts.isCallExpression(n.initializer))cb=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(src);assert.ok(cb);
 const js=ts.transpileModule(`const syncNewPeer=${cb.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const state={networkRole:'host',peers:[]},conn={peer:'p',open:true,metadata:{playerName:'Alice'}},connections={current:new Map([['p',conn]])},pendingNewPeersRef={current:new Map()},pendingPeerJoinCommitsRef={current:new Map()},queued=[];let history=[];
 const scope={gameStateRef:{current:state},connectionsRef:connections,hostRestorePendingRef:{current:null},pendingNewPeersRef,pendingPeerJoinCommitsRef,setGameState:update=>queued.push(update),setGameHistory:update=>{history=update(history)},allManagers:{packageSaveData:()=>null,broadcastFullSync:()=>Promise.resolve()},t:k=>k,setError:()=>{},formatError:String,console,conn};
 vm.runInNewContext(`${js}\nsyncNewPeer(conn);`,scope);assert.equal(queued.length,1);assert.equal(history.length,0,'join must not be announced before commit');
 conn.open=false;connections.current.delete('p');assert.equal(queued[0](state),state);assert.equal(history.length,0);
});

test('a peer opening before initial host state waits and drains after a committed state',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let action,effect;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='syncNewPeer'&&n.initializer&&ts.isCallExpression(n.initializer))action=n.initializer.arguments[0];if(ts.isCallExpression(n)&&n.expression.getText(src)==='useEffect'&&n.arguments[0]?.getText(src).includes('pendingPeerJoinCommitsRef.current'))effect=n.arguments[0];ts.forEachChild(n,visit)}visit(src);assert.ok(action);assert.ok(effect);
 const js=ts.transpileModule(`const syncNewPeer=${action.getText(src)}; const drain=${effect.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const conn={peer:'p',open:true,metadata:{playerName:'Alice'}},connections={current:new Map([['p',conn]])},queue={current:new Map()},joins={current:new Map()},ref={current:null};let called=0;
 const scope={conn,gameStateRef:ref,gameState:null,connectionsRef:connections,pendingNewPeersRef:queue,pendingPeerJoinCommitsRef:joins,hostRestorePendingRef:{current:null},gameplayMutationPendingRef:{current:false},syncNewPeerRef:{current:()=>called++},setGameState:()=>{throw Error('must defer until host exists')},setUserGameHistory:()=>{},t:k=>k};
 vm.runInNewContext(`${js}\nsyncNewPeer(conn);`,{...scope});assert.equal(queue.current.get('p'),conn);
 const state={networkRole:'host',peers:[]};ref.current=state;scope.gameState=state;
 vm.runInNewContext(`${js}\ndrain();`,{...scope});assert.equal(queue.current.size,0);assert.equal(called,1);
 queue.current.set('p',conn);conn.open=false;vm.runInNewContext(`${js}\ndrain();`,{...scope});assert.equal(queue.current.size,0);assert.equal(called,1);
});

test('peer connection notice is issued only after its matching committed peer',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let effect;function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(src)==='useEffect'&&n.arguments[0]?.getText(src).includes('pendingPeerJoinCommitsRef.current'))effect=n.arguments[0];ts.forEachChild(n,visit)}visit(src);assert.ok(effect);
 const js=ts.transpileModule(`const drain=${effect.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;const peer={id:'p',name:'Alice'},conn={peer:'p'},state={networkRole:'host',peers:[peer]},pending={current:true};let history=[];
 const scope={gameState:state,gameStateRef:{current:state},gameplayMutationPendingRef:pending,hostRestorePendingRef:{current:null},pendingPeerJoinCommitsRef:{current:new Map([['p',{peer,connection:conn}]])},pendingNewPeersRef:{current:new Map()},connectionsRef:{current:new Map()},syncNewPeerRef:{current:()=>{}},setUserGameHistory:update=>{history=update(history)},t:k=>k};
 vm.runInNewContext(`${js}\ndrain();`,{...scope});assert.equal(history.length,0);pending.current=false;vm.runInNewContext(`${js}\ndrain();`,{...scope});assert.equal(history.length,1);vm.runInNewContext(`${js}\ndrain();`,{...scope});assert.equal(history.length,1);
});
