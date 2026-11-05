import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('single-player navigation does not expose hosting, joining, network tabs or network turn panels',async()=>{
 const [start,side,app]=await Promise.all(['../components/StartScreen.tsx','../components/SidePanel.tsx','../App.tsx'].map(p=>readFile(new URL(p,import.meta.url),'utf8')));
 assert.doesNotMatch(start,/onStartHost|onJoinGame|t\('Network Game'\)|t\('Host Game'\)|t\('Join Game'\)/);
 assert.doesNotMatch(side,/\{ name: 'Network'/);
 assert.doesNotMatch(app,/<CollectiveActionPanel|<SimultaneousActionPanel|<CollectiveActionRequestModal|clientEditPanel/);
});

test('production has no peer transport or multiplayer managers and retains the Arena GM relay',async()=>{
 const files=['../package.json','../index.html','../hooks/useGameLogic.ts','../hooks/logic/turn.ts','../App.tsx'];
 const [pkg,html,hook,turn,app]=await Promise.all(files.map(p=>readFile(new URL(p,import.meta.url),'utf8')));
 assert.equal(JSON.parse(pkg).dependencies.peerjs,undefined);
 for (const text of [html,hook,turn]) assert.doesNotMatch(text,/peerjs|createMultiplayerManager|turn_result_from_player|new Peer\(/i);
 assert.match(app, /ArenaGmRelayPanel/);
 assert.match(turn, /acquireArenaGmTurnLease/);
 assert.match(hook, /localizeLegacySave\(source\)/);
});
