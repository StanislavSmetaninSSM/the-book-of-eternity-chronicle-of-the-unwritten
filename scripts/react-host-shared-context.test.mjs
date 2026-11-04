import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';
import React, {useRef,useState,useEffect,act,startTransition} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('host shared edits revoke authority before scheduling and hold it across partial React commits',async()=>{
 const source=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8'),src=ts.createSourceFile('hook.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS); const cb={};let commit;
 function visit(n){if(ts.isVariableDeclaration(n)&&['beginSharedContextEdit','clearPendingContextEdits','updateGameSettings','updateSuperInstructions','setUserWorldState','setUserWorldMap','setUserVisitedLocations','setUserGameLog','setUserCombatLog','setPresentationGameLog'].includes(n.name.getText(src))&&n.initializer&&ts.isCallExpression(n.initializer))cb[n.name.getText(src)]=n.initializer.arguments[0].getText(src);if(ts.isCallExpression(n)&&n.expression.getText(src)==='useEffect'&&n.arguments[0]?.getText(src).includes('contextEdits.settings'))commit=n.arguments[0].getText(src);ts.forEachChild(n,visit)}visit(src);
 assert.ok(commit); assert.equal(Object.keys(cb).length,10);
 assert.match(source,/setGameLog: setUserGameLog, setCombatLog: setUserCombatLog/);
 assert.match(source,/setVisitedLocations: setUserVisitedLocations,[\s\S]*?setWorldMap: setUserWorldMap, setWorldState: setUserWorldState/);
 assert.match(source,/const deleteLocationThreat[\s\S]*?setUserWorldMap\([\s\S]*?setUserVisitedLocations\(/);
 assert.match(source,/const editLocationData = [\s\S]*?setUserWorldMap\([\s\S]*?setUserVisitedLocations\(/);
 const script=ts.transpileModule(`const beginSharedContextEdit=${cb.beginSharedContextEdit}; const clearPendingContextEdits=${cb.clearPendingContextEdits}; const setUserWorldState=${cb.setUserWorldState}; const setUserWorldMap=${cb.setUserWorldMap}; const setUserVisitedLocations=${cb.setUserVisitedLocations}; const setUserGameLog=${cb.setUserGameLog}; const setUserCombatLog=${cb.setUserCombatLog}; const setPresentationGameLog=${cb.setPresentationGameLog}; const updateGameSettings=${cb.updateGameSettings}; const updateSuperInstructions=${cb.updateSuperInstructions}; const checkCommit=${commit};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'}); const dom=new JSDOM('<div id="root"></div>');const oldWindow=globalThis.window,oldDocument=globalThis.document,oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let root;
 try {
  const {recordPresentationLog}=await server.ssrLoadModule('/utils/presentationLogSync.ts');
  const {HostTurnAuthority}=await server.ssrLoadModule('/utils/networkTurnProtocol.ts');
  const {beginGameplayMutation,gameplayMutationCommitted}=await server.ssrLoadModule('/utils/gameplayMutationGate.ts');
  const {sharedSettingsEqual,isLocalPreferenceKey,updateLocalPreferences}=await server.ssrLoadModule('/utils/localGamePreferences.ts');
  const authority=new HostTurnAuthority(()=> 'session'),state={networkRole:'host'},history=[];let api,events=[],aborts=0;
  function Harness(){
   const [gameSettings,setGameSettings]=useState({hardMode:false,uiFontScale:1}),[superInstructions,setSuperInstructions]=useState('old'),[worldState,setWorldState]=useState({day:1}),[worldMap,setWorldMap]=useState({old:{}}),[visitedLocations,setVisitedLocations]=useState([]),[gameLog,setGameLog]=useState(['old log']),[combatLog,setCombatLog]=useState(['old combat']),[contextEditEpoch,setContextEditEpoch]=useState(0),[snapshotEpoch,setSnapshotEpoch]=useState(0);
   const gameStateRef=useRef(state),gameHistoryRef=useRef(history),gameplayMutationRevisionRef=useRef(0),gameplayMutationAppliedRef=useRef(0),gameplayMutationPendingRef=useRef(false),stateMutationAppliedRef=useRef(0),stateMutationRevisionRef=useRef(0),historyMutationAppliedRef=useRef(0),historyMutationRevisionRef=useRef(0),hostHistoryHoldRef=useRef(null),hostContextHoldRef=useRef(null),hostTurnAuthorityRef=useRef(authority),contextEditGenerationRef=useRef(0),contextEditRef=useRef({settings:{revision:0,applied:0,expected:null},instructions:{revision:0,applied:0,expected:''},world:{revision:0,applied:0,expected:null},map:{revision:0,applied:0,expected:{}},visited:{revision:0,applied:0,expected:[]},gameLog:{revision:0,applied:0,expected:[]},combatLog:{revision:0,applied:0,expected:[]}}),activeTurnRef=useRef(Symbol('turn')),turnPhaseRef=useRef('generating'),abortControllerRef=useRef({abort:()=>aborts++}),localPreferencesRef=useRef({});
   const scope={pendingPartyTransitionRef:{current:null},recordPresentationLog,hostRestorePendingRef:{current:null},pendingClientSyncRef:{current:null},beginGameplayMutation,gameplayMutationCommitted,sharedSettingsEqual,isLocalPreferenceKey,updateLocalPreferences,gameStateRef,gameHistoryRef,gameplayMutationRevisionRef,gameplayMutationAppliedRef,gameplayMutationPendingRef,stateMutationAppliedRef,stateMutationRevisionRef,historyMutationAppliedRef,historyMutationRevisionRef,hostHistoryHoldRef,hostContextHoldRef,hostTurnAuthorityRef,contextEditGenerationRef,contextEditRef,activeTurnRef,turnPhaseRef,abortControllerRef,localPreferencesRef,setContextEditEpoch,setSnapshotEpoch,setGameSettings,setSuperInstructions,setWorldState,setWorldMap,setVisitedLocations,setGameLog,setCombatLog,gameLog,combatLog,worldState,worldMap,visitedLocations,gameState:state,gameHistory:history,gameSettings,superInstructions,userGameplayActionBlocked:()=>false,initializeAndPreviewSound:()=>{},queueMicrotask};
   vm.runInNewContext(`${script}\nthis.callbacks={updateGameSettings,updateSuperInstructions,clearPendingContextEdits,setUserWorldState,setUserWorldMap,setUserVisitedLocations,setUserGameLog,setUserCombatLog,setPresentationGameLog,checkCommit,setGameSettings};`,scope);api=scope.callbacks;
   useEffect(()=>{api.checkCommit();events.push({settings:gameSettings,instructions:superInstructions,world:worldState,map:worldMap,visited:visitedLocations,gameLog,combatLog,hold:!!hostContextHoldRef.current,pending:gameplayMutationPendingRef.current});});
   return null;
  }
  root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(Harness));});
  const initial=authority.issue();assert.ok(initial);
  await act(async()=>{
   startTransition(()=>api.updateGameSettings({hardMode:true}));
   assert.equal(authority.issue(),null,'grant revoked before queued setting commits');
   assert.equal(authority.accept({turnId:'0123456789012345',base:initial},'p','p','p'), 'pending');
   flushSync(()=>api.updateSuperInstructions('new'));
   assert.equal(events.at(-1).instructions,'new');assert.equal(events.at(-1).settings.hardMode,false);
   assert.equal(events.at(-1).hold,true);assert.equal(authority.issue(),null);
  });
  assert.equal(events.at(-1).settings.hardMode,true);assert.equal(events.at(-1).instructions,'new');assert.equal(events.at(-1).hold,false);assert.equal(events.at(-1).pending,false);assert.ok(authority.issue());assert.equal(aborts,2);
  await act(async()=>{flushSync(()=>api.updateGameSettings({uiFontScale:2}));});assert.ok(authority.issue());assert.equal(aborts,2);
  await act(async()=>{flushSync(()=>api.updateSuperInstructions('new'));});assert.ok(authority.issue(),'same-value update releases hold');assert.equal(events.at(-1).pending,false);
  await act(async()=>{
   startTransition(()=>api.updateGameSettings({hardMode:false}));
   flushSync(()=>{api.clearPendingContextEdits();api.setGameSettings({hardMode:true,uiFontScale:3});});
  });
  assert.equal(events.at(-1).settings.hardMode,true,'local restore supersedes a deferred edit');
  assert.equal(events.at(-1).pending,false);assert.ok(authority.issue());
  const nextWorld={day:2},nextMap={new:{}},nextVisited=[{name:'new'}];
  await act(async()=>{
   startTransition(()=>{api.setUserWorldMap(nextMap);api.setUserVisitedLocations(nextVisited);});
   assert.equal(authority.issue(),null);
   flushSync(()=>api.setUserWorldState(nextWorld));
   assert.equal(events.at(-1).world,nextWorld);assert.notEqual(events.at(-1).map,nextMap);
   assert.equal(events.at(-1).hold,true);assert.equal(authority.issue(),null);
  });
  assert.equal(events.at(-1).world,nextWorld);assert.equal(events.at(-1).map,nextMap);assert.equal(events.at(-1).visited,nextVisited);
  assert.equal(events.at(-1).pending,false);assert.ok(authority.issue());
  const clearedGame=[], clearedCombat=[];
  await act(async()=>{
   startTransition(()=>api.setUserGameLog(clearedGame));
   assert.equal(authority.issue(),null);
   flushSync(()=>api.setUserCombatLog(clearedCombat));
   assert.equal(events.at(-1).combatLog,clearedCombat);assert.notEqual(events.at(-1).gameLog,clearedGame);
   assert.equal(events.at(-1).hold,true);assert.equal(authority.issue(),null);
  });
  assert.equal(events.at(-1).gameLog,clearedGame);assert.equal(events.at(-1).combatLog,clearedCombat);
  assert.equal(events.at(-1).pending,false);assert.ok(authority.issue());
  const clearedAgain=[];
  await act(async()=>{
   startTransition(()=>api.setUserGameLog(clearedAgain));
   flushSync(()=>api.setPresentationGameLog(previous=>['movie',...previous]));
   assert.equal(events.at(-1).hold,true);assert.equal(authority.issue(),null);
  });
  assert.deepEqual(events.at(-1).gameLog,['movie']);
  assert.equal(events.at(-1).pending,false);assert.ok(authority.issue(),'presentation log should not deadlock a committed clear');
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=oldWindow;globalThis.document=oldDocument;globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct;dom.window.close();await server.close();}
});
