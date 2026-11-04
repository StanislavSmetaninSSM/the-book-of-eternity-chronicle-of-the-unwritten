import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';import 'fake-indexeddb/auto';
test('blocked upgrade does not leak a connection after failing closed',async()=>{
 const old=await new Promise((resolve,reject)=>{const r=indexedDB.open('book-client-edit-intents-v1',2);r.onupgradeneeded=()=>{r.result.createObjectStore('intents',{keyPath:'command.commandId'});r.result.createObjectStore('hostEpochs')};r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result)});
 let closes=0;const close=IDBDatabase.prototype.close;IDBDatabase.prototype.close=function(){closes++;return close.call(this)};
 const v=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});try{const s=await v.ssrLoadModule('/utils/clientEditIntentStore.ts');await assert.rejects(()=>s.getClientEditEpoch('host'),/blocked/);old.close();await new Promise(r=>setTimeout(r,20));assert.ok(closes>=2,'abandoned open must close itself after the blocker releases');assert.equal(await s.getClientEditEpoch('host'),null);
 // Another upgrade must not be blocked by the abandoned first open.
 const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('book-client-edit-intents-v1',4);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('leaked connection blocked next upgrade'))});db.close();
 }finally{old.close();IDBDatabase.prototype.close=close;await v.close()}
});
