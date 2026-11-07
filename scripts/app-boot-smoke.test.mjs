import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import 'fake-indexeddb/auto';
import { waitForDom } from './helpers/domWait.mjs';

// The sandbox cannot run a real Chromium build, so this smoke boots the whole
// application shell (not just one component) in JSDOM. It covers the setup
// screen, local party selection and crash-free rendering through the real
// providers; it does not replace a browser check of the generated build.
test('the application shell boots into the local setup screen',async()=>{
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,localStorage:globalThis.localStorage,act:globalThis.IS_REACT_ACT_ENVIRONMENT,ResizeObserver:globalThis.ResizeObserver,fetch:globalThis.fetch};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 globalThis.localStorage=dom.window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 dom.window.matchMedia=dom.window.matchMedia||(q=>({matches:false,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){},onchange:null,dispatchEvent(){return false}}));
 class ResizeObserver{observe(){}unobserve(){}disconnect(){}}
 globalThis.ResizeObserver=ResizeObserver;dom.window.ResizeObserver=ResizeObserver;
 dom.window.scrollTo=()=>{};
 dom.window.HTMLMediaElement.prototype.play=()=>Promise.resolve();
 dom.window.HTMLMediaElement.prototype.pause=()=>{};
 const stubFetch=async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}});
 globalThis.fetch=stubFetch;dom.window.fetch=stubFetch;
 let root;
 try {
  const {default:App}=await vite.ssrLoadModule('/App.tsx');
  const {LocalizationProvider}=await vite.ssrLoadModule('/context/LocalizationContext.tsx');
  const {SpeechProvider}=await vite.ssrLoadModule('/context/SpeechContext.tsx');
  root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(React.createElement(LocalizationProvider,null,React.createElement(SpeechProvider,null,React.createElement(App))))});
  const buttons=()=>[...document.querySelectorAll('button')];
  const label=b=>b.textContent.trim();
  await waitForDom(act,()=>buttons().some(b=>label(b)==='Full Party'),{label:'the setup screen'});
  assert.ok(document.body.textContent.includes('Choose Your Universe'));
  assert.ok(!/something went wrong|unexpected error/i.test(document.body.textContent));
  const fullParty=buttons().find(b=>label(b)==='Full Party');
  assert.ok(fullParty, 'local party mode is offered by the setup screen');
  await act(async()=>fullParty.click());
  assert.match(document.body.textContent,/one player controls several separate characters/i);
  await act(async()=>buttons().find(b=>label(b)==='Multiple Personalities').click());
  assert.match(document.body.textContent,/one player controls multiple personalities/i);
  assert.ok(!buttons().some(b=>/network game|host game|join game/i.test(label(b))));
 } finally {
  if(root)await act(async()=>root.unmount());
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});
  globalThis.localStorage=old.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;
  globalThis.ResizeObserver=old.ResizeObserver;globalThis.fetch=old.fetch;
  dom.window.close();await vite.close();
 }
});
