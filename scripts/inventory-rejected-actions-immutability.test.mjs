import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
test('rejected local inventory actions do not mutate or replace the previous character',async()=>{
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try {
  const {createInventoryActions}=await server.ssrLoadModule('/hooks/logic/inventoryActions.ts');
  const {createInitialContext}=await server.ssrLoadModule('/utils/gameContext.ts');
  const context=createInitialContext({universe:'fantasy',playerName:'Test',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');
  const item={existedId:'a',name:'A',count:1,weight:1,volume:1,equipmentSlot:null}; const missing={...item,existedId:'missing'};
  for(const action of [m=>m.moveItem(missing,null),m=>m.splitItemStack(item,1),m=>m.mergeItemStacks(item,missing)]){
   const player={...context.playerCharacter,inventory:[item]};const state={playerCharacter:player,encounteredNPCs:[]}, before=structuredClone(state), ref={current:{playerCharacter:player}};let next;
   const manager=createInventoryActions({gameState:state,setGameState:f=>next=f(state),gameContextRef:ref,t:k=>k});action(manager);
   assert.equal(next,state);assert.deepEqual(state,before);assert.equal(state.playerCharacter,player);assert.equal(ref.current.playerCharacter,player);
  }
 } finally {await server.close()}
});
