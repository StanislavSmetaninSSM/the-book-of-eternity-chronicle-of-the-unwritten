import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';

const fullItem = (fields = {}) => ({ name: 'Item', description: 'A useful item.', image_prompt: 'A useful item', quality: 'Common', type: 'Misc', price: 1, count: 1, weight: 1, volume: 1, bonuses: [], contentsPath: null, isContainer: false, capacity: null, isConsumption: false, durability: '100%', equipmentSlot: null, ...fields });

test('item journal updates survive player state synchronization', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const item = { existedId: 'sword', name: 'Sword', count: 1, weight: 1, contentsPath: null, journalEntries: ['old'] };
    const player = { ...context.playerCharacter, inventory: [item] };
    const other = { ...context.playerCharacter, playerId: 'other', inventory: [{ ...item, existedId: 'other-sword' }] };
    const base = { playerCharacter: player, players: [structuredClone(player), other], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const response = { itemJournalUpdates: [{ itemId: 'sword', itemName: 'Sword', entryToAppend: 'new' }, { itemId: 'other-sword', itemName: 'Sword', entryToAppend: 'other-new' }] };
    const { newState } = processAndApplyResponse(response, base, context.gameSettings, key => key, true, 1, context.worldMap);
    assert.deepEqual(newState.playerCharacter.inventory[0].journalEntries, ['new', 'old']);
    assert.deepEqual(newState.players[0].inventory[0].journalEntries, ['new', 'old']);
    assert.deepEqual(newState.players[1].inventory[0].journalEntries, ['other-new', 'old']);
    const created = fullItem({ existedId: 'fresh', name: 'Fresh relic' });
    const newItemState = processAndApplyResponse({ inventoryItemsData: [created], itemJournalUpdates: [{ itemId: 'fresh', itemName: 'Fresh relic', entryToAppend: 'first thought' }] }, base, context.gameSettings, key => key, true, 1, context.worldMap).newState;
    assert.deepEqual(newItemState.playerCharacter.inventory.find(i => i.existedId === 'fresh').journalEntries, ['first thought']);

  } finally { await server.close(); }
});

test('different wounds with the same name do not merge in nested NPC data', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { deepMergeResponses } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const oldWound = { woundId: 'w1', woundName: 'Cut', descriptionOfEffects: 'left arm' };
    const fresh = { woundId: 'w2', woundName: 'Cut', descriptionOfEffects: 'right arm' };
    const merged = deepMergeResponses({ wounds: [oldWound] }, { wounds: [fresh] });
    assert.deepEqual(merged.wounds, [oldWound, fresh]);
  } finally { await server.close(); }
});

test('separate item journal commands survive staged merging', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { deepMergeResponses } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const a = { itemId: 'sword', itemName: 'Sword', entryToAppend: 'first' };
    const b = { itemId: 'sword', itemName: 'Sword', entryToAppend: 'second' };
    assert.deepEqual(deepMergeResponses({ itemJournalUpdates: [a] }, { itemJournalUpdates: [b] }).itemJournalUpdates, [a, b]);
  } finally { await server.close(); }
});

test('interrupted NPC activity is archived before its replacement is initialized', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const npc = { ...player, NPCId: 'miles', name: 'Miles', inventory: [], currentActivity: { activityName: 'Investigation', description: 'Find clues', totalTimeCostMinutes: 500, timeSpentMinutes: 240 }, completedActivities: [] };
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const response = { completeNPCActivities: [{ NPCId: 'miles', activityName: 'Investigation', finalState: 'Abandoned', narrativeSummary: 'Interrupted by a riot.' }], NPCsData: [{ NPCId: 'miles', name: 'Miles', currentActivity: { activityName: 'Restoring order', description: 'Coordinate guards', timeSpentMinutes: 0 } }] };
    const { newState, processedResponse } = processAndApplyResponse(response, base, context.gameSettings, key => key, true, 4, context.worldMap);
    const saved = newState.encounteredNPCs[0];
    assert.deepEqual(saved.currentActivity, { activityName: 'Restoring order', description: 'Coordinate guards', timeSpentMinutes: 0 });
    assert.deepEqual(saved.completedActivities, [{ activityName: 'Investigation', completionTurn: 4, finalOutcome: 'Failure', narrativeSummary: 'Interrupted by a riot.' }]);
    assert.deepEqual(buildNextContext(context, processedResponse, newState, [], true).encounteredNPCs[0].completedActivities, saved.completedActivities);
    assert.equal(base.encounteredNPCs[0].currentActivity.activityName, 'Investigation');
    const completionOnly = processAndApplyResponse({ completeNPCActivities: response.completeNPCActivities }, base, context.gameSettings, key => key, true, 4, context.worldMap).newState.encounteredNPCs[0];
    assert.equal(completionOnly.currentActivity, null);
    assert.equal(completionOnly.completedActivities.length, 1);
  } finally { await server.close(); }
});

test('faction project commands honor project IDs when projects share a name', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const project = (id, time) => ({ projectId: id, projectName: 'Repair road', description: '', totalTimeCostMinutes: 100, timeSpentMinutes: time, currentStep: 1, totalSteps: 2, activeState: 'Active' });
    const faction = { factionId: 'guild', name: 'Guild', color: '#123456', activeProjects: [project('east', 10), project('west', 20)], completedProjects: [{ projectId: 'old', projectName: 'Repair road', completionTurn: 1, finalState: 'Completed' }] };
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [faction], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const apply = response => processAndApplyResponse(response, base, context.gameSettings, key => key, true, 4, context.worldMap);
    const updated = apply({ factionProjectUpdates: [{ factionId: 'guild', projectUpdate: { projectId: 'west', projectName: 'Repair road', timeSpentMinutes: 35 } }] }).newState.encounteredFactions[0];
    assert.deepEqual(updated.activeProjects.map(p => [p.projectId, p.timeSpentMinutes]), [['east', 10], ['west', 35]]);
    const ambiguous = apply({ factionProjectUpdates: [{ factionId: 'guild', projectUpdate: { projectName: 'Repair road', timeSpentMinutes: 40 } }] }).newState.encounteredFactions[0];
    assert.deepEqual(ambiguous.activeProjects.map(p => [p.projectId, p.timeSpentMinutes]), [['east', 10], ['west', 20]]);
    const ambiguousCompletion = apply({ completeFactionProjects: [{ factionId: 'guild', projectName: 'Repair road', finalState: 'Completed' }] }).newState.encounteredFactions[0];
    assert.equal(ambiguousCompletion.activeProjects.length, 2);
    assert.deepEqual(ambiguousCompletion.completedProjects.map(p => p.projectId), ['old']);
    const wrongFaction = apply({ completeFactionProjects: [{ factionId: 'unknown', projectId: 'west', projectName: 'Repair road', finalState: 'Completed' }] }).newState.encounteredFactions[0];
    assert.deepEqual(wrongFaction.activeProjects.map(p => p.projectId), ['east', 'west']);
    assert.deepEqual(wrongFaction.completedProjects.map(p => p.projectId), ['old']);
    const wrongProject = apply({ completeFactionProjects: [{ factionId: 'guild', projectId: 'unknown', projectName: 'Repair road', finalState: 'Completed' }] }).newState.encounteredFactions[0];
    assert.deepEqual(wrongProject.activeProjects.map(p => p.projectId), ['east', 'west']);
    assert.deepEqual(wrongProject.completedProjects.map(p => p.projectId), ['old']);
    const result = apply({ completeFactionProjects: [{ factionId: 'guild', projectId: 'west', projectName: 'Repair road', finalState: 'Completed' }] });
    const saved = result.newState.encounteredFactions[0];
    assert.deepEqual(saved.activeProjects.map(p => p.projectId), ['east']);
    assert.deepEqual(saved.completedProjects.map(p => p.projectId), ['west', 'old']);
    assert.deepEqual(buildNextContext(context, result.processedResponse, result.newState, [], true).encounteredFactions[0].completedProjects, saved.completedProjects);
    assert.equal(base.encounteredFactions[0].activeProjects.length, 2);
    const single = structuredClone(base);
    single.encounteredFactions[0].activeProjects = [project('east', 10)];
    const byName = processAndApplyResponse({ factionProjectUpdates: [{ factionId: 'guild', projectUpdate: { projectName: 'Repair road', timeSpentMinutes: 45 } }] }, single, context.gameSettings, key => key, true, 4, context.worldMap).newState.encounteredFactions[0];
    assert.equal(byName.activeProjects[0].timeSpentMinutes, 45);
  } finally { await server.close(); }
});

