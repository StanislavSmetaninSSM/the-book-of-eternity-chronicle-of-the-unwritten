import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('new off-screen location and NPC share one resolved ID through the next context', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    for (const explicitId of [undefined, 'location-provided-by-gm']) {
      const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
      const player = context.playerCharacter;
      const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
      const location = { initialId: 'outpost-initial', ...(explicitId ? { locationId: explicitId } : {}), name: 'Outpost', coordinates: { x: 2, y: 0 }, locationType: 'outdoor', biome: 'Plains', description: 'An outpost.', internalDifficultyProfile: { combat: 1, environment: 1, social: 1, exploration: 1 }, externalDifficultyProfile: { combat: 1, environment: 1, social: 1, exploration: 1 } };
      const response = { worldMapUpdates: { newLocations: [location] }, NPCsData: [{ ...player, NPCId: null, initialId: 'guard-initial', initialLocationId: 'outpost-initial', name: 'Guard', inventory: [] }] };
      const { newState, processedResponse } = processAndApplyResponse(response, base, context.gameSettings, key => key, true, 1, context.worldMap);
      assert.ok(processedResponse, 'the resolved response must be shared with context construction');
      const next = buildNextContext(context, processedResponse, newState, [], true);
      const savedLocation = Object.values(next.worldMap).find(item => item.name === 'Outpost');
      assert.ok(savedLocation?.locationId);
      assert.equal(newState.encounteredNPCs[0].currentLocationId, savedLocation.locationId);
      if (explicitId) assert.equal(savedLocation.locationId, explicitId);
      assert.equal(response.worldMapUpdates.newLocations[0].locationId, explicitId, 'original response remains unmodified');
    }
  } finally { await server.close(); }
});

test('normal turns and GM questions build context from the resolved response', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../hooks/logic/turn.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/buildNextContext\(context, processedResponse, newState, newHistoryWithAnswer, true, onWorldMapWarning\)/g) || []).length, 2);
  assert.equal((source.match(/buildNextContext\(context, processedResponse, newState, newHistoryWithAnswer, false, onWorldMapWarning\)/g) || []).length, 2);
});

test('implicit scene presence reflects NPC changes from the same turn', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const location = { ...context.currentLocation, locationId: 'here' };
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: location, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const npc = { ...player, NPCId: 'npc-1', name: 'Visitor', currentLocationId: 'here', inventory: [] };
    const arrived = processAndApplyResponse({ NPCsData: [npc] }, base, context.gameSettings, key => key, true, 1, context.worldMap).newState;
    assert.equal(arrived.NPCsInScene, true);
    const left = processAndApplyResponse({ NPCsData: [{ NPCId: 'npc-1', name: 'Visitor', currentLocationId: 'elsewhere' }] }, arrived, context.gameSettings, key => key, true, 2, context.worldMap).newState;
    assert.equal(left.NPCsInScene, false);
    const explicit = processAndApplyResponse({ NPCsInScene: false, NPCsData: [npc] }, base, context.gameSettings, key => key, true, 1, context.worldMap).newState;
    assert.equal(explicit.NPCsInScene, false);
  } finally { await server.close(); }
});

test('a temporary location tag cannot pull a departed NPC back on later turns', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const apply = (response, state, turn) => processAndApplyResponse(response, state, context.gameSettings, key => key, true, turn, context.worldMap).newState;
    const created = apply({ currentLocationData: { initialId: 'temp-loc-camp', locationId: 'camp', name: 'Camp' }, NPCsData: [{ ...player, NPCId: 'visitor', name: 'Visitor', currentLocationId: null, initialLocationId: 'temp-loc-camp', inventory: [] }] }, base, 1);
    assert.equal(created.encounteredNPCs[0].currentLocationId, 'camp');
    const departed = apply({ NPCsData: [{ NPCId: 'visitor', name: 'Visitor', currentLocationId: 'other-place' }] }, created, 2);
    assert.equal(departed.encounteredNPCs[0].currentLocationId, 'other-place');
    const later = apply({}, departed, 3);
    assert.equal(later.encounteredNPCs[0].currentLocationId, 'other-place');
    assert.equal(later.NPCsInScene, false);
  } finally { await server.close(); }
});

test('threat completion archives a real activity once and permits a later new activity', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    let context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2;
    const player = context.playerCharacter;
    const here = { ...context.currentLocation, locationId: 'here' };
    const remote = { ...context.currentLocation, locationId: 'remote', name: 'Remote', coordinates: { x: 3, y: 0 }, activeThreats: [{ threatId: 'wolves', name: 'Wolves', intensity: 3, currentActivity: { activityId: 'raid-id', activityName: 'Raid', timeSpentMinutes: 20 }, completedActivities: [] }] };
    context.currentLocation = here;
    context.worldMap = { here, remote };
    let state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: here, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const step = response => {
      const result = processAndApplyResponse(response, state, context.gameSettings, key => key, true, context.currentTurnNumber, context.worldMap);
      state = result.newState;
      context = buildNextContext(context, result.processedResponse, state, [], true);
      return context.worldMap.remote.activeThreats[0];
    };
    const completion = { activityId: 'raid-id', targetLocationId: 'remote', threatId: 'wolves', threatName: 'Wolves', finalState: 'Completed', narrativeSummary: 'The raid ended.' };
    const first = step({ worldMapUpdates: { completeThreatActivities: [completion, completion] } });
    assert.equal(first.currentActivity, null);
    assert.deepEqual(first.completedActivities, [{ activityId: 'raid-id', activityName: 'Raid', finalState: 'Completed', narrativeSummary: 'The raid ended.', completionTurn: 2 }]);
    const repeated = step({ worldMapUpdates: { completeThreatActivities: [completion] } });
    assert.equal(repeated.completedActivities.length, 1);
    const started = step({ worldMapUpdates: { threatsToUpdate: [{ targetLocationId: 'remote', threatUpdate: { threatId: 'wolves', currentActivity: { activityName: 'Hunt', timeSpentMinutes: 0 } } }] } });
    assert.equal(started.currentActivity.activityName, 'Hunt');
    assert.equal(started.completedActivities.length, 1);
    const huntId = started.currentActivity.activityId;
    assert.ok(huntId && huntId !== 'raid-id');
    assert.equal(step({ worldMapUpdates: { completeThreatActivities: [completion] } }).currentActivity.activityId, huntId, 'stale completion rejected');
    assert.equal(step({ worldMapUpdates: { completeThreatActivities: [{ ...completion, activityId: undefined }] } }).currentActivity.activityId, huntId, 'legacy completion rejected');
    const finished = step({ worldMapUpdates: { completeThreatActivities: [{ ...completion, activityId: huntId }] } });
    assert.equal(finished.currentActivity, null);
    assert.equal(finished.completedActivities[0].activityId, huntId);
    assert.equal(remote.activeThreats[0].currentActivity.activityName, 'Raid');
  } finally { await server.close(); }
});

