import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('crash recovery never replaces an active network session or restores a client checkpoint locally', async () => {
  const text = await readFile(new URL('../hooks/useGameLogic.ts', import.meta.url), 'utf8');
  const source = ts.createSourceFile('hook.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let callback;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === 'loadCrashRecovery' && n.initializer && ts.isCallExpression(n.initializer)) callback = n.initializer.arguments[0];
    ts.forEachChild(n, visit);
  }
  visit(source); assert.ok(callback);
  const js = ts.transpileModule(`const run = ${callback.getText(source)};`, {compilerOptions: {target: ts.ScriptTarget.ES2020}}).outputText;
  const execute = async ({initial = null, metadata = null, data = {gameState: {networkRole:'none'}}, transition, peer = false, afterRead} = {}) => {
    let reads = 0, restored = 0, marks = 0, error = null, release;
    const wait = new Promise(resolve => { release = resolve; });
    const stateRef = {current: initial};
    const scope = {gameStateRef:stateRef, peerRef:{current:peer ? {} : null}, hostConnectionRef:{current:null}, syncRevisionRef:{current:0}, getCrashRecoveryMetadata:()=>metadata, markCrashRecoveryAttempt:()=>{marks++;return null}, setCrashRecoveryMarker:()=>{}, loadCrashRecoveryPoint:()=>{reads++;return wait}, restoreFromSaveData:()=>{restored++}, setError:e=>{error=e}, language:'en', formatError:String};
    const pending = vm.runInNewContext(`${js}\nrun()`,scope);
    if (transition !== undefined) stateRef.current = transition;
    if (afterRead) afterRead(scope);
    release(data);
    const result = await pending;
    return {result,reads,restored,marks,error};
  };
  for (const role of ['player','spectator','host']) {
    const r = await execute({initial:{networkRole:role}});
    assert.equal(r.result,false,role);assert.equal(r.reads,0);assert.equal(r.restored,0);assert.ok(r.error);
    const race = await execute({transition:{networkRole:role}});
    assert.equal(race.result,false,`${role} joined during read`);assert.equal(race.restored,0);assert.ok(race.error);
  }
  for (const role of ['player','spectator']) {
    const r = await execute({metadata:{networkRole:role}});assert.equal(r.result,false);assert.equal(r.reads,0);assert.equal(r.marks,0);
    const stale = await execute({metadata:null,data:{gameState:{networkRole:role}}});assert.equal(stale.result,false);assert.equal(stale.restored,0);assert.ok(stale.error);
  }
  const peerActive = await execute({peer:true}); assert.equal(peerActive.reads,0); assert.equal(peerActive.result,false);
  for (const afterRead of [s => { s.peerRef.current = {}; }, s => { s.hostConnectionRef.current = {}; }, s => { s.syncRevisionRef.current++; }]) {
    const r = await execute({afterRead}); assert.equal(r.result,false); assert.equal(r.restored,0); assert.ok(r.error);
  }
  const changedLocal = await execute({initial:{networkRole:'none'},transition:{networkRole:'none'}}); assert.equal(changedLocal.result,false); assert.equal(changedLocal.restored,0);
  assert.equal((await execute()).restored,1);
  assert.equal((await execute({metadata:{networkRole:'host'},data:{gameState:{networkRole:'host'}}})).restored,1);
});
