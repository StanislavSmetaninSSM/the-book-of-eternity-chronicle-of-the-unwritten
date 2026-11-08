import {test} from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';import {createServer} from 'vite';
test('conditional checkpoint discard cannot delete a newer interrupted turn',async()=>{
 const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  const {saveInterruptedTurnRecovery,loadInterruptedTurnRecovery,clearInterruptedTurnRecovery,clearInterruptedTurnRecoveryIfUnchanged}=await server.ssrLoadModule('/utils/fileManager.ts');
  await clearInterruptedTurnRecovery();const recovery={context:{message:'first'},baseState:{},history:[]};
  await saveInterruptedTurnRecovery(recovery);const first=await loadInterruptedTurnRecovery();assert.ok(first.checkpointId);
  await saveInterruptedTurnRecovery(recovery);const second=await loadInterruptedTurnRecovery();assert.notEqual(first.checkpointId,second.checkpointId);
  assert.equal(await clearInterruptedTurnRecoveryIfUnchanged(first),false);assert.equal((await loadInterruptedTurnRecovery()).checkpointId,second.checkpointId);
  assert.equal(await clearInterruptedTurnRecoveryIfUnchanged(second),true);assert.equal(await loadInterruptedTurnRecovery(),null);
  assert.equal(await clearInterruptedTurnRecoveryIfUnchanged(second),false);
  const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('gemini-rpg-db',3);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
  const put=async value=>{const tx=db.transaction('interrupted_turns','readwrite');tx.objectStore('interrupted_turns').put(value);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})};
  const legacy={id:'pending-turn',createdAt:'2020-01-01T00:00:00.000Z',...recovery};
  await put(legacy);assert.equal(await clearInterruptedTurnRecoveryIfUnchanged(legacy),false);
  const migrated=await loadInterruptedTurnRecovery();assert.ok(migrated.checkpointId);assert.equal(migrated.context.message,'first');
  const reread=await loadInterruptedTurnRecovery();assert.equal(reread.checkpointId,migrated.checkpointId);
  await put(legacy);assert.equal(await clearInterruptedTurnRecoveryIfUnchanged(migrated),false,'an old tab replacement must not be deleted');
  const remigrated=await loadInterruptedTurnRecovery();assert.notEqual(remigrated.checkpointId,migrated.checkpointId);assert.equal(await clearInterruptedTurnRecoveryIfUnchanged(remigrated),true);db.close();
 }finally{await server.close()}
});
