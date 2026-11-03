import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('network character is not added or announced if its connection disappears before the state updater',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let cb;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='addPlayer'&&n.initializer&&ts.isCallExpression(n.initializer))cb=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(src);assert.ok(cb);
 const js=ts.transpileModule(`const addPlayer=${cb.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const state={networkRole:'host',playerCharacter:{level:1},players:[]},conn={peer:'p',open:true,metadata:{role:'player'}},connections={current:new Map([['p',conn]])},pendingPeerCharacterCommitsRef={current:new Map()},pendingPeerCharacterIdsRef={current:new Set()},queued=[];let history=[];
 const scope={gameSettings:{},gameStateRef:{current:state},connectionsRef:connections,hostRestorePendingRef:{current:null},pendingPeerCharactersRef:{current:new Map()},pendingPeerCharacterIdsRef,pendingPeerCharacterCommitsRef,userGameplayActionBlocked:()=>false,createNewPlayerCharacter:()=>{},setGameState:update=>queued.push(update),setGameHistory:update=>{history=update(history)},t:k=>k,conn};
 vm.runInNewContext(`${js}\naddPlayer({playerId:'p',name:'Peer'},conn);`,scope);assert.equal(queued.length,1);assert.equal(history.length,0,'must not announce before commit');
 conn.open=false;connections.current.delete('p');const result=queued[0](state);assert.equal(result,state);assert.equal(result.players.length,0);assert.equal(history.length,0);
});

test('join notice waits for committed character and the gameplay barrier',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let effect;
 function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(src)==='useEffect'&&n.arguments[0]?.getText(src).includes('pendingPeerCharacterCommitsRef.current'))effect=n.arguments[0];ts.forEachChild(n,visit)}visit(src);assert.ok(effect);
 const js=ts.transpileModule(`const publish=${effect.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const player={playerId:'p',name:'Peer'},connection={peer:'p',open:true},state={networkRole:'host',players:[player]},pending={current:true},scope={gameState:state,gameStateRef:{current:state},gameplayMutationPendingRef:pending,pendingPeerCharacterCommitsRef:{current:new Map([['p',{player,connection}]])},pendingPeerCharacterIdsRef:{current:new Set(['p'])},t:k=>k};let history=[];scope.setUserGameHistory=update=>{history=update(history)};
 vm.runInNewContext(`${js}\npublish();`,{...scope});assert.equal(history.length,0);assert.equal(scope.pendingPeerCharacterCommitsRef.current.size,1);
 pending.current=false;vm.runInNewContext(`${js}\npublish();`,{...scope});assert.equal(history.length,1);assert.equal(scope.pendingPeerCharacterCommitsRef.current.size,0);assert.equal(scope.pendingPeerCharacterIdsRef.current.size,0);
 vm.runInNewContext(`${js}\npublish();`,{...scope});assert.equal(history.length,1,'no duplicate notice');
 const absent={networkRole:'host',players:[]};scope.gameState=absent;scope.gameStateRef.current=absent;scope.pendingPeerCharacterCommitsRef.current.set('p',{player,connection});vm.runInNewContext(`${js}\npublish();`,{...scope});assert.equal(history.length,1,'no notice when the updater was rejected');
});
