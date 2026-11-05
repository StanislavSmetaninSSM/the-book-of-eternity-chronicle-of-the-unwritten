import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';
test('attempting to equip a broken item leaves state and context untouched',async()=>{
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  const {createInventoryActions}=await server.ssrLoadModule('/hooks/logic/inventoryActions.ts');const {createInitialContext}=await server.ssrLoadModule('/utils/gameContext.ts');
  const context=createInitialContext({universe:'fantasy',playerName:'Test',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');
  const item={existedId:'broken',name:'Broken sword',durability:'0%',equipmentSlot:'MainHand',weight:1,volume:1,count:1},player={...context.playerCharacter,inventory:[item]},state={playerCharacter:player,players:[player],encounteredNPCs:[],encounteredFactions:[]};context.playerCharacter=player;const ref={current:context};let next;
  const manager=createInventoryActions({gameState:state,setGameState:update=>{next=update(state)},gameContextRef:ref,t:k=>k});manager.equipItem(item,'MainHand');
  assert.equal(next,state);assert.equal(state.playerCharacter,player,'original React state must not be mutated');assert.equal(ref.current.playerCharacter,player,'context must not change on rejection');
 }finally{await server.close()}
});

test('failed companion inventory operation leaves the previous state and context unchanged',async()=>{
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  const {createInventoryActions}=await server.ssrLoadModule('/hooks/logic/inventoryActions.ts');const {createInitialContext}=await server.ssrLoadModule('/utils/gameContext.ts');
  const context=createInitialContext({universe:'fantasy',playerName:'Test',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');
  const item={existedId:'item',name:'Item',durability:'100%',weight:1,volume:1,count:1},player={...context.playerCharacter,inventory:[item]},state={playerCharacter:player,players:[player],encounteredNPCs:[],encounteredFactions:[]};context.playerCharacter=player;const ref={current:context};let next;
  const manager=createInventoryActions({gameState:state,setGameState:update=>{next=update(state)},gameContextRef:ref,t:k=>k});manager.handleEquipItemForNpc('missing',item,'MainHand');
  assert.equal(next,state);assert.equal(state.playerCharacter,player);assert.equal(ref.current.playerCharacter,player);
 }finally{await server.close()}
});
