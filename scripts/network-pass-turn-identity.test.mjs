import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
test('host turn pass does not replace the active guest with the host character',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let callback;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='passTurnToPlayer'&&n.initializer&&ts.isCallExpression(n.initializer))callback=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(src);assert.ok(callback);
 const js=ts.transpileModule(`const run = ${callback.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const host={playerId:'host',name:'Host',inventory:[{existedId:'sword'}]},guest={playerId:'guest',name:'Guest',inventory:[{existedId:'staff'}]};
 let state={networkRole:'host',myPeerId:'host',players:[host,guest],playerCharacter:host,activePlayerIndex:1,encounteredNPCs:[],encounteredFactions:[]},history=[],turn=4;const before=structuredClone(state);
 const ctx={gameSettings:{cooperativeGameType:'FullParty'},turnNumber:4,t:(k,r)=>`${k}:${r.name}`,setPartyTransition:fn=>{const r=fn(state,turn);if(r){state=r.gameState;turn=r.turnNumber;history.push(r.message)}},console:{log(){},warn(){},error(){}},asArray:x=>Array.isArray(x)?x:[]};
 vm.runInNewContext(`${js}\nrun(0)`,ctx);assert.equal(state.activePlayerIndex,0);assert.equal(state.players[0].playerId,'host');assert.equal(state.players[1].playerId,'guest');assert.equal(state.players[1].inventory[0].existedId,'staff');assert.equal(state.playerCharacter.playerId,'host');assert.equal(turn,5);assert.equal(history.length,1);assert.deepEqual(before.players[1],guest);
});

test('turn pass keeps host identity, local switching, shared personality data and rejects ambiguity',async()=>{
 const text=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let cb;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='passTurnToPlayer')cb=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(src);const js=ts.transpileModule(`const run=${cb.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const host={playerId:'host',name:'Host',inventory:[{existedId:'h'}],characteristics:{strength:1},equippedItems:{},activeSkills:[],passiveSkills:[],skillMasteryData:[],knownRecipes:[]},guest={playerId:'guest',name:'Guest',inventory:[{existedId:'g'}],characteristics:{strength:2},equippedItems:{},activeSkills:[],passiveSkills:[],skillMasteryData:[],knownRecipes:[]};
 const run=(state,target,settings={cooperativeGameType:'FullParty'})=>{let current=state,history=0,turn=0;const scope={gameSettings:settings,turnNumber:2,t:k=>k,setPartyTransition:f=>{const result=f(current,2);if(result){current=result.gameState;history++;turn++}},console:{log(){},warn(){},error(){}},asArray:x=>Array.isArray(x)?x:[]};scope.target=target;vm.runInNewContext(`${js}\nrun(target)`,scope);return {current,history,turn}};
 const base={networkRole:'host',myPeerId:'host',players:[host,guest],playerCharacter:host,activePlayerIndex:0,encounteredNPCs:[],encounteredFactions:[]};
 let r=run(base,1);assert.equal(r.current.activePlayerIndex,1);assert.equal(r.current.playerCharacter.playerId,'host');assert.equal(r.current.players[1].inventory[0].existedId,'g');assert.equal(r.history,1);
 r=run({...base,networkRole:'none',myPeerId:null},1);assert.equal(r.current.playerCharacter.playerId,'guest','single player switches displayed character');
 r=run(base,1,{cooperativeGameType:'MultiplePersonalities',multiplePersonalitiesSettings:{shareInventory:true,shareCharacteristics:true,shareNpcReputation:true,shareFactionReputation:true}});assert.equal(r.current.players[1].inventory[0].existedId,'h');assert.equal(r.current.players[1].characteristics.strength,1);assert.equal(r.current.playerCharacter.playerId,'host');
 r=run({...base,players:[host,guest],playerCharacter:{...guest,inventory:[{existedId:'latest-g'}]},activePlayerIndex:1},0);assert.equal(r.current.players[1].inventory[0].existedId,'latest-g');assert.equal(r.current.playerCharacter.playerId,'host');
 for(const state of [{...base,myPeerId:null},{...base,players:[host,{...guest,playerId:'host'}]},{...base,playerCharacter:{...guest,playerId:'unknown'}}]){r=run(state,1);assert.equal(r.current,state);assert.equal(r.history,0);assert.equal(r.turn,0);}
 for(const target of [NaN,Infinity,1.5,-1,2]){r=run(base,target);assert.equal(r.current,base);assert.equal(r.history,0);assert.equal(r.turn,0);}
});
