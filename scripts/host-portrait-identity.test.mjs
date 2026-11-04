import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
test('host portrait edit keeps displayed owner independent from active turn',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let cb;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='updatePlayerPortrait')cb=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(src);assert.ok(cb);
 const js=ts.transpileModule(`const run=${cb.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const host={playerId:'host',name:'Host',portrait:null},guest={playerId:'guest',name:'Guest',portrait:null},base={networkRole:'host',myPeerId:'host',players:[host,guest],playerCharacter:host,activePlayerIndex:1,imageCache:{}};
 const run=(initial,id)=>{let state=initial;const scope={setGameState:f=>{state=f(state)},console};scope.id=id;vm.runInNewContext(`${js}\nrun(id,{custom:'data:image/png;base64,AA'})`,scope);return state};
 let state=run(base,'guest');assert.equal(state.playerCharacter.playerId,'host');assert.equal(state.players[1].portrait,'custom-portrait-guest');assert.equal(state.players[0].portrait,null);
 state=run(base,'host');assert.equal(state.playerCharacter.portrait,'custom-portrait-host');assert.equal(state.players[0].portrait,state.playerCharacter.portrait);assert.equal(state.players[1].portrait,null);
 const duplicate={...base,players:[host,{...host}]};assert.equal(run(duplicate,'host'),duplicate,'duplicate ID must not update an arbitrary player');
});
