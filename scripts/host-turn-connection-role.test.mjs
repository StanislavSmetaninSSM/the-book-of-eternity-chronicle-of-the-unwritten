import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';import vm from 'node:vm';
test('both host entry points reject turn results from spectator or unknown connection roles',async()=>{
 const source=await readFile(new URL('../hooks/logic/multiplayer.ts',import.meta.url),'utf8'),src=ts.createSourceFile('network.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),handlers=[];
 function visit(n){if(ts.isCallExpression(n)&&n.arguments.length===2&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text==='data'&&ts.isArrowFunction(n.arguments[1]))handlers.push(n.arguments[1]);ts.forEachChild(n,visit)}visit(src);assert.equal(handlers.length,3);
 for(const handler of [handlers[0],handlers[2]]){
  const js=ts.transpileModule(`const onData=${handler.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const conn={peer:'p',open:true,metadata:{role:'spectator'}},connectionsRef={current:new Map([['p',conn]])};let accepted=0,acks=[];
  const scope={conn,connectionsRef,gameStateRef:{current:{}},restoreFromSaveData:()=>{},broadcastFullSync:()=>{},setError:()=>{},setGameHistory:()=>{},t:k=>k,hostTurnAuthority:{},activeTurnRef:{current:null},gameplayMutationPendingRef:{current:false},applyPlayerTurnResult:()=>{accepted++;return Promise.resolve()},sendOnOpenConnection:(_conn,msg)=>{acks.push(msg);return Promise.resolve()},console:{log:()=>{},warn:()=>{}}};
  const send=()=>vm.runInNewContext(`${js}\nonData(data);`,{...scope,data:{type:'turn_result_from_player',senderId:'p',payload:{submission:{turnId:'turn-123'}}}});
  send();assert.equal(accepted,0);assert.equal(acks.at(-1).payload.status,'unauthorized');assert.equal(acks.at(-1).payload.turnId,'turn-123');
  conn.metadata={};send();assert.equal(accepted,0);assert.equal(acks.at(-1).payload.status,'unauthorized');
  conn.metadata.role='player';send();assert.equal(accepted,1);
  connectionsRef.current.set('p',{peer:'p',open:true});send();assert.equal(accepted,1,'obsolete connection must remain ignored');
 }
});
