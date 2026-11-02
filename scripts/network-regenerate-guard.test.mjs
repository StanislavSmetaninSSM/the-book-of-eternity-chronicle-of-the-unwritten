import {test} from 'node:test'; import assert from 'node:assert/strict'; import ts from 'typescript'; import {readFile} from 'node:fs/promises'; import vm from 'node:vm';
test('regenerate cannot silently turn a network game into a local save',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'); const source=ts.createSourceFile('useGameLogic.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let callback;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='regenerateLastResponse'&&n.initializer&&ts.isCallExpression(n.initializer))callback=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(source);assert.ok(callback);
 const js=ts.transpileModule(`const regenerateLastResponse = ${callback.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 for(const role of ['host','player','spectator','none']){let restored=0,error=null;const ctx={lastTurnSaveFile:{},gameStateRef:{current:{networkRole:role}},restoreFromSaveData:()=>restored++,setError:x=>error=x,t:k=>k,formatError:String};const result=await vm.runInNewContext(`${js}\nregenerateLastResponse();`,ctx); if(role==='none'){assert.equal(result,true);assert.equal(restored,1);}else{assert.equal(result,false);assert.equal(restored,0);assert.equal(error,'network_regeneration_unsupported');}}
});
