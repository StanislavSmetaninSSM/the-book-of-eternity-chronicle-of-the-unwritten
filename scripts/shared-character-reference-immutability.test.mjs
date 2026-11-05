import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

test('character actions do not mutate a prior state shared with the context', async () => {
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try {
  const {createPlayerActionsManager}=await server.ssrLoadModule('/hooks/logic/playerActions.ts');
  const {createInventoryActions}=await server.ssrLoadModule('/hooks/logic/inventoryActions.ts');
  for (const [name,invoke,expected] of [
   ['auto skill',m=>m.player.setAutoCombatSkill('Dodge'),pc=>assert.equal(pc.autoCombatSkill,'Dodge')],
   ['item edit',m=>m.player.editItemData('i','name','New'),pc=>assert.equal(pc.inventory[0].name,'New')],
   ['custom state',m=>m.player.deleteCustomState('s'),pc=>assert.deepEqual(pc.playerCustomStates,[])],
   ['forget wound',m=>m.inventory.forgetHealedWound('player',null,'w'),pc=>assert.deepEqual(pc.playerWounds,[])],
   ['clear healed',m=>m.inventory.clearAllHealedWounds('player',null),pc=>assert.deepEqual(pc.playerWounds,[])],
  ]) {
   const pc={autoCombatSkill:null,inventory:[{existedId:'i',name:'Old'}],playerCustomStates:[{stateId:'s'}],playerWounds:[{woundId:'w',healingState:{currentState:'Healed'}}]};
   const state={playerCharacter:pc,playerCustomStates:pc.playerCustomStates,encounteredNPCs:[]}; const before=structuredClone(state); const ref={current:{playerCharacter:pc,playerCustomStates:pc.playerCustomStates}}; let next=state;
   const setGameState=fn=>{next=fn(state)}; const noop=()=>{};
   const player=createPlayerActionsManager({setGameState,setGameHistory:noop,setGameLog:noop,setCombatLog:noop,setVisitedLocations:noop,setWorldMap:noop,setWorldState:noop,gameSettings:{allowHistoryManipulation:true},gameContextRef:ref,t:k=>k});
   const inventory=createInventoryActions({setGameState,gameState:state,gameContextRef:ref,t:k=>k});
   invoke({player,inventory});
   assert.deepEqual(state,before,`${name}: prior state changed`);
   expected(next.playerCharacter); expected(ref.current.playerCharacter);
   assert.notEqual(ref.current.playerCharacter,pc,`${name}: context should not mutate shared character`);
  }
 } finally {await server.close()}
});
