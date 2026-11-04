import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

test('host turn execution stays reserved until the generated result actually commits', async () => {
 const v=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try {
  const {HostTurnExecutionCoordinator}=await v.ssrLoadModule('/utils/hostTurnExecutionCoordinator.ts');
  const {HostTurnCommandLedger}=await v.ssrLoadModule('/utils/hostTurnCommand.ts');
  const {HostTurnAuthority}=await v.ssrLoadModule('/utils/networkTurnProtocol.ts');
  const authority=new HostTurnAuthority(()=>'session'),base=authority.issue();
  const command={version:1,sessionId:'session',commandId:'00000000-0000-4000-8000-000000000001',playerId:'guest',base,kind:'action',text:'Go',image:null};
  const conn={peer:'guest',open:true,metadata:{role:'player'}},state={networkRole:'host',myPeerId:'host',activePlayerIndex:1,players:[{playerId:'host'},{playerId:'guest'}]};
  const ctx=()=>({connection:conn,connections:new Map([['guest',conn]]),state,busy:false}),ledger=new HostTurnCommandLedger(authority);
  const gate={};gate.promise=new Promise(resolve=>gate.resolve=resolve);
  const player=state.players[0],world={},map={},visited=[],settings={language:'en'},history=[{sender:'player',content:'Go'},{sender:'gm',content:'Done'}];
  const savedState={...state,playerCharacter:player,encounteredNPCs:[],encounteredFactions:[],imageCache:{}};
  const context={gameSettings:settings,superInstructions:'keep',worldState:world,worldMap:map,visitedLocations:visited,currentTurnNumber:2,playerCharacter:player,players:state.players};
  const snapshot={gameState:savedState,gameContext:context,gameHistory:history,gameLog:['log'],combatLog:[],lastJsonResponse:'{}',sceneImagePrompt:null};
  const rendered={gameState:savedState,currentGameState:savedState,gameHistory:history,gameLog:['log'],combatLog:[],lastJsonResponse:'{}',sceneImagePrompt:null,worldState:world,gameSettings:settings,superInstructions:'keep',worldMap:map,visitedLocations:visited,turnNumber:2,currentContext:context};
  let staged=false;
  const coordinator=new HostTurnExecutionCoordinator(ledger);
  assert.equal((await coordinator.start(command,ctx,async (_command,stage)=>{staged=stage(snapshot);await gate.promise})).status,'reserved');
  assert.equal(staged,true);assert.equal(coordinator.observe(rendered),'pending','execution completion and React commit are both necessary');
  assert.equal(authority.issue(),null);assert.equal(ledger.status('session',command.commandId,ctx()),'pending');
  assert.equal((await coordinator.start(command,ctx,async()=>{assert.fail('duplicate must not execute')})).status,'pending');
  assert.equal((await coordinator.start({...command,text:'Changed'},ctx,async()=>{assert.fail('collision must not execute')})).status,'collision');
  gate.resolve();await coordinator.whenExecutionFinishes();
  assert.equal(coordinator.observe({...rendered,gameHistory:[]}), 'pending');assert.equal(authority.issue(),null);
  assert.equal(coordinator.observe(rendered),'committed');const stamp=authority.issue();assert.ok(stamp);assert.equal(ledger.status('session',command.commandId,ctx()),'committed');assert.equal(ledger.receipts(stamp)[0].commandId,command.commandId);
 } finally { await v.close(); }
});

test('failed, missing or unrepresentable result is unknown, never committed', async()=>{
 const v=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});try{
 const {HostTurnExecutionCoordinator}=await v.ssrLoadModule('/utils/hostTurnExecutionCoordinator.ts'),{HostTurnCommandLedger}=await v.ssrLoadModule('/utils/hostTurnCommand.ts'),{HostTurnAuthority}=await v.ssrLoadModule('/utils/networkTurnProtocol.ts');
 for(const execute of [async()=>{},async()=>{throw Error('generation failed')},async(_c,stage)=>{assert.equal(stage({gameState:{bad:()=>{}},gameContext:{gameSettings:{}},gameHistory:[],gameLog:[],combatLog:[]}),false)}]){
  const authority=new HostTurnAuthority(()=>'session'),base=authority.issue(),command={version:1,sessionId:'session',commandId:'00000000-0000-4000-8000-000000000001',playerId:'guest',base,kind:'question',text:'Why',image:null},conn={peer:'guest',open:true,metadata:{role:'player'}},state={networkRole:'host',myPeerId:'host',activePlayerIndex:1,players:[{playerId:'host'},{playerId:'guest'}]},ctx=()=>({connection:conn,connections:new Map([['guest',conn]]),state,busy:false}),ledger=new HostTurnCommandLedger(authority),coordinator=new HostTurnExecutionCoordinator(ledger);
  assert.equal((await coordinator.start(command,ctx,execute)).status,'reserved');await coordinator.whenExecutionFinishes();assert.equal(ledger.status('session',command.commandId,ctx()),'unknown');assert.equal(authority.issue(),null,'failure can leave queued React writes; keep authority held');
 }
 }finally{await v.close()}
});