test('turn manager preserves NPC location and applies item journal commands once', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  const packets = [], storage = new Map();
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  globalThis.fetch = async (url, init) => {
    if (url === '/__arena_gm/turn') { packets.push(JSON.parse(init.body)); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const packet = packets.at(-1);
      const output = packet.stepName === 'Step0_AnalysisAndPlanning_TaskGuide' ? { _internal_flags_: { isSimpleTurn: true } } : { itemJournalUpdates: [{ itemId: 'relic', itemName: 'Relic', entryToAppend: 'New entry' }, { itemId: 'npc-relic', itemName: 'Relic', entryToAppend: 'NPC entry' }] };
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { createTurnManager } = await server.ssrLoadModule('/hooks/logic/turn.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Wait', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2;
    const location = { ...context.currentLocation, locationId: 'camp', initialId: 'temp-loc-camp' };
    const player = { ...context.playerCharacter, inventory: [{ existedId: 'relic', name: 'Relic', count: 1, weight: 1, contentsPath: null, journalEntries: ['Old entry'] }] };
    context.playerCharacter = player;
    context.players = [player];
    const npc = { ...player, NPCId: 'visitor', name: 'Visitor', initialLocationId: 'temp-loc-camp', currentLocationId: 'other-place', inventory: [{ existedId: 'npc-relic', name: 'Relic', count: 1, weight: 1, contentsPath: null, journalEntries: ['NPC old'] }] };
    context.currentLocation = location;
    context.worldMap = { camp: location };
    context.encounteredNPCs = [npc];
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: location, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'host', myPeerId: 'host', peers: [], isConnectedToHost: true };
    let storedState = base, sync = null, error = null;
    const setGameState = value => { storedState = typeof value === 'function' ? value(storedState) : value; };
    const noop = () => {};
    const gameContextRef = { current: context };
    const manager = createTurnManager({ gameState: base, setGameState, gameHistory: [], setGameHistory: noop, isLoading: false, setIsLoading: noop, setError: value => { error = value; }, setLastJsonResponse: noop, setLastRequestJson: noop, setGameLog: noop, setCombatLog: noop, setSceneImagePrompt: noop, setSuggestedActions: noop, setWorldMap: noop, setVisitedLocations: noop, setWorldState: noop, setTurnNumber: noop, gameContextRef, abortControllerRef: { current: null }, setSuperInstructions: noop, setGameSettings: noop, setLanguage: noop, t: key => key, turnStartTimeRef: { current: null }, setTurnTime: noop, setCurrentStep: noop, setCurrentModel: noop, language: 'en', gameSettings: context.gameSettings, hostConnectionRef: { current: null }, gameStateRef: { current: base }, broadcastFullSync: value => { sync = value; }, combatLog: [], gameLog: [] });
    await manager.resumeInterruptedTurn({ context, baseState: base, history: [] });
    assert.equal(error, null);
    assert.ok(sync, 'host receives the full turn result');
    assert.equal(storedState.encounteredNPCs[0].currentLocationId, 'other-place');
    assert.equal(storedState.NPCsInScene, false);
    assert.equal(gameContextRef.current.encounteredNPCs[0].currentLocationId, 'other-place');
    assert.equal(sync.gameState.encounteredNPCs[0].currentLocationId, 'other-place');
    assert.deepEqual(storedState.playerCharacter.inventory[0].journalEntries, ['New entry', 'Old entry']);
    assert.deepEqual(storedState.players[0].inventory[0].journalEntries, ['New entry', 'Old entry']);
    assert.deepEqual(sync.gameState.players[0].inventory[0].journalEntries, ['New entry', 'Old entry']);
    assert.deepEqual(storedState.encounteredNPCs[0].inventory[0].journalEntries, ['NPC entry', 'NPC old']);
    assert.deepEqual(sync.gameState.encounteredNPCs[0].inventory[0].journalEntries, ['NPC entry', 'NPC old']);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    await server.close();
  }
});

test('same-coordinate vertical location retains its own ID and NPC and threat links', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const ctx = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Explore', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    ctx.currentTurnNumber = 2;
    const here = { ...ctx.currentLocation, locationId: 'surface', coordinates: { x: 0, y: 0 } };
    ctx.currentLocation = here; ctx.worldMap = { surface: here };
    const player = ctx.playerCharacter;
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: here, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const underground = { ...here, locationId: 'underground', initialId: 'temp-underground', name: 'Lower cave', coordinates: { x: 0, y: 0 } };
    const response = { worldMapUpdates: { newLocations: [underground], threatsToAdd: [{ initialTargetLocationId: 'temp-underground', threat: { threatId: 'threat-1', name: 'Golem', currentActivity: null } }] }, NPCsData: [{ ...player, NPCId: 'npc-1', name: 'Guard', initialLocationId: 'temp-underground', currentLocationId: null, inventory: [] }] };
    const applied = processAndApplyResponse(response, base, ctx.gameSettings, key => key, true, 2, ctx.worldMap);
    const next = buildNextContext(ctx, applied.processedResponse, applied.newState, [], true);
    assert.equal(next.worldMap.surface.locationId, 'surface');
    assert.equal(next.worldMap.underground.name, 'Lower cave');
    assert.equal(next.worldMap.underground.activeThreats[0].threatId, 'threat-1');
    assert.equal(next.encounteredNPCs[0].currentLocationId, 'underground');
    assert.equal(response.NPCsData[0].currentLocationId, null);
  } finally { await server.close(); }
});

test('new location missing coordinates cannot silently commit dangling NPC links', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const ctx = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Explore', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const p = ctx.playerCharacter;
    const base = { playerCharacter: p, players: [p], activePlayerIndex: 0, currentLocationData: ctx.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const response = { worldMapUpdates: { newLocations: [{ initialId: 'bad', name: 'Broken', coordinates: null }] }, NPCsData: [{ ...p, NPCId: 'npc', name: 'Guard', initialLocationId: 'bad', inventory: [] }] };
    assert.throws(() => processAndApplyResponse(response, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap), /coordinates/i);
    const existingMap = { 'existing': { ...ctx.currentLocation, locationId: 'existing', name: 'Original' } };
    const collision = { worldMapUpdates: { newLocations: [{ ...ctx.currentLocation, locationId: 'existing', initialId: 'new-tag', name: 'Different' }] }, NPCsData: [{ ...p, NPCId: 'npc', name: 'Guard', initialLocationId: 'new-tag', inventory: [] }] };
    assert.throws(() => processAndApplyResponse(collision, base, ctx.gameSettings, k => k, true, 2, existingMap), /location.*id/i);
    const location = { ...ctx.currentLocation, locationId: 'fresh', initialId: 'tag', name: 'Fresh' };
    for (const duplicate of [{ ...location, initialId: 'other' }, { ...location, locationId: 'other' }]) {
      assert.throws(() => processAndApplyResponse({ worldMapUpdates: { newLocations: [location, duplicate] } }, base, ctx.gameSettings, k => k, true, 2, {}), /location.*id/i);
    }
    assert.equal(base.encounteredNPCs.length, 0);
  } finally { await server.close(); }
});

test('threat completion contract requires current activity identity', async () => {
  const { readFile } = await import('node:fs/promises');
  const types = await readFile(new URL('../types.ts', import.meta.url), 'utf8');
  const { getGameMasterGuideRules } = await import('../prompts/mainPromptModule.js');
  const definition = types.split('export interface CompleteThreatActivity {')[1].split('}')[0];
  assert.match(definition, /activityId:\s*string/);
  const rule = getGameMasterGuideRules().split('<Rule id="20.13.4">')[1].split('</Rule>')[0];
  assert.match(rule, /"activityId"/);
});

