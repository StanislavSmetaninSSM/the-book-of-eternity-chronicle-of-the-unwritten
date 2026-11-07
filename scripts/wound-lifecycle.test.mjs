import { test, after} from 'node:test';
import assert from 'node:assert/strict';
import { getTestServer, closeTestServer } from './helpers/testServer.mjs';
import { withGameContext } from '../utils/relayPromptContext.js';

const wound = (id, state, nextState = 'Healed') => ({ woundId: id, woundName: id, severity: 'Light', descriptionOfEffects: 'injury', generatedEffects: [], healingState: { currentState: state, description: '', treatmentProgress: 0, progressNeeded: 20, nextState, canBeImprovedBy: [] } });
const parsedContext = prompt => JSON.parse(prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);

test('GM context separates healed history without mutating the game state or dropping unknown wounds', () => {
  const active = wound('active', 'Untreated', 'Stabilized');
  const healed = wound('past', 'Healed', null);
  const unknown = { woundId: 'old-format', woundName: 'legacy' };
  const player = { name: 'Player', playerWounds: [active, healed, unknown] };
  const npc = { name: 'NPC', wounds: [healed, active] };
  const context = { gameSettings: {}, playerCharacter: player, players: [player], encounteredNPCs: [npc], enemiesDataForCurrentTurn: [{ wounds: [healed, active] }], alliesDataForCurrentTurn: [{ wounds: [active, healed] }] };
  const original = structuredClone(context);
  const result = parsedContext(withGameContext('', context));
  assert.deepEqual(context, original);
  assert.deepEqual(result.playerCharacter.playerWounds, [active, unknown]);
  assert.deepEqual(result.playerCharacter.healedWounds, [healed]);
  assert.deepEqual(result.players[0].playerWounds, [active, unknown]);
  assert.deepEqual(result.players[0].healedWounds, [healed]);
  for (const actor of [result.encounteredNPCs[0], result.enemiesDataForCurrentTurn[0], result.alliesDataForCurrentTurn[0]]) {
    assert.deepEqual(actor.wounds, [active]);
    assert.deepEqual(actor.healedWounds, [healed]);
  }
});

test('healed player and NPC wounds normalize nextState without weakening null protection', async () => {
  const server = await getTestServer();
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse, deepMergeResponses } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const unaffected = { ...wound('p-active', 'Untreated', 'Stabilized'), generatedEffects: [{ effectType: 'Debuff', value: '-10%', targetType: 'strength', duration: 3, description: 'pain' }] };
    const player = { ...context.playerCharacter, playerWounds: [wound('p-heal', 'Recovering'), unaffected] };
    const npc = { ...context.playerCharacter, name: 'NPC', NPCId: 'npc-1', wounds: [wound('n-heal', 'Recovering'), wound('n-active', 'Untreated', 'Stabilized')] };
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const changes = { playerWoundChanges: [wound('p-heal', 'Healed', null), wound('p-active', 'Untreated', null)], NPCWoundChanges: [{ ...wound('n-heal', 'Healed', null), NPCId: 'npc-1', NPCName: 'NPC' }, { ...wound('n-active', 'Untreated', null), NPCId: 'npc-1', NPCName: 'NPC' }] };
    const { newState } = processAndApplyResponse(changes, base, context.gameSettings, key => key, true, 1, context.worldMap);
    const pw = newState.playerCharacter.playerWounds;
    const nw = newState.encounteredNPCs[0].wounds;
    assert.equal(pw.find(w => w.woundId === 'p-heal').healingState.nextState, null);
    assert.equal(pw.find(w => w.woundId === 'p-active').healingState.nextState, 'Stabilized');
    // Explicitly updating the second wound replaces its supplied effects; healing
    // the first alone must never strip the other's effects. Test that independently.
    const singleUpdate = processAndApplyResponse({ playerWoundChanges: [wound('p-heal', 'Healed', null)] }, base, context.gameSettings, key => key, true, 1, context.worldMap).newState;
    assert.deepEqual(singleUpdate.playerCharacter.playerWounds.find(w => w.woundId === 'p-active').generatedEffects, unaffected.generatedEffects);
    assert.equal(nw.find(w => w.woundId === 'n-heal').healingState.nextState, null);
    assert.equal(nw.find(w => w.woundId === 'n-active').healingState.nextState, 'Stabilized');
    assert.equal(deepMergeResponses({ important: 'keep' }, { important: null }).important, 'keep');
    assert.equal(base.playerCharacter.playerWounds[0].healingState.nextState, 'Healed');
  } finally { await server.close(); }
});

