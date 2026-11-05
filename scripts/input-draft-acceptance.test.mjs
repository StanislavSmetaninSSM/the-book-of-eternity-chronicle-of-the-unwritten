import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import 'fake-indexeddb/auto';

test('input retains text and image on rejection and clears only after acceptance', async () => {
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,localStorage:globalThis.localStorage,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 globalThis.window=dom.window;globalThis.document=dom.window.document;Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.localStorage=dom.window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let root;
 try {
  const {default:InputBar}=await vite.ssrLoadModule('/components/InputBar.tsx');
  const {LocalizationProvider}=await vite.ssrLoadModule('/context/LocalizationContext.tsx');
  const {savePlayerActionDraft,loadPlayerActionDraft}=await vite.ssrLoadModule('/utils/fileManager.ts');
  const image={dataUrl:'data:image/png;base64,YWJj',mimeType:'image/png'};
  await savePlayerActionDraft('draft-p',{content:'Hold the bridge',isQuestionMode:true,image});
  let release;let received=[]; const gate=()=>new Promise(r=>release=r);
  const submit=(...args)=>{received.push(args);return gate()};const noop=()=>{};
  const props={onSendMessage:submit,onAskQuestion:submit,onCancelRequest:noop,onClearHalfHistory:noop,isLoading:false,history:[],suggestedActions:[],gameState:null,playerCharacter:{playerId:'draft-p'},gameSettings:null,onGetMusicSuggestion:noop,isMusicLoading:false,isMusicPlayerVisible:false,onToggleStealth:noop,isMusicPlayerDocked:false,undockMusicPlayer:noop,isMusicPlaying:false,musicStatus:'stopped',playPauseMusicRef:{current:noop}};
  root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(React.createElement(LocalizationProvider,null,React.createElement(InputBar,props)));await new Promise(r=>setTimeout(r,80))});
  await act(async()=>{await new Promise(r=>setTimeout(r,40))});
  assert.equal(document.querySelector('textarea').value,'Hold the bridge');assert.ok(document.querySelector('img[alt="Selected preview"]'));
  await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.deepEqual(received[0],['Hold the bridge',{data:'YWJj',mimeType:'image/png'}]);
  await act(async()=>{release(false);await new Promise(r=>setTimeout(r,30))});
  assert.equal(document.querySelector('textarea').value,'Hold the bridge');assert.ok(document.querySelector('img[alt="Selected preview"]'));assert.deepEqual((await loadPlayerActionDraft('draft-p')).image,image);
  await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  await act(async()=>{release(true);await new Promise(r=>setTimeout(r,30))});
  assert.equal(document.querySelector('textarea').value,'');assert.equal(document.querySelector('img[alt="Selected preview"]'),null);
  await new Promise(r=>setTimeout(r,40));assert.equal(await loadPlayerActionDraft('draft-p'),null);
 } finally {if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});globalThis.localStorage=old.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;dom.window.close();await vite.close()}
});
