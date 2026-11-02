import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';import vm from 'node:vm';
test('collective processing cannot mutate a pending host snapshot',async()=>{
 const code=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let cb;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='processCollectiveActions'&&n.initializer&&ts.isCallExpression(n.initializer))cb=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(src);assert.ok(cb);const js=ts.transpileModule(`const processCollectiveActions = ${cb.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const collective={isActive:true,prompt:'act',actions:{p:'one'},initiatorName:'host'},state={networkRole:'host',players:[{playerId:'p',name:'Test'}],collectiveActionState:collective},ctx={collectiveActionState:collective};let sends=0,updates=0,warning=0;
 const scope={gameStateRef:{current:state},gameContextRef:{current:ctx},clientLocalEditBlocked:r=>r==='player'||r==='spectator',userGameplayActionBlocked:()=>{warning++;return true},t:k=>k,setError:()=>{},sendMessageWithStashClear:()=>sends++,setGameState:()=>updates++};
 vm.runInNewContext(`${js}\nprocessCollectiveActions()`,scope);
 assert.equal(state.collectiveActionState,collective);assert.equal(ctx.collectiveActionState,collective);assert.equal(sends,0);assert.equal(updates,0);assert.equal(warning,1);
});