test('staged NPC wound updates keep separate wounds for the same NPC', async () => {
  const server = await getTestServer();
  try {
    const { deepMergeResponses } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const first = { NPCWoundChanges: [{ NPCId: 'npc-1', ...wound('wound-a', 'Untreated') }, { NPCId: 'npc-2', ...wound('wound-a', 'Untreated') }] };
    const second = { NPCWoundChanges: [{ NPCId: 'npc-1', ...wound('wound-b', 'Untreated') }, { NPCId: 'npc-1', ...wound('wound-a', 'Stabilized') }, { NPCId: 'npc-1', ...wound(null, 'Untreated') }, { NPCId: 'npc-1', ...wound(null, 'Untreated') }] };
    const merged = deepMergeResponses(first, second).NPCWoundChanges;
    assert.equal(merged.length, 5);
    assert.equal(merged.find(w => w.NPCId === 'npc-1' && w.woundId === 'wound-a').healingState.currentState, 'Stabilized');
    assert.equal(merged.find(w => w.NPCId === 'npc-2' && w.woundId === 'wound-a').healingState.currentState, 'Untreated');
    assert.ok(merged.some(w => w.woundId === 'wound-b'));
    assert.equal(merged.filter(w => w.woundId === null).length, 2);
  } finally { await server.close(); }
});

test('healed wound history is visible without permission to edit history', async () => {
  const server = await getTestServer();
  try {
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { LocalizationProvider } = await server.ssrLoadModule('/context/LocalizationContext.tsx');
    const { default: ConditionsView } = await server.ssrLoadModule('/components/CharacterSheet/ConditionsView.tsx');
    const element = React.createElement(LocalizationProvider, null, React.createElement(ConditionsView, { character: { playerId: 'p', playerWounds: [wound('past', 'Healed', null)], activePlayerEffects: [], playerCustomStates: [] }, isPlayer: true, isAdminEditable: false }));
    const html = renderToStaticMarkup(element);
    assert.match(html, /Healed Wounds/i);
    assert.doesNotMatch(html, /Clear All Healed Wounds|Forget Wound/i);
  } finally { await server.close(); }
});

test('legacy nested NPC wound updates are flattened into real wounds without creating a wrapper injury', async () => {
  const server = await getTestServer();
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const npc = { ...player, name: 'NPC', NPCId: 'npc-1', wounds: [wound('existing', 'Recovering')] };
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const a = wound('existing', 'Healed', null);
    const b = wound('fresh', 'Untreated', 'Stabilized');
    const input = { NPCWoundChanges: [{ NPCId: 'npc-1', NPCName: 'NPC', wounds: [a, b] }] };
    const { newState, processedResponse } = processAndApplyResponse(input, base, context.gameSettings, key => key, true, 1, context.worldMap);
    const wounds = newState.encounteredNPCs[0].wounds;
    assert.equal(wounds.length, 2);
    assert.equal(wounds.find(w => w.woundId === 'existing').healingState.nextState, null);
    assert.equal(wounds.find(w => w.woundId === 'fresh').healingState.currentState, 'Untreated');
    assert.equal(processedResponse.NPCWoundChanges.length, 2);
    assert.ok(processedResponse.NPCWoundChanges.every(w => w.NPCId === 'npc-1' && !('wounds' in w)));
    assert.deepEqual(input.NPCWoundChanges[0].wounds, [a, b]);
  } finally { await server.close(); }
});