test('location links use ID and refuse ambiguous legacy coordinate operations', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { updateWorldMap } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { resolveLinkTarget } = await import('../utils/locationLinks.js');
    const coords = { x: 0, y: 0 };
    const link = id => ({ name: id, shortDescription: '', linkType: 'Stairs', linkState: 'Safe', targetCoordinates: coords, targetLocationId: id });
    const source = { locationId: 'source', coordinates: { x: 1, y: 0 }, adjacencyMap: [] };
    const upper = { locationId: 'upper', coordinates: coords }, lower = { locationId: 'lower', coordinates: coords };
    let map = { source, upper, lower };
    map = updateWorldMap(map, { newLinks: [{ sourceLocationId: 'source', link: link('upper') }, { sourceLocationId: 'source', link: link('lower') }, { sourceLocationId: 'source', link: { ...link('legacy'), targetLocationId: undefined } }] }, source, 1);
    assert.deepEqual(map.source.adjacencyMap.map(l => l.targetLocationId), ['upper', 'lower']);
    assert.equal(resolveLinkTarget({ targetCoordinates: coords }, Object.values(map)), null);
    assert.equal(resolveLinkTarget(link('lower'), Object.values(map)).locationId, 'lower');
    map = updateWorldMap(map, { linkUpdates: [{ sourceLocationId: 'source', targetCoordinates: coords, updatedLink: { linkState: 'Blocked' } }], linksToRemove: [{ sourceLocationId: 'source', targetCoordinates: coords }] }, map.source, 2);
    assert.equal(map.source.adjacencyMap.length, 2);
    assert.equal(map.source.adjacencyMap[0].linkState, 'Safe');
    map = updateWorldMap(map, { linkUpdates: [{ sourceLocationId: 'source', targetLocationId: 'lower', updatedLink: { linkState: 'Blocked' } }], linksToRemove: [{ sourceLocationId: 'source', targetLocationId: 'upper' }] }, map.source, 3);
    assert.equal(map.source.adjacencyMap.length, 1);
    assert.equal(map.source.adjacencyMap[0].targetLocationId, 'lower');
    assert.equal(map.source.adjacencyMap[0].linkState, 'Blocked');
    const oldSource = { ...source, adjacencyMap: [{ ...link('old'), targetLocationId: undefined }] };
    const old = updateWorldMap({ source: oldSource, upper }, { linkUpdates: [{ sourceLocationId: 'source', targetLocationId: 'upper', updatedLink: { linkState: 'Blocked' } }] }, oldSource, 4);
    assert.equal(old.source.adjacencyMap[0].linkState, 'Blocked');
  } finally { await server.close(); }
});

test('legacy threat activities gain stable IDs and survive save/load', async () => {
  await import('fake-indexeddb/auto');
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { ensureThreatActivityIds, updateWorldMap } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { saveToDBSlot, loadFromDBSlot } = await server.ssrLoadModule('/utils/fileManager.ts');
    const loc = { locationId: 'loc', coordinates: { x: 0, y: 0 }, activeThreats: [{ threatId: 'wolf', name: 'Wolf', currentActivity: { activityName: 'Hunt' } }] };
    const map = { loc }; ensureThreatActivityIds(map, loc);
    const id = loc.activeThreats[0].currentActivity.activityId;
    assert.ok(id); ensureThreatActivityIds(map, loc); assert.equal(loc.activeThreats[0].currentActivity.activityId, id);
    await saveToDBSlot(21, { gameContext: { worldMap: map }, gameState: { playerCharacter: { name: 'Test', level: 1 }, currentLocationData: { name: 'Place' } }, gameHistory: [], gameLog: [], combatLog: [], timestamp: new Date().toISOString() });
    const loaded = await loadFromDBSlot(21); assert.equal(loaded.gameContext.worldMap.loc.activeThreats[0].currentActivity.activityId, id);
    const progress = updateWorldMap(loaded.gameContext.worldMap, { threatsToUpdate: [{ targetLocationId: 'loc', threatUpdate: { threatId: 'wolf', currentActivity: { activityName: 'Hunt', timeSpentMinutes: 5 } } }] }, loaded.gameContext.worldMap.loc, 2);
    assert.equal(progress.loc.activeThreats[0].currentActivity.activityId, id);
    const wrong = updateWorldMap(progress, { completeThreatActivities: [{ targetLocationId: 'loc', threatId: 'wolf', activityId: 'stale', finalState: 'Completed' }] }, progress.loc, 3);
    assert.equal(wrong.loc.activeThreats[0].currentActivity.activityId, id);
    const done = updateWorldMap(wrong, { completeThreatActivities: [{ targetLocationId: 'loc', threatId: 'wolf', activityId: id, finalState: 'Completed' }] }, wrong.loc, 4);
    assert.equal(done.loc.activeThreats[0].currentActivity, null);
    assert.equal(done.loc.activeThreats[0].completedActivities[0].activityId, id);
  } finally { await server.close(); }
});

test('link merges preserve distinct destination IDs at the same coordinates', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { deepMergeResponses } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const a = { targetLocationId: 'a', targetCoordinates: { x: 0, y: 0 }, name: 'Upper' };
    const b = { targetLocationId: 'b', targetCoordinates: { x: 0, y: 0 }, name: 'Lower' };
    const result = deepMergeResponses({ adjacencyMap: [a] }, { adjacencyMap: [b] });
    assert.deepEqual(result.adjacencyMap.map(l => l.targetLocationId), ['a', 'b']);
  } finally { await server.close(); }
});

test('skipped unsafe commands are reported without changing target state', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { updateWorldMap } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { translate } = await server.ssrLoadModule('/utils/localization.ts');
    const loc = { locationId: 'home', coordinates: { x: 1, y: 0 }, adjacencyMap: [{ name: 'Old stairs', targetCoordinates: { x: 0, y: 0 } }], activeThreats: [{ threatId: 'wolves', currentActivity: { activityId: 'hunt', activityName: 'Hunt' }, completedActivities: [] }] };
    const base = { home: loc, upper: { locationId: 'upper', coordinates: { x: 0, y: 0 } }, lower: { locationId: 'lower', coordinates: { x: 0, y: 0 } } };
    const warnings = [];
    const updates = { newLinks: [{ sourceLocationId: 'home', link: { name: 'ambiguous', targetCoordinates: { x: 0, y: 0 } } }], linkUpdates: [{ sourceLocationId: 'home', targetCoordinates: { x: 0, y: 0 }, updatedLink: { name: 'Wrong' } }], linksToRemove: [{ sourceLocationId: 'home', targetCoordinates: { x: 0, y: 0 } }], completeThreatActivities: [{ targetLocationId: 'home', threatId: 'wolves', finalState: 'Completed' }, { targetLocationId: 'home', threatId: 'wolves', activityId: 'stale', finalState: 'Completed' }] };
    const next = updateWorldMap(base, updates, loc, 2, warning => warnings.push(warning));
    assert.deepEqual(warnings.map(w => w.kind), ['link-create', 'link-update', 'link-remove', 'threat-completion', 'threat-completion']);
    assert.equal(next.home.adjacencyMap.length, 1);
    assert.equal(next.home.adjacencyMap[0].name, 'Old stairs');
    assert.equal(next.home.activeThreats[0].currentActivity.activityId, 'hunt');
    for (const warning of warnings) for (const language of ['en', 'ru']) {
      const message = translate(language, `world_map_warning_${warning.kind}`, { subject: warning.subject });
      assert(!message.includes('{subject}')); assert(!message.startsWith('world_map_warning_'));
      assert(message.includes(warning.subject));
    }
    const accepted = [];
    const done = updateWorldMap(next, { completeThreatActivities: [{ targetLocationId: 'home', threatId: 'wolves', activityId: 'hunt', finalState: 'Completed' }] }, next.home, 3, w => accepted.push(w));
    assert.equal(done.home.activeThreats[0].currentActivity, null);
    assert.deepEqual(accepted, []);
  } finally { await server.close(); }
});