test('staged empty combatant arrays end combat while null and unrelated empty arrays remain no-ops', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { deepMergeResponses, processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Fight', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const enemy = { NPCId: null, name: 'Bandit', currentHealth: '50%', maxHealth: '100%', actions: [] };
    const ally = { NPCId: null, name: 'Guard', currentHealth: '80%', maxHealth: '100%', actions: [] };
    const prior = { enemiesData: [enemy], alliesData: [ally], worldEventsLog: [{ eventId: 'event', headline: 'Battle' }] };
    const untouched = deepMergeResponses(prior, { enemiesData: null, alliesData: null, worldEventsLog: [] });
    assert.deepEqual(untouched, prior);
    const merged = deepMergeResponses(prior, { enemiesData: [], alliesData: [], NPCsData: [{ NPCId: 'npc-1', name: 'Bandit leader', currentHealth: 50 }] });
    assert.deepEqual(merged.enemiesData, []);
    assert.deepEqual(merged.alliesData, []);
    assert.deepEqual(merged.worldEventsLog, prior.worldEventsLog);
    const npc = { ...player, NPCId: 'npc-1', name: 'Bandit leader', currentHealth: 100, inventory: [] };
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [enemy], alliesData: [ally], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const { newState, processedResponse } = processAndApplyResponse(merged, base, context.gameSettings, key => key, true, 2, context.worldMap);
    assert.deepEqual(newState.enemiesData, []);
    assert.deepEqual(newState.alliesData, []);
    assert.equal(newState.encounteredNPCs[0].currentHealth, 50);
    const next = buildNextContext(context, processedResponse, newState, [], true);
    assert.deepEqual(next.enemiesDataForCurrentTurn, []);
    assert.deepEqual(next.alliesDataForCurrentTurn, []);
    assert.deepEqual(prior.enemiesData, [enemy]);
  } finally { await server.close(); }
});

test('stage combat cleanup retains safe named NPC health without overriding explicit NPC updates', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { mergeStageResponses, processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Fight', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const npc = { ...player, NPCId: 'npc-1', name: 'Leader', currentHealth: 100, inventory: [] };
    context.encounteredNPCs = [npc];
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const combatant = { NPCId: 'npc-1', name: 'Leader', isGroup: false, currentHealth: '80%', maxHealth: `${npc.maxHealth}%`, actions: [] };
    const previous = { enemiesData: [combatant], alliesData: [] };
    const merged = mergeStageResponses(previous, { enemiesData: [], alliesData: [] }, context);
    assert.deepEqual(merged.enemiesData, []);
    assert.equal(processAndApplyResponse(merged, base, context.gameSettings, key => key, true, 2, context.worldMap).newState.encounteredNPCs[0].currentHealth, 80);
    const { newState, processedResponse } = processAndApplyResponse(merged, base, context.gameSettings, key => key, true, 2, context.worldMap);
    assert.equal(newState.encounteredNPCs[0].currentHealth, 80);
    assert.equal(buildNextContext(context, processedResponse, newState, [], true).encounteredNPCs[0].currentHealth, 80);
    const explicit = mergeStageResponses(previous, { enemiesData: [], NPCsData: [{ NPCId: 'npc-1', name: 'Leader', currentHealth: 60 }] }, context);
    assert.equal(explicit.NPCsData[0].currentHealth, 60);
    const priorExplicit = mergeStageResponses({ ...previous, NPCsData: [{ NPCId: 'npc-1', name: 'Leader', currentHealth: 55 }] }, { enemiesData: [] }, context);
    assert.equal(priorExplicit.NPCsData[0].currentHealth, 55);
    const ally = mergeStageResponses({ alliesData: [combatant] }, { alliesData: [] }, context);
    assert.equal(ally.NPCsData[0].currentHealth, 80);
    const nullUpdate = mergeStageResponses(previous, { enemiesData: null }, context);
    assert.equal(nullUpdate.NPCsData, undefined);
    const invalid = mergeStageResponses({ enemiesData: [{ ...combatant, maxHealth: '200%' }] }, { enemiesData: [] }, context);
    assert.equal(invalid.NPCsData, undefined);
    const group = mergeStageResponses({ enemiesData: [{ ...combatant, isGroup: true }] }, { enemiesData: [] }, context);
    assert.equal(group.NPCsData, undefined);
    const conflict = mergeStageResponses({ enemiesData: [combatant], alliesData: [{ ...combatant, currentHealth: '70%' }] }, { enemiesData: [], alliesData: [] }, context);
    assert.equal(conflict.NPCsData, undefined);
    assert.equal(previous.enemiesData[0].currentHealth, '80%');
  } finally { await server.close(); }
});

test('NPCsData identity does not merge distinct IDs or guess an ambiguous name', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse, deepMergeResponses } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Wait', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const npc = id => ({ ...player, NPCId: id, name: 'Guard', inventory: [], currentHealth: 100 });
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc('n1'), npc('n2')], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const apply = response => processAndApplyResponse(response, base, context.gameSettings, key => key, true, 2, context.worldMap).newState.encounteredNPCs;
    const ambiguous = apply({ NPCsData: [{ name: 'Guard', currentHealth: 50 }] });
    assert.deepEqual(ambiguous.map(n => [n.NPCId, n.currentHealth]), [['n1', 100], ['n2', 100]]);
    const explicit = apply({ NPCsData: [{ NPCId: 'n2', name: 'Guard', currentHealth: 60 }] });
    assert.deepEqual(explicit.map(n => [n.NPCId, n.currentHealth]), [['n1', 100], ['n2', 60]]);
    const fresh = apply({ NPCsData: [{ ...npc('n3'), currentHealth: 70 }] });
    assert.deepEqual(fresh.map(n => [n.NPCId, n.currentHealth]), [['n1', 100], ['n2', 100], ['n3', 70]]);
    const merged = deepMergeResponses({ NPCsData: [{ NPCId: 'n1', name: 'Guard' }] }, { NPCsData: [{ NPCId: 'n2', name: 'Guard' }] });
    assert.deepEqual(merged.NPCsData.map(n => n.NPCId), ['n1', 'n2']);
  } finally { await server.close(); }
});

test('item journals require unique identity and never fall back from a stale ID', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const sword = (id, extra = {}) => ({ existedId: id, name: 'Sword', count: 1, weight: 1, contentsPath: null, journalEntries: [], ...extra });
    const player = { ...context.playerCharacter, inventory: [sword('sword-a', { initialId: 'stale-tag' }), sword('sword-b'), { ...sword('relic'), name: 'Relic' }] };
    const base = { playerCharacter: player, players: [structuredClone(player)], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const changes = { itemJournalUpdates: [
      { itemId: 'old-sword', itemName: 'Sword', entryToAppend: 'wrong id' },
      { itemId: null, itemName: 'Sword', entryToAppend: 'ambiguous name' },
      { itemId: null, initialItemId: 'stale-tag', itemName: 'Sword', entryToAppend: 'stale tag' },
      { itemId: 'sword-b', itemName: 'Sword', entryToAppend: 'correct id' },
      { itemId: null, itemName: 'Relic', entryToAppend: 'unique name' },
    ] };
    const { newState, logsToAdd } = processAndApplyResponse(changes, base, context.gameSettings, key => key, true, 2, context.worldMap);
    assert.deepEqual(newState.playerCharacter.inventory[0].journalEntries, []);
    assert.deepEqual(newState.playerCharacter.inventory[1].journalEntries, ['correct id']);
    assert.deepEqual(newState.playerCharacter.inventory[2].journalEntries, ['unique name']);
    assert.equal(logsToAdd.filter(log => log === 'warning_item_journal_identity').length, 3);
    const fresh = fullItem({ initialId: 'fresh-tag', name: 'Fresh relic' });
    const created = processAndApplyResponse({ inventoryItemsData: [fresh], itemJournalUpdates: [{ itemId: null, initialItemId: 'fresh-tag', itemName: 'Fresh relic', entryToAppend: 'first thought' }] }, base, context.gameSettings, key => key, true, 2, context.worldMap);
    assert.deepEqual(created.newState.playerCharacter.inventory.find(i => i.name === 'Fresh relic').journalEntries, ['first thought']);
    assert.ok(!created.logsToAdd.includes('warning_item_journal_identity'));
    assert.deepEqual(base.playerCharacter.inventory[0].journalEntries, []);
  } finally { await server.close(); }
});