test('legacy wounds without healing state remain visible as active injuries', async () => {
  const server = await getTestServer();
  try {
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { LocalizationProvider } = await server.ssrLoadModule('/context/LocalizationContext.tsx');
    const { default: ConditionsView } = await server.ssrLoadModule('/components/CharacterSheet/ConditionsView.tsx');
    const character = { playerId: 'p', playerWounds: [{ woundId: 'legacy', woundName: 'Old injury', severity: 'Light', descriptionOfEffects: 'Still documented' }], activePlayerEffects: [], playerCustomStates: [] };
    const element = React.createElement(LocalizationProvider, null, React.createElement(ConditionsView, { character, isPlayer: true, isAdminEditable: false }));
    const html = renderToStaticMarkup(element);
    assert.match(html, /Old injury/);
    assert.doesNotMatch(html, /You are unwounded/);
  } finally { await server.close(); }
});

test('named NPC combat health is retained in NPC state after combat ends', async () => {
  const server = await getTestServer();
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Start', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const npc = { ...player, name: 'NPC', NPCId: 'npc-1', currentHealth: 100, wounds: [] };
    const base = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const changes = { enemiesData: [{ NPCId: 'npc-1', name: 'NPC', isGroup: false, currentHealth: '80%', maxHealth: '108%', actions: [] }] };
    const turn = processAndApplyResponse(changes, base, context.gameSettings, key => key, true, 1, context.worldMap).newState;
    assert.equal(turn.encounteredNPCs[0].currentHealth, 80);
    const after = processAndApplyResponse({ enemiesData: [] }, turn, context.gameSettings, key => key, true, 2, context.worldMap).newState;
    assert.equal(after.enemiesData.length, 0);
    assert.equal(after.encounteredNPCs[0].currentHealth, 80);
    const ally = processAndApplyResponse({ alliesData: [{ NPCId: 'npc-1', name: 'NPC', currentHealth: '0%', maxHealth: '108%', actions: [] }] }, base, context.gameSettings, key => key, true, 1, context.worldMap).newState;
    assert.equal(ally.encounteredNPCs[0].currentHealth, 0);
    const ambiguous = processAndApplyResponse({ enemiesData: [{ NPCId: 'npc-1', name: 'NPC', currentHealth: '50%', maxHealth: '200%', actions: [] }] }, base, context.gameSettings, key => key, true, 1, context.worldMap).newState;
    assert.equal(ambiguous.encounteredNPCs[0].currentHealth, 100, 'different max health must not be guessed');
    const explicit = processAndApplyResponse({ ...changes, NPCsData: [{ NPCId: 'npc-1', name: 'NPC', currentHealth: 70 }] }, base, context.gameSettings, key => key, true, 1, context.worldMap).newState;
    assert.equal(explicit.encounteredNPCs[0].currentHealth, 70, 'explicit NPC state takes priority');
    const malformed = processAndApplyResponse({ ...changes, NPCsData: [{ NPCId: 'npc-1', name: 'NPC', currentHealth: 'not-a-number', maxHealth: 'unknown' }] }, base, context.gameSettings, key => key, true, 1, context.worldMap).newState;
    assert.equal(malformed.encounteredNPCs[0].currentHealth, 80, 'malformed NPC values must not zero health or block valid combat damage');
    const invalidOnly = processAndApplyResponse({ NPCsData: [{ NPCId: 'npc-1', name: 'NPC', currentHealth: 'garbage', maxHealth: 'garbage' }] }, base, context.gameSettings, key => key, true, 1, context.worldMap).newState;
    assert.equal(invalidOnly.encounteredNPCs[0].currentHealth, 100);
    const explicitZero = processAndApplyResponse({ ...changes, NPCsData: [{ NPCId: 'npc-1', name: 'NPC', currentHealth: '0%' }] }, base, context.gameSettings, key => key, true, 1, context.worldMap).newState;
    assert.equal(explicitZero.encounteredNPCs[0].currentHealth, 0);

  } finally { await server.close(); }
});

