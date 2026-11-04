import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';import 'fake-indexeddb/auto';
test('intent database upgrades without losing a legacy pending command',async()=>{
 const command={version:1,sessionId:'s',commandId:'00000000-0000-4000-8000-000000000042',playerId:'p',base:{version:1,sessionId:'s',revision:1},command:{type:'equip',itemId:'sword',slot:'MainHand'}};
 const intent={command,hostPeerId:'host',createdAt:new Date().toISOString(),revision:1,status:'pending'};
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('book-client-edit-intents-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('intents',{keyPath:'command.commandId'});r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result)});
 await new Promise((resolve,reject)=>{const tx=db.transaction('intents','readwrite');tx.objectStore('intents').put(intent);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
 const v=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});try{const s=await v.ssrLoadModule('/utils/clientEditIntentStore.ts');assert.deepEqual(await s.listClientEditIntents(),[intent]);assert.equal(await s.getClientEditEpoch('host'),null);const unknown=await s.transitionClientEditIntent(intent,'unknown');assert.equal(unknown.status,'unknown');assert.match(await s.getClientEditEpoch('host'),/^[0-9a-f-]{36}$/)}finally{await v.close()}
});
