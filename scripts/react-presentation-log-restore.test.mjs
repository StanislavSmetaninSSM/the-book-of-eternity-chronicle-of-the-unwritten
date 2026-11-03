import {test} from 'node:test'; import assert from 'node:assert/strict'; import {readFile} from 'node:fs/promises'; import ts from 'typescript'; import vm from 'node:vm';
import React,{act,useEffect,useRef,useState,startTransition} from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom'; import {JSDOM} from 'jsdom'; import {createServer} from 'vite';

test('presentation log updates do not strand host or client snapshot commits',async()=>{
 const source=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');const src=ts.createSourceFile('hook.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let callback;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='setPresentationGameLog')callback=n.initializer.arguments[0].getText(src);ts.forEachChild(n,visit)}visit(src);assert.ok(callback);
 const js=ts.transpileModule(`this.callback=${callback}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});const dom=new JSDOM('<div id="root"></div>');const old={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT};globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;let root;
 try {const {snapshotMatchesRendered,commitClientSnapshot}=await server.ssrLoadModule('/hooks/logic/multiplayer.ts');const {recordPresentationLog}=await server.ssrLoadModule('/utils/presentationLogSync.ts');
  for(const role of ['host','player']){
   const state={networkRole:role,encounteredNPCs:[],encounteredFactions:[]},history=[],combat=[],settings={language:'en'},world={day:1},map={},visited=[]; const base=['remote'];
   const snapshot={gameState:state,gameHistory:history,gameLog:base,combatLog:combat,lastJsonResponse:null,sceneImagePrompt:null,gameContext:{gameSettings:settings,superInstructions:'',worldState:world,worldMap:map,visitedLocations:visited,currentTurnNumber:1}};let api,events=[];
   function Harness(){const [gameLog,setGameLog]=useState(['old']),[,setContextEditEpoch]=useState(0); const hostRestorePendingRef=useRef(role==='host'?{snapshot}:null),pendingClientSyncRef=useRef(role==='player'?{snapshot}:null),contextEditRef=useRef({gameLog:{revision:0,applied:0,expected:[]}});
    const scope={recordPresentationLog,setGameLog,hostRestorePendingRef,pendingClientSyncRef,contextEditRef,setContextEditEpoch,queueMicrotask};vm.runInNewContext(js,scope);api={media:scope.callback,setGameLog,pending:()=>hostRestorePendingRef.current || pendingClientSyncRef.current};
    useEffect(()=>{events.push({gameLog,matched:snapshotMatchesRendered(snapshot,{gameState:state,currentGameState:state,gameHistory:history,gameLog,combatLog:combat,lastJsonResponse:null,sceneImagePrompt:null,worldState:world,gameSettings:settings,superInstructions:'',worldMap:map,visitedLocations:visited,turnNumber:1},(hostRestorePendingRef.current || pendingClientSyncRef.current)?.allowedGameLogs)});});return null;}
   root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(Harness)));
   await act(async()=>{startTransition(()=>api.setGameLog(base));flushSync(()=>api.media(previous=>['movie',...previous]));});
   assert.deepEqual(events.at(-1).gameLog,['movie','remote'],role);assert.equal(events.at(-1).matched,true,`${role}: committed restore plus media must release barrier`);
   assert.equal(snapshot.gameLog,base,'authoritative snapshot is never mutated');
   const truncated=['wrong'];recordPresentationLog(api.pending(),base,truncated);assert.equal(api.pending().allowedGameLogs?.has(truncated),false,'a destructive log change is not presentation evidence');
   const unrelated=['movie','remote'];const rendered={gameState:state,currentGameState:state,gameHistory:history,gameLog:unrelated,combatLog:combat,lastJsonResponse:null,sceneImagePrompt:null,worldState:world,gameSettings:settings,superInstructions:'',worldMap:map,visitedLocations:visited,turnNumber:1};
   assert.equal(snapshotMatchesRendered(snapshot,rendered,api.pending().allowedGameLogs),false,'equal-looking untracked logs are not evidence of commit');
   if(role==='player'){const stamp={sessionId:'s',revision:1};assert.equal(commitClientSnapshot({...api.pending(),stamp},rendered),null);rendered.gameLog=events.at(-1).gameLog;assert.equal(commitClientSnapshot({...api.pending(),stamp},rendered),stamp);}
   await act(async()=>flushSync(()=>api.media(previous=>['music',...previous])));
   assert.deepEqual(events.at(-1).gameLog,['music','movie','remote']);assert.equal(events.at(-1).matched,true,'a chain of presentation updates remains recognised');
   await act(async()=>root.unmount());root=null;
  }
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;dom.window.close();await server.close()}
});
