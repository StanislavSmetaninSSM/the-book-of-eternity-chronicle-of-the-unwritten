import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';
test('companion transfers reject invalid quantities without changing either inventory',async()=>{
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  const {transferItemBetweenCharacters}=await server.ssrLoadModule('/utils/inventoryManager.ts');
  const item={existedId:'i',name:'Ore',count:4,weight:1},player={inventory:[item],equippedItems:{}},npc={NPCId:'n',inventory:[],equippedItems:{}},state={playerCharacter:player,encounteredNPCs:[npc]};
  for(const quantity of [-1,0,1.5,NaN,Infinity]) assert.equal(transferItemBetweenCharacters('player','npc','n',item,quantity,state),state,`reject ${quantity}`);
  assert.equal(transferItemBetweenCharacters('player','player','n',item,1,state),state);
  assert.equal(player.inventory[0].count,4);assert.equal(npc.inventory.length,0);
  const valid=transferItemBetweenCharacters('player','npc','n',item,2,state);
  assert.notEqual(valid,state);assert.equal(valid.playerCharacter.inventory[0].count,2);assert.equal(valid.encounteredNPCs[0].inventory[0].count,2);
  const clamped=transferItemBetweenCharacters('player','npc','n',item,8,state);
  assert.equal(clamped.playerCharacter.inventory.length,0);assert.equal(clamped.encounteredNPCs[0].inventory[0].count,4);
  assert.equal(player.inventory[0].count,4);assert.equal(npc.inventory.length,0);
 }finally{await server.close()}
});
