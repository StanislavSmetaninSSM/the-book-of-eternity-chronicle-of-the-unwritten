import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import 'fake-indexeddb/auto';

// Component-level check of the debounced draft: the toolbar is a real editing
// path (it replaces the whole text), so it drives the same state as typing.
test('edits are persisted after the debounce and cleared only after acceptance',async()=>{
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,localStorage:globalThis.localStorage,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 globalThis.localStorage=dom.window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let root;
 try{
  const {default:InputBar}=await vite.ssrLoadModule('/components/InputBar.tsx');
  const {LocalizationProvider}=await vite.ssrLoadModule('/context/LocalizationContext.tsx');
  const {savePlayerActionDraft,loadPlayerActionDraft}=await vite.ssrLoadModule('/utils/fileManager.ts');
  await savePlayerActionDraft('draft-integration',null);
  const noop=()=>{};
  let releaseSubmit;const submit=()=>new Promise(resolve=>{releaseSubmit=resolve});
  const props={onSendMessage:submit,onAskQuestion:submit,onCancelRequest:noop,onClearHalfHistory:noop,isLoading:false,history:[],suggestedActions:[],gameState:null,playerCharacter:{playerId:'draft-integration'},gameSettings:null,onGetMusicSuggestion:noop,isMusicLoading:false,isMusicPlayerVisible:false,onToggleStealth:noop,isMusicPlayerDocked:false,undockMusicPlayer:noop,isMusicPlaying:false,musicStatus:'stopped',playPauseMusicRef:{current:noop}};
  root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(React.createElement(LocalizationProvider,null,React.createElement(InputBar,props)))});
  await act(async()=>{await new Promise(r=>setTimeout(r,150))});
  const bold=()=>[...document.querySelectorAll('button')].find(b=>b.title==='Bold');
  const textarea=()=>document.querySelector('textarea');

  await act(async()=>bold().click());
  assert.equal(textarea().value,'****');
  await act(async()=>{await new Promise(r=>setTimeout(r,120))});
  assert.equal(await loadPlayerActionDraft('draft-integration'),null,'edits must be debounced, not written per change');
  await act(async()=>{await new Promise(r=>setTimeout(r,400))});
  assert.equal((await loadPlayerActionDraft('draft-integration')).content,'****');

  await act(async()=>bold().click());
  assert.equal(textarea().value,'********');
  await act(async()=>{document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))});
  await act(async()=>{releaseSubmit(true);await new Promise(r=>setTimeout(r,80))});
  assert.equal(textarea().value,'');
  await act(async()=>{await new Promise(r=>setTimeout(r,500))});
  assert.equal(await loadPlayerActionDraft('draft-integration'),null,'the queued write must not recreate a submitted draft');
 }finally{
  if(root)await act(async()=>root.unmount());
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});
  globalThis.localStorage=old.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;
  dom.window.close();await vite.close();
 }
});
