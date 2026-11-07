import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

// Editing a game state must not copy megabytes of cached base64 images. The
// shortcut is only safe while the rest of the state keeps deep-clone semantics
// and the cache is never mutated in place, which this test pins down.

test('editable clone skips image payloads but keeps deep-copy semantics',async()=>{
 const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'error'});
 try{
  const {cloneGameStateForEdit}=await server.ssrLoadModule('/utils/gameStateClone.ts');
  const image='data:image/png;base64,'+'A'.repeat(1_500_000);
  const imageCache={};
  for(let i=0;i<12;i++) imageCache[`prompt-${i}`]={src:image,sourceProvider:'Arena GM'};
  const state={
   playerCharacter:{playerId:'p',name:'First',inventory:[{existedId:'i1',name:'Sword',tags:['a']}],equippedItems:{MainHand:'i1'}},
   players:[{playerId:'p',name:'First',inventory:[{existedId:'i1',name:'Sword',tags:['a']}]}],
   activePlayerIndex:0,imageCache,
   encounteredNPCs:[{NPCId:'n1',name:'Bob',inventory:[]}],
   encounteredFactions:[{factionId:'f1',name:'Guild'}],
   activeQuests:[{questId:'q1',title:'Quest'}],completedQuests:[],worldStateFlags:[{flagId:'w1'}],worldEventsLog:[],enemiesData:[],alliesData:[],playerCustomStates:[],plotOutline:null,
  };

  const clone=cloneGameStateForEdit(state);
  assert.notEqual(clone,state);
  assert.equal(clone.imageCache,state.imageCache);
  assert.notEqual(clone.playerCharacter,state.playerCharacter);
  assert.notEqual(clone.playerCharacter.inventory[0],state.playerCharacter.inventory[0]);
  assert.notEqual(clone.playerCharacter.inventory[0].tags,state.playerCharacter.inventory[0].tags);
  assert.notEqual(clone.players[0],state.players[0]);
  assert.notEqual(clone.encounteredNPCs[0],state.encounteredNPCs[0]);
  assert.notEqual(clone.activeQuests[0],state.activeQuests[0]);

  // Mutating the clone must not touch the published snapshot.
  clone.playerCharacter.name='Changed';
  clone.playerCharacter.inventory[0].tags.push('b');
  clone.players[0].name='Changed roster';
  assert.equal(state.playerCharacter.name,'First');
  assert.deepEqual(state.playerCharacter.inventory[0].tags,['a']);
  assert.equal(state.players[0].name,'First');

  const time=(fn,times=5)=>{const start=process.hrtime.bigint();for(let i=0;i<times;i++)fn();return Number(process.hrtime.bigint()-start)/1e6/times};
  const fullCloneMs=time(()=>JSON.parse(JSON.stringify(state)));
  const editCloneMs=time(()=>cloneGameStateForEdit(state));
  assert.ok(editCloneMs*5<fullCloneMs,`editable clone (${editCloneMs.toFixed(2)} ms) should be much faster than a full JSON copy (${fullCloneMs.toFixed(2)} ms)`);
  console.log(`full clone ${fullCloneMs.toFixed(1)} ms, editable clone ${editCloneMs.toFixed(2)} ms for 18 MB of cached images`);
 }finally{await server.close()}
});
