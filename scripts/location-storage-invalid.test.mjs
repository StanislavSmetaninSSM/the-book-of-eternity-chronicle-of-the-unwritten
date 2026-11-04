import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';
test('location storage rejects invalid quantities, counts and ambiguous source or storage IDs',async()=>{
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  const {createPlayerActionsManager}=await server.ssrLoadModule('/hooks/logic/playerActions.ts');const {createInitialContext}=await server.ssrLoadModule('/utils/gameContext.ts');const ctx=createInitialContext({universe:'fantasy',playerName:'Test',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');
  const item={existedId:'i',name:'Item',count:3,weight:1,volume:1,contentsPath:null,equipmentSlot:null},other={...item,existedId:'j',count:2};
  const run=(direction,amount,{source=[item],destination=[],duplicateStorage=false}={})=>{
   const stash={storageId:'s',contents:direction==='retrieve'?source:destination};const pc={...ctx.playerCharacter,inventory:direction==='move'?source:destination,totalWeight:0,maxWeight:1000,criticalExcessWeight:100};const state={playerCharacter:pc,currentLocationData:{locationId:'l',locationStorages:duplicateStorage?[stash,stash]:[stash]}};const before=structuredClone(state),ref={current:{playerCharacter:pc,currentLocation:state.currentLocationData}};let next=state;const noop=()=>{};
   const mgr=createPlayerActionsManager({setGameState:f=>next=f(state),setGameHistory:noop,setGameLog:noop,setCombatLog:noop,setVisitedLocations:noop,setWorldMap:noop,setWorldState:noop,gameSettings:{allowHistoryManipulation:true},gameContextRef:ref,t:k=>k});
   if(direction==='move')mgr.moveToLocationStorage('l','s',item,amount);else mgr.retrieveFromLocationStorage('l','s',item,amount);
   assert.deepEqual(state,before,'prior state remains intact');return {state,next,ref};
  };
  for(const dir of ['move','retrieve']){
   for(const amount of [NaN,Infinity,-1,0,1.5]){const r=run(dir,amount);assert.equal(r.next,r.state,`${dir}: invalid quantity`);assert.equal(r.ref.current.playerCharacter,r.state.playerCharacter);}
   for(const options of [{source:[item,item]},{source:[{...item,count:NaN}]},{source:[{...item,count:1.5}]},{duplicateStorage:true},{destination:[{...other,count:Number.MAX_SAFE_INTEGER}]}]){const r=run(dir,1,options);assert.equal(r.next,r.state,`${dir}: malformed or ambiguous base`);}
   const ok=run(dir,99);const loc=ok.next.currentLocationData.locationStorages[0];assert.equal(dir==='move'?ok.next.playerCharacter.inventory.length:loc.contents.length,0);assert.equal(dir==='move'?loc.contents[0].count:ok.next.playerCharacter.inventory[0].count,3);
  }
 }finally{await server.close()}
});
