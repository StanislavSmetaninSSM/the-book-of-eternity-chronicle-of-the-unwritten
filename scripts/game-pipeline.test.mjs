import { test, after} from 'node:test';
import assert from 'node:assert/strict';
import { getTestServer, closeTestServer } from './helpers/testServer.mjs';

// Exercise the actual turn pipeline and relay client, with deterministic GM replies.
test('first turn sends full state at every stage and cannot take the simple path', async () => {
  const server = await getTestServer();
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const packets = [];
  const storage = new Map();
  globalThis.window = {
    setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
    sessionStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) },
  };
  globalThis.fetch = async (url, init) => {
    if (url === '/__arena_gm/turn') {
      packets.push(JSON.parse(init.body));
      return new Response('{}', { status: 200 });
    }
    if (String(url).startsWith('/__arena_gm/response')) {
      const packet = packets.at(-1);
      const output = packet.stepName === 'Step0_AnalysisAndPlanning_TaskGuide'
        ? { items_and_stat_calculations: ['initial analysis'], _internal_flags_: { isSimpleTurn: true, needsInventoryProcessing: false, needsWorldProgression: false, needsFactionProgression: false, needsSelfCorrection: true } }
        : packet.stepName === 'Step0_5_Verification_TaskGuide' ? { _internal_flags_: { isSimpleTurn: true, needsInventoryProcessing: false, needsWorldProgression: false, needsFactionProgression: false } }
        : packet.stepName === 'Step2_CoreState_TaskGuide' ? { currentHealthChange: 0 }
        : packet.stepName === 'Step6_NarrativeGeneration_TaskGuide' ? { response: 'Начало истории.' } : {};
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { executeTurn } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Мира', race: 'Human', charClass: 'Warrior', initialPrompt: 'Я ищу пропавшую сестру', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear', youtubeApiKey: 'private-key' }, 'ru');
    context.image = { mimeType: 'image/png', data: 'aW1hZ2U=' };
    const result = await executeTurn(context, new AbortController().signal, () => {}, () => {}, () => {});
    const steps = packets.map(p => p.stepName);
    assert.deepEqual(steps, ['Step0_AnalysisAndPlanning_TaskGuide', 'Step0_5_Verification_TaskGuide', 'Step_FactionProgression_TaskGuide', 'Step_WorldProgression_TaskGuide', 'Step2_CoreState_TaskGuide', 'Step5_Inventory_TaskGuide', 'Step6_NarrativeGeneration_TaskGuide', 'Step7_Finalization_TaskGuide']);
    for (const packet of packets) {
      const state = JSON.parse(packet.prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
      assert.equal(state.message, context.message);
      assert.equal(state.playerCharacter.name, 'Мира');
      assert.equal(state.gameSettings.youtubeApiKey, undefined);
      assert.ok(!packet.prompt.includes('private-key'));
      assert.deepEqual(state.image, context.image);
    }
    const setupInventory = packets.find(packet => packet.stepName === 'Step5_Inventory_TaskGuide');
    assert.equal(setupInventory.ruleBundleId, undefined, 'first-turn inventory keeps all rules inline');
    assert.ok(setupInventory.prompt.length > 2_000_000);
    const last = JSON.parse(packets.at(-1).prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
    assert.match(last.partiallyGeneratedResponse, /Начало истории/);
    assert.equal(result.response, 'Начало истории.');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    await server.close();
  }
});

test('cinematic prompt builders use a game context and the requested trailer', async () => {
  const { getCinemaPrompt, getContinueCinemaPrompt } = await import('../prompts/cinemaPrompt.js');
  const context = { gameSettings: {}, playerCharacter: { name: 'Мира' }, visitedLocations: [], responseHistory: [], worldEventsLog: [], encounteredNPCs: [] };
  assert.match(getCinemaPrompt(context, 'Битва у моста').promptContent, /Битва у моста/);
  const trailer = { title: 'Мост', userPrompt: 'битва', synopsis: 'вступление', frames: [{ imagePrompt: 'bridge', subtitle: 'утро' }] };
  assert.match(getContinueCinemaPrompt(context, trailer).promptContent, /Мост/);
});

