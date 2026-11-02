import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

test('only the matching host response releases a sync request barrier', async () => {
  const server = await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'error'});
  try {
    const {createMultiplayerManager, stageHostFullSync, commitClientSnapshot} = await server.ssrLoadModule('/hooks/logic/multiplayer.ts');
    const {HostTurnAuthority} = await server.ssrLoadModule('/utils/networkTurnProtocol.ts');
    const noop=()=>{}, state={networkRole:'player',myPeerId:'p'}, history=[{sender:'gm',content:'host'}], logs=[], battles=[];
    const snapshot={gameState:state,gameHistory:history,gameLog:logs,combatLog:battles,lastJsonResponse:null,sceneImagePrompt:null};
    const authority=new HostTurnAuthority(()=> 'session'); const first=authority.issue(), observed={current:first}, pending={current:{stamp:first,snapshot}}, stamp={current:null}, request={current:null}, sent=[]; let renderedHistory=history, scheduled=0;
    const connection={open:true,on:noop,off:noop,send:msg=>sent.push(msg)};
    const manager=createMultiplayerManager({gameStateRef:{current:state},hostConnectionRef:{current:connection},clientTurnStampRef:stamp,pendingClientSyncRef:pending,pendingSyncRequestRef:request,setGameHistory:update=>{renderedHistory=update(renderedHistory)},setError:noop,t:k=>k});
    manager.requestSyncFromHost(); const id=sent[0].payload.syncRequestId; assert.ok(id); assert.equal(request.current,id);
    const render={gameState:state,currentGameState:state,gameHistory:renderedHistory,gameLog:logs,combatLog:battles,lastJsonResponse:null,sceneImagePrompt:null};
    assert.deepEqual(commitClientSnapshot(pending.current,render),first); assert.equal(request.current,id); // effect must not publish this old grant
    const props={observedHostStampRef:observed,clientTurnStampRef:stamp,pendingClientSyncRef:pending,pendingSyncRequestRef:request,activeTurnRef:{current:null},abortControllerRef:{current:null},turnPhaseRef:{current:'idle'},restoreFromSaveData:file=>file,setError:noop,setIsLoading:noop,scheduleClientSyncCommit:()=>scheduled++,t:k=>k};
    authority.revoke(); const fresh=authority.issue(); const identity={role:'player',myPeerId:'p',hostPeerId:'host'};
    assert.equal(stageHostFullSync({payload:{protocol:fresh,saveFile:snapshot,syncRequestId:'other'}},identity,props),'staged'); assert.equal(request.current,id);
    // Multiple queued responses can carry the same revision; the matching duplicate releases the barrier.
    assert.equal(stageHostFullSync({payload:{protocol:fresh,saveFile:snapshot,syncRequestId:id}},identity,props),'ignored'); assert.equal(request.current,null); assert.equal(scheduled,2);
    const hook=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');
    assert.match(hook,/!stamp \|\| !pending \|\| !gameState \|\| pendingSyncRequestRef\.current/);
    assert.match(hook,/queuedHostSyncRequestsRef\.current\.add\(syncRequestId\)/);
    assert.match(hook,/networkRole === 'host' && hostRestorePendingRef\.current/);
    assert.match(hook,/hostHistoryHoldRef\.current = hostTurnAuthorityRef\.current!\.beginMutation\(\)/);
  } finally {await server.close();}
});
