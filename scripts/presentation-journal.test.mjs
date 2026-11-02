import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

test('staged sync blocks edits; presentation changes survive until acknowledged', async () => {
  const server = await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'error'});
  try {
    const { PresentationJournal } = await server.ssrLoadModule('/utils/presentationJournal.ts');
    const { beginGameplayMutation } = await server.ssrLoadModule('/utils/gameplayMutationGate.ts');
    const rev={current:0}, pending={current:false};
    assert.equal(beginGameplayMutation(rev,pending,'player','idle',true),null);
    assert.equal(rev.current,0); assert.equal(pending.current,false);
    const base={imageCache:{old:{src:'old'}},cinematics:[{id:'old',name:'old'}]};
    const local={...base,imageCache:{new:{src:'new'}},cinematics:[{id:'new',name:'new'}]};
    const j=new PresentationJournal(); j.record(base,local);
    const host={...base,imageCache:{...base.imageCache,host:{src:'host'}},cinematics:[...base.cinematics,{id:'host'}]};
    j.acknowledge(host);
    const replay=j.apply(host);
    assert.deepEqual(replay.imageCache,{new:{src:'new'},host:{src:'host'}});
    assert.deepEqual(replay.cinematics.map(f=>f.id),['host','new']);
    assert.ok(j.matches(replay));
    // Host has confirmed local changes: a later host-side removal must stay removed.
    j.acknowledge(JSON.parse(JSON.stringify(replay)));
    const later={...host,imageCache:{host:{src:'host'}},cinematics:[{id:'host'}]};
    assert.equal(j.apply(later),later);
    // Changes completing during a replay are retained independently.
    j.record(later,{...later,imageCache:{...later.imageCache,late:{src:'late'}}});
    assert.equal(j.apply(later).imageCache.late.src,'late');
    j.clear(); assert.equal(j.apply(later),later);
    const hook=await readFile(new URL('../hooks/useGameLogic.ts',import.meta.url),'utf8');
    const network=await readFile(new URL('../hooks/logic/multiplayer.ts',import.meta.url),'utf8');
    assert.match(hook,/pendingClientSyncRef\.current !== null \|\| pendingNetworkTurnRef\.current !== null \|\| !clientTurnStampRef\.current/);
    assert.match(hook,/gameHistoryRef\.current === gameHistory/);
    assert.match(hook,/journal\.acknowledge\(pending\.snapshot\.gameState\)/);
    assert.match(hook,/journal\.apply\(previous\)/);
    assert.match(network,/clientTurnStampRef\.current = null;\s*void sendOnOpenConnection/);
  } finally { await server.close(); }
});
