import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

test('a full stage prompt crosses the real HTTP relay and mailbox with its context intact', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'arena-full-prompt-'));
  const oldDir = process.env.ARENA_GM_RELAY_DIR;
  process.env.ARENA_GM_RELAY_DIR = dir;
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  let server;
  try {
    server = await createServer({ configFile: path.resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 0, preTransformRequests: false }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error' });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const storage = new Map();
    globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
    let seen;
    globalThis.fetch = async (url, init) => {
      const response = await oldFetch(`${base}${url}`, init);
      if (url === '/__arena_gm/turn' && response.ok) {
        seen = JSON.parse(await readFile(path.join(dir, 'pending.json'), 'utf8'));
        await writeFile(path.join(dir, 'responses', `${seen.correlationId}.json`), JSON.stringify({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: seen.correlationId, output: { currentHealthChange: 0 } }));
      }
      return response;
    };
    const { executeStepWithCorrection } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Мира', race: 'Human', charClass: 'Warrior', initialPrompt: 'Ищу ключ\nв доме', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear', youtubeApiKey: 'SECRET-RELAY-TEST' }, 'ru');
    context.image = { mimeType: 'image/png', data: 'aW1hZ2U=' };
    const previous = { items_and_stat_calculations: ['Проверка пройдена'], _internal_flags_: { isSimpleTurn: false } };
    const result = await executeStepWithCorrection('Step2_CoreState_TaskGuide', () => 'TASK GUIDE', context, previous, new AbortController().signal, () => {}, () => {}, () => {});
    assert.equal(seen.kind, 'arena-gm-step');
    assert.equal(seen.stepName, 'Step2_CoreState_TaskGuide');
    assert(seen.prompt.length > 2_000_000);
    assert(!seen.prompt.includes('SECRET-RELAY-TEST'));
    const transmitted = JSON.parse(seen.prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
    assert.equal(transmitted.message, context.message);
    assert.equal(transmitted.playerCharacter.name, 'Мира');
    assert.deepEqual(transmitted.image, context.image);
    assert.deepEqual(JSON.parse(transmitted.partiallyGeneratedResponse), previous);
    assert.equal(result.response.currentHealthChange, 0);
    const status = await (await oldFetch(`${base}/__arena_gm/status`)).json();
    assert.equal(status.activeCorrelationId, null);
    assert.equal(status.queuedCount, 0);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (server) await server.close();
    if (oldDir === undefined) delete process.env.ARENA_GM_RELAY_DIR; else process.env.ARENA_GM_RELAY_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test('narrative pilot uses verified files, preserves context, and falls back if the bundle disappears before submission', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'arena-rules-'));
  const oldDir = process.env.ARENA_GM_RELAY_DIR, oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  process.env.ARENA_GM_RELAY_DIR = dir;
  let server;
  try {
    server = await createServer({ configFile: path.resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 0, preTransformRequests: false }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error' });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const storage = new Map();
    globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
    const packets = [];
    let breakBundle = false, reportUnavailable = false, rejections = 0;
    globalThis.fetch = async (url, init) => {
      if (url === '/__arena_gm/turn' && breakBundle) {
        const packet = JSON.parse(init.body);
        if (packet.ruleBundleId) await rm(path.join(dir, 'rule-bundles', packet.ruleBundleId, 'rules.txt'));
        breakBundle = false;
      }
      const response = await oldFetch(`${base}${url}`, init);
      if (url === '/__arena_gm/turn' && response.status === 409) rejections++;
      if (url === '/__arena_gm/turn' && response.ok) {
        const packet = JSON.parse(await readFile(path.join(dir, 'pending.json'), 'utf8'));
        packets.push(packet);
        const output = reportUnavailable && packet.ruleBundleId ? { _arenaRuleBundleUnavailable: true } : { response: 'Сцена.' };
        if (output._arenaRuleBundleUnavailable) reportUnavailable = false;
        await writeFile(path.join(dir, 'responses', `${packet.correlationId}.json`), JSON.stringify({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output }));
      }
      return response;
    };
    const { executeStepWithCorrection } = await server.ssrLoadModule('/utils/gemini.ts');
    const { getStep6 } = await import('../prompts/mainPromptSteps.js');
    const { getGameMasterGuideRules } = await import('../prompts/mainPromptModule.js');
    const narrative = (await import('../prompts/narrativeStyleGuide.js')).default.getGuide();
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Мира', race: 'Human', charClass: 'Warrior', initialPrompt: 'Ищу ключ', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'ru');
    const partial = { items_and_stat_calculations: ['Ключ найден'], currentHealthChange: -3 };
    const run = () => executeStepWithCorrection('Step6_NarrativeGeneration_TaskGuide', getStep6, context, partial, new AbortController().signal, () => {}, () => {}, () => {});
    await run();
    const compact = packets[0];
    assert.match(compact.ruleBundleId, /^[a-f0-9]{64}$/);
    assert.ok(compact.prompt.length < 100_000);
    assert.match(compact.prompt, /NarrativeFocus/);
    assert.match(compact.prompt, /LocalRuleReference/);
    const bundle = path.join(dir, 'rule-bundles', compact.ruleBundleId);
    assert.equal(await readFile(path.join(bundle, 'rules.txt'), 'utf8'), getGameMasterGuideRules());
    assert.equal(await readFile(path.join(bundle, 'narrative.txt'), 'utf8'), narrative);
    assert.match(await readFile(path.join(bundle, 'index.txt'), 'utf8'), /Rule id=/);
    const transmitted = JSON.parse(compact.prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
    assert.deepEqual(JSON.parse(transmitted.partiallyGeneratedResponse), partial);
    assert.equal(transmitted.message, context.message);

    breakBundle = true;
    await run();
    assert.equal(rejections, 1);
    assert.equal(packets.length, 2);
    assert.equal(packets[1].ruleBundleId, undefined);
    assert.ok(packets[1].prompt.length > 2_000_000);
    assert.match(packets[1].prompt, /NarrativeFocus/);
    assert.match(packets[1].prompt, /GameMasterGuide_NarrativeStyle/);
    reportUnavailable = true;
    const result = await run();
    assert.equal(packets.length, 4);
    assert.ok(packets[2].ruleBundleId);
    assert.equal(packets[3].ruleBundleId, undefined);
    assert.ok(packets[3].prompt.length > 2_000_000);
    assert.equal(result.response.response, 'Сцена.');
    assert.equal(result.response._arenaRuleBundleUnavailable, undefined);

  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (server) await server.close();
    if (oldDir === undefined) delete process.env.ARENA_GM_RELAY_DIR; else process.env.ARENA_GM_RELAY_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test('NPC stage can reference verified world and style guides, with a complete fallback', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'arena-npc-rules-'));
  const oldDir = process.env.ARENA_GM_RELAY_DIR, oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  process.env.ARENA_GM_RELAY_DIR = dir;
  let server, fallback = false;
  try {
    server = await createServer({ configFile: path.resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 0, preTransformRequests: false }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error' });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`, storage = new Map();
    globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
    const packets = [];
    const npcOutput = { items_and_stat_calculations: ['NPC: guards the outpost'], NPCsData: [{ NPCId: 'npc-1', name: 'Guard', currentHealth: 80 }] };
    globalThis.fetch = async (url, init) => {
      if (url === '/__arena_gm/rules' && fallback) return new Response('{}', { status: 503 });
      const response = await oldFetch(`${base}${url}`, init);
      if (url === '/__arena_gm/turn' && response.ok) {
        const packet = JSON.parse(await readFile(path.join(dir, 'pending.json'), 'utf8'));
        packets.push(packet);
        await writeFile(path.join(dir, 'responses', `${packet.correlationId}.json`), JSON.stringify({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output: npcOutput }));
      }
      return response;
    };
    const { executeStepWithCorrection } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { getStep4 } = await import('../prompts/mainPromptSteps.js');
    const world = (await import('../prompts/worldLogicGuide.js')).default.getGuide();
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Mira', race: 'Human', charClass: 'Warrior', initialPrompt: 'Talk to the guard', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const partial = { items_and_stat_calculations: ['NPC remains injured'], currentHealthChange: 0 };
    const run = () => executeStepWithCorrection('Step4_NPC_TaskGuide', getStep4, context, partial, new AbortController().signal, () => {}, () => {}, () => {});
    const compact = await run();
    fallback = true;
    const full = await run();
    assert.ok(packets[0].ruleBundleId);
    assert.ok(packets[0].prompt.length < 200_000);
    assert.match(packets[0].prompt, /world\.txt/);
    assert.equal(await readFile(path.join(dir, 'rule-bundles', packets[0].ruleBundleId, 'world.txt'), 'utf8'), world);
    assert.equal(packets[1].ruleBundleId, undefined);
    assert.ok(packets[1].prompt.length > 2_000_000);
    assert.ok(packets[1].prompt.includes(world));
    for (const packet of packets) {
      const sent = JSON.parse(packet.prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
      assert.deepEqual(JSON.parse(sent.partiallyGeneratedResponse), partial);
      assert.equal(sent.message, context.message);
      assert.match(packet.prompt, /NPCWoundChanges/);
    }
    assert.deepEqual(compact.response, full.response);
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const player = context.playerCharacter;
    const npc = { ...player, NPCId: 'npc-1', name: 'Guard', currentHealth: 100, inventory: [] };
    const baseState = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const apply = result => processAndApplyResponse(result.response, baseState, context.gameSettings, key => key, true, 2, context.worldMap).newState;
    const compactState = apply(compact), fullState = apply(full);
    assert.equal(compactState.encounteredNPCs[0].currentHealth, 80);
    assert.deepEqual(compactState, fullState);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (server) await server.close();
    if (oldDir === undefined) delete process.env.ARENA_GM_RELAY_DIR; else process.env.ARENA_GM_RELAY_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test('inventory stage resolves the same item changes with referenced or full guides', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'arena-inventory-rules-'));
  const oldDir = process.env.ARENA_GM_RELAY_DIR, oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  process.env.ARENA_GM_RELAY_DIR = dir;
  let server, fallback = false;
  try {
    server = await createServer({ configFile: path.resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 0, preTransformRequests: false }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error' });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`, storage = new Map();
    globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
    const packets = [];
    const output = { items_and_stat_calculations: ['Расход ткани: 2 → 1'], inventoryItemsData: [{ existedId: 'cloth', name: 'Cloth', count: 1 }] };
    globalThis.fetch = async (url, init) => {
      if (url === '/__arena_gm/rules' && fallback) return new Response('{}', { status: 503 });
      const response = await oldFetch(`${base}${url}`, init);
      if (url === '/__arena_gm/turn' && response.ok) {
        const packet = JSON.parse(await readFile(path.join(dir, 'pending.json'), 'utf8'));
        packets.push(packet);
        await writeFile(path.join(dir, 'responses', `${packet.correlationId}.json`), JSON.stringify({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output }));
      }
      return response;
    };
    const { executeStepWithCorrection } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const { getStep5 } = await import('../prompts/mainPromptSteps.js');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Mira', race: 'Human', charClass: 'Warrior', initialPrompt: 'Use cloth', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = { ...context.playerCharacter, inventory: [{ existedId: 'cloth', name: 'Cloth', count: 2, weight: 1, contentsPath: null }] };
    context.playerCharacter = player;
    context.currentTurnNumber = 2;
    const partial = { items_and_stat_calculations: ['Расходуем одну ткань'], _internal_flags_: { needsInventoryProcessing: true } };
    const run = () => executeStepWithCorrection('Step5_Inventory_TaskGuide', getStep5, context, partial, new AbortController().signal, () => {}, () => {}, () => {});
    const compact = await run(); fallback = true; const full = await run();
    assert.ok(packets[0].ruleBundleId); assert.equal(packets[1].ruleBundleId, undefined);
    assert.match(packets[0].prompt, /10\.2/); assert.match(packets[0].prompt, /narrative\.txt/);
    assert.ok(packets[0].prompt.length < 200_000 && packets[1].prompt.length > 2_000_000);
    for (const packet of packets) {
      const sent = JSON.parse(packet.prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
      assert.deepEqual(JSON.parse(sent.partiallyGeneratedResponse), partial);
      assert.equal(sent.playerCharacter.inventory[0].count, 2);
    }
    const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const apply = result => processAndApplyResponse(result.response, state, context.gameSettings, key => key, true, 2, context.worldMap).newState;
    assert.deepEqual(apply(compact), apply(full));
    assert.equal(apply(compact).playerCharacter.inventory[0].count, 1);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (server) await server.close();
    if (oldDir === undefined) delete process.env.ARENA_GM_RELAY_DIR; else process.env.ARENA_GM_RELAY_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test('combat auditor preserves health and wounds with referenced or full rules', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'arena-combat-rules-'));
  const oldDir = process.env.ARENA_GM_RELAY_DIR, oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  process.env.ARENA_GM_RELAY_DIR = dir;
  let server, fallback = false;
  try {
    server = await createServer({ configFile: path.resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 0, preTransformRequests: false }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error' });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`, storage = new Map();
    globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
    const packets = [];
    const wound = { woundId: 'wound-1', woundName: 'Cut', severity: 'Light', descriptionOfEffects: 'cut', generatedEffects: [], healingState: { currentState: 'Untreated', treatmentProgress: 0, progressNeeded: 20, nextState: 'Stabilized', canBeImprovedBy: [] } };
    const output = { items_and_stat_calculations: ['Проверено'], currentHealthChange: -5, enemiesData: [{ NPCId: 'npc-1', name: 'Guard', isGroup: false, currentHealth: '80%', maxHealth: '108%', actions: [] }], playerWoundChanges: [wound], NPCWoundChanges: [{ NPCId: 'npc-1', NPCName: 'Guard', ...wound, woundId: 'npc-wound' }] };
    globalThis.fetch = async (url, init) => {
      if (url === '/__arena_gm/rules' && fallback) return new Response('{}', { status: 503 });
      const response = await oldFetch(`${base}${url}`, init);
      if (url === '/__arena_gm/turn' && response.ok) {
        const packet = JSON.parse(await readFile(path.join(dir, 'pending.json'), 'utf8')); packets.push(packet);
        await writeFile(path.join(dir, 'responses', `${packet.correlationId}.json`), JSON.stringify({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output }));
      }
      return response;
    };
    const { executeStepWithCorrection } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const { getStep3, getStep3Logs } = await import('../prompts/mainPromptSteps.js');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Mira', race: 'Human', charClass: 'Warrior', initialPrompt: 'Defend', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2;
    const player = context.playerCharacter;
    const npc = { ...player, NPCId: 'npc-1', name: 'Guard', currentHealth: 100, wounds: [] };
    const partial = { items_and_stat_calculations: ['Игрок получил критический удар, 5 урона; NPC потерял 20 здоровья и получил рану'], _internal_flags_: { isCombatActive: true } };
    const run = () => executeStepWithCorrection('Step3_Combat_TaskGuide', getStep3, context, partial, new AbortController().signal, () => {}, () => {}, () => {});
    const compact = await run(); fallback = true; const full = await run();
    fallback = false; context.currentTurnNumber = 1; await run();
    context.currentTurnNumber = 2; await executeStepWithCorrection('Step3_Logs_CombatAnalysis_TaskGuide', getStep3Logs, context, partial, new AbortController().signal, () => {}, () => {}, () => {});
    assert.equal(packets[2].ruleBundleId, undefined, 'first-turn combat audit keeps full rules');
    assert.equal(packets[3].ruleBundleId, undefined, 'combat calculation logs keep full rules');
    assert.ok(packets[0].ruleBundleId); assert.equal(packets[1].ruleBundleId, undefined);
    assert.match(packets[0].prompt, /5\.20/); assert.match(packets[0].prompt, /14\.3/);
    assert.ok(packets[0].prompt.length < 200_000 && packets[1].prompt.length > 2_000_000);
    for (const packet of packets) {
      const sent = JSON.parse(packet.prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
      assert.deepEqual(JSON.parse(sent.partiallyGeneratedResponse), partial);
    }
    const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const apply = result => processAndApplyResponse(result.response, state, context.gameSettings, key => key, true, 2, context.worldMap).newState;
    const actual = apply(compact); assert.deepEqual(actual, apply(full));
    assert.equal(actual.playerCharacter.currentHealth, player.currentHealth - 5);
    assert.equal(actual.encounteredNPCs[0].currentHealth, 80);
    assert.equal(actual.playerCharacter.playerWounds[0].woundId, 'wound-1');
    assert.equal(actual.encounteredNPCs[0].wounds[0].woundId, 'npc-wound');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (server) await server.close();
    if (oldDir === undefined) delete process.env.ARENA_GM_RELAY_DIR; else process.env.ARENA_GM_RELAY_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test('world progression retains prior faction events and applies world changes in either mode', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'arena-world-rules-'));
  const oldDir = process.env.ARENA_GM_RELAY_DIR, oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  process.env.ARENA_GM_RELAY_DIR = dir;
  let server, fallback = false, unavailable = false;
  try {
    server = await createServer({ configFile: path.resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 0, preTransformRequests: false }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error' });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`, storage = new Map(), packets = [];
    globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
    const event = { eventId: 'faction-event', turnNumber: 2, date: { year: 1000, monthName: 'January', dayOfMonth: 1, timeOfDay: '08:00' }, headline: 'Supplies sent', summary: 'Faction sent supplies.', vignette: 'Wagons leave.', eventType: 'Social', visibility: 'Public' };
    const partial = { items_and_stat_calculations: ['Faction sent supplies'], worldEventsLog: [event], _internal_flags_: { needsWorldProgression: true } };
    const output = { items_and_stat_calculations: ['Threat activity advances'], worldMapUpdates: { threatsToUpdate: [{ targetLocationId: 'outpost', threatUpdate: { threatId: 'threat-1', currentActivity: { activityName: 'Hunt', timeSpentMinutes: 30 } } }] }, NPCsData: [{ NPCId: 'npc-1', name: 'Scout', currentLocationId: 'outpost' }], NPCGoalUpdates: [{ NPCId: 'npc-1', NPCName: 'Scout', newShortTermGoal: 'Inspect wagons' }], updateWorldProgressionTracker: { newLastWorldProgressionTimeInMinutes: 480 } };
    globalThis.fetch = async (url, init) => {
      if (url === '/__arena_gm/rules' && fallback) return new Response('{}', { status: 503 });
      const response = await oldFetch(`${base}${url}`, init);
      if (url === '/__arena_gm/turn' && response.ok) {
        const packet = JSON.parse(await readFile(path.join(dir, 'pending.json'), 'utf8')); packets.push(packet);
        const reply = unavailable && packet.ruleBundleId ? { _arenaRuleBundleUnavailable: true } : output;
        await writeFile(path.join(dir, 'responses', `${packet.correlationId}.json`), JSON.stringify({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output: reply }));
      }
      return response;
    };
    const { executeStepWithCorrection } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const { getStepWorldProgression } = await import('../prompts/mainPromptSteps.js');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Mira', race: 'Human', charClass: 'Warrior', initialPrompt: 'Wait', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2;
    const player = context.playerCharacter;
    const npc = { ...player, NPCId: 'npc-1', name: 'Scout', currentLocationId: 'start-loc-01', goals: { shortTerm: 'Stand guard', longTerm: 'Protect town' } };
    const location = { ...context.currentLocation, locationId: 'outpost', name: 'Outpost', activeThreats: [{ threatId: 'threat-1', name: 'Pack', currentActivity: { activityId: 'hunt-activity-1', activityName: 'Hunt', timeSpentMinutes: 0 } }] };
    context.worldMap = { outpost: location }; context.encounteredNPCs = [npc];
    const run = () => executeStepWithCorrection('Step_WorldProgression_TaskGuide', getStepWorldProgression, context, partial, new AbortController().signal, () => {}, () => {}, () => {});
    const compact = await run(); fallback = true; const full = await run();
    fallback = false; context.currentTurnNumber = 1; await run(); context.currentTurnNumber = 2;
    unavailable = true; const retried = await run();
    assert.ok(packets[0].ruleBundleId); assert.equal(packets[1].ruleBundleId, undefined); assert.equal(packets[2].ruleBundleId, undefined);
    assert.ok(packets[3].ruleBundleId); assert.equal(packets[4].ruleBundleId, undefined);
    assert.deepEqual(retried.response, full.response);
    assert.ok(packets[0].prompt.length < 200_000 && packets[1].prompt.length > 2_000_000);
    assert.match(packets[0].prompt, /30\.6/); assert.match(packets[0].prompt, /world\.txt/); assert.match(packets[0].prompt, /narrative\.txt/);
    for (const packet of packets) {
      const sent = JSON.parse(packet.prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
      assert.deepEqual(JSON.parse(sent.partiallyGeneratedResponse), partial);
      assert.equal(sent.worldMap.outpost.activeThreats[0].threatId, 'threat-1');
    }
    const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const apply = result => { const { newState, processedResponse } = processAndApplyResponse(result.response, state, context.gameSettings, key => key, true, 2, context.worldMap); return { state: newState, next: buildNextContext(context, processedResponse, newState, [], true) }; };
    const actual = apply(compact), baseline = apply(full);
    assert.deepEqual(actual.state, baseline.state);
    const comparableContext = ({ preGeneratedDices1d20, lootForCurrentTurn, ...rest }) => rest;
    assert.deepEqual(comparableContext(actual.next), comparableContext(baseline.next));
    assert.equal(actual.state.worldEventsLog[0].eventId, 'faction-event');
    assert.equal(actual.state.encounteredNPCs[0].currentLocationId, 'outpost');
    assert.equal(actual.state.encounteredNPCs[0].goals.shortTerm, 'Inspect wagons');
    assert.equal(actual.next.worldMap.outpost.activeThreats[0].currentActivity.timeSpentMinutes, 30);
    assert.equal(actual.next.worldState.lastWorldProgressionTimeInMinutes, 480);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (server) await server.close();
    if (oldDir === undefined) delete process.env.ARENA_GM_RELAY_DIR; else process.env.ARENA_GM_RELAY_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test('faction progression preserves economy and projects through the world stage in either mode', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'arena-faction-rules-'));
  const oldDir = process.env.ARENA_GM_RELAY_DIR, oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  process.env.ARENA_GM_RELAY_DIR = dir;
  let server, fallback = false, unavailable = false;
  try {
    server = await createServer({ configFile: path.resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 0, preTransformRequests: false }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error' });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`, storage = new Map(), packets = [];
    globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
    const event = { eventId: 'faction-event', turnNumber: 2, date: { year: 1000, monthName: 'January', dayOfMonth: 1, timeOfDay: '08:00' }, headline: 'Road repaired', summary: 'The guild repaired the road.', vignette: 'Workers clear the road.', eventType: 'Social', visibility: 'Public' };
    const partial = { items_and_stat_calculations: ['The player waits.'], _internal_flags_: { needsFactionProgression: true, needsWorldProgression: true } };
    const factionOutput = { items_and_stat_calculations: ['Economy: 10 + (5 - 2) = 13. Project progress 30 → 60; road project completed.'], factionResourceChanges: [{ factionId: 'f-1', factionName: 'Guild', resourceChanges: [{ resourceName: 'Wealth', changeAmount: 3 }] }], factionProjectUpdates: [{ factionId: 'f-1', factionName: 'Guild', projectUpdate: { projectId: 'p-1', timeSpentMinutes: 60 } }], completeFactionProjects: [{ factionId: 'f-1', factionName: 'Guild', projectId: 'p-2', projectName: 'Repair road', finalState: 'Completed', narrativeSummary: 'Road repaired.' }], factionChronicleUpdates: [{ factionId: 'f-1', factionName: 'Guild', entryToAppend: 'Road repaired.' }], worldEventsLog: [event], updateFactionProgressionTracker: { newLastFactionProgressionTimeInMinutes: 1920 } };
    const worldOutput = { items_and_stat_calculations: ['Consequence: road is repaired.'], worldMapUpdates: { locationUpdates: [{ locationId: 'outpost', newDescription: 'The road is repaired.' }] }, updateWorldProgressionTracker: { newLastWorldProgressionTimeInMinutes: 1920 } };
    globalThis.fetch = async (url, init) => {
      if (url === '/__arena_gm/rules' && fallback) return new Response('{}', { status: 503 });
      const response = await oldFetch(`${base}${url}`, init);
      if (url === '/__arena_gm/turn' && response.ok) {
        const packet = JSON.parse(await readFile(path.join(dir, 'pending.json'), 'utf8')); packets.push(packet);
        const output = unavailable && packet.ruleBundleId ? { _arenaRuleBundleUnavailable: true } : packet.stepName === 'Step_FactionProgression_TaskGuide' ? factionOutput : worldOutput;
        await writeFile(path.join(dir, 'responses', `${packet.correlationId}.json`), JSON.stringify({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output }));
      }
      return response;
    };
    const { executeStepWithCorrection } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const { getStepFactionProgression, getStepWorldProgression } = await import('../prompts/mainPromptSteps.js');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Mira', race: 'Human', charClass: 'Warrior', initialPrompt: 'Wait', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2; context.worldState.currentTimeInMinutes = 1920; context.worldState.lastFactionProgressionTimeInMinutes = 480;
    const faction = { factionId: 'f-1', name: 'Guild', color: '#123456', resources: { metaResources: [{ resourceName: 'Wealth', currentStockpile: 10, incomePerCycle: 5, upkeepPerCycle: 2 }], strategicGoods: [] }, activeProjects: [{ projectId: 'p-1', projectName: 'Prepare caravan', timeSpentMinutes: 30, totalTimeCostMinutes: 120 }, { projectId: 'p-2', projectName: 'Repair road', timeSpentMinutes: 60, totalTimeCostMinutes: 60 }], completedProjects: [], scribeChronicle: [] };
    context.encounteredFactions = [faction]; context.worldMap = { outpost: { ...context.currentLocation, locationId: 'outpost', name: 'Outpost' } };
    const runFaction = () => executeStepWithCorrection('Step_FactionProgression_TaskGuide', getStepFactionProgression, context, partial, new AbortController().signal, () => {}, () => {}, () => {});
    const compact = await runFaction(); fallback = true; const full = await runFaction(); fallback = false;
    context.currentTurnNumber = 1; await runFaction(); context.currentTurnNumber = 2;
    unavailable = true; const retry = await runFaction(); unavailable = false;
    assert.ok(packets[0].ruleBundleId); assert.equal(packets[1].ruleBundleId, undefined); assert.equal(packets[2].ruleBundleId, undefined);
    assert.ok(packets[3].ruleBundleId); assert.equal(packets[4].ruleBundleId, undefined); assert.deepEqual(retry.response, full.response);
    assert.ok(packets[0].prompt.length < 200_000 && packets[1].prompt.length > 2_000_000);
    assert.match(packets[0].prompt, /21\.A\.2\.3/); assert.match(packets[0].prompt, /30\.1\.D/); assert.match(packets[0].prompt, /world\.txt/); assert.match(packets[0].prompt, /narrative\.txt/);
    for (const packet of packets) {
      const sent = JSON.parse(packet.prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
      assert.deepEqual(JSON.parse(sent.partiallyGeneratedResponse), partial);
      assert.equal(sent.encounteredFactions[0].resources.metaResources[0].currentStockpile, 10);
    }
    const world = await executeStepWithCorrection('Step_WorldProgression_TaskGuide', getStepWorldProgression, context, compact.response, new AbortController().signal, () => {}, () => {}, () => {});
    const worldPacket = packets.at(-1);
    const sentWorld = JSON.parse(worldPacket.prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
    assert.deepEqual(JSON.parse(sentWorld.partiallyGeneratedResponse), compact.response);
    const fullWorld = await executeStepWithCorrection('Step_WorldProgression_TaskGuide', getStepWorldProgression, context, full.response, new AbortController().signal, () => {}, () => {}, () => {});
    const player = context.playerCharacter, state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [faction], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const apply = result => { const { newState, processedResponse } = processAndApplyResponse(result.response, state, context.gameSettings, key => key, true, 2, context.worldMap); return { state: newState, next: buildNextContext(context, processedResponse, newState, [], true) }; };
    const actual = apply(world), baseline = apply(fullWorld);
    assert.deepEqual(actual.state, baseline.state);
    const comparable = ({ preGeneratedDices1d20, lootForCurrentTurn, ...rest }) => rest;
    assert.deepEqual(comparable(actual.next), comparable(baseline.next));
    assert.equal(actual.state.encounteredFactions[0].resources.metaResources[0].currentStockpile, 13);
    assert.equal(actual.state.encounteredFactions[0].activeProjects.find(p => p.projectId === 'p-1').timeSpentMinutes, 60);
    assert.equal(actual.state.encounteredFactions[0].completedProjects[0].projectId, 'p-2');
    assert.equal(actual.state.encounteredFactions[0].scribeChronicle[0], 'Road repaired.');
    assert.equal(actual.state.worldEventsLog[0].eventId, 'faction-event');
    assert.equal(actual.next.worldMap.outpost.description, 'The road is repaired.');
    assert.equal(actual.next.worldState.lastFactionProgressionTimeInMinutes, 1920);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (server) await server.close();
    if (oldDir === undefined) delete process.env.ARENA_GM_RELAY_DIR; else process.env.ARENA_GM_RELAY_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});
