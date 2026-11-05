import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

// Chat rendering must stay cheap on long histories: markdown is parsed once, memoized
// across renders, and past messages are not re-rendered when unrelated UI state changes.
test('markdown is memoized and long chats do not re-parse unchanged messages',async()=>{
 const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
 const old={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 // jsdom has no layout engine; ChatWindow auto-scrolls to the newest message.
 dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 let root;
 try{
  const {default:MarkdownRenderer}=await vite.ssrLoadModule('/components/MarkdownRenderer.tsx');
  const {default:ChatWindow}=await vite.ssrLoadModule('/components/ChatWindow.tsx');
  const {LocalizationProvider}=await vite.ssrLoadModule('/context/LocalizationContext.tsx');
  const {SpeechProvider}=await vite.ssrLoadModule('/context/SpeechContext.tsx');

  assert.equal(MarkdownRenderer.$$typeof,Symbol.for('react.memo'),'MarkdownRenderer must be memoized');

  // Behaviour: markdown is converted and HTML is sanitized.
  const host=document.getElementById('root');
  root=createRoot(host);
  await act(async()=>{root.render(React.createElement(MarkdownRenderer,{content:'**bold** <script>alert(1)</script>'}))});
  assert.match(host.innerHTML,/<strong>bold<\/strong>/);
  assert.equal(host.innerHTML.includes('<script'),false,'sanitizer must strip scripts');

  // Inline mode keeps the span wrapper.
  await act(async()=>{root.render(React.createElement(MarkdownRenderer,{content:'*em*',inline:true}))});
  assert.match(host.innerHTML,/^<span[^>]*><em>em<\/em><\/span>$/);

  // Cache: re-rendering the same content must not parse it again.
  // Vite externalizes node_modules in SSR, so this is the same instance the renderer uses.
  const marked=await import('marked');
  let parseCalls=0;
  const originalParse=marked.marked.parse;
  marked.marked.parse=function(...args){parseCalls+=1;return originalParse.apply(this,args)};
  try{
   await act(async()=>{root.render(React.createElement(MarkdownRenderer,{content:'cached **value**'}))});
   const firstPass=parseCalls;
   assert.equal(firstPass,1);
   await act(async()=>{root.render(React.createElement(MarkdownRenderer,{content:'cached **value**'}))});
   await act(async()=>{root.render(React.createElement('div',null))});
   await act(async()=>{root.render(React.createElement(MarkdownRenderer,{content:'cached **value**'}))});
   assert.equal(parseCalls,firstPass,'repeated renders must reuse the parsed HTML');

   // Long history: mount once, then re-render with an unrelated prop change.
   const history=Array.from({length:120},(_,index)=>({sender:index%2?'gm':'player',content:`message ${index} with **bold** text`}));
   const baseProps={history,error:null,onDeleteMessage:()=>{},onShowMessageModal:()=>{},onShowEditModal:()=>{},allowHistoryManipulation:false,isLoading:false};
   parseCalls=0;
   await act(async()=>{root.render(React.createElement(LocalizationProvider,null,React.createElement(SpeechProvider,null,React.createElement(ChatWindow,baseProps))))});
   const mountCalls=parseCalls;
   assert.equal(mountCalls,history.length,'each message is parsed exactly once on mount');
   assert.equal(host.querySelectorAll('.chat-message-content').length,history.length);

   await act(async()=>{root.render(React.createElement(LocalizationProvider,null,React.createElement(SpeechProvider,null,React.createElement(ChatWindow,{...baseProps,isLoading:true}))))});
   assert.equal(parseCalls,mountCalls,'an unrelated prop change must not re-parse the whole history');
   assert.equal(host.querySelectorAll('.chat-message-content').length,history.length);

   // Unrelated state is still wired: history manipulation toggles the edit affordance.
   await act(async()=>{root.render(React.createElement(LocalizationProvider,null,React.createElement(SpeechProvider,null,React.createElement(ChatWindow,{...baseProps,allowHistoryManipulation:true}))))});
   assert.ok([...host.querySelectorAll('button')].some(button=>button.getAttribute('aria-label')==='Edit'));
  }finally{marked.marked.parse=originalParse}

  // Source shape: rows are memoized and markdown no longer renders through an async effect.
  const {readFile}=await import('node:fs/promises');
  const chat=await readFile(new URL('../components/ChatWindow.tsx',import.meta.url),'utf8');
  const renderer=await readFile(new URL('../components/MarkdownRenderer.tsx',import.meta.url),'utf8');
  assert.match(chat,/const ChatMessageRow = React\.memo/);
  assert.match(chat,/strippedContents = useMemo/);
  assert.equal(/await\s+marked\.parse/.test(renderer),false,'parsing must be synchronous so the first paint already has content');
  assert.match(renderer,/useMemo/);
 }finally{
  if(root)await act(async()=>root.unmount());
  globalThis.window=old.window;globalThis.document=old.document;
  Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});
  globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;
  dom.window.close();await vite.close();
 }
});