test('generic combatant wounds receive distinct IDs and remain on the combatant', async () => {
  const server = await getTestServer();
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Fight', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const enemy = { NPCId: null, name: 'Wolf', isGroup: false, maxHealth: '100%', currentHealth: '100%', actions: [], wounds: [] };
    const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [], encounteredFactions: [], enemiesData: [enemy], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const wound = { woundId: null, woundName: 'Cut', severity: 'Light', descriptionOfEffects: 'Pain', generatedEffects: [{ effectType: 'Debuff', value: '-10%', targetType: 'speed', duration: 3 }], healingState: { currentState: 'Untreated', treatmentProgress: 0, progressNeeded: 20, nextState: 'Stabilized', canBeImprovedBy: [] } };
    const { newState, processedResponse } = processAndApplyResponse({ enemiesData: [{ ...enemy, currentHealth: '60%', wounds: [wound, { ...wound }] }] }, state, context.gameSettings, key => key, true, 2, context.worldMap);
    const wounds = newState.enemiesData[0].wounds;
    assert.equal(wounds.length, 2); assert.ok(wounds[0].woundId); assert.ok(wounds[1].woundId); assert.notEqual(wounds[0].woundId, wounds[1].woundId);
    assert.equal(wounds[0].generatedEffects[0].effectType, 'Debuff');
    assert.deepEqual(buildNextContext(context, processedResponse, newState, [], true).enemiesDataForCurrentTurn[0].wounds, wounds);
    const healed = processAndApplyResponse({ enemiesData: [{ NPCId: null, name: 'Wolf', wounds: [{ woundId: wounds[0].woundId, healingState: { currentState: 'Healed', nextState: null } }] }] }, newState, context.gameSettings, key => key, true, 3, context.worldMap).newState.enemiesData[0].wounds;
    assert.equal(healed.length, 2);
    assert.equal(healed[0].healingState.currentState, 'Healed'); assert.equal(healed[0].healingState.nextState, null);
    assert.equal(healed[1].healingState.currentState, 'Untreated');
    assert.notEqual(healed[0].woundId, healed[1].woundId);
    const unchanged = processAndApplyResponse({ enemiesData: [{ NPCId: null, name: 'Wolf', wounds: [{ woundId: wounds[1].woundId, healingState: { nextState: null } }] }] }, newState, context.gameSettings, key => key, true, 3, context.worldMap).newState.enemiesData[0].wounds;
    assert.equal(unchanged[1].healingState.nextState, 'Stabilized', 'null alone does not clear the next stage');
    const allyState = { ...state, enemiesData: [], alliesData: [enemy] };
    const ally = processAndApplyResponse({ alliesData: [{ ...enemy, wounds: [{ ...wound }] }] }, allyState, context.gameSettings, key => key, true, 2, context.worldMap).newState;
    const allyWound = ally.alliesData[0].wounds[0];
    const healedAlly = processAndApplyResponse({ alliesData: [{ NPCId: null, name: 'Wolf', wounds: [{ woundId: allyWound.woundId, healingState: { currentState: 'Healed' } }] }] }, ally, context.gameSettings, key => key, true, 3, context.worldMap).newState;
    assert.equal(healedAlly.alliesData[0].wounds[0].healingState.nextState, null);
  } finally { await server.close(); }
});

