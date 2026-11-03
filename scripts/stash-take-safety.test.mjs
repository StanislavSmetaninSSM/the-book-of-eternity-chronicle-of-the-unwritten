import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

test('taking from stash preserves snapshots, metadata and stack identity',async()=>{
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try {
  const {createInventoryActions}=await server.ssrLoadModule('/hooks/logic/inventoryActions.ts');
  const {createInitialContext}=await server.ssrLoadModule('/utils/gameContext.ts');
  const context=createInitialContext({universe:'fantasy',playerName:'Test',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');
  const base={existedId:'stash',name:'Potion',count:3,weight:1,volume:1,resource:2,maximumResource:10,quality:'Rare',contentsPath:null,isContainer:false,equipmentSlot:null};
  const run=(stash,inventory,quantity,argument=stash[0])=>{
   const player={...context.playerCharacter,inventory,totalWeight:0,maxWeight:1000,criticalExcessWeight:100}; const old={playerCharacter:player,temporaryStash:stash,encounteredNPCs:[]}; const before=structuredClone(old);const ref={current:{playerCharacter:player}};let next=old;
   const manager=createInventoryActions({gameState:old,setGameState:f=>{next=f(old)},gameContextRef:ref,t:k=>k});manager.moveFromStashToInventory(argument,quantity);
   assert.deepEqual(old,before,'old snapshot remains untouched'); return {next,old,ref};
  };
  let {next}=run([base],[{...base,existedId:'existing',quality:'Common',resource:10}],1,{...base,weight:0,quality:'forged'});
  assert.equal(next.temporaryStash[0].count,2); assert.equal(next.temporaryStash[0].resource,2);
  assert.equal(next.playerCharacter.inventory.length,2); const moved=next.playerCharacter.inventory[1];
  assert.equal(moved.quality,'Rare');assert.equal(moved.resource,10);assert.notEqual(moved.existedId,'stash');
  ({next}=run([base],[],3));assert.equal(next.temporaryStash.length,0);assert.equal(next.playerCharacter.inventory[0].existedId,'stash');assert.equal(next.playerCharacter.inventory[0].resource,2);
  for(const quantity of [NaN,Infinity,0,-1,1.5]) { const result=run([base],[],quantity);assert.equal(result.next,result.old); }
  for(const special of [{isContainer:true},{isSentient:true}]) {const result=run([{...base,...special}],[],1);assert.equal(result.next,result.old);}
  for(const stash of [[base,{...base}],[{...base,count:NaN}]]) {const result=run(stash,[],1);assert.equal(result.next,result.old);}
  {const result=run([base],[{...base}],3);assert.equal(result.next,result.old);}
 } finally {await server.close()}
});
