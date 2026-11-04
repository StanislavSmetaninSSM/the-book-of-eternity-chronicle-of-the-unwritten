import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import vm from 'node:vm';import {readFile} from 'node:fs/promises';

test('file, autosave and slot loads do not restore after a network session begins',async()=>{
 const text=await readFile(new URL('../hooks/logic/saveLoad.ts',import.meta.url),'utf8');const ast=ts.createSourceFile('saveLoad.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);const callbacks={};
 function visit(n){if(ts.isVariableDeclaration(n)&&['loadGame','loadAutosave','loadGameFromSlot'].includes(n.name.getText(ast)))callbacks[n.name.getText(ast)]=n.initializer;ts.forEachChild(n,visit)}visit(ast);
 for(const name of ['loadGame','loadAutosave','loadGameFromSlot']){
  assert.ok(callbacks[name]);const js=ts.transpileModule(`const run = ${callbacks[name].getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  async function run({blocked=false,race=false,empty=false}={}){
   let resolve;const wait=new Promise(r=>resolve=r);let checks=0,restores=0,cleanup=0,reads=0,error=null;
   const beginLocalLoad=()=>{if(blocked){error='blocked';return null}return ()=>{checks++;if(race){error='changed';return false}return true}};
   const scope={beginLocalLoad,gameStateRef:{current:null},cleanupNetwork:()=>cleanup++,loadGameFromFile:()=>{reads++;return wait},loadFromDB:()=>{reads++;return wait},loadFromDBSlot:()=>{reads++;return wait},restoreFromSaveData:()=>restores++,t:k=>k,alert:()=>{},console};
   const pending=vm.runInNewContext(`${js}\nrun(1)`,scope);resolve(empty?null:{});const result=await pending;return {result,checks,restores,cleanup,reads,error};
  }
  let r=await run({blocked:true});assert.equal(r.result,false,name);assert.equal(r.reads,0);assert.equal(r.cleanup,0);assert.equal(r.restores,0);
  r=await run({race:true});assert.equal(r.result,false,name);assert.equal(r.restores,0);assert.equal(r.cleanup,0);assert.equal(r.checks,1);
  r=await run({empty:true});assert.equal(r.result,false,name);assert.equal(r.restores,0);assert.equal(r.cleanup,0);
  r=await run();assert.equal(r.result,true,name);assert.equal(r.restores,1);assert.equal(r.checks,1);
 }
});

test('production load guard observes session and pending mutation changes',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('useGameLogic.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let cb;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='beginLocalLoad'&&n.initializer&&ts.isCallExpression(n.initializer))cb=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(ast);assert.ok(cb);
 const js=ts.transpileModule(`const begin = ${cb.getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const setup=()=>{let error=null;const scope={gameStateRef:{current:null},syncRevisionRef:{current:0},gameplayMutationRevisionRef:{current:0},peerRef:{current:null},hostConnectionRef:{current:null},activeTurnRef:{current:null},hostRestorePendingRef:{current:null},gameplayMutationPendingRef:{current:false},language:'en',setError:e=>error=e};return {scope,getError:()=>error}};
 const changes=[s=>{s.peerRef.current={}},s=>{s.hostConnectionRef.current={}},s=>{s.gameStateRef.current={networkRole:'player'}},s=>{s.gameStateRef.current={networkRole:'spectator'}},s=>{s.gameStateRef.current={networkRole:'host'}},s=>{s.gameStateRef.current={networkRole:'none'}},s=>{s.syncRevisionRef.current++},s=>{s.gameplayMutationRevisionRef.current++},s=>{s.gameplayMutationPendingRef.current=true},s=>{s.activeTurnRef.current=Symbol()},s=>{s.hostRestorePendingRef.current={}}];
 for(const change of changes){const {scope,getError}=setup();const check=vm.runInNewContext(`${js}\nbegin()`,scope);assert.equal(typeof check,'function');change(scope);assert.equal(check(),false);assert.ok(getError());}
 for(const role of ['host','player','spectator']){const {scope,getError}=setup();scope.gameStateRef.current={networkRole:role};assert.equal(vm.runInNewContext(`${js}\nbegin()`,scope),null);assert.ok(getError());}
 const {scope}=setup();const check=vm.runInNewContext(`${js}\nbegin()`,scope);assert.equal(check(),true);assert.match(text,/setDbSaveSlots, beginLocalLoad, setIsSaving/);
});
