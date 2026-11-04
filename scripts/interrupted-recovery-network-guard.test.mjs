import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('interrupted turn recovery does not overwrite a network session after asynchronous work', async () => {
 const text = await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');
 const source = ts.createSourceFile('useGameLogic.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 let callback;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='resumeInterruptedGameTurn'&&n.initializer&&ts.isCallExpression(n.initializer))callback=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(source);assert.ok(callback);
 const js=ts.transpileModule(`const run = ${callback.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const recovery={baseState:{networkRole:'none'},context:{},history:[]};
 const run=async ({initial=null, duringRead, duringCancel, saved=recovery}={})=>{
  let loadResolve,cancelResolve,reads=0,cancels=0,clears=0,resumes=0,error=null;
  const load=new Promise(r=>loadResolve=r),cancel=new Promise(r=>cancelResolve=r);
  const scope={interruptedTurnRecovery:null,loadInterruptedTurnRecovery:()=>{reads++;return load},cancelInterruptedArenaGmRequest:()=>{cancels++;return cancel},setInterruptedTurnRecovery:()=>clears++,setError:e=>{error=e},language:'en',allManagers:{resumeInterruptedTurn:()=>{resumes++}},gameStateRef:{current:initial},peerRef:{current:null},hostConnectionRef:{current:null},syncRevisionRef:{current:0},gameplayMutationRevisionRef:{current:0},gameplayMutationPendingRef:{current:false},activeTurnRef:{current:null},isTurnSubmitPendingRef:{current:false},hostRestorePendingRef:{current:null}};
  const pending=vm.runInNewContext(`${js}\nrun()`,scope);
  if(duringRead)duringRead(scope);loadResolve(saved);await new Promise(r=>setImmediate(r));
  if(duringCancel)duringCancel(scope);cancelResolve();const result=await pending;
  return {result,reads,cancels,clears,resumes,error};
 };
 for(const role of ['player','spectator','host']){
  let r=await run({initial:{networkRole:role}});assert.equal(r.result,false);assert.equal(r.reads,0);assert.equal(r.resumes,0);assert.ok(r.error);
  for(const phase of ['duringRead','duringCancel']){r=await run({[phase]:s=>{s.gameStateRef.current={networkRole:role}}});assert.equal(r.result,false,`${role} ${phase}`);assert.equal(r.resumes,0);assert.equal(r.clears,0);assert.ok(r.error);}
 }
 for(const change of [s=>{s.peerRef.current={}},s=>{s.hostConnectionRef.current={}},s=>{s.syncRevisionRef.current++},s=>{s.gameplayMutationRevisionRef.current++},s=>{s.gameplayMutationPendingRef.current=true},s=>{s.activeTurnRef.current=Symbol('turn')},s=>{s.isTurnSubmitPendingRef.current=true},s=>{s.hostRestorePendingRef.current={}}]){
  for(const phase of ['duringRead','duringCancel']){const r=await run({[phase]:change});assert.equal(r.result,false);assert.equal(r.clears,0);assert.equal(r.resumes,0);assert.ok(r.error);}
 }
 const netCheckpoint=await run({saved:{baseState:{networkRole:'player'}}});assert.equal(netCheckpoint.cancels,0);assert.equal(netCheckpoint.result,false);
 const ok=await run();assert.equal(ok.result,true);assert.equal(ok.resumes,1);assert.equal(ok.clears,1);
});

test('the raw turn manager recovery is not exposed without a current-session guard', async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');
 const source=ts.createSourceFile('useGameLogic.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let callback;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='resumeInterruptedTurnSafely'&&n.initializer&&ts.isCallExpression(n.initializer))callback=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(source);assert.ok(callback,'safe public wrapper');
 const js=ts.transpileModule(`const run = ${callback.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 for(const role of ['none','host','player','spectator']){
  let calls=0,error=null;const scope={gameStateRef:{current:{networkRole:role}},peerRef:{current:null},hostConnectionRef:{current:null},activeTurnRef:{current:null},isTurnSubmitPendingRef:{current:false},hostRestorePendingRef:{current:null},gameplayMutationPendingRef:{current:false},language:'en',setError:e=>error=e,allManagers:{resumeInterruptedTurn:()=>calls++}};
  vm.runInNewContext(`${js}\nrun({baseState:{networkRole:'none'}})`,scope);
  assert.equal(calls,role==='none'?1:0);if(role!=='none')assert.ok(error);
 }
 for(const [change, checkpointRole] of [
  [s=>{s.peerRef.current={}}, 'none'], [s=>{s.hostConnectionRef.current={}}, 'none'],
  [s=>{s.activeTurnRef.current=Symbol('turn')}, 'none'], [s=>{s.isTurnSubmitPendingRef.current=true}, 'none'], [s=>{s.hostRestorePendingRef.current={}}, 'none'],
  [s=>{s.gameplayMutationPendingRef.current=true}, 'none'], [()=>{}, 'player'], [()=>{}, 'spectator'], [()=>{}, 'host']
 ]) {
  let calls=0,error=null;const scope={gameStateRef:{current:null},peerRef:{current:null},hostConnectionRef:{current:null},activeTurnRef:{current:null},isTurnSubmitPendingRef:{current:false},hostRestorePendingRef:{current:null},gameplayMutationPendingRef:{current:false},language:'en',setError:e=>error=e,allManagers:{resumeInterruptedTurn:()=>calls++}};
  change(scope);scope.checkpointRole=checkpointRole;vm.runInNewContext(`${js}\nrun({baseState:{networkRole:checkpointRole}})`,scope);assert.equal(calls,0);assert.ok(error);
 }
 assert.match(text,/resumeInterruptedTurn:\s*resumeInterruptedTurnSafely/);
});