test('inter-NPC relationship updates use IDs and reject ambiguous or stale identities', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const p = context.playerCharacter;
    const npc = (id, name, extra = {}) => ({ ...p, NPCId: id, name, inventory: [], ...extra });
    const friend = { targetNpcId: 'old', targetNpcName: 'Wolf', relationshipStatus: 'Friend', statusReason: 'Trust' };
    const guard = npc('guard', 'Guard', { npcRelationships: [friend] });
    const base = { playerCharacter: p, players: [p], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [guard, npc('old', 'Wolf'), npc('new', 'Wolf')], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const change = { sourceNpcId: 'guard', sourceNpcName: 'Guard', targetNpcId: 'new', targetNpcName: 'Wolf', newRelationshipStatus: 'Rival', newStatusReason: 'Stranger' };
    const created = processAndApplyResponse({ interNPCRelationshipChanges: [change] }, base, context.gameSettings, key => key, true, 2, context.worldMap);
    const rels = created.newState.encounteredNPCs.find(n => n.NPCId === 'guard').npcRelationships;
    assert.equal(rels.length, 2); assert.deepEqual(rels[0], friend); assert.equal(rels[1].targetNpcId, 'new');
    assert.equal(rels[1].relationshipStatus, 'Rival');
    const revised = processAndApplyResponse({ interNPCRelationshipChanges: [{ ...change, targetNpcId: 'old', newRelationshipStatus: 'Ally' }] }, created.newState, context.gameSettings, key => key, true, 3, context.worldMap).newState;
    assert.equal(revised.encounteredNPCs.find(n => n.NPCId === 'guard').npcRelationships[0].relationshipStatus, 'Ally');
    assert.equal(revised.encounteredNPCs.find(n => n.NPCId === 'guard').npcRelationships[1].relationshipStatus, 'Rival');
    for (const bad of [{ ...change, sourceNpcId: 'stale' }, { ...change, targetNpcId: null }, { ...change, targetNpcId: null, initialTargetNpcId: 'stale-tag' }]) {
      const rejected = processAndApplyResponse({ interNPCRelationshipChanges: [bad] }, base, context.gameSettings, key => key, true, 2, context.worldMap);
      assert.deepEqual(rejected.newState.encounteredNPCs.find(n => n.NPCId === 'guard').npcRelationships, [friend]);
      assert.ok(rejected.logsToAdd.includes('warning_npc_relationship_identity'));
    }
    const unique = { ...base, encounteredNPCs: [guard, npc('old', 'Wolf')] };
    const byName = processAndApplyResponse({ interNPCRelationshipChanges: [{ ...change, targetNpcId: null, newRelationshipStatus: 'Ally' }] }, unique, context.gameSettings, key => key, true, 2, context.worldMap).newState;
    const updated = byName.encounteredNPCs.find(n => n.NPCId === 'guard').npcRelationships[0];
    assert.equal(updated.targetNpcId, 'old'); assert.equal(updated.relationshipStatus, 'Ally');
    assert.deepEqual(base.encounteredNPCs[0].npcRelationships, [friend]);
  } finally { await server.close(); }
});

test('new same-name items keep distinct IDs, journals, and subsequent updates', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse, mergeStageResponses } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const item = { existedId: 'old', initialId: 'reused-tag', name: 'Sword', count: 1, weight: 1, contentsPath: null, journalEntries: ['old journal'] };
    const player = { ...context.playerCharacter, inventory: [item] };
    const base = { playerCharacter: player, players: [structuredClone(player)], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    for (const explicitId of ['new', null]) {
      const response = { inventoryItemsData: [fullItem({ existedId: explicitId, initialId: 'reused-tag', name: 'Sword' })], itemJournalUpdates: [{ itemId: null, initialItemId: 'reused-tag', itemName: 'Sword', entryToAppend: 'new journal' }] };
      const { newState, logsToAdd } = processAndApplyResponse(response, base, context.gameSettings, k => k, true, 2, context.worldMap);
      const items = newState.playerCharacter.inventory;
      assert.equal(items.length, 2); assert.equal(items[0].existedId, 'old');
      assert.ok(items[1].existedId); assert.notEqual(items[1].existedId, 'old');
      if (explicitId) assert.equal(items[1].existedId, explicitId);
      assert.deepEqual(items[0].journalEntries, ['old journal']); assert.deepEqual(items[1].journalEntries, ['new journal']);
      assert.ok(!logsToAdd.includes('warning_item_journal_identity'));
      const next = processAndApplyResponse({ inventoryItemsData: [{ existedId: items[1].existedId, name: 'Sword', count: 3 }] }, newState, context.gameSettings, k => k, true, 3, context.worldMap).newState;
      assert.deepEqual(next.playerCharacter.inventory.map(i => i.count), [1, 3]);
    }
    const merged = mergeStageResponses({ inventoryItemsData: [{ initialId: 'a', name: 'Sword', count: 1 }] }, { inventoryItemsData: [{ initialId: 'b', name: 'Sword', count: 1 }] }, {});
    assert.equal(merged.inventoryItemsData.length, 2);
    const mergedAnonymous = mergeStageResponses({ inventoryItemsData: [{ name: 'Sword', count: 1 }] }, { inventoryItemsData: [{ name: 'Sword', count: 1 }] }, {});
    assert.equal(mergedAnonymous.inventoryItemsData.length, 2);
    const same = mergeStageResponses({ inventoryItemsData: [{ existedId: 'old', name: 'Sword', count: 1 }] }, { inventoryItemsData: [{ existedId: 'old', count: 2 }] }, {});
    // Keep stage fragments intact until all turn-local identity conflicts are known.
    assert.equal(same.inventoryItemsData.length, 2); assert.equal(same.inventoryItemsData[1].count, 2);
    assert.deepEqual(base.playerCharacter.inventory[0].journalEntries, ['old journal']);
  } finally { await server.close(); }
});

test('unknown NPC target cannot hijack a unique name-only legacy relationship', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const p = context.playerCharacter;
    const npc = (id, name, extra = {}) => ({ ...p, NPCId: id, name, inventory: [], ...extra });
    const legacy = { targetNpcId: null, targetNpcName: 'Wolf', relationshipStatus: 'Friend', statusReason: 'Trust' };
    const guard = npc('guard', 'Guard', { npcRelationships: [legacy] });
    const base = { playerCharacter: p, players: [p], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [guard, npc('real-wolf', 'Wolf')], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const change = { sourceNpcId: 'guard', sourceNpcName: 'Guard', targetNpcId: 'stale-wolf', targetNpcName: 'Wolf', newRelationshipStatus: 'Enemy', newStatusReason: 'Stranger' };
    const rejected = processAndApplyResponse({ interNPCRelationshipChanges: [change] }, base, context.gameSettings, k => k, true, 2, context.worldMap);
    assert.deepEqual(rejected.newState.encounteredNPCs.find(n => n.NPCId === 'guard').npcRelationships, [legacy]);
    assert.ok(rejected.logsToAdd.includes('warning_npc_relationship_identity'));
    const accepted = processAndApplyResponse({ interNPCRelationshipChanges: [{ ...change, targetNpcId: 'real-wolf' }] }, base, context.gameSettings, k => k, true, 2, context.worldMap);
    const rels = accepted.newState.encounteredNPCs.find(n => n.NPCId === 'guard').npcRelationships;
    assert.equal(rels.length, 1); assert.equal(rels[0].targetNpcId, 'real-wolf'); assert.equal(rels[0].relationshipStatus, 'Enemy');
    const ghost = { targetNpcId: 'not-in-roster', targetNpcName: 'Wanderer', relationshipStatus: 'Friend', statusReason: 'Old friend' };
    const withGhost = { ...base, encounteredNPCs: [npc('guard', 'Guard', { npcRelationships: [ghost] })] };
    const updatedGhost = processAndApplyResponse({ interNPCRelationshipChanges: [{ ...change, targetNpcId: 'not-in-roster', targetNpcName: 'Wanderer' }] }, withGhost, context.gameSettings, k => k, true, 2, context.worldMap);
    assert.equal(updatedGhost.newState.encounteredNPCs[0].npcRelationships[0].relationshipStatus, 'Enemy');
  } finally { await server.close(); }
});

