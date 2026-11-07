import {test, after} from 'node:test';import assert from 'node:assert/strict';import { getTestServer, closeTestServer } from './helpers/testServer.mjs';
test('companion transfers do not merge merely by name or erase distinct item metadata',async()=>{
 const server = await getTestServer();
 try{
  const {transferItemBetweenCharacters}=await server.ssrLoadModule('/utils/inventoryManager.ts');
  const source={existedId:'a',name:'Potion',count:2,weight:1,description:'rare',equipmentSlot:null,contentsPath:null},target={...source,existedId:'b',count:3,description:'common'};
  const state={playerCharacter:{inventory:[source],equippedItems:{}},encounteredNPCs:[{NPCId:'n',inventory:[target],equippedItems:{}}]};
  const result=transferItemBetweenCharacters('player','npc','n',source,1,state);
  const inventory=result.encounteredNPCs[0].inventory;assert.equal(inventory.length,2);assert.equal(inventory.find(i=>i.existedId==='b').count,3);assert.equal(inventory.find(i=>i.description==='rare').count,1);assert.equal(result.playerCharacter.inventory[0].count,1);
  assert.equal(state.playerCharacter.inventory[0].count,2);assert.equal(state.encounteredNPCs[0].inventory[0].count,3);
 }finally{await server.close()}
});

test('only equivalent ordinary root stacks merge; sentient and container stacks remain separate',async()=>{
 const server = await getTestServer();
 try{
  const {transferItemBetweenCharacters}=await server.ssrLoadModule('/utils/inventoryManager.ts');
  const original={existedId:'a',name:'Potion',count:2,weight:1,description:'same',equipmentSlot:null,contentsPath:null};
  const run=(src,other)=>transferItemBetweenCharacters('player','npc','n',src,1,{playerCharacter:{inventory:[src],equippedItems:{}},encounteredNPCs:[{NPCId:'n',inventory:[other],equippedItems:{}}]}).encounteredNPCs[0].inventory;
  const same={...original,existedId:'b',count:3};const merged=run(original,same);assert.equal(merged.length,1);assert.equal(merged[0].count,4);
  for(const patch of [{isSentient:true},{isContainer:true},{resource:1,maximumResource:2}]){
   const source={...original,...patch}, target={...same,...patch,...('resource' in patch?{resource:0}:{})};
   const result=run(source,target);assert.equal(result.length,2,JSON.stringify(patch));assert.equal(result.reduce((n,item)=>n+item.count,0),4);
  }
  const partial=run({...original,resource:1,maximumResource:2},{...same,resource:1,maximumResource:2});assert.equal(partial.length,2);assert.equal(partial.find(item=>item.existedId!=='b').resource,2,'the partial unit remains with the source stack');
  const nested=run(original,{...same,contentsPath:['bag']});assert.equal(nested.length,2);
 }finally{await server.close()}
});

after(async () => { await closeTestServer(); });