test('multiple staged results or failure after staging cannot certify a commit',async()=>{
 const v=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});try{
 const {HostTurnExecutionCoordinator}=await v.ssrLoadModule('/utils/hostTurnExecutionCoordinator.ts'),{HostTurnCommandLedger}=await v.ssrLoadModule('/utils/hostTurnCommand.ts'),{HostTurnAuthority}=await v.ssrLoadModule('/utils/networkTurnProtocol.ts');
 for(const fail of [false,true]){
  const authority=new HostTurnAuthority(()=>'session'),base=authority.issue(),command={version:1,sessionId:'session',commandId:'00000000-0000-4000-8000-000000000001',playerId:'guest',base,kind:'action',text:'Go',image:null},conn={peer:'guest',open:true,metadata:{role:'player'}},state={networkRole:'host',myPeerId:'host',activePlayerIndex:1,players:[{playerId:'host'},{playerId:'guest'}]},ctx=()=>({connection:conn,connections:new Map([['guest',conn]]),state,busy:false}),ledger=new HostTurnCommandLedger(authority),coordinator=new HostTurnExecutionCoordinator(ledger);
  const snapshot={gameState:state,gameContext:{gameSettings:{}},gameHistory:[],gameLog:[],combatLog:[]};
  assert.equal((await coordinator.start(command,ctx,async(_c,stage)=>{assert.equal(stage(snapshot),true);if(fail)throw Error('post-stage failure');assert.equal(stage(snapshot),false)})).status,'reserved');await coordinator.whenExecutionFinishes();assert.equal(ledger.status('session',command.commandId,ctx()),'unknown');assert.equal(authority.issue(),null,'failure can leave queued React writes; keep authority held');
 }
 }finally{await v.close()}
});

test('session reset never lets an old generation overlap a new reservation',async()=>{
 const v=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});try{
 const {HostTurnExecutionCoordinator}=await v.ssrLoadModule('/utils/hostTurnExecutionCoordinator.ts'),{HostTurnCommandLedger}=await v.ssrLoadModule('/utils/hostTurnCommand.ts'),{HostTurnAuthority}=await v.ssrLoadModule('/utils/networkTurnProtocol.ts');let sequence=0;const authority=new HostTurnAuthority(()=>`session-${++sequence}`),base=authority.issue(),command={version:1,sessionId:base.sessionId,commandId:'00000000-0000-4000-8000-000000000001',playerId:'guest',base,kind:'action',text:'Go',image:null},conn={peer:'guest',open:true,metadata:{role:'player'}},state={networkRole:'host',myPeerId:'host',activePlayerIndex:1,players:[{playerId:'host'},{playerId:'guest'}]},ctx=()=>({connection:conn,connections:new Map([['guest',conn]]),state,busy:false}),ledger=new HostTurnCommandLedger(authority),coordinator=new HostTurnExecutionCoordinator(ledger);let release;const gate=new Promise(r=>release=r);
 assert.equal((await coordinator.start(command,ctx,async()=>{await gate})).status,'reserved');authority.reset();const nextBase=authority.issue(),next={...command,sessionId:nextBase.sessionId,base:nextBase,commandId:'00000000-0000-4000-8000-000000000002'};assert.equal((await coordinator.start(next,ctx,async()=>assert.fail('must not execute'))).status,'busy');assert.equal(ledger.status(next.sessionId,next.commandId,ctx()),'unknown');assert.equal(authority.issue(),null,'old generation may still write after the reset');release();await coordinator.whenExecutionFinishes();assert.equal(ledger.status(command.sessionId,command.commandId,ctx()),'unknown');
 }finally{await v.close()}
});
