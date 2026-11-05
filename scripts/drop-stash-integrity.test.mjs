import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

test('dropping an item uses the unique current inventory record and rejects ambiguous or stale targets',async()=>{
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try {
  const {dropItem}=await server.ssrLoadModule('/utils/inventoryManager.ts');
  const {createInventoryActions}=await server.ssrLoadModule('/hooks/logic/inventoryActions.ts');
  const item={existedId:'a',name:'Current',count:3,weight:1,contentsPath:['Bag']};
  const mk=(inventory,stash=[])=>({playerCharacter:{inventory,equippedItems:{MainHand:'a'}},temporaryStash:stash,encounteredNPCs:[]});
  let state=mk([item]),before=structuredClone(state);
  let result=dropItem({...item,name:'stale',count:1},state);
  assert.deepEqual(state,before); assert.equal(result.temporaryStash[0].name,'Current');assert.equal(result.temporaryStash[0].count,3);assert.equal(result.temporaryStash[0].contentsPath,null);assert.equal(result.playerCharacter.equippedItems.MainHand,null);
  for (const [inv,stash,arg] of [[[],[],item],[[item,item],[],item],[[item],[item],item],[[{...item,existedId:null}],[],{...item,existedId:null}]]) {
   state=mk(inv,stash); before=structuredClone(state);const ref={current:{playerCharacter:state.playerCharacter}};let next;
   const manager=createInventoryActions({gameState:state,setGameState:f=>next=f(state),gameContextRef:ref,t:k=>k});
   manager.dropItem(arg);assert.equal(next,state);assert.deepEqual(state,before);assert.equal(ref.current.playerCharacter,state.playerCharacter);
  }
 } finally {await server.close()}
});
