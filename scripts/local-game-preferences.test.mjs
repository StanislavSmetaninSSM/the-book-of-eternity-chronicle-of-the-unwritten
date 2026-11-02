import ts from 'typescript';import vm from 'node:vm';import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';import {readFile} from 'node:fs/promises';
test('host sync preserves local preferences but retains authoritative game rules',async()=>{
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try {const {mergeNetworkLocalPreferences,updateLocalPreferences,isLocalPreferenceKey}=await server.ssrLoadModule('/utils/localGamePreferences.ts');
  const host={language:'en',hardMode:true,uiFontScale:1,notificationSound:true,disableImageGeneration:false,showImageSourceInfo:false},previous={language:'ru',hardMode:false,uiFontScale:1.5,notificationSound:false,disableImageGeneration:true,showImageSourceInfo:true},edits={};
  updateLocalPreferences(edits,{uiFontScale:1.8,hardMode:false,notificationSound:false});
  assert.equal(isLocalPreferenceKey('hardMode'),false);assert.equal(edits.hardMode,undefined);
  const merged=mergeNetworkLocalPreferences(host,previous,edits);assert.equal(merged.hardMode,true);assert.equal(merged.language,'ru');assert.equal(merged.uiFontScale,1.8);assert.equal(merged.notificationSound,false);assert.equal(merged.disableImageGeneration,true);assert.equal(merged.showImageSourceInfo,true);assert.notEqual(merged,host);assert.equal(host.uiFontScale,1);
  assert.deepEqual(mergeNetworkLocalPreferences(host,null,{}),host);
  const hook=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');assert.match(hook,/updateLocalPreferences\(localPreferencesRef\.current, newSettings\)/);assert.match(hook,/mergeNetworkLocalPreferences\(loadedSettings, gameContextRef\.current\?\.gameSettings, localPreferencesRef\.current\)/);
  // Run the actual UI callback with React's setter deliberately deferred.
  const src=ts.createSourceFile('hook.ts',hook,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let cb;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(src)==='updateGameSettings'&&n.initializer&&ts.isCallExpression(n.initializer))cb=n.initializer.arguments[0];ts.forEachChild(n,visit)}visit(src);assert.ok(cb);
  const js=ts.transpileModule(`const updateGameSettings = ${cb.getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;const pending={},queue=[];const scope={isLocalPreferenceKey,updateLocalPreferences,localPreferencesRef:{current:pending},userGameplayActionBlocked:()=>true,setGameSettings:fn=>queue.push(fn),initializeAndPreviewSound:()=>{}};
  vm.runInNewContext(`${js}\nupdateGameSettings({uiFontScale:2});updateGameSettings({hardMode:false});`,scope);assert.equal(queue.length,1);assert.equal(mergeNetworkLocalPreferences(host,previous,pending).uiFontScale,2);assert.equal(mergeNetworkLocalPreferences(host,previous,pending).hardMode,true);
 }finally{await server.close()}
});
