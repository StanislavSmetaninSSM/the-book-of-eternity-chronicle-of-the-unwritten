import { test } from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import 'fake-indexeddb/auto';

test('setup offers local party modes without hosting or joining',async()=>{
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,localStorage:globalThis.localStorage,act:globalThis.IS_REACT_ACT_ENVIRONMENT};globalThis.window=dom.window;globalThis.document=dom.window.document;Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.localStorage=dom.window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;let root;
 try{
  const {default:StartScreen}=await vite.ssrLoadModule('/components/StartScreen.tsx');const {LocalizationProvider}=await vite.ssrLoadModule('/context/LocalizationContext.tsx');
  const noop=()=>{};root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(React.createElement(LocalizationProvider,null,React.createElement(StartScreen,{onStartLocal:noop,onLoadGame:noop,onLoadAutosave:noop,autosaveTimestamp:null,onLoadFromSlot:noop,dbSaveSlots:[]})));});
  await act(async()=>{await new Promise(r=>setTimeout(r,150))});
  const buttons=[...document.querySelectorAll('button')];const label=b=>b.textContent.trim();
  assert.ok(buttons.some(b=>label(b)==='Full Party'));assert.ok(buttons.some(b=>label(b)==='Multiple Personalities'));
  assert.ok(!buttons.some(b=>/network game|host game|join game/i.test(label(b))));
  await act(async()=>buttons.find(b=>label(b)==='Multiple Personalities').click());
  assert.match(document.body.textContent,/one player controls multiple personalities/i);
  assert.ok(document.body.textContent.includes('Shared characteristics'));
  await act(async()=>buttons.find(b=>label(b)==='Full Party').click());
  assert.match(document.body.textContent,/one player controls several separate characters/i);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});globalThis.localStorage=old.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;dom.window.close();await vite.close()}
});
