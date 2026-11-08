import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import vm from 'node:vm';import {readFile} from 'node:fs/promises';

test('discard checks active sessions and does not clear a replaced checkpoint',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let callback;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='discardInterruptedGameTurn'&&n.initializer&&ts.isCallExpression(n.initializer))callback=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(src);assert.ok(callback);
 const js=ts.transpileModule(`const run = ${callback.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const record={id:'pending-turn',checkpointId:'old',baseState:{}};
 async function run({initial=null,duringRead,duringCancel,conflict=false}={}){
  let releaseRead,releaseCancel,reads=0,cancels=0,deletes=0,clears=0,error=null;const read=new Promise(r=>releaseRead=r),cancel=new Promise(r=>releaseCancel=r);
  const scope={gameStateRef:{current:initial},peerRef:{current:null},hostConnectionRef:{current:null},syncRevisionRef:{current:0},gameplayMutationRevisionRef:{current:0},gameplayMutationPendingRef:{current:false},isTurnSubmitPendingRef:{current:false},activeTurnRef:{current:null},hostRestorePendingRef:{current:null},interruptedTurnRecovery:null,loadInterruptedTurnRecovery:()=>{reads++;return read},cancelInterruptedArenaGmRequest:()=>{cancels++;return cancel},clearInterruptedTurnRecovery:()=>{deletes++;return Promise.resolve()},clearInterruptedTurnRecoveryIfUnchanged:()=>{deletes++;return Promise.resolve(!conflict)},setInterruptedTurnRecovery:()=>clears++,setError:e=>error=e,language:'en',formatError:String};
  const p=vm.runInNewContext(`${js}\nrun()`,scope);if(duringRead)duringRead(scope);releaseRead(record);await new Promise(r=>setImmediate(r));if(duringCancel)duringCancel(scope);releaseCancel();await p;return {reads,cancels,deletes,clears,error};
 }
 for(const phase of ['duringRead','duringCancel'])for(const change of [s=>{s.gameStateRef.current={players:[]}},s=>{s.activeTurnRef.current=Symbol('turn')},s=>{s.syncRevisionRef.current++}]){const r=await run({[phase]:change});assert.equal(r.deletes,0);assert.equal(r.clears,0);assert.ok(r.error);}
 const changed=await run({conflict:true});assert.equal(changed.deletes,1);assert.equal(changed.clears,0);assert.ok(changed.error);
 const ok=await run();assert.equal(ok.cancels,1);assert.equal(ok.deletes,1);assert.equal(ok.clears,1);
});