test('name-only relationship changes do not modify a different historical namesake', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const npc = (id, name, extra = {}) => ({ ...player, NPCId: id, name, inventory: [], ...extra });
    const oldRel = { targetNpcId: 'old', targetNpcName: 'Wolf', relationshipStatus: 'Friend', statusReason: 'Trust' };
    const guard = npc('guard', 'Guard', { npcRelationships: [oldRel] });
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [guard, npc('new', 'Wolf')], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const change = { sourceNpcId: 'guard', sourceNpcName: 'Guard', targetNpcId: null, targetNpcName: 'Wolf', newRelationshipStatus: 'Enemy', newStatusReason: 'New wolf is hostile' };
    const rejected = processAndApplyResponse({ interNPCRelationshipChanges: [change] }, base, context.gameSettings, k => k, true, 2, context.worldMap);
    assert.deepEqual(rejected.newState.encounteredNPCs.find(n => n.NPCId === 'guard').npcRelationships, [oldRel]);
    assert.ok(rejected.logsToAdd.includes('warning_npc_relationship_identity'));
    const noPrevious = { ...base, encounteredNPCs: [npc('guard', 'Guard', { npcRelationships: [] }), npc('new', 'Wolf')] };
    const created = processAndApplyResponse({ interNPCRelationshipChanges: [change] }, noPrevious, context.gameSettings, k => k, true, 2, context.worldMap).newState;
    assert.equal(created.encounteredNPCs[0].npcRelationships[0].targetNpcId, 'new');
    const absent = { ...base, encounteredNPCs: [guard] };
    const historical = processAndApplyResponse({ interNPCRelationshipChanges: [change] }, absent, context.gameSettings, k => k, true, 2, context.worldMap).newState;
    assert.equal(historical.encounteredNPCs[0].npcRelationships[0].targetNpcId, 'old');
    assert.equal(historical.encounteredNPCs[0].npcRelationships[0].relationshipStatus, 'Enemy');
    assert.deepEqual(base.encounteredNPCs[0].npcRelationships, [oldRel]);
  } finally { await server.close(); }
});

test('incomplete unknown inventory updates cannot create ghost items', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const item = { existedId: 'real', name: 'Sword', count: 1, weight: 1, contentsPath: null };
    const player = { ...context.playerCharacter, inventory: [item] };
    const base = { playerCharacter: player, players: [structuredClone(player)], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const response = { inventoryItemsData: [{ existedId: 'stale', name: 'Sword', count: 99 }, { existedId: 'real', count: 2 }, fullItem({ existedId: 'new', name: 'Sword', weight: 0 })], currentHealthChange: -1 };
    const { newState, logsToAdd } = processAndApplyResponse(response, base, context.gameSettings, k => k, true, 2, context.worldMap);
    assert.deepEqual(newState.playerCharacter.inventory.map(i => [i.existedId, i.count]), [['real', 2], ['new', 1]]);
    assert.equal(newState.playerCharacter.currentHealth, player.currentHealth - 1);
    assert.equal(logsToAdd.filter(log => log === 'warning_inventory_item_identity').length, 1);
    assert.equal(base.playerCharacter.inventory[0].count, 1);
    for (const invalid of [
      { existedId: 'stale', name: 'Sword', count: 1, weight: 1 },
      fullItem({ description: undefined }), fullItem({ image_prompt: undefined }),
      fullItem({ count: 0 }), fullItem({ count: 0.5 }), fullItem({ weight: -1 }),
      fullItem({ bonuses: undefined }), fullItem({ volume: undefined }),
    ]) {
      const rejected = processAndApplyResponse({ inventoryItemsData: [invalid] }, base, context.gameSettings, k => k, true, 2, context.worldMap);
      assert.equal(rejected.newState.playerCharacter.inventory.length, 1);
      assert.ok(rejected.logsToAdd.includes('warning_inventory_item_identity'));
    }
    const second = { ...structuredClone(player), playerId: 'second', inventory: [] };
    const multiplayer = { ...base, players: [structuredClone(player), second] };
    const other = processAndApplyResponse({ otherPlayersInteractions: { second: [{ inventoryItemsData: [
      { existedId: 'real', name: 'Sword', count: 5 },
      fullItem({ name: 'Rope', weight: 2 }),
    ] }] } }, multiplayer, context.gameSettings, k => k, true, 2, context.worldMap);
    assert.deepEqual(other.newState.players[1].inventory.map(i => i.name), ['Rope']);
    assert.ok(other.newState.players[1].inventory[0].existedId);
    assert.ok(other.logsToAdd.includes('warning_inventory_item_identity'));
    assert.equal(multiplayer.players[1].inventory.length, 0);
    const fragments = processAndApplyResponse({ inventoryItemsData: [
      fullItem({ existedId: 'fresh', name: 'Rope', weight: 2 }),
      { existedId: 'fresh', count: 3 },
    ] }, base, context.gameSettings, k => k, true, 2, context.worldMap);
    assert.equal(fragments.newState.playerCharacter.inventory.find(i => i.existedId === 'fresh').count, 3);
    const { durability, ...missingDurability } = fullItem({ existedId: 'fresh', name: 'Rope' });
    for (const updates of [
      [{ existedId: 'fresh', durability: '50%' }, missingDurability],
      [missingDurability, { existedId: 'fresh', durability: '50%' }],
    ]) {
      const combined = processAndApplyResponse({ inventoryItemsData: updates }, base, context.gameSettings, k => k, true, 2, context.worldMap);
      assert.equal(combined.newState.playerCharacter.inventory.find(i => i.existedId === 'fresh').durability, '50%');
      assert.ok(!combined.logsToAdd.includes('warning_inventory_item_identity'));
    }
    const equippedBase = { ...base, playerCharacter: { ...player, equippedItems: { ...player.equippedItems, MainHand: 'real' } } };
    const equipment = processAndApplyResponse({ inventoryItemsData: [{ existedId: 'stale', name: 'Sword', count: 1, weight: 1 }], equipmentChanges: [{ action: 'equip', itemId: 'stale', targetSlots: ['MainHand'] }] }, equippedBase, context.gameSettings, k => k, true, 2, context.worldMap);
    assert.equal(equipment.newState.playerCharacter.equippedItems.MainHand, 'real');
    assert.ok(equipment.logsToAdd.includes('warning_inventory_item_identity'));
    assert.ok(equipment.logsToAdd.includes('warning_equipment_item_identity'));
    assert.equal(equippedBase.playerCharacter.equippedItems.MainHand, 'real');
    const validEquipment = processAndApplyResponse({ inventoryItemsData: [fullItem({ existedId: 'fresh' })], equipmentChanges: [{ action: 'equip', itemId: 'fresh', targetSlots: ['MainHand'] }] }, base, context.gameSettings, k => k, true, 2, context.worldMap);
    assert.equal(validEquipment.newState.playerCharacter.equippedItems.MainHand, 'fresh');
    const { general } = await server.ssrLoadModule('/utils/translations/general.ts');
    assert.match(general.en.warning_inventory_item_identity, /Warning/);
    assert.match(general.ru.warning_inventory_item_identity, /Предупреждение/);
    assert.match(general.en.warning_equipment_item_identity, /Warning/);
    assert.match(general.ru.warning_equipment_item_identity, /Предупреждение/);
    const duplicate = { ...base, playerCharacter: { ...player, inventory: [item, { ...item }] }, players: [{ ...player, inventory: [item, { ...item }] }] };
    const ambiguous = processAndApplyResponse({ inventoryItemsData: [{ existedId: 'real', count: 3 }], equipmentChanges: [{ action: 'equip', itemId: 'real', targetSlots: ['MainHand'] }] }, duplicate, context.gameSettings, k => k, true, 2, context.worldMap);
    assert.deepEqual(ambiguous.newState.playerCharacter.inventory.map(i => i.count), [1, 1]);
    assert.ok(ambiguous.logsToAdd.includes('warning_inventory_item_identity'));
    assert.ok(ambiguous.logsToAdd.includes('warning_equipment_item_identity'));
    assert.notEqual(ambiguous.newState.playerCharacter.equippedItems.MainHand, 'real');
  } finally { await server.close(); }
});