test('oversized relay requests fail once instead of being retried ten times', async () => {
  const server = await getTestServer();
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  let submissions = 0;
  globalThis.window = { sessionStorage: { setItem() {}, getItem() {}, removeItem() {} } };
  globalThis.fetch = async () => { submissions++; return new Response('{}', { status: 413 }); };
  try {
    const { executeStepWithCorrection } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Mira', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    await assert.rejects(executeStepWithCorrection('Step2_CoreState_TaskGuide', () => 'step', context, {}, new AbortController().signal, () => {}, () => {}, () => {}), /too large/);
    assert.equal(submissions, 1);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    await server.close();
  }
});

test('first turn respects disabled world progression while keeping setup stages', async () => {
  const server = await getTestServer();
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  const packets = [], storage = new Map();
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  globalThis.fetch = async (url, init) => {
    if (url === '/__arena_gm/turn') { packets.push(JSON.parse(init.body)); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const packet = packets.at(-1);
      const output = packet.stepName === 'Step0_AnalysisAndPlanning_TaskGuide' ? { _internal_flags_: { isSimpleTurn: true, needsWorldProgression: true, needsFactionProgression: true } } : {};
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { executeTurn } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Mira', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear', doNotUseWorldEvents: true }, 'en');
    await executeTurn(context, new AbortController().signal, () => {}, () => {}, () => {});
    assert.deepEqual(packets.map(p => p.stepName), ['Step0_AnalysisAndPlanning_TaskGuide', 'Step2_CoreState_TaskGuide', 'Step5_Inventory_TaskGuide', 'Step6_NarrativeGeneration_TaskGuide', 'Step7_Finalization_TaskGuide']);
    const parsed = JSON.parse(packets[0].prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
    assert.equal(parsed.gameSettings.doNotUseWorldEvents, true);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    await server.close();
  }
});

