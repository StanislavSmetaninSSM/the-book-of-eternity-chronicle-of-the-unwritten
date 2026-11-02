import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('blocked addPlayer has no false history side effects', async () => {
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');
 const source=ts.createSourceFile('useGameLogic.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 let callback;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='addPlayer'&&n.initializer&&ts.isCallExpression(n.initializer)) callback=n.initializer.arguments[0]; ts.forEachChild(n,visit)}visit(source);
 assert.ok(callback);const js=ts.transpileModule(`const addPlayer = ${callback.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 let history=[];let state={networkRole:'player',playerCharacter:{level:1},players:[]};let warnings=0;
 const sandbox={gameSettings:{}, gameStateRef:{current:state},createNewPlayerCharacter:()=>{throw Error('unexpected creation')}, userGameplayActionBlocked:()=>{warnings++;return true},setGameState:()=>{},setGameHistory:update=>{history=update(history)},t:k=>k};
 vm.runInNewContext(`${js}\naddPlayer({playerId:'other'});`,sandbox);
 assert.equal(warnings,1);assert.deepEqual(history,[]);
 let hostState={networkRole:'host',playerCharacter:{level:1},players:[]};let hostHistory=[];
 const host={gameSettings:{},gameStateRef:{current:hostState},createNewPlayerCharacter:()=>{throw Error('unexpected creation')},userGameplayActionBlocked:()=>false,setGameState:update=>{hostState=update(hostState)},setGameHistory:update=>{hostHistory=update(hostHistory)},t:k=>k};
 vm.runInNewContext(`${js}\naddPlayer({playerId:'new-peer'});`,host);
 assert.equal(hostState.players[0].playerId,'new-peer');assert.equal(hostHistory.length,1);
});
