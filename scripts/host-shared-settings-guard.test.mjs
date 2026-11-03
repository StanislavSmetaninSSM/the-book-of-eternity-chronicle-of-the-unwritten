import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';

test('shared settings and instructions invalidate host authority before scheduling, local preferences do not', async () => {
  const text = await readFile(new URL('../hooks/useGameLogic.ts', import.meta.url), 'utf8');
  const src = ts.createSourceFile('hook.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const callbacks = {};
  function visit(n) { if (ts.isVariableDeclaration(n) && ['updateGameSettings','updateSuperInstructions'].includes(n.name.getText(src)) && n.initializer && ts.isCallExpression(n.initializer)) callbacks[n.name.getText(src)] = n.initializer.arguments[0].getText(src); ts.forEachChild(n, visit); }
  visit(src);
  assert.ok(callbacks.updateGameSettings); assert.ok(callbacks.updateSuperInstructions);
  const js = ts.transpileModule(`const updateGameSettings = ${callbacks.updateGameSettings}; const updateSuperInstructions = ${callbacks.updateSuperInstructions};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const order = [], queued = [], preferences = {}, scope = {
    isLocalPreferenceKey: k => k === 'uiFontScale', userGameplayActionBlocked: () => false,
    beginSharedContextEdit: field => { order.push(`begin:${field}`); return action => { order.push(`apply:${field}`); return action; }; },
    updateLocalPreferences: (target, patch) => { if ('uiFontScale' in patch) target.uiFontScale = patch.uiFontScale; }, localPreferencesRef:{current:preferences},
    setGameSettings: value => { order.push('schedule:settings'); queued.push(value); }, setSuperInstructions: value => { order.push('schedule:instructions'); queued.push(value); }, initializeAndPreviewSound: () => {}
  };
  vm.runInNewContext(`${js}\nupdateGameSettings({hardMode:true}); updateSuperInstructions('new'); updateGameSettings({uiFontScale:2});`,scope);
  assert.deepEqual(order,['begin:settings','schedule:settings','begin:instructions','schedule:instructions','schedule:settings']);
  assert.equal(preferences.uiFontScale,2);
});

test('turn result is pending while a host edit survives an authority reset', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
  try {
    const { HostTurnAuthority } = await server.ssrLoadModule('/utils/networkTurnProtocol.ts');
    const { applyPlayerTurnResult } = await server.ssrLoadModule('/hooks/logic/multiplayer.ts');
    const authority = new HostTurnAuthority(() => 'session'); authority.beginMutation(); authority.reset(); const stamp = authority.issue(); const pending = {current:true};
    const message = {senderId:'p',payload:{saveFile:{},submission:{turnId:'0123456789abcdef',base:stamp}}};
    let ack, restored = false;
    const props = {gameStateRef:{current:{players:[{playerId:'p'}],activePlayerIndex:0}},hostTurnAuthority:authority,activeTurnRef:{current:null},gameplayMutationPendingRef:pending,restoreFromSaveData:()=>{restored=true},broadcastFullSync:()=>{},setError:()=>{},setGameHistory:()=>{},t:k=>k};
    await applyPlayerTurnResult(message,'p',props,async result=>{ack=result.status});
    assert.equal(ack,'pending'); assert.equal(restored,false);
  } finally { await server.close(); }
});
