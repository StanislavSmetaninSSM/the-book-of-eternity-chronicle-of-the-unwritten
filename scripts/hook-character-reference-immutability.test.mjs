import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';

test('exported hook wound and custom-state callbacks preserve the prior shared character',async()=>{
 const source=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');const file=ts.createSourceFile('hook.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),callbacks={};
 const names=['forgetHealedWound','clearAllHealedWounds','deleteCustomState'];
 function visit(n){if(ts.isVariableDeclaration(n)&&names.includes(n.name.getText(file))&&n.initializer&&ts.isCallExpression(n.initializer)) callbacks[n.name.getText(file)]=n.initializer.arguments[0].getText(file);ts.forEachChild(n,visit)}visit(file);
 assert.deepEqual(Object.keys(callbacks).sort(),[...names].sort());
 for (const [name,args,field] of [['forgetHealedWound',['player',null,'w'],'playerWounds'],['clearAllHealedWounds',['player',null],'playerWounds'],['deleteCustomState',['s'],'playerCustomStates']]){
  const character={playerWounds:[{woundId:'w',healingState:{currentState:'Healed'}}],playerCustomStates:[{stateId:'s'}]};const state={playerCharacter:character,playerCustomStates:character.playerCustomStates,encounteredNPCs:[]};const before=structuredClone(state);const ref={current:{playerCharacter:character,playerCustomStates:character.playerCustomStates}};let result;
  const js=ts.transpileModule(`this.callback=${callbacks[name]}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const scope={gameSettings:{allowHistoryManipulation:true},gameContextRef:ref,setGameState:f=>{result=f(state)},console};vm.runInNewContext(js,scope);scope.callback(...args);
  assert.deepEqual(state,before,`${name}: previous state must stay unchanged`);assert.notEqual(ref.current.playerCharacter,character);assert.equal(result.playerCharacter[field].length,0);assert.equal(ref.current.playerCharacter[field].length,0);
 }
});