test('legacy incomplete items remain inspectable in the item details renderer', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { default: ItemDetails } = await server.ssrLoadModule('/components/DetailRenderer/ItemDetailsRenderer.tsx');
    const { LocalizationProvider } = await server.ssrLoadModule('/context/LocalizationContext.tsx');
    const item = { existedId: 'legacy', name: 'Sword', count: 1, weight: 1 };
    const html = renderToString(React.createElement(LocalizationProvider, null, React.createElement(ItemDetails, {
      item, playerCharacter: null, gameSettings: null, imageCache: {}, allowHistoryManipulation: false,
    })));
    assert.match(html, /Sword/);
  } finally { await server.close(); }
});

test('turn-local item fragments merge before IDs are assigned, without matching saved tags', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const old = fullItem({ existedId: 'old', initialId: 'tag', name: 'Old' });
    const player = { ...context.playerCharacter, inventory: [old] };
    const base = { playerCharacter: player, players: [structuredClone(player)], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const { durability, ...full } = fullItem({ existedId: null, initialId: 'tag', name: 'New' });
    const fragment = { existedId: null, initialId: 'tag', durability: '50%' };
    for (const fragments of [[full, fragment], [fragment, full]]) {
      const result = processAndApplyResponse({ inventoryItemsData: fragments, itemJournalUpdates: [{ initialItemId: 'tag', entryToAppend: 'new entry' }] }, base, context.gameSettings, k => k, true, 2, context.worldMap);
      assert.equal(result.newState.playerCharacter.inventory.length, 2);
      const item = result.newState.playerCharacter.inventory[1];
      assert.notEqual(item.existedId, 'old');
      assert.equal(item.durability, '50%');
      assert.deepEqual(item.journalEntries, ['new entry']);
      assert.equal(result.newState.playerCharacter.inventory[0].durability, '100%');
      assert.ok(!result.logsToAdd.includes('warning_inventory_item_identity'));
    }
    const distinct = processAndApplyResponse({ inventoryItemsData: [fullItem({ initialId: 'a', name: 'Sword' }), fullItem({ initialId: 'b', name: 'Sword' })] }, base, context.gameSettings, k => k, true, 2, context.worldMap);
    assert.equal(distinct.newState.playerCharacter.inventory.length, 3);
    assert.notEqual(distinct.newState.playerCharacter.inventory[1].existedId, distinct.newState.playerCharacter.inventory[2].existedId);
    assert.equal(base.playerCharacter.inventory.length, 1);
  } finally { await server.close(); }
});

test('legacy null item IDs do not intercept the image of a new item', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const legacy = fullItem({ existedId: null, name: 'Legacy', image_prompt: 'old image' });
    const player = { ...context.playerCharacter, inventory: [legacy] };
    const npc = { ...context.playerCharacter, NPCId: 'npc', name: 'NPC', inventory: [structuredClone(legacy)] };
    const base = { playerCharacter: player, players: [structuredClone(player)], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    for (const source of [base, { ...base, playerCharacter: { ...player, inventory: [] } }]) {
      const response = { inventoryItemsData: [fullItem({ existedId: null, name: 'New', image_prompt: 'new image' })] };
      const result = processAndApplyResponse(response, source, context.gameSettings, k => k, true, 2, context.worldMap);
      const created = result.newState.playerCharacter.inventory.find(i => i.name === 'New');
      assert.ok(created?.existedId);
      assert.equal(created.image_prompt, 'new image');
      assert.equal(created.pending_image_prompt, undefined);
      assert.ok(!result.logsToAdd.includes('warning_inventory_item_identity'));
      assert.equal(response.inventoryItemsData[0].image_prompt, 'new image');
    }
    const existing = fullItem({ existedId: 'saved', image_prompt: 'old image' });
    const withExisting = { ...base, playerCharacter: { ...player, inventory: [existing] } };
    const updated = processAndApplyResponse({ inventoryItemsData: [{ existedId: 'saved', image_prompt: 'changed image' }] }, withExisting, context.gameSettings, k => k, true, 2, context.worldMap);
    assert.equal(updated.newState.playerCharacter.inventory[0].image_prompt, 'old image');
    assert.equal(updated.newState.playerCharacter.inventory[0].pending_image_prompt, 'changed image');
    assert.equal(legacy.image_prompt, 'old image');
  } finally { await server.close(); }
});

test('repeated other-player commands are preserved and applied once per turn', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = { ...context.playerCharacter, inventory: [] };
    const second = { ...structuredClone(player), playerId: 'second', inventory: [], currentHealth: 50 };
    const base = { playerCharacter: player, players: [structuredClone(player), second], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const { durability, ...fresh } = fullItem({ initialId: 'tag', name: 'A' });
    const commands = [
      { inventoryItemsData: [{ initialId: 'tag', durability: '65%' }] },
      { inventoryItemsData: [fresh] },
      { inventoryItemsData: [fullItem({ existedId: 'b', name: 'B' })] },
      { currentHealthChange: -4 }, { currentHealthChange: 2 },
      { equipmentChanges: [{ action: 'equip', itemId: 'b', targetSlots: ['MainHand'] }] },
      { playerActiveEffectsChanges: [{ effectId: 'effect-a', name: 'A', duration: 3 }] },
      { playerActiveEffectsChanges: [{ effectId: 'effect-b', name: 'B', duration: 3 }] },
    ];
    const result = processAndApplyResponse({ otherPlayersInteractions: { second: commands } }, base, context.gameSettings, k => k, false, 2, context.worldMap);
    const updated = result.newState.players[1];
    assert.deepEqual(updated.inventory.map(i => i.name), ['A', 'B']);
    assert.equal(updated.inventory[0].durability, '65%');
    assert.ok(updated.inventory[0].existedId);
    assert.equal(updated.currentHealth, 48);
    assert.equal(updated.equippedItems.MainHand, 'b');
    assert.deepEqual(updated.activePlayerEffects.map(e => e.effectId), ['effect-a', 'effect-b']);
    assert.equal(result.newState.playerCharacter.inventory.length, 0);
    assert.equal(base.players[1].inventory.length, 0);
    assert.equal(base.players[1].currentHealth, 50);
    assert.ok(!result.logsToAdd.includes('warning_inventory_item_identity'));
  } finally { await server.close(); }
});