test('turn warnings enter visible history and host save together with unchanged world state', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  const packets = [], storage = new Map();
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  globalThis.fetch = async (url, init) => {
    if (url === '/__arena_gm/turn') { packets.push(JSON.parse(init.body)); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const packet = packets.at(-1);
      const output = packet.stepName === 'Step0_AnalysisAndPlanning_TaskGuide' ? { _internal_flags_: { isSimpleTurn: true } } : { response: 'The story continues.', worldMapUpdates: { linksToRemove: [{ sourceLocationId: 'home', targetCoordinates: { x: 0, y: 0 } }], completeThreatActivities: [{ targetLocationId: 'home', threatId: 'wolves', finalState: 'Completed' }] } };
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { createTurnManager } = await server.ssrLoadModule('/hooks/logic/turn.ts');
    const { translate } = await server.ssrLoadModule('/utils/localization.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2; const p = context.playerCharacter;
    const home = { ...context.currentLocation, locationId: 'home', coordinates: { x: 1, y: 0 }, adjacencyMap: [{ name: 'Stairs', targetCoordinates: { x: 0, y: 0 } }], activeThreats: [{ threatId: 'wolves', currentActivity: { activityId: 'hunt', activityName: 'Hunt' } }] };
    context.currentLocation = home; context.worldMap = { home, upper: { ...home, locationId: 'upper', coordinates: { x: 0, y: 0 }, activeThreats: [] }, lower: { ...home, locationId: 'lower', coordinates: { x: 0, y: 0 }, activeThreats: [] } };
    const base = { playerCharacter: p, players: [p], activePlayerIndex: 0, currentLocationData: home, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'host', myPeerId: 'host', peers: [], isConnectedToHost: true };
    let sync, history; const noop = () => {}; const contextRef = { current: context };
    const manager = createTurnManager({ gameState: base, setGameState: noop, gameHistory: [], setGameHistory: v => { history = v; }, isLoading: false, setIsLoading: noop, setError: noop, setLastJsonResponse: noop, setLastRequestJson: noop, setGameLog: noop, setCombatLog: noop, setSceneImagePrompt: noop, setSuggestedActions: noop, setWorldMap: noop, setVisitedLocations: noop, setWorldState: noop, setTurnNumber: noop, gameContextRef: contextRef, abortControllerRef: { current: null }, setSuperInstructions: noop, setGameSettings: noop, setLanguage: noop, t: (k, r) => translate('en', k, r), turnStartTimeRef: { current: null }, setTurnTime: noop, setCurrentStep: noop, setCurrentModel: noop, language: 'en', gameSettings: context.gameSettings, hostConnectionRef: { current: null }, gameStateRef: { current: base }, broadcastFullSync: value => { sync = value; }, combatLog: [], gameLog: [] });
    await manager.resumeInterruptedTurn({ context, baseState: base, history: [] });
    const system = history.filter(item => item.sender === 'system');
    assert.equal(system.length, 2); assert.match(system[0].content, /not removed/); assert.match(system[1].content, /not completed/);
    assert.deepEqual(sync.gameHistory, history); assert.deepEqual(contextRef.current.responseHistory, history);
    assert.equal(sync.gameContext.worldMap.home.adjacencyMap.length, 1);
    assert.equal(sync.gameContext.worldMap.home.activeThreats[0].currentActivity.activityId, 'hunt');
    await manager.askQuestion('Check the world');
    const questionWarnings = history.filter(item => item.sender === 'system');
    assert.equal(questionWarnings.length, 2);
    assert.match(questionWarnings[0].content, /not removed/);
    assert.match(questionWarnings[1].content, /not completed/);
    assert.deepEqual(sync.gameHistory, history);
    assert.deepEqual(contextRef.current.responseHistory, history);
    assert.equal(sync.gameContext.worldMap.home.activeThreats[0].currentActivity.activityId, 'hunt');
  } finally { globalThis.fetch = oldFetch; if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; await server.close(); }
});

test('completing one threat activity and starting another in the same response archives the old one', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { updateWorldMap } = await server.ssrLoadModule('/utils/gameContext.ts');
    const here = { locationId: 'here', coordinates: { x: 1, y: 0 }, activeThreats: [{ threatId: 'wolves', name: 'Wolves', currentActivity: { activityId: 'raid', activityName: 'Raid', timeSpentMinutes: 20 }, completedActivities: [] }] };
    const update = { targetLocationId: 'here', threatUpdate: { threatId: 'wolves', currentActivity: { activityName: 'Hunt', timeSpentMinutes: 0 } } };
    const completion = { targetLocationId: 'here', threatId: 'wolves', activityId: 'raid', finalState: 'Completed', narrativeSummary: 'The raid ended' };
    const warnings = [];
    const map = updateWorldMap({ here }, { threatsToUpdate: [update], completeThreatActivities: [completion] }, here, 3, w => warnings.push(w));
    const wolf = map.here.activeThreats[0];
    assert.equal(wolf.completedActivities[0].activityId, 'raid');
    assert.equal(wolf.currentActivity.activityName, 'Hunt');
    assert.notEqual(wolf.currentActivity.activityId, 'raid');
    const reloaded = JSON.parse(JSON.stringify(map));
    const later = updateWorldMap(reloaded, { completeThreatActivities: [completion] }, reloaded.here, 4);
    assert.equal(later.here.activeThreats[0].completedActivities.length, 1);
    assert.equal(later.here.activeThreats[0].currentActivity.activityId, wolf.currentActivity.activityId);
    assert.deepEqual(warnings, []);
    assert.equal(here.activeThreats[0].currentActivity.activityId, 'raid');
    const rejected = updateWorldMap({ here }, { threatsToUpdate: [update], completeThreatActivities: [{ ...completion, activityId: 'stale' }] }, here, 3, w => warnings.push(w));
    assert.equal(rejected.here.activeThreats[0].currentActivity.activityId, 'raid');
    assert.equal(rejected.here.activeThreats[0].completedActivities.length, 0);
    assert.ok(warnings.some(w => w.kind === 'threat-replacement'));
    const withoutCompletion = updateWorldMap({ here }, { threatsToUpdate: [update] }, here, 3, w => warnings.push(w));
    assert.equal(withoutCompletion.here.activeThreats[0].currentActivity.activityId, 'raid');
    const progressed = updateWorldMap({ here }, { threatsToUpdate: [{ targetLocationId: 'here', threatUpdate: { threatId: 'wolves', currentActivity: { activityName: 'Raid', timeSpentMinutes: 30 } } }], completeThreatActivities: [completion] }, here, 3);
    assert.equal(progressed.here.activeThreats[0].currentActivity, null);
    assert.equal(progressed.here.activeThreats[0].completedActivities[0].activityId, 'raid');
  } finally { await server.close(); }
});

