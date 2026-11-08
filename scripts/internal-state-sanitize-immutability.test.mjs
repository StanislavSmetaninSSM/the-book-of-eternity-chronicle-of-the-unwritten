import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';
import {createServer} from 'vite';

test('internal setter never mutates a previous or supplied snapshot while sanitizing',async()=>{
 const source=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');const file=ts.createSourceFile('hook.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let body;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(file)==='setGameStateInternal')body=n.initializer.arguments[0].getText(file);ts.forEachChild(n,visit)}visit(file);assert.ok(body);
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try {
 const {sanitizeGameState}=await server.ssrLoadModule('/utils/sanitizeGameState.ts');
 const code=ts.transpileModule(`this.setter = ${body}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 let previous={encounteredNPCs:[{name:'NPC'}],encounteredFactions:[{name:'Faction'}]},current=previous;const ref={current:previous};let completed=0;
 const scope={hostTurnAuthorityRef:{current:{beginMutation:()=>()=>completed++}},_setGameState:fn=>{current=fn(current)},gameStateRef:ref,setSnapshotEpoch:()=>{},queueMicrotask,sanitizeGameState};
 vm.runInNewContext(code,scope);const npc=previous.encounteredNPCs,factions=previous.encounteredFactions;
 scope.setter(x=>x);assert.equal(current,previous);assert.equal(previous.encounteredNPCs,npc);assert.equal(previous.encounteredFactions,factions);
 const supplied={encounteredNPCs:[null,{name:'NPC'}],encounteredFactions:[{name:'Faction'},null]};const before=structuredClone(supplied);
 scope.setter(supplied);assert.deepEqual(supplied,before);assert.notEqual(current,supplied);assert.deepEqual(Array.from(current.encounteredNPCs),[{name:'NPC'}]);assert.deepEqual(Array.from(current.encounteredFactions),[{name:'Faction'}]);assert.equal(ref.current,current);
 assert.match(source,/loadedGameState = sanitizeGameState\(loadedGameState\)!;[\s\S]{0,1500}?setGameStateInternal\(loadedGameState\)/);
 } finally {await server.close()}
});