test('a later simple turn carries the current context through the simple response stage', async () => {
  const server = await getTestServer();
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  const packets = [], storage = new Map();
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  globalThis.fetch = async (url, init) => {
    if (url === '/__arena_gm/turn') { packets.push(JSON.parse(init.body)); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const packet = packets.at(-1);
      const output = packet.stepName === 'Step0_AnalysisAndPlanning_TaskGuide' ? { _internal_flags_: { isSimpleTurn: true, needsWorldProgression: false, needsFactionProgression: false }, items_and_stat_calculations: ['Safe action'] } : { response: 'Вы осматриваете комнату.' };
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { executeTurn } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Мира', race: 'Human', charClass: 'Warrior', initialPrompt: 'Осмотреться', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'ru');
    context.currentTurnNumber = 2;
    context.currentLocation.name = 'Зал';
    const result = await executeTurn(context, new AbortController().signal, () => {}, () => {}, () => {});
    assert.deepEqual(packets.map(p => p.stepName), ['Step0_AnalysisAndPlanning_TaskGuide', 'StepSimpleFullResponse_TaskGuide']);
    const state = JSON.parse(packets[1].prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
    assert.equal(state.currentTurnNumber, 2);
    assert.equal(state.currentLocation.name, 'Зал');
    assert.equal(JSON.parse(state.partiallyGeneratedResponse)._internal_flags_.isSimpleTurn, true);
    assert.match(packets[1].prompt, /<NarrativeFocus>/);
    assert.match(packets[1].prompt, /Finding or seeing an item does not mean the player took it/);
    assert.match(packets[1].prompt, /<GameMasterGuide_NarrativeStyle>/);
    assert.ok(packets[1].prompt.length > 2_000_000, 'simple turns retain all mechanics rules');
    assert.equal(result.response, 'Вы осматриваете комнату.');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    await server.close();
  }
});

test('world progression hands NPC activity results to the NPC stage, without altering unrelated simple turns', async () => {
  const server = await getTestServer();
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window, packets = [], storage = new Map();
  let simple = true, worldRequested = true, worldCreatesNPC = false;
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  globalThis.fetch = async (url, init) => {
    if (url === '/__arena_gm/rules') return new Response('{}', { status: 503 });
    if (url === '/__arena_gm/turn') { packets.push(JSON.parse(init.body)); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const packet = packets.at(-1);
      const output = packet.stepName === 'Step0_AnalysisAndPlanning_TaskGuide'
        ? { items_and_stat_calculations: ['Waiting'], _internal_flags_: { isSimpleTurn: simple, needsNPCProcessing: false, needsWorldProgression: worldRequested, needsFactionProgression: false } }
        : packet.stepName === 'Step_WorldProgression_TaskGuide'
          ? { items_and_stat_calculations: ['World simulation: Scout makes 30 minutes progress on Repair.'], ...(worldCreatesNPC ? { NPCsData: [{ NPCId: 'npc-1', name: 'Scout' }] } : {}) }
          : packet.stepName === 'Step4_NPC_TaskGuide'
            ? { NPCActivityUpdates: [{ NPCId: 'npc-1', NPCName: 'Scout', activityUpdate: { activityName: 'Repair', timeSpentMinutes: 30 } }], completeNPCActivities: [{ NPCId: 'npc-2', NPCName: 'Herbalist', activityName: 'Gather herbs', finalState: 'Completed', narrativeSummary: 'Herbs gathered.' }] }
            : {};
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { executeTurn } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Mira', race: 'Human', charClass: 'Warrior', initialPrompt: 'Wait', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2;
    const player = context.playerCharacter, npc = { ...player, NPCId: 'npc-1', name: 'Scout', currentActivity: { activityName: 'Repair', timeSpentMinutes: 0 } };
    const herbalist = { ...player, NPCId: 'npc-2', name: 'Herbalist', currentActivity: { activityName: 'Gather herbs', timeSpentMinutes: 30 } };
    context.encounteredNPCs = [npc, herbalist];
    const run = async () => { packets.length = 0; const result = await executeTurn(context, new AbortController().signal, () => {}, () => {}, () => {}); return { result, steps: packets.map(p => p.stepName), packets: [...packets] }; };
    const simpleWorld = await run();
    assert.deepEqual(simpleWorld.steps, ['Step0_AnalysisAndPlanning_TaskGuide', 'Step_WorldProgression_TaskGuide', 'Step2_CoreState_TaskGuide', 'Step4_NPC_TaskGuide', 'Step6_NarrativeGeneration_TaskGuide', 'Step7_Finalization_TaskGuide']);
    const sent = JSON.parse(simpleWorld.packets.find(p => p.stepName === 'Step4_NPC_TaskGuide').prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
    assert.match(JSON.parse(sent.partiallyGeneratedResponse).items_and_stat_calculations.join(' '), /30 minutes progress/);
    const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc, herbalist], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const { newState, processedResponse } = processAndApplyResponse(simpleWorld.result, state, context.gameSettings, key => key, true, 2, context.worldMap);
    assert.equal(newState.encounteredNPCs[0].currentActivity.timeSpentMinutes, 30);
    assert.equal(newState.encounteredNPCs[1].currentActivity, null);
    assert.equal(newState.encounteredNPCs[1].completedActivities[0].activityName, 'Gather herbs');
    assert.equal(buildNextContext(context, processedResponse, newState, [], true).encounteredNPCs[0].currentActivity.timeSpentMinutes, 30);
    simple = false; const complex = await run(); assert.equal(complex.steps.filter(s => s === 'Step4_NPC_TaskGuide').length, 1);
    simple = true; worldRequested = false; assert.deepEqual((await run()).steps, ['Step0_AnalysisAndPlanning_TaskGuide', 'StepSimpleFullResponse_TaskGuide']);
    worldRequested = true; context.gameSettings.doNotUseWorldEvents = true; assert.deepEqual((await run()).steps, ['Step0_AnalysisAndPlanning_TaskGuide', 'StepSimpleFullResponse_TaskGuide']);
    context.gameSettings.doNotUseWorldEvents = false; context.encounteredNPCs = [];
    assert.deepEqual((await run()).steps, ['Step0_AnalysisAndPlanning_TaskGuide', 'Step_WorldProgression_TaskGuide', 'StepSimpleFullResponse_TaskGuide']);
    worldCreatesNPC = true; const created = await run(); assert.ok(created.steps.includes('Step4_NPC_TaskGuide'), 'new NPC from world simulation also needs handoff');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    await server.close();
  }
});

test('faction event hands NPC goals to the NPC stage even without world progression', async () => {
  const server = await getTestServer();
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window, packets = [], storage = new Map();
  let emitEvent = true, simple = true, requestFaction = true, requestWorld = false, reportNpc = false, priorEvent = false;
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  const event = { eventId: 'event-1', headline: 'Outpost attacked', summary: 'Raiders attacked the outpost.', involvedNPCs: [{ NPCId: 'npc-1', NPCName: 'Scout', roleInEvent: 'Defender' }] };
  globalThis.fetch = async (url, init) => {
    if (url === '/__arena_gm/rules') return new Response('{}', { status: 503 });
    if (url === '/__arena_gm/turn') { packets.push(JSON.parse(init.body)); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const packet = packets.at(-1);
      const output = packet.stepName === 'Step0_AnalysisAndPlanning_TaskGuide'
        ? { items_and_stat_calculations: ['Player waits.'], ...(priorEvent ? { worldEventsLog: [event] } : {}), _internal_flags_: { isSimpleTurn: simple, needsNPCProcessing: false, needsFactionProgression: requestFaction, needsWorldProgression: requestWorld } }
        : packet.stepName === 'Step_FactionProgression_TaskGuide'
          ? emitEvent ? { items_and_stat_calculations: ['Scout must prepare a defence.'], worldEventsLog: [event], ...(reportNpc ? { NPCsData: [{ NPCId: 'npc-1', name: 'Scout' }] } : {}) } : { items_and_stat_calculations: ['No new faction event.'] }
          : packet.stepName === 'Step4_NPC_TaskGuide'
            ? { NPCGoalUpdates: [{ NPCId: 'npc-1', NPCName: 'Scout', newShortTermGoal: 'Defend the outpost', newPlan: 'Organize a watch' }], NPCQuestUpdates: [{ NPCId: 'npc-1', NPCName: 'Scout', questsToAddOrUpdate: [{ questId: 'quest-1', questName: 'Defend the outpost', status: 'Active' }] }] }
            : {};
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { executeTurn } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const { getStepFactionProgression, getStep4 } = await import('../prompts/mainPromptSteps.js');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Mira', race: 'Human', charClass: 'Warrior', initialPrompt: 'Wait', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2;
    const player = context.playerCharacter, npc = { ...player, NPCId: 'npc-1', name: 'Scout', goals: { shortTerm: 'Guard the road', longTerm: 'Protect the town' }, personalQuests: [] };
    context.encounteredNPCs = [npc];
    const run = async () => { packets.length = 0; const result = await executeTurn(context, new AbortController().signal, () => {}, () => {}, () => {}); return { result, steps: packets.map(p => p.stepName), packets: [...packets] }; };
    const handoff = await run();
    assert.deepEqual(handoff.steps, ['Step0_AnalysisAndPlanning_TaskGuide', 'Step_FactionProgression_TaskGuide', 'Step2_CoreState_TaskGuide', 'Step4_NPC_TaskGuide', 'Step6_NarrativeGeneration_TaskGuide', 'Step7_Finalization_TaskGuide']);
    const sent = JSON.parse(handoff.packets.find(p => p.stepName === 'Step4_NPC_TaskGuide').prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
    assert.equal(JSON.parse(sent.partiallyGeneratedResponse).worldEventsLog[0].eventId, 'event-1');
    const factionTask = getStepFactionProgression();
    const allowed = factionTask.split('<AllowedKeys>')[1].split('</AllowedKeys>')[0];
    assert.doesNotMatch(allowed, /NPCGoalUpdates|NPCQuestUpdates/);
    assert.match(factionTask, /Step4_NPC_TaskGuide/);
    assert.match(getStep4(), /faction.*event/is);
    const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const { newState, processedResponse } = processAndApplyResponse(handoff.result, state, context.gameSettings, key => key, true, 2, context.worldMap);
    assert.equal(newState.encounteredNPCs[0].goals.shortTerm, 'Defend the outpost');
    assert.equal(newState.encounteredNPCs[0].personalQuests[0].questId, 'quest-1');
    assert.equal(buildNextContext(context, processedResponse, newState, [], true).encounteredNPCs[0].goals.shortTerm, 'Defend the outpost');
    assert.equal(newState.worldEventsLog[0].eventId, 'event-1');
    simple = false; assert.equal((await run()).steps.filter(s => s === 'Step4_NPC_TaskGuide').length, 1);
    simple = true; emitEvent = false; assert.deepEqual((await run()).steps, ['Step0_AnalysisAndPlanning_TaskGuide', 'Step_FactionProgression_TaskGuide', 'StepSimpleFullResponse_TaskGuide']);
    emitEvent = true; requestFaction = false; assert.deepEqual((await run()).steps, ['Step0_AnalysisAndPlanning_TaskGuide', 'StepSimpleFullResponse_TaskGuide']);
    requestFaction = true; context.gameSettings.doNotUseWorldEvents = true; assert.deepEqual((await run()).steps, ['Step0_AnalysisAndPlanning_TaskGuide', 'StepSimpleFullResponse_TaskGuide']);
    context.gameSettings.doNotUseWorldEvents = false; context.encounteredNPCs = []; assert.deepEqual((await run()).steps, ['Step0_AnalysisAndPlanning_TaskGuide', 'Step_FactionProgression_TaskGuide', 'StepSimpleFullResponse_TaskGuide']);
    reportNpc = true; assert.ok((await run()).steps.includes('Step4_NPC_TaskGuide'), 'NPCs newly reported by faction stage receive handoff');
    reportNpc = false; context.encounteredNPCs = [npc]; priorEvent = true; assert.deepEqual((await run()).steps, ['Step0_AnalysisAndPlanning_TaskGuide', 'Step_FactionProgression_TaskGuide', 'StepSimpleFullResponse_TaskGuide'], 're-reporting an unchanged earlier event does not force handoff');
    priorEvent = false; requestWorld = true; assert.equal((await run()).steps.filter(s => s === 'Step4_NPC_TaskGuide').length, 1);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    await server.close();
  }
});

test('combat hands armor durability to inventory and named NPC stages', async () => {
  const server = await getTestServer();
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window, packets = [], storage = new Map();
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  globalThis.fetch = async (url, init) => {
    if (url === '/__arena_gm/rules') return new Response('{}', { status: 503 });
    if (url === '/__arena_gm/turn') { packets.push(JSON.parse(init.body)); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const packet = packets.at(-1);
      const output = packet.stepName === 'Step0_AnalysisAndPlanning_TaskGuide' ? { items_and_stat_calculations: ['Combat.'], _internal_flags_: { isSimpleTurn: false, isCombatActive: true, needsInventoryProcessing: false, needsNPCProcessing: false } }
        : packet.stepName === 'Step3_Logs_CombatAnalysis_TaskGuide' ? { items_and_stat_calculations: ['Armor holds: player armor player-armor 100% → 72%; NPC armor npc-armor 100% → 95%.'] }
        : packet.stepName === 'Step4_NPC_TaskGuide' ? { NPCInventoryUpdates: [{ NPCId: 'npc-1', NPCName: 'Guard', itemUpdate: { existedId: 'npc-armor', durability: '95%' } }] }
        : packet.stepName === 'Step5_Inventory_TaskGuide' ? { inventoryItemsData: [{ existedId: 'player-armor', name: 'Armor', durability: '72%' }] } : {};
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { executeTurn } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Mira', race: 'Human', charClass: 'Warrior', initialPrompt: 'Defend', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2;
    const player = context.playerCharacter;
    player.inventory = [{ existedId: 'player-armor', name: 'Armor', durability: '100%', count: 1, weight: 0, contentsPath: null }];
    player.equippedItems.Chest = 'player-armor';
    const npc = { ...structuredClone(player), NPCId: 'npc-1', name: 'Guard', inventory: [{ existedId: 'npc-armor', name: 'Armor', durability: '100%', count: 1, weight: 0, contentsPath: null }], equippedItems: { Chest: 'npc-armor' } };
    context.encounteredNPCs = [npc]; context.enemiesDataForCurrentTurn = [{ NPCId: 'npc-1', name: 'Guard', isGroup: false, maxHealth: '108%', currentHealth: '108%', actions: [] }];
    const run = async () => { packets.length = 0; const result = await executeTurn(context, new AbortController().signal, () => {}, () => {}, () => {}); return { result, packets: [...packets] }; };
    const turn = await run();
    const steps = turn.packets.map(p => p.stepName);
    assert.ok(steps.includes('Step4_NPC_TaskGuide')); assert.ok(steps.includes('Step5_Inventory_TaskGuide'));
    for (const name of ['Step4_NPC_TaskGuide', 'Step5_Inventory_TaskGuide']) {
      const sent = JSON.parse(turn.packets.find(p => p.stepName === name).prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
      assert.match(JSON.parse(sent.partiallyGeneratedResponse).items_and_stat_calculations.join(' '), /Armor holds/);
    }
    const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const { newState, processedResponse } = processAndApplyResponse(turn.result, state, context.gameSettings, key => key, true, 2, context.worldMap);
    assert.equal(newState.playerCharacter.inventory[0].durability, '72%'); assert.equal(newState.encounteredNPCs[0].inventory[0].durability, '95%');
    const next = buildNextContext(context, processedResponse, newState, [], true);
    assert.equal(next.playerCharacter.inventory[0].durability, '72%'); assert.equal(next.encounteredNPCs[0].inventory[0].durability, '95%');
    player.equippedItems.Chest = null; npc.equippedItems.Chest = null;
    const withoutGear = (await run()).packets.map(p => p.stepName);
    assert.ok(!withoutGear.includes('Step4_NPC_TaskGuide')); assert.ok(!withoutGear.includes('Step5_Inventory_TaskGuide'));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    await server.close();
  }
});

test('staged combat cleanup carries named NPC health through the actual turn pipeline', async () => {
  const server = await getTestServer();
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  const packets = [], storage = new Map();
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  globalThis.fetch = async (url, init) => {
    if (url === '/__arena_gm/rules') return new Response('{}', { status: 503 });
    if (url === '/__arena_gm/turn') { packets.push(JSON.parse(init.body)); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const packet = packets.at(-1);
      const output = packet.stepName === 'Step0_AnalysisAndPlanning_TaskGuide' ? { _internal_flags_: { isSimpleTurn: false, isCombatActive: true } }
        : packet.stepName === 'Step3_Combat_TaskGuide' ? { enemiesData: [{ NPCId: 'npc-1', name: 'Leader', isGroup: false, currentHealth: '80%', maxHealth: '108%', activeDebuffs: [{ effectId: 'poison', effectType: 'Debuff', targetType: 'strength', value: '-10%', duration: 2, description: 'Poison' }], actions: [] }], NPCWoundChanges: [{ NPCId: 'npc-1', NPCName: 'Leader', woundId: 'cut', woundName: 'Cut', severity: 'Light', descriptionOfEffects: 'Pain', generatedEffects: [], healingState: { currentState: 'Untreated', nextState: 'Stabilized' } }] }
        : packet.stepName === 'Step7_Finalization_TaskGuide' ? { enemiesData: [], alliesData: [] } : {};
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { executeTurn } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Fight', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2;
    const player = context.playerCharacter;
    const npc = { ...player, NPCId: 'npc-1', name: 'Leader', maxHealth: 108, currentHealth: 100, inventory: [] };
    context.encounteredNPCs = [npc];
    const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const response = await executeTurn(context, new AbortController().signal, () => {}, () => {}, () => {});
    assert.deepEqual(response.enemiesData, []);
    assert.equal(response.NPCsData.find(n => n.NPCId === 'npc-1').currentHealth, 80);
    const result = processAndApplyResponse(response, state, context.gameSettings, key => key, true, 2, context.worldMap);
    assert.equal(result.newState.encounteredNPCs[0].currentHealth, 80);
    const next = buildNextContext(context, result.processedResponse, result.newState, [], true);
    assert.equal(next.encounteredNPCs[0].currentHealth, 80);
    assert.equal(next.encounteredNPCs[0].wounds[0].woundId, 'cut');
    assert.equal(next.encounteredNPCs[0].activeEffects[0].effectId, 'poison');
    assert.equal(next.encounteredNPCs[0].activeEffects[0].duration, 2);
    assert.deepEqual(next.enemiesDataForCurrentTurn, []);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    await server.close();
  }
});

test('direct combat cleanup hands named NPC final health to NPC stage', async () => {
  const server = await getTestServer();
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window, packets = [], storage = new Map();
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  globalThis.fetch = async (url, init) => {
    if (url === '/__arena_gm/rules') return new Response('{}', { status: 503 });
    if (url === '/__arena_gm/turn') { packets.push(JSON.parse(init.body)); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const p = packets.at(-1);
      const output = p.stepName === 'Step0_AnalysisAndPlanning_TaskGuide' ? { _internal_flags_: { isSimpleTurn: false, isCombatActive: true, needsNPCProcessing: false } }
        : p.stepName === 'Step3_Logs_CombatAnalysis_TaskGuide' ? { items_and_stat_calculations: ['Guard final health: 80. Combat ends.'] }
        : p.stepName === 'Step3_Combat_TaskGuide' ? { enemiesData: [], alliesData: [], NPCWoundChanges: [{ NPCId: 'npc-1', NPCName: 'Guard', woundId: 'w1', woundName: 'Cut', severity: 'Light', descriptionOfEffects: 'Pain', generatedEffects: [], healingState: { currentState: 'Untreated', nextState: 'Stabilized' } }], NPCEffectChanges: [{ NPCId: 'npc-1', NPCName: 'Guard', effectsApplied: [{ effectId: 'poison', effectType: 'Debuff', value: '-10%', targetType: 'strength', duration: 2, description: 'Poison' }] }] }
        : p.stepName === 'Step4_NPC_TaskGuide' ? { NPCsData: [{ NPCId: 'npc-1', name: 'Guard', currentHealth: 80 }] } : {};
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: p.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { executeTurn } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Fight', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2;
    const player = context.playerCharacter;
    const npc = { ...player, NPCId: 'npc-1', name: 'Guard', inventory: [], equippedItems: {}, currentHealth: 100, wounds: [], activeEffects: [] };
    context.encounteredNPCs = [npc]; context.enemiesDataForCurrentTurn = [{ NPCId: 'npc-1', name: 'Guard', currentHealth: '100%', maxHealth: `${npc.maxHealth}%`, actions: [] }];
    const response = await executeTurn(context, new AbortController().signal, () => {}, () => {}, () => {});
    const packet = packets.find(p => p.stepName === 'Step4_NPC_TaskGuide');
    assert.ok(packet, 'NPC stage is required even when the combat roster was cleared and the NPC has no armor');
    const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: context.enemiesDataForCurrentTurn, alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const applied = processAndApplyResponse(response, state, context.gameSettings, key => key, true, 2, context.worldMap);
    const next = buildNextContext(context, applied.processedResponse, applied.newState, [], true);
    assert.equal(next.encounteredNPCs[0].currentHealth, 80);
    assert.equal(next.encounteredNPCs[0].wounds[0].woundId, 'w1');
    assert.equal(next.encounteredNPCs[0].activeEffects[0].effectId, 'poison');
    assert.deepEqual(next.enemiesDataForCurrentTurn, []);
  } finally { globalThis.fetch = oldFetch; if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; await server.close(); }
});

test('inventory processing overrides contradictory simple-turn routing for transfers', async () => {
  const server = await getTestServer();
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  const packets = [], storage = new Map();
  let malformedFinal = false, malformedEarly = false;
  const transfer = { transferId: 't1', source: { type: 'npc', id: 'n', itemId: 'i' }, destination: { type: 'player', id: 'p' }, quantity: 1 };
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  globalThis.fetch = async (url, init) => {
    if (url === '/__arena_gm/turn') { packets.push(JSON.parse(init.body)); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const p = packets.at(-1);
      const output = p.stepName === 'Step0_AnalysisAndPlanning_TaskGuide'
        ? { _internal_flags_: { isSimpleTurn: true, needsInventoryProcessing: true, needsWorldProgression: false, needsFactionProgression: false } }
        : malformedEarly && p.stepName === 'Step2_CoreState_TaskGuide' ? { inventoryTransfers: { unexpected: 'not an array' }, currentHealthChange: 10 }
        : p.stepName === 'Step5_Inventory_TaskGuide' ? { inventoryTransfers: [transfer] }
        : malformedFinal && p.stepName === 'Step7_Finalization_TaskGuide' ? { inventoryTransfers: [null], currentHealthChange: 10 } : {};
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: p.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { executeTurn } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Mira', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear', doNotUseWorldEvents: true }, 'en');
    context.currentTurnNumber = 2;
    const result = await executeTurn(context, new AbortController().signal, () => {}, () => {}, () => {});
    assert.ok(packets.some(p => p.stepName === 'Step5_Inventory_TaskGuide'));
    assert.ok(!packets.some(p => p.stepName === 'StepSimpleFullResponse_TaskGuide'));
    assert.deepEqual(result.inventoryTransfers, [transfer]);
    assert.equal(result._internal_flags_.isSimpleTurn, false);
    malformedFinal = true;
    const invalid = await executeTurn(context, new AbortController().signal, () => {}, () => {}, () => {});
    assert.deepEqual(invalid.inventoryTransfers, [transfer, null]);
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const pc = context.playerCharacter;
    const base = { playerCharacter: pc, players: [pc], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const snapshot = structuredClone(base);
    assert.throws(() => processAndApplyResponse(invalid, base, context.gameSettings, k => k, true, 2, context.worldMap), /error_inventory_transfer_rejected/);
    assert.deepEqual(base, snapshot);
    malformedFinal = false; malformedEarly = true;
    const early = await executeTurn(context, new AbortController().signal, () => {}, () => {}, () => {});
    assert.deepEqual(early.inventoryTransfers, { unexpected: 'not an array' });
    assert.throws(() => processAndApplyResponse(early, base, context.gameSettings, k => k, true, 2, context.worldMap), /error_inventory_transfer_rejected/);
    assert.deepEqual(base, snapshot);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    await server.close();
  }
});

after(async () => { await closeTestServer(); });
