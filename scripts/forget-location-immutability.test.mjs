import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('forgetting a location preserves the prior map while removing only links to that location', async () => {
  const server = await createServer({configFile:false, optimizeDeps:{noDiscovery:true,include:[]}, server:{middlewareMode:true}, appType:'custom', logLevel:'silent'});
  try {
    const { createPlayerActionsManager } = await server.ssrLoadModule('/hooks/logic/playerActions.ts');
    const removed={locationId:'gone',name:'Gone'}, retained={locationId:'keep',name:'Keep',adjacencyMap:[{targetLocationId:'gone',name:'Gone'}, {targetLocationId:'other',name:'Other'}]}, other={locationId:'other',name:'Other'};
    const oldMap={gone:removed,keep:retained,other}; const before=structuredClone(oldMap); const context={current:{worldMap:oldMap,visitedLocations:[removed,retained]}}; let map=oldMap,visited=context.current.visitedLocations;
    const noop=()=>{};
    const manager=createPlayerActionsManager({gameSettings:{allowHistoryManipulation:true},gameContextRef:context,setWorldMap:f=>{map=f(map)},setVisitedLocations:f=>{visited=f(visited)},setGameState:noop,setGameHistory:noop,setUserGameHistory:noop,setGameLog:noop,setCombatLog:noop,setWorldState:noop,t:k=>k});
    manager.forgetLocation('gone');
    assert.deepEqual(oldMap,before,'previously rendered map and saved snapshots must not be mutated');
    assert.equal(oldMap.keep,retained);
    assert.notEqual(map.keep,retained);
    assert.equal(map.gone,undefined);
    assert.deepEqual(map.keep.adjacencyMap,[{targetLocationId:'other',name:'Other'}]);
    assert.equal(map.other,other);
    assert.deepEqual(visited,[retained]);
    assert.equal(context.current.worldMap,map);
  } finally {await server.close();}
});
