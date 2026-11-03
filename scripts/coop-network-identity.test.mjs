import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

test('cooperative messages bind identity and targets to the live player connection',async()=>{
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try {
  const {applyCoopMessage}=await server.ssrLoadModule('/hooks/logic/multiplayer.ts');
  const conn={peer:'p',metadata:{role:'player'}},state={networkRole:'host',players:[{playerId:'p',name:'Alice'},{playerId:'q',name:'Bob'}]};
  const request={type:'request_collective_action',senderId:'p',payload:{initiatorId:'q',initiatorName:'Spoof',participantIds:['p','q'],prompt:'Act'}};
  let next=applyCoopMessage(state,conn,request); assert.equal(next.collectiveActionState.initiatorId,'p');assert.equal(next.collectiveActionState.initiatorName,'Alice');
  assert.equal(applyCoopMessage(state,conn,{...request,senderId:'q'}),null);
  assert.equal(applyCoopMessage(state,{peer:'p',metadata:{role:'spectator'}},request),null);
  assert.equal(applyCoopMessage(state,{peer:'missing',metadata:{role:'player'}},{...request,senderId:'missing'}),null);
  assert.equal(applyCoopMessage(state,conn,{...request,payload:{...request.payload,participantIds:['p','no-such-player']}}),null);
  assert.equal(applyCoopMessage(state,conn,{...request,payload:{...request.payload,participantIds:['q']}}),null);
  assert.equal(applyCoopMessage(state,conn,{...request,payload:null}),null);
  assert.equal(applyCoopMessage(next,conn,request),null,'do not overwrite an active action');
  const submit={type:'submit_collective_action',senderId:'p',payload:{action:'Hello'}};
  assert.equal(applyCoopMessage(next,conn,{...submit,senderId:'q'}),null);
  assert.equal(applyCoopMessage(next,conn,{...submit,payload:{action:{bad:1}}}),null);
  next=applyCoopMessage(next,conn,submit);assert.equal(next.collectiveActionState.actions.p,'Hello');assert.equal(next.collectiveActionState.actions.q,undefined);
  assert.equal(applyCoopMessage({...state,collectiveActionState:{...next.collectiveActionState,participantIds:['q']}},conn,submit),null);
  const sim=applyCoopMessage(state,conn,{type:'request_simultaneous_action',senderId:'p',payload:{}});assert.ok(sim.simultaneousActionState.isActive);
  assert.equal(applyCoopMessage(sim,conn,{type:'simultaneous_action_submit',senderId:'q',payload:{action:'impersonate'}}),null);
  assert.equal(applyCoopMessage(sim,conn,{type:'simultaneous_action_submit',senderId:'p',payload:{action:'go'}}).simultaneousActionState.actions.p,'go');
  const hook=await readFile(new URL('../hooks/logic/multiplayer.ts',import.meta.url),'utf8');assert.equal((hook.match(/dispatchCoopMessage\(conn, message\)/g)||[]).length,2);
 } finally {await server.close()}
});

test('both host dispatchers reject spoofed actions and recheck a disconnected peer before React applies them',async()=>{
 const ts=(await import('typescript')).default,vm=await import('node:vm');
 const source=await readFile(new URL('../hooks/logic/multiplayer.ts',import.meta.url),'utf8'),src=ts.createSourceFile('network.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let dispatch;const handlers=[];
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='dispatchCoopMessage')dispatch=n.initializer;if(ts.isCallExpression(n)&&n.arguments.length===2&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text==='data'&&ts.isArrowFunction(n.arguments[1]))handlers.push(n.arguments[1]);ts.forEachChild(n,visit)}visit(src);assert.ok(dispatch);assert.equal(handlers.length,3);
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try {
  const {applyCoopMessage}=await server.ssrLoadModule('/hooks/logic/multiplayer.ts');
  for(const handler of [handlers[0],handlers[2]]){
   const js=ts.transpileModule(`const dispatchCoopMessage=${dispatch.getText(src)};const onData=${handler.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
   const state={networkRole:'host',players:[{playerId:'p',name:'Alice'}],collectiveActionState:{isActive:true,participantIds:['p'],actions:{}}},conn={peer:'p',open:true,metadata:{role:'player'}},connections={current:new Map([['p',conn]])},queued=[], rejected=[], hostRestorePendingRef={current:null};
   const scope={applyCoopMessage,conn,connectionsRef:connections,gameStateRef:{current:state},hostRestorePendingRef,sendOnOpenConnection:(_conn,msg)=>{rejected.push(msg);return Promise.resolve()},setGameState:fn=>queued.push(fn),console:{log:()=>{}}};
   const send=(data)=>vm.runInNewContext(`${js}\nonData(data);`,{...scope,data});
   send({type:'submit_collective_action',senderId:'other',payload:{action:'forged'}});assert.equal(queued.length,0);assert.equal(rejected.length,1);
   hostRestorePendingRef.current={};send({type:'submit_collective_action',senderId:'p',payload:{action:'valid'}});assert.equal(queued.length,0);assert.equal(rejected.length,2);hostRestorePendingRef.current=null;
   send({type:'submit_collective_action',senderId:'p',payload:{action:'valid'}});assert.equal(queued.length,1);
   conn.open=false;assert.equal(queued[0](state),state);
   conn.open=true;connections.current.set('p',{peer:'p',open:true});assert.equal(queued[0](state),state);
   connections.current.set('p',conn);assert.equal(queued[0](state).collectiveActionState.actions.p,'valid');
  }
  const clientJs=ts.transpileModule(`const onData=${handlers[1].getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const conn={peer:'host',open:true},errors=[];const clientScope={conn,hostConnectionRef:{current:conn},setError:msg=>errors.push(msg),t:key=>key,console:{log:()=>{}},data:{type:'coop_action_rejected',payload:{}}};
  vm.runInNewContext(`${clientJs}\nonData(data);`,clientScope);assert.deepEqual(errors,['coop_action_rejected']);
 }finally{await server.close()}
});