test('temporary location and cross-entity ID collisions are rejected instead of misdirecting NPCs', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const c = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const p = c.playerCharacter, here = { ...c.currentLocation, locationId: 'here', initialId: 'same-tag', coordinates: { x: 0, y: 0 } };
    const base = { playerCharacter: p, players: [p], activePlayerIndex: 0, currentLocationData: here, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const location = { ...here, locationId: 'new-place', name: 'New', coordinates: { x: 4, y: 0 } };
    const npc = { ...p, NPCId: 'guard', name: 'Guard', initialLocationId: 'same-tag', inventory: [] };
    const response = { currentLocationData: { locationId: 'here', initialId: 'same-tag' }, worldMapUpdates: { newLocations: [location] }, NPCsData: [npc] };
    assert.throws(() => processAndApplyResponse(response, base, c.gameSettings, k => k, true, 2, { here }), /initial|temporary/i);
    const cross = { worldMapUpdates: { newLocations: [location] }, questUpdates: [{ questId: 'quest', initialId: 'same-tag', questName: 'Quest' }], NPCsData: [npc] };
    assert.throws(() => processAndApplyResponse(cross, base, c.gameSettings, k => k, true, 2, { here }), /initial|temporary/i);
    const sameIdDifferentKind = { ...cross, questUpdates: [{ questId: 'new-place', initialId: 'same-tag', questName: 'Quest' }] };
    assert.throws(() => processAndApplyResponse(sameIdDifferentKind, base, c.gameSettings, k => k, true, 2, { here }), /initial|temporary/i);
    const sameEntity = { currentLocationData: { locationId: 'new-place', initialId: 'same-tag' }, worldMapUpdates: { newLocations: [location] }, NPCsData: [npc] };
    const accepted = processAndApplyResponse(sameEntity, base, c.gameSettings, k => k, true, 2, { here });
    assert.equal(accepted.newState.encounteredNPCs[0].currentLocationId, 'new-place');
    const temporaryOnly = { currentLocationData: { locationId: null, initialId: 'same-tag' }, worldMapUpdates: { newLocations: [{ ...location, locationId: null }] }, NPCsData: [npc] };
    const generated = processAndApplyResponse(temporaryOnly, base, c.gameSettings, k => k, true, 2, { here });
    const generatedId = generated.newState.currentLocationData.locationId;
    assert.ok(generatedId);
    assert.equal(generated.processedResponse.worldMapUpdates.newLocations[0].locationId, generatedId);
    assert.equal(generated.newState.encounteredNPCs[0].currentLocationId, generatedId);
    assert.equal(generated.newState.currentLocationData.name, 'New');
    const currentExplicit = { currentLocationData: { locationId: 'new-place', initialId: 'same-tag' }, worldMapUpdates: { newLocations: [{ ...location, locationId: null }] }, NPCsData: [npc] };
    const unified = processAndApplyResponse(currentExplicit, base, c.gameSettings, k => k, true, 2, { here });
    assert.equal(unified.processedResponse.worldMapUpdates.newLocations[0].locationId, 'new-place');
    assert.equal(unified.newState.currentLocationData.locationId, 'new-place');
    assert.equal(unified.newState.currentLocationData.name, 'New');
    assert.equal(unified.newState.encounteredNPCs[0].currentLocationId, 'new-place');
    const newExplicit = { currentLocationData: { initialId: 'same-tag' }, worldMapUpdates: { newLocations: [location] }, NPCsData: [npc] };
    assert.equal(processAndApplyResponse(newExplicit, base, c.gameSettings, k => k, true, 2, { here }).newState.currentLocationData.locationId, 'new-place');
    assert.equal(base.encounteredNPCs.length, 0);
  } finally { await server.close(); }
});

test('ID-only links acquire valid target coordinates and legacy malformed links do not crash the map', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { updateWorldMap } = await server.ssrLoadModule('/utils/gameContext.ts');
    const home = { locationId: 'home', name: 'Home', coordinates: { x: 0, y: 0 }, adjacencyMap: [] };
    const destination = { locationId: 'dest', name: 'Destination', coordinates: { x: 1, y: 2 }, adjacencyMap: [] };
    const idOnly = { name: 'Path', shortDescription: '', linkType: 'Path', linkState: 'Safe', targetLocationId: 'dest' };
    const warnings = [];
    const result = updateWorldMap({ home, dest: destination }, { newLinks: [{ sourceLocationId: 'home', link: idOnly }] }, home, 2, w => warnings.push(w));
    assert.deepEqual(result.home.adjacencyMap[0].targetCoordinates, { x: 1, y: 2 });
    assert.equal(idOnly.targetCoordinates, undefined);
    const rejected = updateWorldMap({ home, dest: destination }, { newLinks: [{ sourceLocationId: 'home', link: { ...idOnly, targetCoordinates: { x: 9, y: 9 } } }] }, home, 2, w => warnings.push(w));
    assert.equal(rejected.home.adjacencyMap.length, 0);
    assert.equal(warnings.at(-1).kind, 'link-create');
    const brokenUpdate = updateWorldMap(result, { linkUpdates: [{ sourceLocationId: 'home', targetLocationId: 'dest', updatedLink: { targetCoordinates: { x: 9, y: 9 } } }] }, result.home, 3, w => warnings.push(w));
    assert.deepEqual(brokenUpdate.home.adjacencyMap[0].targetCoordinates, { x: 1, y: 2 });
    assert.equal(warnings.at(-1).kind, 'link-update');
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { LocalizationProvider } = await server.ssrLoadModule('/context/LocalizationContext.tsx');
    const LocationViewer = (await server.ssrLoadModule('/components/LocationViewer.tsx')).default;
    const legacy = { ...home, adjacencyMap: [{ ...idOnly }, { name: 'Broken' }, null] };
    assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(LocalizationProvider, null, React.createElement(LocationViewer, { visitedLocations: [legacy, destination], currentLocation: legacy, onOpenModal() {}, imageCache: {}, onImageGenerated() {}, gameSettings: null, encounteredFactions: [] }))));
  } finally { await server.close(); }
});

test('stale activity updates cannot rewrite another activity identity', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { updateWorldMap } = await server.ssrLoadModule('/utils/gameContext.ts');
    const here = { locationId: 'here', coordinates: { x: 0, y: 0 }, activeThreats: [{ threatId: 'wolf', intensity: 1, currentActivity: { activityId: 'new', activityName: 'Raid', timeSpentMinutes: 5 } }] };
    const warnings = [];
    const result = updateWorldMap({ here }, { threatsToUpdate: [{ targetLocationId: 'here', threatUpdate: { threatId: 'wolf', intensity: 2, currentActivity: { activityId: 'old', activityName: 'Raid', timeSpentMinutes: 80 } } }] }, here, 2, warning => warnings.push(warning));
    assert.deepEqual(result.here.activeThreats[0].currentActivity, here.activeThreats[0].currentActivity);
    assert.equal(result.here.activeThreats[0].intensity, 2);
    assert.deepEqual(warnings, [{ kind: 'threat-update', subject: 'wolf' }]);
    const accepted = updateWorldMap(result, { threatsToUpdate: [{ targetLocationId: 'here', threatUpdate: { threatId: 'wolf', currentActivity: { activityId: 'new', activityName: 'Raid', timeSpentMinutes: 15 } } }] }, result.here, 3);
    assert.equal(accepted.here.activeThreats[0].currentActivity.timeSpentMinutes, 15);
  } finally { await server.close(); }
});

test('entering a newly declared location preserves full declaration and current overrides', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const here = { ...context.currentLocation, locationId: 'here', coordinates: { x: 0, y: 0 } };
    context.currentLocation = here; context.worldMap = { here }; context.currentTurnNumber = 2;
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: here, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const location = { ...here, locationId: 'cave', initialId: 'cave-tag', name: 'Cave', description: 'A deep cave', coordinates: { x: 4, y: 0 }, locationStorages: [{ name: 'Chest', inventory: [] }], activeThreats: [{ name: 'Bats' }] };
    const response = { currentLocationData: { locationId: 'cave', initialId: 'cave-tag', description: 'A dark cave' }, worldMapUpdates: { newLocations: [location] } };
    const { newState, processedResponse } = processAndApplyResponse(response, base, context.gameSettings, k => k, true, 2, context.worldMap);
    const next = buildNextContext(context, processedResponse, newState, [], true);
    const cave = next.worldMap.cave;
    assert.equal(cave.name, 'Cave'); assert.equal(cave.description, 'A dark cave');
    assert.deepEqual(cave.coordinates, { x: 4, y: 0 });
    assert.ok(cave.locationStorages[0].storageId); assert.ok(cave.activeThreats[0].threatId);
    assert.deepEqual(next.currentLocation, cave);
    assert.equal(context.worldMap.cave, undefined);
    const loaded = JSON.parse(JSON.stringify(next));
    assert.deepEqual(loaded.worldMap.cave, cave);
  } finally { await server.close(); }
});

