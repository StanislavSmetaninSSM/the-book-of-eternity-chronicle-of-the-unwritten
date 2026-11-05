import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

test('guarded actions preserve successful return values and never invoke blocked actions',async()=>{
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try {
  const {guardGameplayActions}=await server.ssrLoadModule('/utils/gameplayMutationGate.ts');
  let calls=0, blocked=false;
  const actions=guardGameplayActions({produce:value=>{calls++;return `result:${value}`}},()=>blocked);
  assert.equal(actions.produce('one'),'result:one');assert.equal(calls,1);
  blocked=true;assert.equal(actions.produce('two'),undefined);assert.equal(calls,1);
 }finally{await server.close()}
});
