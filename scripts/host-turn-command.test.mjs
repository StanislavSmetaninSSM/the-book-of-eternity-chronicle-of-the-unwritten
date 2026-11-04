import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('host turn request validates minimal input and reserves once after hashing',async()=>{
 const v=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  const p=await v.ssrLoadModule('/utils/hostTurnCommand.ts'), {HostTurnAuthority}=await v.ssrLoadModule('/utils/networkTurnProtocol.ts');
  const authority=new HostTurnAuthority(()=>'session'),base=authority.issue(),raw={version:1,sessionId:'session',commandId:'00000000-0000-4000-8000-000000000001',playerId:'guest',base,kind:'action',text:'Open the door',image:null};
  assert.equal(p.isHostTurnCommand(raw),true);
  for(const bad of [{...raw,saveFile:{}},{...raw,text:''},{...raw,text:'x'.repeat(32001)},{...raw,kind:'collective'}, {...raw,image:{data:'bad!',mimeType:'image/png'}},{...raw,base:{...base,extra:true}}])assert.equal(p.isHostTurnCommand(bad),false);
  const conn={peer:'guest',open:true,metadata:{role:'player'}},state={networkRole:'host',myPeerId:'host',activePlayerIndex:1,players:[{playerId:'host'},{playerId:'guest'}]},connections=new Map([['guest',conn]]);
  const ctx=()=>({connection:conn,connections,state,busy:false}),ledger=new p.HostTurnCommandLedger(authority,2);
  const [one,two]=await Promise.all([ledger.begin(raw,ctx),ledger.begin(raw,ctx)]);assert.deepEqual([one.status,two.status].sort(),['pending','reserved']);
  assert.equal((await ledger.begin({...raw,text:'Different'},ctx)).status,'collision');assert.equal((await ledger.begin(raw,()=>({...ctx(),connection:{...conn,peer:'other'}}))).status,'unauthorized');
  assert.equal(ledger.settle('session',raw.commandId,'committed'),true);const stamp=authority.issue();assert.ok(ledger.receipts(stamp).some(r=>r.commandId===raw.commandId));assert.equal(ledger.status('session',raw.commandId,ctx()),'committed');
  const id2='00000000-0000-4000-8000-000000000002';let release;const wait=new Promise(r=>release=r);const slow=new p.HostTurnCommandLedger(authority,2,async bytes=>{await wait;return crypto.subtle.digest('SHA-256',bytes)});const candidate=slow.begin({...raw,commandId:id2,base:stamp},ctx);conn.open=false;release();assert.equal((await candidate).status,'unauthorized','identity must be rechecked after asynchronous hashing');
 }finally{await v.close()}
});

test('turn reservation fails closed on stale grants, role changes, reset and failed hashes',async()=>{
 const v=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});try{
 const p=await v.ssrLoadModule('/utils/hostTurnCommand.ts'),{HostTurnAuthority}=await v.ssrLoadModule('/utils/networkTurnProtocol.ts');let n=0;const authority=new HostTurnAuthority(()=>`s${++n}`),base=authority.issue(),raw={version:1,sessionId:base.sessionId,commandId:'00000000-0000-4000-8000-000000000001',playerId:'guest',base,kind:'question',text:'Why?',image:{data:'eA==',mimeType:'image/png'}};
 const conn={peer:'guest',open:true,metadata:{role:'player'}},state={networkRole:'host',myPeerId:'host',activePlayerIndex:1,players:[{playerId:'host'},{playerId:'guest'}]},connections=new Map([['guest',conn]]),ctx=()=>({connection:conn,connections,state,busy:false}),ledger=new p.HostTurnCommandLedger(authority);
 assert.equal(p.isHostTurnCommand(raw),true);state.activePlayerIndex=0;assert.equal((await ledger.begin(raw,ctx)).status,'unauthorized');state.activePlayerIndex=1;assert.equal((await ledger.begin(raw,()=>({...ctx(),busy:true}))).status,'busy');
 const failed=new p.HostTurnCommandLedger(authority,2,async()=>{throw Error('digest unavailable')});assert.equal((await failed.begin(raw,ctx)).status,'invalid');
 let release;const wait=new Promise(r=>release=r);const slow=new p.HostTurnCommandLedger(authority,2,async bytes=>{await wait;return crypto.subtle.digest('SHA-256',bytes)});const pending=slow.begin(raw,ctx);raw.text='changed after begin';authority.reset();release();assert.equal((await pending).status,'expired');assert.deepEqual(slow.receipts(authority.issue()),[]);
 }finally{await v.close()}
});