test('stale identified activity cannot restart an idle threat', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { updateWorldMap } = await server.ssrLoadModule('/utils/gameContext.ts');
    const home = { locationId: 'home', coordinates: { x: 0, y: 0 }, activeThreats: [{ threatId: 'wolf', name: 'Wolves', currentActivity: null, completedActivities: [{ activityId: 'old', activityName: 'Raid', completionTurn: 1 }] }] };
    const warnings = [];
    const stale = updateWorldMap({ home }, { threatsToUpdate: [{ targetLocationId: 'home', threatUpdate: { threatId: 'wolf', currentActivity: { activityId: 'old', activityName: 'Raid', timeSpentMinutes: 80 } } }] }, home, 2, w => warnings.push(w));
    assert.equal(stale.home.activeThreats[0].currentActivity, null);
    assert.deepEqual(warnings, [{ kind: 'threat-update', subject: 'wolf' }]);
    const fresh = updateWorldMap(stale, { threatsToUpdate: [{ targetLocationId: 'home', threatUpdate: { threatId: 'wolf', currentActivity: { activityName: 'Hunt', timeSpentMinutes: 0 } } }] }, stale.home, 3);
    assert.equal(fresh.home.activeThreats[0].currentActivity.activityName, 'Hunt');
    assert.ok(fresh.home.activeThreats[0].currentActivity.activityId);
  } finally { await server.close(); }
});

test('embedded location threat activity changes use identity and completion checks', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { updateWorldMap } = await server.ssrLoadModule('/utils/gameContext.ts');
    const home = { locationId: 'home', coordinates: { x: 0, y: 0 }, activeThreats: [{ threatId: 'wolf', name: 'Wolves', intensity: 1, currentActivity: { activityId: 'new', activityName: 'Raid', timeSpentMinutes: 5 }, completedActivities: [] }] };
    const warnings = [];
    const stale = updateWorldMap({ home }, { locationUpdates: [{ locationId: 'home', activeThreats: [{ threatId: 'wolf', intensity: 2, currentActivity: { activityId: 'old', activityName: 'Raid', timeSpentMinutes: 80 } }] }] }, home, 2, w => warnings.push(w));
    assert.deepEqual(stale.home.activeThreats[0].currentActivity, home.activeThreats[0].currentActivity);
    assert.equal(stale.home.activeThreats[0].intensity, 2);
    assert.deepEqual(warnings, [{ kind: 'threat-update', subject: 'wolf' }]);
    const done = updateWorldMap(stale, { locationUpdates: [{ locationId: 'home', activeThreats: [{ threatId: 'wolf', currentActivity: { activityName: 'Hunt', timeSpentMinutes: 0 } }] }], completeThreatActivities: [{ targetLocationId: 'home', threatId: 'wolf', activityId: 'new', finalState: 'Completed' }] }, stale.home, 3);
    assert.equal(done.home.activeThreats[0].completedActivities[0].activityId, 'new');
    assert.equal(done.home.activeThreats[0].currentActivity.activityName, 'Hunt');
  } finally { await server.close(); }
});

test('null legacy links do not interrupt remote link operations', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { updateWorldMap } = await server.ssrLoadModule('/utils/gameContext.ts');
    const home = { locationId: 'home', coordinates: { x: 0, y: 0 } };
    const remote = { locationId: 'remote', coordinates: { x: 1, y: 0 }, adjacencyMap: [null] };
    const target = { locationId: 'target', coordinates: { x: 3, y: 0 } };
    const map = { home, remote, target };
    const added = updateWorldMap(map, { newLinks: [{ sourceLocationId: 'remote', link: { targetLocationId: 'target', name: 'Path' } }] }, home, 2);
    assert.equal(added.remote.adjacencyMap[1].targetLocationId, 'target');
    const updated = updateWorldMap(added, { linkUpdates: [{ sourceLocationId: 'remote', targetLocationId: 'target', updatedLink: { name: 'Road' } }] }, home, 3);
    assert.equal(updated.remote.adjacencyMap[1].name, 'Road');
    const removed = updateWorldMap(updated, { linksToRemove: [{ sourceLocationId: 'remote', targetCoordinates: { x: 3, y: 0 } }] }, home, 4);
    assert.deepEqual(removed.remote.adjacencyMap, [null]);
  } finally { await server.close(); }
});

test('current location threat updates cannot bypass activity identity checks', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const here = { ...context.currentLocation, locationId: 'here', coordinates: { x: 0, y: 0 }, activeThreats: [{ threatId: 'wolf', name: 'Wolves', currentActivity: { activityId: 'new', activityName: 'Raid', timeSpentMinutes: 5 }, completedActivities: [] }] };
    context.currentLocation = here; context.worldMap = { here }; context.currentTurnNumber = 2;
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: here, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const response = { currentLocationData: { locationId: 'here', activeThreats: [{ threatId: 'wolf', currentActivity: { activityId: 'old', activityName: 'Raid', timeSpentMinutes: 80 } }] } };
    const { newState, processedResponse } = processAndApplyResponse(response, base, context.gameSettings, k => k, true, 2, context.worldMap);
    const warnings = [];
    const next = buildNextContext(context, processedResponse, newState, [], true, w => warnings.push(w));
    assert.deepEqual(next.currentLocation.activeThreats[0].currentActivity, here.activeThreats[0].currentActivity);
    assert.deepEqual(warnings, [{ kind: 'threat-update', subject: 'wolf' }]);
  } finally { await server.close(); }
});

test('embedded threat updates reject conflicting IDs and ambiguous names', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { updateWorldMap, createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const wolves = id => ({ threatId: id, name: 'Wolf', intensity: 1, currentActivity: { activityId: `activity-${id}`, activityName: 'Raid', timeSpentMinutes: 5 } });
    const here = { ...context.currentLocation, locationId: 'here', coordinates: { x: 0, y: 0 }, activeThreats: [wolves('one'), wolves('two')] };
    context.currentLocation = here; context.worldMap = { here }; context.currentTurnNumber = 2;
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: here, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const changes = [{ threatId: 'stale', name: 'Wolf', currentActivity: { activityId: 'old', activityName: 'Raid', timeSpentMinutes: 80 } }, { name: 'Wolf', intensity: 99, currentActivity: { activityId: 'old', activityName: 'Raid', timeSpentMinutes: 80 } }];
    for (const threat of changes) {
      let warnings = [];
      const remote = updateWorldMap({ here }, { locationUpdates: [{ locationId: 'here', activeThreats: [threat], newDescription: 'changed' }] }, here, 2, w => warnings.push(w));
      assert.deepEqual(remote.here.activeThreats, here.activeThreats);
      assert.equal(remote.here.description, 'changed');
      assert.equal(warnings[0]?.kind, 'threat-identity');
      const { newState, processedResponse } = processAndApplyResponse({ currentLocationData: { locationId: 'here', activeThreats: [threat] } }, base, context.gameSettings, k => k, true, 2, context.worldMap);
      warnings = [];
      const next = buildNextContext(context, processedResponse, newState, [], true, w => warnings.push(w));
      assert.deepEqual(next.currentLocation.activeThreats, here.activeThreats);
      assert.equal(warnings[0]?.kind, 'threat-identity');
    }
    const warnings = [];
    const valid = updateWorldMap({ here }, { locationUpdates: [{ locationId: 'here', activeThreats: [{ threatId: 'one', name: 'Wolf', intensity: 4, currentActivity: { activityId: 'activity-one', activityName: 'Raid', timeSpentMinutes: 15 } }] }] }, here, 2, w => warnings.push(w));
    assert.equal(valid.here.activeThreats[0].intensity, 4);
    assert.equal(valid.here.activeThreats[0].currentActivity.timeSpentMinutes, 15);
    assert.equal(valid.here.activeThreats[1].currentActivity.timeSpentMinutes, 5);
    assert.deepEqual(warnings, []);
  } finally { await server.close(); }
});

