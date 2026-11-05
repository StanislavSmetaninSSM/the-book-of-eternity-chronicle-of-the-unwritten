import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import 'fake-indexeddb/auto';

// Fixture responses are deliberately scripted; this does not test GM decisions.
test('combat, cleanup, healing and world progression retain linked state across turns', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { mergeStageResponses, deepMergeResponses, processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    let context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Fight', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2;
    const player = context.playerCharacter;
    const here = { ...context.currentLocation, locationId: 'here', coordinates: { x: 0, y: 0 } };
    const outpost = { ...context.currentLocation, locationId: 'outpost', name: 'Outpost', coordinates: { x: 2, y: 0 }, description: 'Damaged' };
    const npc = { ...player, NPCId: 'guard', name: 'Guard', inventory: [], currentHealth: 100, wounds: [], activeEffects: [], goals: { shortTerm: '', longTerm: '' } };
    const faction = { factionId: 'guild', name: 'Guild', color: '#123456', resources: { metaResources: [{ resourceName: 'Wealth', currentStockpile: 10 }], strategicGoods: [] }, activeProjects: [], completedProjects: [] };
    context.currentLocation = here; context.worldMap = { here, outpost }; context.encounteredNPCs = [npc]; context.encounteredFactions = [faction];
    let state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: here, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [faction], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const step = response => { const r = processAndApplyResponse(response, state, context.gameSettings, k => k, true, context.currentTurnNumber, context.worldMap); state = r.newState; context = buildNextContext(context, r.processedResponse, state, [], true); };
    const pain = { effectId: 'pain', sourceWoundId: 'w1', effectType: 'Debuff', value: '-10%', targetType: 'strength', duration: 999, description: 'Wound pain' };
    const poison = { effectId: 'poison', effectType: 'Debuff', value: '-10%', targetType: 'strength', duration: 4, description: 'Poison' };
    const injury = { NPCId: 'guard', NPCName: 'Guard', woundId: 'w1', woundName: 'Cut', severity: 'Light', descriptionOfEffects: 'Pain', generatedEffects: [pain], healingState: { currentState: 'Untreated', nextState: 'Stabilized', treatmentProgress: 0, progressNeeded: 20, canBeImprovedBy: [] } };
    const combat = { alliesData: [{ NPCId: 'guard', name: 'Guard', isGroup: false, currentHealth: '80%', maxHealth: `${npc.maxHealth}%`, activeDebuffs: [poison], actions: [] }], NPCWoundChanges: [injury], currentHealthChange: -5 };
    const end = mergeStageResponses(combat, { enemiesData: [], alliesData: [] }, context);
    step(end);
    assert.equal(state.encounteredNPCs[0].currentHealth, 80);
    assert.equal(state.playerCharacter.currentHealth, player.currentHealth - 5);
    assert.equal(context.encounteredNPCs[0].wounds[0].woundId, 'w1');
    assert.deepEqual(context.alliesDataForCurrentTurn, []);
    assert.equal(state.encounteredNPCs[0].activeEffects[0].effectId, 'poison');
    const heal = { NPCWoundChanges: [{ NPCId: 'guard', NPCName: 'Guard', woundId: 'w1', healingState: { currentState: 'Healed', nextState: null } }] };
    const world = { worldEventsLog: [{ eventId: 'event-1', headline: 'Outpost repaired', summary: 'The guild repaired the outpost.' }], worldMapUpdates: { locationUpdates: [{ locationId: 'outpost', newDescription: 'Repaired' }] }, factionResourceChanges: [{ factionId: 'guild', resourceChanges: [{ resourceName: 'Wealth', changeAmount: -2 }] }], NPCGoalUpdates: [{ NPCId: 'guard', NPCName: 'Guard', newShortTermGoal: 'Protect the outpost' }], updateWorldProgressionTracker: { newLastWorldProgressionTimeInMinutes: 1234 } };
    step(deepMergeResponses(heal, world));
    assert.equal(state.encounteredNPCs[0].wounds[0].healingState.currentState, 'Healed');
    assert.equal(state.encounteredNPCs[0].wounds[0].healingState.nextState, null);
    assert.deepEqual(state.encounteredNPCs[0].wounds[0].generatedEffects, [pain]);
    assert.equal(state.encounteredNPCs[0].activeEffects[0].effectId, 'poison');
    assert.equal(state.encounteredNPCs[0].activeEffects[0].duration, 3);
    assert.equal(state.encounteredNPCs[0].goals.shortTerm, 'Protect the outpost');
    assert.equal(state.encounteredFactions[0].resources.metaResources[0].currentStockpile, 8);
    assert.equal(context.worldMap.outpost.description, 'Repaired');
    assert.equal(context.worldEventsLog[0].eventId, 'event-1');
    assert.equal(context.worldState.lastWorldProgressionTimeInMinutes, 1234);
    const { saveToDB, loadFromDB, saveToDBSlot, loadFromDBSlot } = await server.ssrLoadModule('/utils/fileManager.ts');
    const save = { gameContext: context, gameState: state, gameHistory: [], gameLog: [], combatLog: [], timestamp: '2026-10-31T00:00:00.000Z' };
    await saveToDB(save);
    await saveToDBSlot(1, save);
    const loaded = await loadFromDB();
    const slot = await loadFromDBSlot(1);
    assert.deepEqual(loaded, slot);
    assert.equal(loaded.gameState.encounteredNPCs[0].wounds[0].healingState.currentState, 'Healed');
    assert.equal(loaded.gameContext.worldMap.outpost.description, 'Repaired');
    state = loaded.gameState; context = loaded.gameContext;
    step({});
    assert.equal(state.encounteredNPCs[0].wounds[0].healingState.currentState, 'Healed');
    assert.equal(state.encounteredFactions[0].resources.metaResources[0].currentStockpile, 8);
    assert.equal(context.worldMap.outpost.description, 'Repaired');
    assert.equal(context.worldEventsLog.length, 1);
  } finally { await server.close(); }
});

test('legacy save round-trips missing wound state and effect ID without migration or reapplication', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { restorePlayerStats } = await server.ssrLoadModule('/utils/restorePlayer.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const { saveToDBSlot, loadFromDBSlot } = await server.ssrLoadModule('/utils/fileManager.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Wait', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2;
    const p = { ...context.playerCharacter, playerWounds: [{ woundId: 'legacy', woundName: 'Old cut', severity: 'Light', descriptionOfEffects: 'Pain' }], activePlayerEffects: [{ effectType: 'Debuff', value: '-10%', targetType: 'strength', duration: 999, description: 'Old curse' }] };
    context.playerCharacter = p; context.players = [p];
    const state = { playerCharacter: p, players: [p], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    await saveToDBSlot(2, { gameContext: context, gameState: state, gameHistory: [], gameLog: [], combatLog: [], timestamp: '2026-10-31T00:00:00.000Z' });
    const loaded = await loadFromDBSlot(2);
    restorePlayerStats(loaded.gameState, k => k, false);
    const applied = processAndApplyResponse({}, loaded.gameState, context.gameSettings, k => k, true, 2, context.worldMap);
    const next = buildNextContext(loaded.gameContext, applied.processedResponse, applied.newState, [], true);
    assert.equal(next.playerCharacter.playerWounds[0].woundName, 'Old cut');
    assert.equal(next.playerCharacter.playerWounds[0].healingState, undefined);
    assert.equal(next.playerCharacter.activePlayerEffects.length, 1);
    assert.equal(next.playerCharacter.activePlayerEffects[0].effectId, undefined);
  } finally { await server.close(); }
});