test('conflicting item tags reject ambiguous fragments regardless of order and stage', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse, mergeStageResponses } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const p = { ...context.playerCharacter, inventory: [fullItem({ existedId: 'a', name: 'A' }), fullItem({ existedId: 'b', name: 'B' })] };
    const other = { ...structuredClone(p), playerId: 'other' };
    const base = { playerCharacter: p, players: [structuredClone(p), other], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const a = { existedId: 'a', initialId: 'clash', durability: '80%' };
    const b = { existedId: 'b', initialId: 'clash', durability: '70%' };
    const ambiguous = { existedId: null, initialId: 'clash', count: 99 };
    for (const order of [[a, ambiguous, b], [ambiguous, b, a], [a, b, ambiguous]]) {
      const result = processAndApplyResponse({ inventoryItemsData: order }, base, context.gameSettings, k => k, true, 2, context.worldMap);
      assert.deepEqual(result.newState.playerCharacter.inventory.map(i => [i.existedId, i.count, i.durability]), [['a', 1, '80%'], ['b', 1, '70%']]);
      assert.ok(result.logsToAdd.includes('warning_inventory_item_identity'));
    }
    let staged = {};
    for (const fragment of [a, ambiguous, b]) staged = mergeStageResponses(staged, { inventoryItemsData: [fragment] }, {});
    const acrossStages = processAndApplyResponse(staged, base, context.gameSettings, k => k, true, 2, context.worldMap);
    assert.deepEqual(acrossStages.newState.playerCharacter.inventory.map(i => i.count), [1, 1]);
    assert.ok(acrossStages.logsToAdd.includes('warning_inventory_item_identity'));
    const otherResult = processAndApplyResponse({ otherPlayersInteractions: { other: [
      { inventoryItemsData: [a, ambiguous] }, { inventoryItemsData: [b] },
    ] } }, base, context.gameSettings, k => k, true, 2, context.worldMap);
    assert.deepEqual(otherResult.newState.players[1].inventory.map(i => i.count), [1, 1]);
    assert.ok(otherResult.logsToAdd.includes('warning_inventory_item_identity'));
    assert.deepEqual(base.playerCharacter.inventory.map(i => i.count), [1, 1]);
  } finally { await server.close(); }
});

test('other-player effect durations and journal commands are scoped to their player', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const p = { ...context.playerCharacter, inventory: [fullItem({ existedId: 'active-item', name: 'Sword', journalEntries: ['active old'] })], activePlayerEffects: [{ effectId: 'same', duration: 3 }] };
    const other = { ...structuredClone(p), playerId: 'other', inventory: [fullItem({ existedId: 'other-item', name: 'Sword', journalEntries: ['old'] })], activePlayerEffects: [{ effectId: 'same', duration: 3 }, { effectId: 'old-eff', duration: 3 }] };
    const base = { playerCharacter: p, players: [structuredClone(p), other], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const response = { otherPlayersInteractions: { other: [
      { playerActiveEffectsChanges: [{ effectId: 'same', duration: 1 }, { effectId: 'expired', duration: 0 }] },
      { inventoryItemsData: [fullItem({ initialId: 'new-tag', name: 'New book' })] },
      { itemJournalUpdates: [
        { itemId: 'other-item', itemName: 'Sword', entryToAppend: 'new' },
        { itemId: null, initialItemId: 'new-tag', itemName: 'New book', entryToAppend: 'fresh' },
        { itemId: 'active-item', itemName: 'Sword', entryToAppend: 'wrong owner' },
        { itemId: 'stale', itemName: 'Sword', entryToAppend: 'stale' },
      ] },
    ] } };
    const result = processAndApplyResponse(response, base, context.gameSettings, k => k, true, 2, context.worldMap);
    const target = result.newState.players[1];
    assert.deepEqual(target.activePlayerEffects.map(e => [e.effectId, e.duration]), [['same', 1], ['old-eff', 2]]);
    assert.equal(result.newState.playerCharacter.activePlayerEffects[0].duration, 2);
    assert.deepEqual(target.inventory[0].journalEntries, ['new', 'old']);
    assert.deepEqual(target.inventory[1].journalEntries, ['fresh']);
    assert.deepEqual(result.newState.playerCharacter.inventory[0].journalEntries, ['active old']);
    assert.equal(result.logsToAdd.filter(x => x === 'warning_item_journal_identity').length, 2);
    assert.deepEqual(base.players[1].inventory[0].journalEntries, ['old']);
    assert.equal(base.players[1].activePlayerEffects[0].duration, 3);
  } finally { await server.close(); }
});

test('conflicting full new item declarations with the same temporary tag are not silently merged', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse, mergeStageResponses } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const ctx = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = { ...ctx.playerCharacter, inventory: [] };
    const base = { playerCharacter: player, players: [structuredClone(player)], activePlayerIndex: 0, currentLocationData: ctx.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const first = fullItem({ existedId: null, initialId: 'dup', name: 'Sword' });
    const second = fullItem({ existedId: null, initialId: 'dup', name: 'Shield' });
    for (const updates of [[first, second], [second, first]]) {
      const result = processAndApplyResponse({ inventoryItemsData: updates, currentHealthChange: -1 }, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
      assert.equal(result.newState.playerCharacter.inventory.length, 0);
      assert.equal(result.newState.playerCharacter.currentHealth, player.currentHealth - 1);
      assert.ok(result.logsToAdd.includes('warning_inventory_item_identity'));
    }
    const staged = mergeStageResponses({ inventoryItemsData: [first] }, { inventoryItemsData: [second] }, {});
    const result = processAndApplyResponse(staged, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
    assert.equal(result.newState.playerCharacter.inventory.length, 0);
    const repeat = processAndApplyResponse({ inventoryItemsData: [first, { ...first, durability: '60%' }] }, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
    assert.equal(repeat.newState.playerCharacter.inventory.length, 1);
    assert.equal(repeat.newState.playerCharacter.inventory[0].durability, '60%');
    assert.equal(base.playerCharacter.inventory.length, 0);
  } finally { await server.close(); }
});

test('rejected player-side item does not destroy a possible NPC transfer source', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const ctx = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = { ...ctx.playerCharacter, inventory: [] };
    const npc = { ...ctx.playerCharacter, NPCId: 'npc', name: 'Trader', progressionType: 'Standard', inventory: [fullItem({ existedId: 'potion', name: 'Potion', count: 5 }), fullItem({ existedId: 'rope', name: 'Rope' })] };
    const base = { playerCharacter: player, players: [structuredClone(player)], activePlayerIndex: 0, currentLocationData: ctx.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const apply = response => processAndApplyResponse(response, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
    const missing = { existedId: null, name: 'Potion', count: 1, weight: 1 };
    const failed = apply({ inventoryItemsData: [missing], NPCInventoryRemovals: [{ NPCId: 'npc', itemId: 'potion' }, { NPCId: 'npc', itemId: 'rope' }] });
    // Without a transfer ID, even an apparently unrelated removal may be the
    // source of a rejected, renamed item and is therefore deferred.
    assert.deepEqual(failed.newState.encounteredNPCs[0].inventory.map(i => i.existedId), ['potion', 'rope']);
    assert.equal(failed.newState.playerCharacter.inventory.length, 0);
    assert.ok(failed.logsToAdd.includes('warning_inventory_item_identity'));
    assert.ok(failed.logsToAdd.includes('warning_npc_item_transfer'));
    const partial = apply({ inventoryItemsData: [missing], NPCInventoryUpdates: [{ NPCId: 'npc', itemUpdate: { existedId: 'potion', count: 4, durability: '90%' } }] });
    assert.equal(partial.newState.encounteredNPCs[0].inventory[0].count, 5);
    assert.equal(partial.newState.encounteredNPCs[0].inventory[0].durability, '90%');
    assert.ok(partial.logsToAdd.includes('warning_npc_item_transfer'));
    const success = apply({ inventoryItemsData: [fullItem({ existedId: null, name: 'Potion', count: 5 })], NPCInventoryRemovals: [{ NPCId: 'npc', itemId: 'potion' }] });
    assert.equal(success.newState.encounteredNPCs[0].inventory.some(i => i.existedId === 'potion'), false);
    assert.equal(success.newState.playerCharacter.inventory[0].name, 'Potion');
    assert.ok(!success.logsToAdd.includes('warning_npc_item_transfer'));
    const notTransfer = apply({ NPCInventoryRemovals: [{ NPCId: 'npc', itemId: 'potion' }] });
    assert.equal(notTransfer.newState.encounteredNPCs[0].inventory.some(i => i.existedId === 'potion'), false);
    assert.equal(base.encounteredNPCs[0].inventory[0].count, 5);
    const { general } = await server.ssrLoadModule('/utils/translations/general.ts');
    assert.match(general.en.warning_npc_item_transfer, /Warning/); assert.match(general.ru.warning_npc_item_transfer, /Предупреждение/);
  } finally { await server.close(); }
});

test('effect duration updates do not suppress ticking on other actors with colliding IDs', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const ctx = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = { ...ctx.playerCharacter, activePlayerEffects: [{ effectId: 'shared', duration: 4 }] };
    const other = { ...structuredClone(player), playerId: 'other' };
    const npc = { ...structuredClone(player), NPCId: 'npc', name: 'NPC', activeEffects: [{ effectId: 'shared', duration: 4 }], inventory: [] };
    const base = { playerCharacter: player, players: [structuredClone(player), other], activePlayerIndex: 0, currentLocationData: ctx.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const apply = response => processAndApplyResponse(response, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap).newState;
    const active = apply({ playerActiveEffectsChanges: [{ effectId: 'shared', duration: 1 }] });
    assert.equal(active.players[0].activePlayerEffects[0].duration, 1);
    assert.equal(active.players[1].activePlayerEffects[0].duration, 3);
    assert.equal(active.encounteredNPCs[0].activeEffects[0].duration, 3);
    const target = apply({ otherPlayersInteractions: { other: [{ playerActiveEffectsChanges: [{ effectId: 'shared', duration: 1 }] }] } });
    assert.equal(target.players[0].activePlayerEffects[0].duration, 3);
    assert.equal(target.players[1].activePlayerEffects[0].duration, 1);
    assert.equal(target.encounteredNPCs[0].activeEffects[0].duration, 3);
    assert.equal(base.playerCharacter.activePlayerEffects[0].duration, 4);
  } finally { await server.close(); }
});

