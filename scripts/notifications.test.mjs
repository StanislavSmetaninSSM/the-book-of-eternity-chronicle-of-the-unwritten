import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

// alert() is blocked inside the Arena iframe, so user-facing messages must go through
// the in-app notification host. These checks cover the bus, the toast behaviour and the
// absence of blocking dialogs in app code.
test('notifications render as dismissible toasts instead of blocking dialogs',async()=>{
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let root;
 try{
  const bus=await vite.ssrLoadModule('/utils/notifications.ts');
  const {default:NotificationHost}=await vite.ssrLoadModule('/components/NotificationHost.tsx');
  bus.resetNotificationBusForTests();

  // Without a mounted host the message is still logged instead of lost silently.
  const logged=[];
  const originalWarn=console.warn;
  console.warn=(...args)=>logged.push(args.join(' '));
  bus.notify('boot warning','warning');
  console.warn=originalWarn;
  assert.match(logged.join('\n'),/boot warning/);
  assert.equal(bus.notify('   ',  'info'),0,'empty messages are ignored');

  root=createRoot(document.getElementById('root'));
  const host=document.getElementById('root');
  await act(async()=>{root.render(React.createElement(NotificationHost))});
  assert.equal(host.querySelector('[data-testid="notification-host"]'),null,'nothing is rendered while the queue is empty');

  await act(async()=>{bus.notifySuccess('Game saved to slot 1.')});
  assert.equal(host.querySelector('[data-testid="notification-host"]').children.length,1);
  assert.match(host.textContent,/Game saved to slot 1\./);
  assert.equal(host.querySelector('[role="status"]')?.textContent?.includes('Game saved to slot 1.'),true);

  await act(async()=>{bus.notifyError('Failed to save game.')});
  assert.equal(host.querySelectorAll('[role="alert"]').length,1,'errors are announced assertively');
  assert.equal(host.textContent.includes('Failed to save game.'),true);

  // Dismissing removes exactly one toast.
  const dismissButtons=[...host.querySelectorAll('button[aria-label="Dismiss notification"]')];
  assert.equal(dismissButtons.length,2);
  await act(async()=>{dismissButtons[0].dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}))});
  assert.equal(host.textContent.includes('Game saved to slot 1.'),false);
  assert.equal(host.textContent.includes('Failed to save game.'),true);

  // Toasts expire on their own.
  await act(async()=>{bus.notify('short lived','info')});
  assert.equal(host.textContent.includes('short lived'),true);
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,6300))});
  assert.equal(host.textContent.includes('short lived'),false,'info toasts auto-dismiss');

  // The source no longer contains blocking dialogs in app code.
  const files=execFileSync('rg',['-l','alert\\(','--glob','!node_modules','--glob','!scripts/**','--glob','!dist*','components','hooks','utils','context','App.tsx','index.tsx'],{encoding:'utf8'})
    .split('\n').filter(Boolean)
    .filter(file=>!file.endsWith('utils/notifications.ts'))
    .filter(file=>!file.endsWith('components/NotificationHost.tsx'));
  assert.deepEqual(files,[],'use notify()/notifyError() instead of alert()');
  const indexSource=await readFile(new URL('../index.tsx',import.meta.url),'utf8');
  assert.match(indexSource,/NotificationHost/,'the toast host must be mounted in the app root');
 }finally{
  if(root)await act(async()=>root.unmount());
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});
  globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;
  dom.window.close();await vite.close();
 }
});
