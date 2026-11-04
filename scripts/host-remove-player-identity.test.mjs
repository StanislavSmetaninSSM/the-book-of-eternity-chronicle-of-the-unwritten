import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
test('removing another player does not replace the host displayed character',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let cb;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='removePlayer')cb=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(src);const js=ts.transpileModule(`const run=${cb.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const host={playerId:'host',name:'Host'},a={playerId:'a',name:'A'},b={playerId:'b',name:'B'};const base={networkRole:'host',myPeerId:'host',players:[host,a,b],playerCharacter:host,activePlayerIndex:2};
 const run=(initial,id)=>{let state=initial,history=[];const scope={id,gameStateRef:{current:state},userGameplayActionBlocked:()=>false,setError:()=>{},setPartyTransition:f=>{const r=f(state,0);if(r){state=r.gameState;history.push(r.message)}},t:(key,r)=>`${key}:${r?.name || ""}`};vm.runInNewContext(`${js}\nrun(id)`,scope);return {state,history}};
 let r=run(base,'a');assert.equal(r.state.playerCharacter.playerId,'host');assert.equal(r.state.activePlayerIndex,1);assert.equal(r.state.players[1].playerId,'b');assert.equal(r.history.length,1);
 r=run(base,'host');assert.equal(r.state,base);assert.equal(r.history.length,0);
 const duplicate={...base,players:[host,a,{...a}]};r=run(duplicate,'a');assert.equal(r.state,duplicate);assert.equal(r.history.length,0);
 r=run({...base,networkRole:'none',myPeerId:null,playerCharacter:b},'a');assert.equal(r.state.playerCharacter.playerId,'b');
});