test('named NPC wound and combat effect survive staged combat cleanup', async () => {
  const server = await getTestServer();
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { mergeStageResponses, processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Fight', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    context.currentTurnNumber = 2;
    const player = context.playerCharacter;
    const npc = { ...player, NPCId: 'npc-1', name: 'Guard', inventory: [], wounds: [], activeEffects: [{ effectId: 'poison', effectType: 'Debuff', value: '-10%', targetType: 'strength', duration: 5, description: 'Poison' }] };
    context.encounteredNPCs = [npc];
    const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const effect = { effectId: 'poison', effectType: 'Debuff', value: '-10%', targetType: 'strength', duration: 2, description: 'Poison' };
    const injury = { ...wound('cut', 'Untreated', 'Stabilized'), NPCId: 'npc-1', NPCName: 'Guard', generatedEffects: [{ effectType: 'Debuff', value: '-5%', targetType: 'speed', duration: 3, description: 'Pain' }] };
    const combatant = { NPCId: 'npc-1', name: 'Guard', isGroup: false, currentHealth: '80%', maxHealth: `${npc.maxHealth}%`, activeDebuffs: [effect], actions: [] };
    const prior = { alliesData: [combatant], NPCWoundChanges: [injury] };
    const result = mergeStageResponses(prior, { enemiesData: [], alliesData: [] }, context);
    const applied = processAndApplyResponse(result, state, context.gameSettings, key => key, true, 2, context.worldMap);
    const saved = applied.newState.encounteredNPCs[0];
    assert.equal(saved.wounds[0].woundId, 'cut');
    assert.deepEqual(saved.wounds[0].generatedEffects, injury.generatedEffects);
    assert.deepEqual(saved.activeEffects, [effect]);
    const next = buildNextContext(context, applied.processedResponse, applied.newState, [], true);
    assert.deepEqual(next.encounteredNPCs[0].activeEffects, [effect]);
    assert.deepEqual(next.alliesDataForCurrentTurn, []);
    const later = processAndApplyResponse({}, applied.newState, context.gameSettings, key => key, true, 3, context.worldMap).newState;
    assert.equal(later.encounteredNPCs[0].activeEffects[0].duration, 1);
    assert.equal(later.encounteredNPCs[0].wounds[0].woundId, 'cut');
    const removed = mergeStageResponses(prior, { alliesData: [], NPCEffectChanges: [{ NPCId: 'npc-1', NPCName: 'Guard', effectsToRemove: ['poison'] }] }, context);
    assert.equal(processAndApplyResponse(removed, state, context.gameSettings, key => key, true, 2, context.worldMap).newState.encounteredNPCs[0].activeEffects.length, 0);
    const explicit = mergeStageResponses(prior, { alliesData: [], NPCEffectChanges: [{ NPCId: 'npc-1', NPCName: 'Guard', effectsApplied: [{ ...effect, duration: 4 }] }] }, context);
    assert.equal(processAndApplyResponse(explicit, state, context.gameSettings, key => key, true, 2, context.worldMap).newState.encounteredNPCs[0].activeEffects[0].duration, 4);
    const unsafe = mergeStageResponses({ alliesData: [{ ...combatant, activeDebuffs: [{ ...effect, effectId: undefined }, { ...effect, effectId: 'pain', sourceWoundId: 'cut' }, { ...effect, effectId: 'expired', duration: 0 }, effect, effect] }] }, { alliesData: [] }, context);
    assert.equal(unsafe.NPCEffectChanges, undefined, 'missing IDs, wound-linked, expired and ambiguous effects are not copied');
    const expired = mergeStageResponses({ alliesData: [{ ...combatant, activeDebuffs: [{ ...effect, duration: 0 }] }], NPCWoundChanges: [injury] }, { alliesData: [] }, context);
    const expiredState = processAndApplyResponse(expired, state, context.gameSettings, key => key, true, 2, context.worldMap).newState;
    assert.equal(expiredState.encounteredNPCs[0].activeEffects.length, 0, 'an explicitly expired combat effect must not survive in NPC state');
    assert.deepEqual(expiredState.encounteredNPCs[0].wounds[0].generatedEffects, injury.generatedEffects, 'ordinary effect removal must not alter wound-linked effects');
    const explicitRenewal = mergeStageResponses({ alliesData: [{ ...combatant, activeDebuffs: [{ ...effect, duration: 0 }] }] }, { alliesData: [], NPCEffectChanges: [{ NPCId: 'npc-1', NPCName: 'Guard', effectsApplied: [{ ...effect, duration: 4 }] }] }, context);
    assert.equal(processAndApplyResponse(explicitRenewal, state, context.gameSettings, key => key, true, 2, context.worldMap).newState.encounteredNPCs[0].activeEffects[0].duration, 4);
    const absent = mergeStageResponses({ alliesData: [{ ...combatant, activeDebuffs: [] }] }, { alliesData: [] }, context);
    assert.equal(processAndApplyResponse(absent, state, context.gameSettings, key => key, true, 2, context.worldMap).newState.encounteredNPCs[0].activeEffects[0].duration, 4, 'absence alone does not remove the effect');
    const linkedContext = { ...context, encounteredNPCs: [{ ...npc, activeEffects: [{ ...effect, sourceWoundId: 'cut' }] }] };
    const linked = mergeStageResponses({ alliesData: [{ ...combatant, activeDebuffs: [{ ...effect, duration: 0, sourceWoundId: 'cut' }] }] }, { alliesData: [] }, linkedContext);
    assert.equal(linked.NPCEffectChanges, undefined);
    assert.equal(prior.alliesData[0].activeDebuffs[0].duration, 2);
  } finally { await server.close(); }
});

