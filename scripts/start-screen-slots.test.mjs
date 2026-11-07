import { test } from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import 'fake-indexeddb/auto';
import { waitForDom } from './helpers/domWait.mjs';

// Slots used to be reachable only from inside a running game, although the start screen
// already received the list. Players who close the tab had no way back into a slot save.
test('the start screen lists database slots and loads one',async()=>{
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,localStorage:globalThis.localStorage,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 globalThis.localStorage=dom.window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let root;
 try{
  const {default:StartScreen}=await vite.ssrLoadModule('/components/StartScreen.tsx');
  const {LocalizationProvider}=await vite.ssrLoadModule('/context/LocalizationContext.tsx');
  const loaded=[];
  const slots=[
    {slotId:1,playerName:'Aria',playerLevel:3,locationName:'Aetheria',turnNumber:7,timestamp:'2026-11-07T09:00:00.000Z',imagesOmitted:false},
    {slotId:2,playerName:'Borin',playerLevel:5,locationName:'Docks',turnNumber:12,timestamp:'2026-11-07T10:30:00.000Z',imagesOmitted:true},
  ];
  root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(React.createElement(LocalizationProvider,null,React.createElement(StartScreen,{
    onStartLocal:()=>{},onLoadGame:async()=>{},onLoadAutosave:async()=>false,autosaveTimestamp:null,
    onLoadFromSlot:async id=>{loaded.push(id)},dbSaveSlots:slots})));});

  const panel=await waitForDom(act,()=>document.querySelector('[data-testid="start-screen-slots"]'),{label:'the slot list'});
  assert.match(panel.textContent,/Slot 1: Aria/);
  assert.match(panel.textContent,/Slot 2: Borin/);
  assert.match(panel.textContent,/Docks/);
  assert.equal(panel.querySelector('[data-testid="start-screen-slot-without-images-2"]')!==null,true,'slots saved without images are flagged');
  assert.equal(panel.querySelector('[data-testid="start-screen-slot-without-images-1"]'),null,'a complete slot has no warning');

  await act(async()=>{panel.querySelector('[data-testid="start-screen-load-slot-2"]').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}))});
  assert.deepEqual(loaded,[2],'the load button asks for its own slot');
 }finally{
  if(root)await act(async()=>root.unmount());
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});
  globalThis.localStorage=old.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;
  dom.window.close();await vite.close();
 }
});
