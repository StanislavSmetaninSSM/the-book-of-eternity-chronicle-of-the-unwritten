import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

test('guest stash destruction asks for confirmation and rejects a replaced snapshot', async () => {
 const vite=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const dom=new JSDOM('<div id="root"></div><div id="modal-root"></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 globalThis.window=dom.window;globalThis.document=dom.window.document;Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let root;
 try {
  const {default:StashView}=await vite.ssrLoadModule('/components/StashView.tsx'),{LocalizationProvider}=await vite.ssrLoadModule('/context/LocalizationContext.tsx');
  const item={existedId:'x',name:'Potion',count:1,weight:1,quality:'Common'},calls=[];
  const render=stash=>React.createElement(LocalizationProvider,null,React.createElement(StashView,{stash,confirmDrop:true,playerCharacter:{totalWeight:0,maxWeight:10,criticalExcessWeight:2},gameSettings:{disableImageGeneration:true},imageCache:{},onImageGenerated:()=>{},onTake:()=>{},onDrop:value=>calls.push(value)}));
  const click=text=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);assert.ok(button,`missing ${text}`);button.click()};
  root=createRoot(document.getElementById('root'));await act(async()=>root.render(render([item])));await act(async()=>click('Drop'));assert.equal(calls.length,0);assert.match(document.querySelector('[role=dialog]').textContent,/Permanently discard Potion/);
  await act(async()=>root.render(render([{...item}])));await act(async()=>click('Yes'));assert.equal(calls.length,0,'confirmation of an older snapshot must not send a new command');assert.match(document.querySelector('[role=alert]').textContent,/stash changed/i);
  await act(async()=>click('Drop'));await act(async()=>click('No'));assert.equal(calls.length,0);
  await act(async()=>click('Drop'));await act(async()=>click('Yes'));assert.equal(calls.length,1);assert.equal(calls[0].existedId,'x');
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;dom.window.close();await vite.close()}
});