test('cleanup without a stage combat result does not guess NPC effects from pre-turn state', async () => {
  const server = await getTestServer();
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { mergeStageResponses } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'End combat', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const npc = { ...context.playerCharacter, NPCId: 'npc-1', name: 'Guard', activeEffects: [] };
    context.encounteredNPCs = [npc];
    context.alliesDataForCurrentTurn = [{ NPCId: 'npc-1', name: 'Guard', activeDebuffs: [{ effectId: 'poison', effectType: 'Debuff', targetType: 'strength', value: '-10%', duration: 1, description: 'Poison' }] }];
    const result = mergeStageResponses({}, { alliesData: [], enemiesData: [] }, context);
    assert.equal(result.NPCEffectChanges, undefined);
    assert.deepEqual(result.alliesData, []);
  } finally { await server.close(); }
});

test('healing a wound removes only explicitly linked effects from its owner', async () => {
  const server = await getTestServer();
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Heal', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const effect = (id, sourceWoundId) => ({ effectId: id, sourceWoundId, effectType: 'Debuff', value: '-10%', targetType: 'strength', duration: 999, description: id });
    const w1 = { ...wound('w1', 'Untreated', 'Stabilized'), generatedEffects: [effect('embedded', 'w1')] }, w2 = wound('w2', 'Untreated', 'Stabilized');
    const effects = [effect('bound', 'w1'), effect('other', 'w2'), effect('independent', undefined)];
    const player = { ...context.playerCharacter, playerWounds: [w1, w2], activePlayerEffects: effects };
    const npc = { ...context.playerCharacter, NPCId: 'npc-1', name: 'Guard', inventory: [], wounds: [w1, w2], activeEffects: effects };
    const enemy = { NPCId: null, name: 'Wolf', isGroup: false, maxHealth: '100%', currentHealth: '60%', actions: [], wounds: [w1, w2], activeDebuffs: effects };
    const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [enemy], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const response = { playerWoundChanges: [{ woundId: 'w1', healingState: { currentState: 'Healed' } }], NPCWoundChanges: [{ NPCId: 'npc-1', NPCName: 'Guard', woundId: 'w1', healingState: { currentState: 'Healed' } }], enemiesData: [{ NPCId: null, name: 'Wolf', wounds: [{ woundId: 'w1', healingState: { currentState: 'Healed' } }] }] };
    const saved = processAndApplyResponse(response, state, context.gameSettings, key => key, true, 3, context.worldMap).newState;
    for (const [actor, list, wounds] of [[saved.playerCharacter, saved.playerCharacter.activePlayerEffects, saved.playerCharacter.playerWounds], [saved.encounteredNPCs[0], saved.encounteredNPCs[0].activeEffects, saved.encounteredNPCs[0].wounds], [saved.enemiesData[0], saved.enemiesData[0].activeDebuffs, saved.enemiesData[0].wounds]]) {
      assert.deepEqual(list.map(e => e.effectId), ['other', 'independent']);
      assert.equal(wounds.find(w => w.woundId === 'w1').healingState.currentState, 'Healed');
      assert.deepEqual(wounds.find(w => w.woundId === 'w1').generatedEffects, w1.generatedEffects);
      assert.equal(wounds.find(w => w.woundId === 'w2').healingState.currentState, 'Untreated');
    }
    const noHeal = processAndApplyResponse({ playerWoundChanges: [{ woundId: 'w1', healingState: { nextState: null } }] }, state, context.gameSettings, key => key, true, 3, context.worldMap).newState;
    assert.equal(noHeal.playerCharacter.activePlayerEffects.length, 3);
  } finally { await server.close(); }
});