test('companion transfer does not duplicate items into the stash and failed renamed transfers preserve sources', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const ctx = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = { ...ctx.playerCharacter, inventory: [] };
    const npc = { ...ctx.playerCharacter, NPCId: 'companion', name: 'Companion', progressionType: 'Companion', inventory: [fullItem({ existedId: 'potion', name: 'Potion', count: 5 })] };
    const base = { playerCharacter: player, players: [structuredClone(player)], activePlayerIndex: 0, currentLocationData: ctx.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const apply = response => processAndApplyResponse(response, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
    const removal = { NPCId: 'companion', itemId: 'potion' };
    const success = apply({ inventoryItemsData: [fullItem({ existedId: null, name: 'Potion', count: 5 })], NPCInventoryRemovals: [removal] });
    assert.equal(success.newState.encounteredNPCs[0].inventory.length, 0);
    assert.equal(success.newState.playerCharacter.inventory[0].count, 5);
    assert.equal(success.newState.temporaryStash?.length || 0, 0);
    const drop = apply({ NPCInventoryRemovals: [removal] });
    assert.equal(drop.newState.temporaryStash[0].existedId, 'potion');
    const renamed = { existedId: null, name: 'Healing Potion', count: 5, weight: 1 };
    const failure = apply({ inventoryItemsData: [renamed], NPCInventoryRemovals: [removal] });
    assert.equal(failure.newState.encounteredNPCs[0].inventory[0].count, 5);
    assert.equal(failure.newState.playerCharacter.inventory.length, 0);
    assert.equal(failure.newState.temporaryStash?.length || 0, 0);
    assert.ok(failure.logsToAdd.includes('warning_npc_item_transfer'));
    const partial = apply({ inventoryItemsData: [renamed], NPCInventoryUpdates: [{ NPCId: 'companion', itemUpdate: { existedId: 'potion', count: 3 } }] });
    assert.equal(partial.newState.encounteredNPCs[0].inventory[0].count, 5);
    assert.ok(partial.logsToAdd.includes('warning_npc_item_transfer'));
    assert.equal(base.encounteredNPCs[0].inventory[0].count, 5);
  } finally { await server.close(); }
});

test('NPC effect duration updates are scoped to the matching actor and its combat representation', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const ctx = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = ctx.playerCharacter;
    const npc = (id) => ({ ...player, NPCId: id, name: id, inventory: [], activeEffects: [{ effectId: 'shared', duration: 4 }] });
    const combatant = id => ({ NPCId: id, name: id, activeBuffs: [{ effectId: 'shared', duration: 4 }], activeDebuffs: [] });
    const base = { playerCharacter: player, players: [structuredClone(player)], activePlayerIndex: 0, currentLocationData: ctx.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc('a'), npc('b')], encounteredFactions: [], enemiesData: [combatant('a'), combatant('b')], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const response = { NPCEffectChanges: [{ NPCId: 'a', NPCName: 'a', effectsApplied: [{ effectId: 'shared', duration: 1 }] }], enemiesData: [{ NPCId: 'a', name: 'a', activeBuffs: [{ effectId: 'shared', duration: 1 }] }] };
    const { newState } = processAndApplyResponse(response, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
    assert.deepEqual(newState.encounteredNPCs.map(n => n.activeEffects[0].duration), [1, 3]);
    assert.deepEqual(newState.enemiesData.map(n => n.activeBuffs[0].duration), [1, 3]);
    assert.equal(base.encounteredNPCs[0].activeEffects[0].duration, 4);
  } finally { await server.close(); }
});

test('a rejected item defers both sides of player and NPC transfers without rolling back health', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const ctx = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const potion = fullItem({ existedId: 'owned', name: 'Owned potion', isConsumption: true, count: 1, resource: 1, maximumResource: 1 });
    const player = { ...ctx.playerCharacter, inventory: [potion], equippedItems: { ...ctx.playerCharacter.equippedItems, MainHand: 'owned' } };
    const other = { ...structuredClone(player), playerId: 'other', inventory: [] };
    const npc = (id, inventory) => ({ ...ctx.playerCharacter, NPCId: id, name: id, progressionType: 'Standard', inventory });
    const base = { playerCharacter: player, players: [structuredClone(player), other], activePlayerIndex: 0, currentLocationData: ctx.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc('A', [fullItem({ existedId: 'potion', name: 'Potion', count: 2 })]), npc('B', [])], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const invalid = { existedId: null, name: 'Sword', count: 1 };
    const valid = fullItem({ existedId: null, name: 'Potion', count: 2 });
    const removal = { NPCId: 'A', itemId: 'potion' };
    const response = { inventoryItemsData: [valid, invalid], currentHealthChange: -3, inventoryItemsResources: [{ existedId: 'owned', resource: 0 }], equipmentChanges: [{ action: 'unequip', itemId: 'owned', sourceSlots: ['MainHand'] }], NPCInventoryRemovals: [removal] };
    const apply = r => processAndApplyResponse(r, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
    const playerTransfer = apply(response);
    assert.deepEqual(playerTransfer.newState.playerCharacter.inventory.map(i => i.existedId), ['owned']);
    assert.equal(playerTransfer.newState.playerCharacter.inventory[0].resource, 1);
    assert.equal(playerTransfer.newState.playerCharacter.equippedItems.MainHand, 'owned');
    assert.equal(playerTransfer.newState.playerCharacter.currentHealth, player.currentHealth - 3);
    assert.equal(playerTransfer.newState.encounteredNPCs[0].inventory[0].existedId, 'potion');
    assert.ok(playerTransfer.logsToAdd.includes('warning_npc_transfer_batch'));
    assert.ok(!playerTransfer.logsToAdd.includes('item_consumed_creating_empty'));
    const npcTransfer = apply({ inventoryItemsData: [invalid], NPCInventoryAdds: [{ NPCId: 'B', item: valid }], NPCInventoryRemovals: [removal] });
    assert.equal(npcTransfer.newState.encounteredNPCs[0].inventory.length, 1);
    assert.equal(npcTransfer.newState.encounteredNPCs[1].inventory.length, 0);
    assert.ok(npcTransfer.logsToAdd.includes('warning_npc_transfer_batch'));
    const partial = apply({ inventoryItemsData: [valid, invalid], NPCInventoryUpdates: [{ NPCId: 'A', itemUpdate: { existedId: 'potion', count: 1, durability: '90%' } }] });
    assert.equal(partial.newState.playerCharacter.inventory.length, 1);
    assert.equal(partial.newState.encounteredNPCs[0].inventory[0].count, 2);
    assert.equal(partial.newState.encounteredNPCs[0].inventory[0].durability, '90%');
    const increase = apply({ inventoryItemsData: [invalid], removeInventoryItems: [{ removedItemId: 'owned' }], NPCInventoryUpdates: [{ NPCId: 'A', itemUpdate: { existedId: 'potion', count: 3 } }] });
    assert.equal(increase.newState.playerCharacter.inventory[0].existedId, 'owned');
    assert.equal(increase.newState.encounteredNPCs[0].inventory[0].count, 2);
    const otherTransfer = apply({ otherPlayersInteractions: { other: [{ inventoryItemsData: [valid, invalid] }, { currentHealthChange: -2 }] }, NPCInventoryRemovals: [removal] });
    assert.equal(otherTransfer.newState.players[1].inventory.length, 0);
    assert.equal(otherTransfer.newState.players[1].currentHealth, other.currentHealth - 2);
    assert.equal(otherTransfer.newState.encounteredNPCs[0].inventory.length, 1);
    const success = apply({ inventoryItemsData: [valid], NPCInventoryRemovals: [removal] });
    assert.equal(success.newState.playerCharacter.inventory.length, 2);
    assert.equal(success.newState.encounteredNPCs[0].inventory.length, 0);
    assert.ok(!success.logsToAdd.includes('warning_npc_transfer_batch'));
    const { general } = await server.ssrLoadModule('/utils/translations/general.ts');
    assert.match(general.en.warning_npc_transfer_batch, /Warning/); assert.match(general.ru.warning_npc_transfer_batch, /Предупреждение/);
    assert.equal(base.playerCharacter.inventory[0].resource, 1);
  } finally { await server.close(); }
});

