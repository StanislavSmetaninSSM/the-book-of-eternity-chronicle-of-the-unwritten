import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

// Typing must not write the draft on every keystroke, and no hand-over point
// (character switch, unmount, accepted submit) may lose or resurrect a draft.
test('draft writes are debounced, flushed and cancelled',async()=>{
 const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'error'});
 try{
  const {createDebouncedDraftSaver}=await server.ssrLoadModule('/utils/debouncedDraftSaver.ts');
  const writes=[];
  let now=0;
  const timers=[];
  const scheduleTimer=(callback,ms)=>timers.push({callback,at:now+ms,id:timers.length+1});
  const clearTimer=({id})=>{const timer=timers.find(t=>t.id===id);if(timer)timer.cleared=true};
  const advance=ms=>{
   now+=ms;
   for(const timer of timers.slice()){
    if(!timer.cleared&&timer.at<=now){timer.cleared=true;timer.callback()}
   }
  };
  const saver=createDebouncedDraftSaver(async(key,draft)=>{writes.push({key,draft})},400,scheduleTimer,clearTimer);

  saver.schedule('p',{content:'H',isQuestionMode:false});
  saver.schedule('p',{content:'He',isQuestionMode:false});
  saver.schedule('p',{content:'Hel',isQuestionMode:false});
  advance(399);
  assert.equal(writes.length,0,'a debounced write must not run before its delay');
  advance(1);
  assert.equal(writes.length,1);
  assert.equal(writes[0].draft.content,'Hel','only the latest keystroke is written');

  // Switching character flushes the queued draft immediately.
  saver.schedule('p',{content:'Pending',isQuestionMode:false});
  assert.equal(saver.hasPending(),true);
  saver.flush();
  assert.equal(writes.length,2);
  assert.equal(writes[1].draft.content,'Pending');
  advance(1000);
  assert.equal(writes.length,2,'a flushed write must not fire again');

  // An accepted submission cancels the queue instead of recreating the draft.
  saver.schedule('p',{content:'Submitted',isQuestionMode:false});
  saver.cancel();
  advance(1000);
  assert.equal(writes.length,2);
  assert.equal(saver.hasPending(),false);

  // An empty draft is persisted as a deletion.
  saver.schedule('p',null);
  saver.flush();
  assert.equal(writes.length,3);
  assert.equal(writes[2].draft,null);
 }finally{await server.close()}
});