test('stage merge preserves distinct same-name locations and their NPC references', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse, mergeStageResponses } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const home = { ...context.currentLocation, locationId: 'home', coordinates: { x: 0, y: 0 } };
    context.currentLocation = home; context.worldMap = { home }; context.currentTurnNumber = 2;
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: home, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const first = { initialId: 'cave-a', name: 'Cave', coordinates: { x: 1, y: 0 } };
    const second = { initialId: 'cave-b', name: 'Cave', coordinates: { x: 2, y: 0 } };
    const previous = { worldMapUpdates: { newLocations: [first] }, NPCsData: [{ ...player, NPCId: 'guard', name: 'Guard', initialLocationId: 'cave-a', inventory: [] }] };
    const merged = mergeStageResponses(previous, { worldMapUpdates: { newLocations: [second] } }, {});
    assert.equal(merged.worldMapUpdates.newLocations.length, 2);
    const { newState, processedResponse } = processAndApplyResponse(merged, base, context.gameSettings, k => k, true, 2, context.worldMap);
    const next = buildNextContext(context, processedResponse, newState, [], true);
    const locations = Object.values(next.worldMap).filter(loc => loc.name === 'Cave');
    assert.equal(locations.length, 2);
    assert.equal(newState.encounteredNPCs[0].currentLocationId, locations.find(loc => loc.coordinates.x === 1).locationId);
    assert.notEqual(locations[0].locationId, locations[1].locationId);
    assert.equal(previous.worldMapUpdates.newLocations[0].initialId, 'cave-a');

    const same = mergeStageResponses({ worldMapUpdates: { newLocations: [first] } }, { worldMapUpdates: { newLocations: [{ initialId: 'cave-a', description: 'Deep' }] } }, {});
    assert.equal(same.worldMapUpdates.newLocations.length, 1);
    assert.equal(same.worldMapUpdates.newLocations[0].description, 'Deep');
    for (const [left, right] of [
      [{ ...first, locationId: 'id-a' }, { ...first, locationId: 'id-b' }],
      [{ ...first, locationId: 'id-a' }, { ...first, initialId: 'other', locationId: 'id-a' }],
    ]) {
      const conflict = mergeStageResponses({ worldMapUpdates: { newLocations: [left] } }, { worldMapUpdates: { newLocations: [right] } }, {});
      assert.equal(conflict.worldMapUpdates.newLocations.length, 2);
      assert.throws(() => processAndApplyResponse(conflict, base, context.gameSettings, k => k, true, 2, context.worldMap), /location.*(id|temporary)/i);
    }
  } finally { await server.close(); }
});

test('name-only updates of off-screen threats are resolved before assigning new IDs', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const home = { ...context.currentLocation, locationId: 'home', coordinates: { x: 0, y: 0 } };
    const remote = { ...home, locationId: 'remote', coordinates: { x: 2, y: 0 }, activeThreats: [{ threatId: 'wolf', name: 'Wolf', currentActivity: { activityId: 'raid', activityName: 'Raid', timeSpentMinutes: 5 } }] };
    context.currentLocation = home; context.worldMap = { home, remote }; context.currentTurnNumber = 2;
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: home, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const response = { worldMapUpdates: { locationUpdates: [{ locationId: 'remote', activeThreats: [{ name: 'Wolf', currentActivity: { activityName: 'Raid', timeSpentMinutes: 20 } }, { name: 'Bear', currentActivity: { activityName: 'Hunt', timeSpentMinutes: 1 } }] }] } };
    const { newState, processedResponse } = processAndApplyResponse(response, base, context.gameSettings, k => k, true, 2, context.worldMap);
    const warnings = [];
    const next = buildNextContext(context, processedResponse, newState, [], true, w => warnings.push(w));
    assert.equal(next.worldMap.remote.activeThreats[0].threatId, 'wolf');
    assert.equal(next.worldMap.remote.activeThreats[0].currentActivity.timeSpentMinutes, 20);
    assert.ok(next.worldMap.remote.activeThreats[1].threatId);
    assert.notEqual(next.worldMap.remote.activeThreats[1].threatId, 'wolf');
    assert.deepEqual(warnings, []);
  } finally { await server.close(); }
});

test('same-name threats in one location remain distinct through updates and save/load', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext, updateWorldMap } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse, mergeStageResponses } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const home = { ...context.currentLocation, locationId: 'home', coordinates: { x: 0, y: 0 } };
    const remote = { ...home, locationId: 'remote', coordinates: { x: 2, y: 0 }, activeThreats: [] };
    context.currentLocation = home; context.worldMap = { home, remote }; context.currentTurnNumber = 2;
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: home, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    for (const withIds of [true, false]) {
      const first = { ...(withIds ? { threatId: 'one' } : {}), name: 'Wolf', intensity: 1, currentActivity: { activityName: 'Hunt', timeSpentMinutes: 5 } };
      const second = { ...(withIds ? { threatId: 'two' } : {}), name: 'Wolf', intensity: 5, currentActivity: { activityName: 'Raid', timeSpentMinutes: 10 } };
      const response = { worldMapUpdates: { locationUpdates: [{ locationId: 'remote', activeThreats: [first, second] }] } };
      const { newState, processedResponse } = processAndApplyResponse(response, base, context.gameSettings, k => k, true, 2, context.worldMap);
      const warnings = [];
      const next = buildNextContext(context, processedResponse, newState, [], true, w => warnings.push(w));
      const threats = next.worldMap.remote.activeThreats;
      assert.equal(threats.length, 2);
      assert.deepEqual(threats.map(t => t.intensity), [1, 5]);
      assert.ok(threats[0].threatId && threats[1].threatId);
      assert.notEqual(threats[0].threatId, threats[1].threatId);
      assert.notEqual(threats[0].currentActivity.activityId, threats[1].currentActivity.activityId);
      assert.deepEqual(warnings, []);
      const loadedMap = JSON.parse(JSON.stringify(next.worldMap));
      const updated = updateWorldMap(loadedMap, { threatsToUpdate: [{ targetLocationId: 'remote', threatUpdate: { threatId: threats[1].threatId, intensity: 7 } }] }, home, 3);
      assert.deepEqual(updated.remote.activeThreats.map(t => t.intensity), [1, 7]);
    }
    const left = { currentLocationData: { activeThreats: [{ threatId: 'one', name: 'Wolf', intensity: 1 }] } };
    const right = { currentLocationData: { activeThreats: [{ threatId: 'two', name: 'Wolf', intensity: 5 }] } };
    const combined = mergeStageResponses(left, right, {});
    assert.deepEqual(combined.currentLocationData.activeThreats.map(t => t.threatId), ['one', 'two']);
    const legacy = updateWorldMap({ home, remote: { ...remote, activeThreats: [{ threatId: 'old', name: 'Bear', intensity: 1 }] } }, { locationUpdates: [{ locationId: 'remote', activeThreats: [{ name: 'Bear', intensity: 4 }] }] }, home, 2);
    assert.deepEqual(legacy.remote.activeThreats.map(t => [t.threatId, t.intensity]), [['old', 4]]);
  } finally { await server.close(); }
});