test('ambiguous or conflicting NPC targets do not apply wound or effect updates to a namesake', async () => {
  const server = await getTestServer();
  try {
    const { createInitialContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const context = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Heal', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    const player = context.playerCharacter;
    const makeNpc = id => ({ ...player, NPCId: id, name: 'Guard', inventory: [], wounds: [wound('w1', 'Untreated')], activeEffects: [] });
    const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [makeNpc('n1'), makeNpc('n2')], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const change = (id) => ({ NPCWoundChanges: [{ NPCId: id, NPCName: 'Guard', woundId: 'w1', healingState: { currentState: 'Healed' } }], NPCEffectChanges: [{ NPCId: id, NPCName: 'Guard', effectsApplied: [{ effectId: 'e1', effectType: 'Debuff', value: '-10%', targetType: 'strength', duration: 3, description: 'poison' }] }] });
    for (const id of [null, 'unknown-id']) {
      const result = processAndApplyResponse(change(id), state, context.gameSettings, key => key, true, 2, context.worldMap).newState;
      assert.ok(result.encounteredNPCs.every(n => n.wounds[0].healingState.currentState === 'Untreated' && n.activeEffects.length === 0));
    }
    const valid = processAndApplyResponse(change('n2'), state, context.gameSettings, key => key, true, 2, context.worldMap).newState;
    assert.equal(valid.encounteredNPCs[0].wounds[0].healingState.currentState, 'Untreated');
    assert.equal(valid.encounteredNPCs[1].wounds[0].healingState.currentState, 'Healed');
    assert.equal(valid.encounteredNPCs[1].activeEffects[0].effectId, 'e1');
  } finally { await server.close(); }
});

test('fresh unambiguous nameless-ID combat effect is assigned an ID before cleanup', async () => {
  const server = await getTestServer();
  try {
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { mergeStageResponses, processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const ctx = createInitialContext({ universe: 'fantasy', playerName: 'Test', race: 'Human', charClass: 'Warrior', initialPrompt: 'Fight', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
    ctx.currentTurnNumber = 2;
    const player = ctx.playerCharacter;
    const npc = { ...player, NPCId: 'npc', name: 'Guard', activeEffects: [], inventory: [] };
    ctx.encounteredNPCs = [npc];
    const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: ctx.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
    const poison = { effectType: 'Debuff', value: '-10%', targetType: 'strength', duration: 3, description: 'Venom' };
    const actor = { NPCId: 'npc', name: 'Guard', isGroup: false, activeDebuffs: [poison] };
    const merged = mergeStageResponses({ enemiesData: [actor] }, { enemiesData: [] }, ctx);
    const generated = merged.NPCEffectChanges?.[0].effectsApplied[0];
    assert.ok(generated?.effectId);
    const applied = processAndApplyResponse(merged, state, ctx.gameSettings, k => k, true, 2, ctx.worldMap);
    const next = buildNextContext(ctx, applied.processedResponse, applied.newState, [], true);
    assert.equal(next.encounteredNPCs[0].activeEffects[0].effectId, generated.effectId);
    assert.equal(next.encounteredNPCs[0].activeEffects[0].duration, 3);
    const prior = structuredClone(ctx); prior.encounteredNPCs[0].activeEffects = [{ ...poison, effectId: 'existing' }];
    assert.equal(mergeStageResponses({ enemiesData: [actor] }, { enemiesData: [] }, prior).NPCEffectChanges, undefined, 'do not duplicate a matching stored effect');
    assert.equal(mergeStageResponses({ enemiesData: [{ ...actor, activeDebuffs: [poison, { ...poison }] }] }, { enemiesData: [] }, ctx).NPCEffectChanges, undefined, 'indistinguishable effects remain unresolved');
    assert.equal(mergeStageResponses({ enemiesData: [{ ...actor, activeDebuffs: [{ ...poison, sourceWoundId: 'w1' }] }] }, { enemiesData: [] }, ctx).NPCEffectChanges, undefined, 'do not duplicate a wound-linked effect');
    assert.equal(poison.effectId, undefined, 'original stage response is not mutated');
  } finally { await server.close(); }
});

after(async () => { await closeTestServer(); });
