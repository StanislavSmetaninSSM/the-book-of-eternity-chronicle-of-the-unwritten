import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createServer} from 'vite';
test('completed faction projects can actually be deleted',async()=>{
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 try{
  // 1. The routing helper distinguishes the two project lists.
  const {locateFactionProject}=await server.ssrLoadModule('/utils/factionProjects.ts');
  const faction={factionId:'f',activeProjects:[{projectId:'a1'},{projectId:'a2'}],completedProjects:[{projectId:'c1'}]};
  assert.equal(locateFactionProject(faction,'a2'),'active');
  assert.equal(locateFactionProject(faction,'c1'),'completed');
  assert.equal(locateFactionProject(faction,'missing'),null);
  assert.equal(locateFactionProject({factionId:'f'},'c1'),null,'missing lists do not throw');
  assert.equal(locateFactionProject({factionId:'f',activeProjects:[{projectId:'x'}],completedProjects:[{projectId:'x'}]},'x'),'active','active list wins a duplicate id');

  // 2. Production wiring: the renderer routes completed deletions to their own handler
  //    and never renders the historical no-op trash button.
  const renderer=await readFile(new URL('../components/DetailRenderer/FactionDetailsRenderer.tsx',import.meta.url),'utf8');
  assert.ok(!renderer.includes('onDelete={allowHistoryManipulation ? () => {} : undefined}'), 'the completed tab must not render a no-op trash button');
  assert.match(renderer,/onDelete=\{allowHistoryManipulation && deleteFactionCompletedProject \? \(\) => setProjectToDelete\(proj\) : undefined\}/);
  assert.match(renderer,/bucket === 'completed' \? deleteFactionCompletedProject : deleteFactionProject/);
  const hook=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');
  assert.match(hook,/^\s*deleteFactionCompletedProject,$/m,'the hook exposes the completed-project handler');
  // The in-game tree lives in the game host; the shell only owns the start screen.
  const app=await readFile(new URL('../components/GameHost.tsx',import.meta.url),'utf8');
  const passes=(app.match(/deleteFactionCompletedProject=\{deleteFactionCompletedProject\}/g)||[]).length;
  assert.ok(passes>=2,`the handler reaches the side panel and both detail renderer mounts (found ${passes})`);
  const sidePanel=await readFile(new URL('../components/SidePanel.tsx',import.meta.url),'utf8');
  assert.match(sidePanel,/deleteFactionCompletedProject\?: \(factionId: string, projectId: string\) => void;/);
 }finally{await server.close()}
});