test('temporary references reject tags of the wrong entity type before changing state', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const home = { ...context.currentLocation, locationId: 'home', coordinates: { x: 0, y: 0 } };
    const guard = { ...player, NPCId: 'guard', name: 'Guard', currentLocationId: 'home', inventory: [] };
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: home, activeQuests: [], completedQuests: [], encounteredNPCs: [guard], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const declared = {
      factionDataChanges: [{ factionId: 'faction-id', initialId: 'faction-tag', name: 'Guild' }],
      NPCsData: [{ ...player, NPCId: 'npc-id', initialId: 'npc-tag', name: 'Scout', inventory: [] }],
      worldMapUpdates: { newLocations: [{ ...home, locationId: 'loc-id', initialId: 'loc-tag', name: 'Outpost', coordinates: { x: 1, y: 0 } }] },
      questUpdates: [{ questId: 'quest-id', initialId: 'quest-tag', questName: 'Quest' }],
    };
    const before = JSON.stringify(base);
    const badFields = [
      ['initialLocationId', 'faction-tag'],
      ['initialTargetLocationId', 'npc-tag'],
      ['initialFactionId', 'loc-tag'],
      ['initialTargetFactionId', 'quest-tag'],
      ['initialTargetNpcId', 'faction-tag'],
      ['newBreakthroughQuestId', 'loc-tag'],
    ];
    for (const [field, tag] of badFields) {
      const response = { ...declared, testReferences: [{ nested: { [field]: tag } }] };
      assert.throws(() => processAndApplyResponse(response, base, context.gameSettings, k => k, true, 2, { home }), new RegExp(`Temporary reference.*${field}.*expects`));
      assert.equal(JSON.stringify(base), before);
    }
    const wrongNpc = { factionDataChanges: declared.factionDataChanges, NPCsData: [{ NPCId: 'guard', initialLocationId: 'faction-tag' }] };
    assert.throws(() => processAndApplyResponse(wrongNpc, base, context.gameSettings, k => k, true, 2, { home }), /initialLocationId.*expects loc/);
    assert.equal(base.encounteredNPCs[0].currentLocationId, 'home');
    const valid = { ...declared, NPCsData: [...declared.NPCsData, { NPCId: 'guard', initialLocationId: 'loc-tag' }], testReferences: [
      { initialLocationId: 'loc-tag' }, { initialTargetLocationId: 'loc-tag' }, { initialFactionId: 'faction-tag' },
      { initialTargetFactionId: 'faction-tag' }, { initialTargetNpcId: 'npc-tag' }, { newBreakthroughQuestId: 'quest-tag' },
      { newBreakthroughQuestId: '_clear_' }, { newBreakthroughQuestId: 'existing-quest-id' }, { initialLocationId: 'unknown-tag' },
    ] };
    const { newState, processedResponse } = processAndApplyResponse(valid, base, context.gameSettings, k => k, true, 2, { home });
    assert.equal(newState.encounteredNPCs.find(n => n.NPCId === 'guard').currentLocationId, 'loc-id');
    const refs = processedResponse.testReferences;
    assert.equal(refs[0].currentLocationId, 'loc-id'); assert.equal(refs[1].targetLocationId, 'loc-id');
    assert.equal(refs[2].factionId, 'faction-id'); assert.equal(refs[3].targetFactionId, 'faction-id');
    assert.equal(refs[4].targetNpcId, 'npc-id'); assert.equal(refs[5].newBreakthroughQuestId, 'quest-id');
    assert.equal(refs[6].newBreakthroughQuestId, '_clear_'); assert.equal(refs[7].newBreakthroughQuestId, 'existing-quest-id');
    assert.equal(refs[8].currentLocationId, undefined);
  } finally { await server.close(); }
});

test('turn-local tags cannot redirect resolved NPC relationships or old factions', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const home = { ...context.currentLocation, locationId: 'home', coordinates: { x: 0, y: 0 } };
    const guard = { ...player, NPCId: 'guard', name: 'Guard', inventory: [], currentLocationId: 'home', npcRelationships: [] };
    const oldFaction = { factionId: 'old-faction', name: 'Guild', initialId: 'temp-guild', resources: { metaResources: [{ resourceName: 'Gold', currentStockpile: 10 }], strategicGoods: [] } };
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: home, activeQuests: [], completedQuests: [], encounteredNPCs: [guard], encounteredFactions: [oldFaction], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const first = { NPCsData: [{ NPCId: 'guard', npcRelationships: [{ targetNpcId: null, initialTargetNpcId: 'temp-friend', targetNpcName: 'Friend' }] }, { ...player, NPCId: 'friend', initialId: 'temp-friend', name: 'Friend', inventory: [] }] };
    const firstState = processAndApplyResponse(first, base, context.gameSettings, k => k, true, 2, { home }).newState;
    const relation = firstState.encounteredNPCs.find(n => n.NPCId === 'guard').npcRelationships[0];
    assert.equal(relation.targetNpcId, 'friend');
    assert.equal(relation.initialTargetNpcId, 'temp-friend');
    const later = { NPCsData: [{ NPCId: 'guard', npcRelationships: [relation] }, { ...player, NPCId: 'stranger', initialId: 'temp-friend', name: 'Stranger', inventory: [] }] };
    const secondState = processAndApplyResponse(later, firstState, context.gameSettings, k => k, true, 3, { home }).newState;
    assert.equal(secondState.encounteredNPCs.find(n => n.NPCId === 'guard').npcRelationships[0].targetNpcId, 'friend');
    assert.ok(secondState.encounteredNPCs.find(n => n.NPCId === 'stranger'));
    assert.equal(relation.targetNpcId, 'friend');

    const stale = processAndApplyResponse({ factionResourceChanges: [{ initialFactionId: 'temp-guild', resourceChanges: [{ resourceName: 'Gold', changeAmount: 5 }] }] }, base, context.gameSettings, k => k, true, 3, { home }).newState;
    assert.equal(stale.encounteredFactions[0].resources.metaResources[0].currentStockpile, 10);
    const explicit = processAndApplyResponse({ factionResourceChanges: [{ factionId: 'old-faction', initialFactionId: 'temp-guild', resourceChanges: [{ resourceName: 'Gold', changeAmount: 5 }] }] }, base, context.gameSettings, k => k, true, 3, { home }).newState;
    assert.equal(explicit.encounteredFactions[0].resources.metaResources[0].currentStockpile, 15);
    const fresh = { factionDataChanges: [{ factionId: 'new-faction', initialId: 'temp-guild', name: 'Guild', resources: { metaResources: [{ resourceName: 'Gold', currentStockpile: 1 }], strategicGoods: [] } }], factionResourceChanges: [{ initialFactionId: 'temp-guild', resourceChanges: [{ resourceName: 'Gold', changeAmount: 5 }] }] };
    const freshState = processAndApplyResponse(fresh, base, context.gameSettings, k => k, true, 3, { home }).newState;
    assert.equal(freshState.encounteredFactions.length, 2);
    assert.equal(freshState.encounteredFactions.find(f => f.factionId === 'old-faction').resources.metaResources[0].currentStockpile, 10);
    assert.equal(freshState.encounteredFactions.find(f => f.factionId === 'new-faction').resources.metaResources[0].currentStockpile, 6);
  } finally { await server.close(); }
});

test('stale location tag does not override an explicit threat destination', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { updateWorldMap } = await server.ssrLoadModule('/utils/gameContext.ts');
    const home = { locationId: 'home', coordinates: { x: 0, y: 0 }, activeThreats: [] };
    const newLocation = { locationId: 'new', initialId: 'temp-location', coordinates: { x: 1, y: 0 }, activeThreats: [] };
    const result = updateWorldMap({ home }, { newLocations: [newLocation], threatsToAdd: [{ targetLocationId: 'home', initialTargetLocationId: 'temp-location', threat: { name: 'Wolves' } }] }, home, 2);
    assert.equal(result.home.activeThreats.length, 1);
    assert.equal(result.new.activeThreats.length, 0);
  } finally { await server.close(); }
});
