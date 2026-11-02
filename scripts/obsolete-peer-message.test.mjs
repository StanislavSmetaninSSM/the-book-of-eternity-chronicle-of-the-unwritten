import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';import vm from 'node:vm';
test('stale peer connections cannot deliver gameplay or chat messages',async()=>{
 const text=await readFile(new URL('../hooks/logic/multiplayer.ts',import.meta.url),'utf8'),src=ts.createSourceFile('multiplayer.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);const callbacks=[];function visit(n){if(ts.isCallExpression(n)&&n.arguments.length===2&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text==='data'&&ts.isArrowFunction(n.arguments[1]))callbacks.push(n.arguments[1]);ts.forEachChild(n,visit)}visit(src);assert.equal(callbacks.length,3);
 const old={peer:'p',open:true,send:()=>{}},replacement={peer:'p',open:true,send:()=>{}},hostRef={current:replacement},connections={current:new Map([['p',replacement]])};let received=0;
 for(const cb of callbacks){const js=ts.transpileModule(`const onData = ${cb.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;const scope={conn:old,hostConnectionRef:hostRef,connectionsRef:connections,onChatMessage:()=>received++,console:{log:()=>{}},data:{type:'chat_message',payload:{content:'test'}}};vm.runInNewContext(`${js}\nonData(data);`,scope);assert.equal(received,0,'stale connection was processed');scope.conn=replacement;vm.runInNewContext(`${js}\nonData(data);`,{...scope});assert.equal(received,1);received=0;
 for (const malformed of [null, [], 'invalid', {}, {type:3}]) {vm.runInNewContext(`${js}\nonData(data);`,{...scope,data:malformed});assert.equal(received,0);}
 replacement.open=false;vm.runInNewContext(`${js}\nonData(data);`,{...scope});assert.equal(received,0);replacement.open=true;
 }
});