test('new NPC name-only effect updates retain their duration on creation turn', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const ctx = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const p = ctx.playerCharacter;
    const base = { playerCharacter: p, players: [structuredClone(p)], activePlayerIndex: 0, currentLocationData: ctx.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    for (const id of ['new-npc', null]) {
      const npc = { ...p, NPCId: id, initialId: 'npc-tag', name: 'New NPC', inventory: [], activeEffects: [] };
      const response = { NPCsData: [npc], NPCEffectChanges: [{ NPCId: null, NPCName: 'New NPC', effectsApplied: [{ effectId: 'fresh-effect', duration: 1 }] }] };
      const result = processAndApplyResponse(response, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
      const created = result.newState.encounteredNPCs.find(n => n.name === 'New NPC');
      assert.ok(created.NPCId);
      assert.equal(created.activeEffects[0].effectId, 'fresh-effect');
      assert.equal(created.activeEffects[0].duration, 1);
      assert.equal(base.encounteredNPCs.length, 0);
    }
  } finally { await server.close(); }
});

test('ambiguous receiving stack IDs defer transfers instead of deleting NPC items', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const ctx = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const item = fullItem({ existedId: 'dup', name: 'Potion' });
    const player = { ...ctx.playerCharacter, inventory: [item, structuredClone(item)] };
    const other = { ...structuredClone(player), playerId: 'other' };
    const npc = { ...ctx.playerCharacter, NPCId: 'source', name: 'Source', progressionType: 'Standard', inventory: [fullItem({ existedId: 'from', name: 'Potion' })] };
    const base = { playerCharacter: player, players: [structuredClone(player), other], activePlayerIndex: 0, currentLocationData: ctx.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const apply = response => processAndApplyResponse(response, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
    const update = { existedId: 'dup', count: 2 };
    const removal = { NPCId: 'source', itemId: 'from' };
    for (const response of [
      { inventoryItemsData: [update], NPCInventoryRemovals: [removal] },
      { otherPlayersInteractions: { other: [{ inventoryItemsData: [update] }] }, NPCInventoryRemovals: [removal] },
      { inventoryItemsData: [update], NPCInventoryUpdates: [{ NPCId: 'source', itemUpdate: { existedId: 'from', count: 0 } }] },
    ]) {
      const result = apply(response);
      assert.equal(result.newState.encounteredNPCs[0].inventory[0].count, 1);
      assert.deepEqual(result.newState.playerCharacter.inventory.map(i => i.count), [1, 1]);
      assert.ok(result.logsToAdd.includes('warning_inventory_item_identity'));
      assert.ok(result.logsToAdd.includes('warning_npc_transfer_batch'));
    }
    assert.deepEqual(base.playerCharacter.inventory.map(i => i.count), [1, 1]);
  } finally { await server.close(); }
});

test('companion transfer into an existing player stack does not also create a stash copy', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const ctx = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const stack = fullItem({ existedId: 'stack', name: 'Potion', count: 2 });
    const player = { ...ctx.playerCharacter, inventory: [stack] };
    const other = { ...structuredClone(player), playerId: 'other' };
    const npc = { ...ctx.playerCharacter, NPCId: 'source', name: 'Companion', progressionType: 'Companion', inventory: [fullItem({ existedId: 'from', name: 'Potion', count: 1 })] };
    const base = { playerCharacter: player, players: [structuredClone(player), other], activePlayerIndex: 0, currentLocationData: ctx.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const removal = { NPCId: 'source', itemId: 'from' };
    for (const response of [
      { inventoryItemsData: [{ existedId: 'stack', count: 3 }], NPCInventoryRemovals: [removal] },
      { otherPlayersInteractions: { other: [{ inventoryItemsData: [{ existedId: 'stack', count: 3 }] }] }, NPCInventoryRemovals: [removal] },
    ]) {
      const result = processAndApplyResponse(response, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
      assert.equal(result.newState.encounteredNPCs[0].inventory.length, 0);
      assert.equal(result.newState.temporaryStash?.length || 0, 0);
      assert.equal(result.newState.players[response.otherPlayersInteractions ? 1 : 0].inventory[0].count, 3);
    }
    const normalDrop = processAndApplyResponse({ NPCInventoryRemovals: [removal] }, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
    assert.equal(normalDrop.newState.temporaryStash[0].existedId, 'from');
    assert.equal(base.playerCharacter.inventory[0].count, 2);
  } finally { await server.close(); }
});

test('deferred transfer batch also withholds a new NPC inline inventory and its equipment references', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const ctx = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = { ...ctx.playerCharacter, inventory: [] };
    const source = { ...ctx.playerCharacter, NPCId: 'source', name: 'Source', progressionType: 'Standard', inventory: [fullItem({ existedId: 'from', name: 'Potion' })] };
    const recipient = { ...ctx.playerCharacter, NPCId: 'new', name: 'New NPC', inventory: [fullItem({ existedId: 'gift', name: 'Potion' })], equippedItems: { MainHand: 'gift' } };
    const base = { playerCharacter: player, players: [structuredClone(player)], activePlayerIndex: 0, currentLocationData: ctx.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [source], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const removal = { NPCId: 'source', itemId: 'from' };
    const input = { inventoryItemsData: [{ name: 'Sword', count: 1 }], NPCsData: [recipient], NPCInventoryRemovals: [removal] };
    const failed = processAndApplyResponse(input, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
    const newNpc = failed.newState.encounteredNPCs.find(n => n.NPCId === 'new');
    assert.equal(failed.newState.encounteredNPCs.find(n => n.NPCId === 'source').inventory.length, 1);
    assert.equal(newNpc.inventory.length, 0);
    assert.equal(newNpc.equippedItems.MainHand, null);
    assert.ok(failed.logsToAdd.includes('warning_npc_transfer_batch'));
    assert.equal(input.NPCsData[0].inventory.length, 1);
    const success = processAndApplyResponse({ NPCsData: [recipient], NPCInventoryRemovals: [removal] }, base, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
    assert.equal(success.newState.encounteredNPCs.find(n => n.NPCId === 'source').inventory.length, 0);
    assert.equal(success.newState.encounteredNPCs.find(n => n.NPCId === 'new').inventory[0].existedId, 'gift');
    assert.equal(base.encounteredNPCs[0].inventory.length, 1);
  } finally { await server.close(); }
});
