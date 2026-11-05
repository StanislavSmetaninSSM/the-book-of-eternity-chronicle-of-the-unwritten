import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('pending checkpoint blocks duplicate local submissions and rejects changed gameplay, not presentation',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');
 const source=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let callback;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='runLocalSubmission')callback=n.initializer.arguments[0].getText(source);ts.forEachChild(n,visit)}visit(source);assert.ok(callback);
 const js=ts.transpileModule(`this.run = ${callback}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 for(const scenario of ['unchanged','presentation','edit','restore']){
  let release, calls=0,error;const gate=new Promise(r=>release=r);
  const scope={isTurnSubmitPendingRef:{current:false},isLoading:false,activeTurnRef:{current:null},gameStateRef:{current:{name:'before'}},gameContextRef:{current:{}},gameplayMutationPendingRef:{current:false},syncRevisionRef:{current:0},gameplayMutationRevisionRef:{current:0},savePreActionCrashRecovery:()=>gate,setError:e=>error=e,t:k=>k,passTurnManually:()=>{},allManagers:{sendMessage:async()=>{calls++;},askQuestion:async()=>{calls++;}}};
  vm.runInNewContext(js,scope);const task=scope.run('action','look');assert.equal(await scope.run('action','duplicate'),false);assert.equal(calls,0);
  if(scenario==='presentation')scope.gameStateRef.current={name:'before',imageCache:{}};
  if(scenario==='edit')scope.gameplayMutationRevisionRef.current++;
  if(scenario==='restore')scope.syncRevisionRef.current++;
  release();assert.equal(await task, scenario==='unchanged'||scenario==='presentation'); await new Promise(r=>setImmediate(r));assert.equal(calls,scenario==='unchanged'||scenario==='presentation'?1:0);assert.equal(scope.isTurnSubmitPendingRef.current,false);
  if(scenario==='edit'||scenario==='restore')assert.equal(error,'turn_game_state_changed');
 }
});

test('accepted submission remains locked until its turn finishes',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');const source=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let callback;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='runLocalSubmission')callback=n.initializer.arguments[0].getText(source);ts.forEachChild(n,visit)}visit(source);
 const js=ts.transpileModule(`this.run = ${callback}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;let finish,calls=0;
 const scope={isTurnSubmitPendingRef:{current:false},isLoading:false,activeTurnRef:{current:null},gameStateRef:{current:{}},gameContextRef:{current:{}},gameplayMutationPendingRef:{current:false},syncRevisionRef:{current:0},gameplayMutationRevisionRef:{current:0},savePreActionCrashRecovery:async()=>{},setError:()=>{},formatError:String,t:k=>k,passTurnManually:()=>{},allManagers:{sendMessage:()=>{calls++;return new Promise(r=>finish=r)},askQuestion:()=>{calls++;return new Promise(r=>finish=r)}}};
 vm.runInNewContext(js,scope);assert.equal(await scope.run('question','why'),true);assert.equal(await scope.run('action','duplicate'),false);assert.equal(calls,1);finish();await new Promise(r=>setImmediate(r));assert.equal(scope.isTurnSubmitPendingRef.current,false);
});
