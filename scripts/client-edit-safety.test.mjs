import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';

test('unconfirmed client edits are refused before inventory, history or world side effects', async () => {
 const server = await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'error'});
 try {
  const {clientLocalEditBlocked,guardGameplayActions} = await server.ssrLoadModule('/utils/gameplayMutationGate.ts');
  const {createInventoryActions} = await server.ssrLoadModule('/hooks/logic/inventoryActions.ts');
  const {createPlayerActionsManager} = await server.ssrLoadModule('/hooks/logic/playerActions.ts');
  const {createInitialContext} = await server.ssrLoadModule('/utils/gameContext.ts');
  for (const role of ['player','spectator','host','none']) {
   const ctx=createInitialContext({universe:'fantasy',playerName:'Test',race:'Human',charClass:'Warrior',initialPrompt:'Start',startingYear:1000,startingMonth:'January',startingDay:1,startTime:'08:00',weather:'Clear'},'en');
   const item={existedId:'sword-1',name:'Sword',durability:'100%',equipmentSlot:'MainHand',weight:0,volume:0,count:1,requiresTwoHands:false};
   const player={...ctx.playerCharacter,inventory:[item],equippedItems:{...ctx.playerCharacter.equippedItems,MainHand:null}};
   let state={networkRole:role,playerCharacter:player,players:[player],encounteredNPCs:[],encounteredFactions:[],imageCache:{}};
   ctx.playerCharacter=player; const contextRef={current:ctx}; let history=[{sender:'gm',content:'Original'},{sender:'player',content:'Next'}],visited=[{locationId:'l'}],gameLog=['old'],combatLog=['battle'],warnings=0;
   const applyState=update=>{state=typeof update==='function'?update(state):update};
   const applyHistory=update=>{history=typeof update==='function'?update(history):update};
   const blocked=()=>{if(clientLocalEditBlocked(role)){warnings++;return true}return false};
   const inventory=guardGameplayActions(createInventoryActions({gameState:state,setGameState:applyState,gameContextRef:contextRef,t:k=>k}),blocked);
   const noop=()=>{};
   const actions=guardGameplayActions(createPlayerActionsManager({setGameState:applyState,setGameHistory:applyHistory,setUserGameHistory:applyHistory,setGameLog:value=>{gameLog=typeof value==='function'?value(gameLog):value},setCombatLog:value=>{combatLog=typeof value==='function'?value(combatLog):value},setVisitedLocations:update=>{visited=update(visited)},setWorldMap:noop,setWorldState:noop,gameSettings:{allowHistoryManipulation:true},gameContextRef:contextRef,t:k=>k}),blocked);
   inventory.equipItem(item,'MainHand');actions.deleteMessage(0);actions.forgetLocation('l');actions.deleteLogs();
   if(role==='player'||role==='spectator') {assert.equal(state.playerCharacter.equippedItems.MainHand,null);assert.equal(history.length,2);assert.equal(visited.length,1);assert.equal(warnings,4);assert.deepEqual(gameLog,['old']);assert.deepEqual(combatLog,['battle']);}
   else {assert.equal(state.playerCharacter.equippedItems.MainHand,'sword-1');assert.equal(history.length,1);assert.equal(visited.length,0);assert.equal(warnings,0);assert.equal(gameLog.length,0);assert.equal(combatLog.length,0);}
  }
  const hook=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');
  const multi=await readFile(new URL('../hooks/logic/multiplayer.ts',import.meta.url),'utf8');
  assert.match(hook,/guardGameplayActions\(createInventoryActions/);assert.match(hook,/guardGameplayActions\(createPlayerActionsManager/);
  assert.match(hook,/gameState, setGameState: setGameStateInternal, gameHistory, setGameHistory/);
  assert.match(hook,/setPresentationState = useCallback/);
  assert.match(multi,/setGameStateForConnection\(prev => prev \? \{ \.\.\.prev, playerNeedsToCreateCharacter: false \}/);
 } finally {await server.close()}
});
