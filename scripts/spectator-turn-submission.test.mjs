import {captureTurnSubmissionIdentity, sameTurnSubmissionIdentity} from './test-utils/turn-submission-helper.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import vm from 'node:vm';import {readFile} from 'node:fs/promises';

test('spectator cannot begin a turn or question, including role change while awaiting recovery',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),cbs={};
 function visit(n){if(ts.isVariableDeclaration(n)&&['beginTurnSubmission','sendMessageWithStashClear','askQuestionWithRecovery'].includes(n.name.getText(src))&&n.initializer&&ts.isCallExpression(n.initializer))cbs[n.name.getText(src)]=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(src);
 const build=name=>ts.transpileModule(`const ${name} = ${cbs[name].getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 let error;const scope={hasBlockingClientIntent:()=>false,isTurnSubmitPendingRef:{current:false},isLoading:false,activeTurnRef:{current:null},gameStateRef:{current:{networkRole:'spectator'}},gameContextRef:{current:{}},hostRestorePendingRef:{current:null},gameplayMutationPendingRef:{current:false},clientTurnStampRef:{current:{}},hostConnectionRef:{current:null},t:k=>k,setError:e=>error=e};
 assert.equal(vm.runInNewContext(`(()=>{${build('beginTurnSubmission')}\nreturn beginTurnSubmission()})()`,scope),false);assert.equal(error,'spectator_cannot_submit_turn');assert.equal(scope.isTurnSubmitPendingRef.current,false);
 scope.gameStateRef.current={networkRole:'player'};error=null;assert.equal(vm.runInNewContext(`(()=>{${build('beginTurnSubmission')}\nreturn beginTurnSubmission()})()`,scope),false);assert.equal(error,'network_sync_not_ready');
 scope.hostConnectionRef.current={open:true};error=null;assert.equal(vm.runInNewContext(`(()=>{${build('beginTurnSubmission')}\nreturn beginTurnSubmission()})()`,scope),true);assert.equal(error,null);
 for(const name of ['sendMessageWithStashClear','askQuestionWithRecovery']){
  let resolve,invocations=0;const wait=new Promise(r=>resolve=r);error=null;
  const c={captureTurnSubmissionIdentity,sameTurnSubmissionIdentity,clientTurnStampRef:{current:null},hostConnectionRef:{current:null},gameStateRef:{current:{networkRole:'player'}},beginTurnSubmission:()=>true,syncRevisionRef:{current:0},gameplayMutationRevisionRef:{current:0},gameplayMutationPendingRef:{current:false},hostRestorePendingRef:{current:null},isTurnSubmitPendingRef:{current:true},savePreActionCrashRecovery:()=>wait,allManagers:{sendMessage:()=>invocations++,askQuestion:()=>invocations++},passTurnManually:()=>invocations++,t:k=>k,setError:e=>error=e};
  const pending=vm.runInNewContext(`${build(name)}\n${name}('test')`,c);c.gameStateRef.current={networkRole:'spectator'};resolve();await pending;assert.equal(invocations,0,name);assert.equal(c.isTurnSubmitPendingRef.current,false);assert.equal(error,'spectator_cannot_submit_turn');
 }
});

test('low-level turn manager rejects spectators before history or GM side effects',async()=>{
 const text=await readFile(new URL('../hooks/logic/turn.ts',import.meta.url),'utf8'),src=ts.createSourceFile('turn.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),cbs={};
 function visit(n){if(ts.isVariableDeclaration(n)&&['sendMessage','askQuestion'].includes(n.name.getText(src)))cbs[n.name.getText(src)]=n.initializer;ts.forEachChild(n,visit)}visit(src);
 for(const name of ['sendMessage','askQuestion']){
  let error=null,sideEffects=0;const js=ts.transpileModule(`const run = ${cbs[name].getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const scope={isLoading:false,activeTurnRef:{current:null},gameStateRef:{current:{networkRole:'spectator'}},gameContextRef:{current:{}},hostRestorePendingRef:{current:null},gameplayMutationPendingRef:{current:false},clientTurnStampRef:{current:{}},t:k=>k,setError:e=>error=e,setGameHistory:()=>sideEffects++,handleTurn:()=>sideEffects++,packageSaveDataForTurn:()=>{sideEffects++;return null},setLastTurnSaveFile:()=>sideEffects++};
  await vm.runInNewContext(`${js}\nrun('hello')`,scope);assert.equal(error,'spectator_cannot_submit_turn',name);assert.equal(sideEffects,0);
 }
});
