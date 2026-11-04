import {captureTurnSubmissionIdentity, sameTurnSubmissionIdentity} from './test-utils/turn-submission-helper.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';import vm from 'node:vm';

test('pending turn or question cannot start after session identity changes without a sync revision',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),cbs={};
 function visit(n){if(ts.isVariableDeclaration(n)&&['sendMessageWithStashClear','askQuestionWithRecovery'].includes(n.name.getText(src))&&n.initializer&&ts.isCallExpression(n.initializer))cbs[n.name.getText(src)]=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(src);
 for(const name of Object.keys(cbs)){
  const js=ts.transpileModule(`const run = ${cbs[name].getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  for(const change of [s=>{s.gameStateRef.current={...s.gameStateRef.current,networkRole:'none'}},s=>{s.gameStateRef.current={...s.gameStateRef.current,myPeerId:'other'}},s=>{s.gameStateRef.current={...s.gameStateRef.current,activePlayerIndex:1}},s=>{s.hostConnectionRef.current={open:true}},s=>{s.hostConnectionRef.current.open=false},s=>{s.clientTurnStampRef.current={version:1,sessionId:'new',revision:1}}]){
   let resolve,sent=0,error=null;const wait=new Promise(r=>resolve=r);const state={networkRole:'player',myPeerId:'p',hostPeerId:'h',players:[{playerId:'p'},{playerId:'q'}],activePlayerIndex:0};
   const scope={captureTurnSubmissionIdentity,sameTurnSubmissionIdentity,gameStateRef:{current:state},hostConnectionRef:{current:{open:true}},clientTurnStampRef:{current:{version:1,sessionId:'s',revision:1}},beginTurnSubmission:()=>true,syncRevisionRef:{current:0},gameplayMutationRevisionRef:{current:0},gameplayMutationPendingRef:{current:false},hostRestorePendingRef:{current:null},isTurnSubmitPendingRef:{current:true},savePreActionCrashRecovery:()=>wait,allManagers:{sendMessage:()=>sent++,askQuestion:()=>sent++},passTurnManually:()=>sent++,t:k=>k,setError:e=>error=e};
   const pending=vm.runInNewContext(`${js}\nrun('message')`,scope);change(scope);resolve();await pending;assert.equal(sent,0,name);assert.equal(scope.isTurnSubmitPendingRef.current,false);assert.equal(error,'turn_session_changed_before_start');
  }
 }
});

test('submission identity tolerates presentation changes but detects grant mutation',()=>{
 const p={networkRole:'player',myPeerId:'p',hostPeerId:'h',players:[{playerId:'p'}],activePlayerIndex:0};const conn={open:true},stamp={version:1,sessionId:'s',revision:1};
 const before=captureTurnSubmissionIdentity(p,stamp,conn);
 assert.equal(sameTurnSubmissionIdentity(before,captureTurnSubmissionIdentity({...p,imageCache:{x:'new'}},stamp,conn)),true);
 stamp.revision=2;assert.equal(sameTurnSubmissionIdentity(before,captureTurnSubmissionIdentity(p,stamp,conn)),false);
 const host={...p,networkRole:'host'};assert.equal(sameTurnSubmissionIdentity(captureTurnSubmissionIdentity(host,null,{}),captureTurnSubmissionIdentity({...host,imageCache:{}},null,{})),true);
});
