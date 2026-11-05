import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

// This is an oracle and transport/application regression, NOT an autonomous GM.
// Replies are synthesized from fixed fixture expectations and cannot establish
// whether a real model would use the rules or choose actions correctly.
test('fixed combat cases retain full calculation rules and apply the recorded outcomes', async () => {
  const cases = JSON.parse(await readFile(new URL('./fixtures/combat-calculation-cases.json', import.meta.url), 'utf8'));
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window, storage = new Map(), packets = [];
  let current;
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0), clearTimeout, sessionStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) } };
  globalThis.fetch = async (url, init) => {
    if (url === '/__arena_gm/rules') return new Response('{}', { status: 503 });
    if (url === '/__arena_gm/turn') { packets.push(JSON.parse(init.body)); return new Response('{}'); }
    if (String(url).startsWith('/__arena_gm/response')) {
      const packet = packets.at(-1);
      const wound = current.wound && { NPCId: 'npc-combat', NPCName: 'Guard', woundId: `wound-${current.id}`, woundName: 'Test injury', severity: current.wound, descriptionOfEffects: 'Test wound', generatedEffects: [{ effectId: `wound-effect-${current.id}`, effectType: 'Debuff', value: '-10%', targetType: 'strength_checks', duration: 3, description: 'Test wound effect' }], healingState: { currentState: 'Untreated', treatmentProgress: 0, progressNeeded: 20, nextState: 'Stabilized', canBeImprovedBy: [] } };
      const output = packet.stepName === 'Step3_Logs_CombatAnalysis_TaskGuide'
        ? { items_and_stat_calculations: [`Synthetic oracle ${current.id}: ${current.expectedResult}, damage ${current.expectedDamage}, NPC health ${current.expectedHealth}.`] }
        : { enemiesData: [{ NPCId: 'npc-combat', name: 'Guard', isGroup: false, maxHealth: '100%', currentHealth: `${current.expectedHealth}%`, actions: [] }], ...(wound ? { NPCWoundChanges: [wound] } : {}) };
      return Response.json({ kind: 'arena-gm-step-response', protocolVersion: 1, correlationId: packet.correlationId, output });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const { executeStepWithCorrection } = await server.ssrLoadModule('/utils/gemini.ts');
    const { createInitialContext, buildNextContext } = await server.ssrLoadModule('/utils/gameContext.ts');
    const { processAndApplyResponse } = await server.ssrLoadModule('/utils/responseProcessor.ts');
    const { getStep3Logs, getStep3 } = await import('../prompts/mainPromptSteps.js');
    assert.match(getStep3(), /14\.2\.2.*Luck bonus/s);
    const rules = await readFile(new URL('../prompts/mainPromptModule.js', import.meta.url), 'utf8');
    assert.match(rules, /FinalCritMultiplier = 1\.5 \+ \(CritDamageLuckBonus% \/ 100\)/);
    assert.match(rules, /Threshold 1 \(>25% of maxHealth\)/);
    assert.match(rules, /Threshold 2 \(>45% of maxHealth\)/);
    for (const fixture of cases) {
      current = fixture;
      const [roll, gmRoll] = fixture.rolls, critThreshold = 20 - Math.floor(fixture.luck / 20);
      const result = roll >= critThreshold ? 'Critical Success' : (() => { const difference = roll + fixture.statModifier - gmRoll - fixture.difficultyModifier; return difference >= 10 ? 'Critical Success' : difference >= 5 ? 'Full Success' : 'Other'; })();
      assert.equal(result, fixture.expectedResult, fixture.id);
      const base = fixture.weaponDamage + 5 + Math.floor(4 / 2.5);
      const crit = result === 'Critical Success' ? 1.5 + Math.floor(fixture.luck / 2) / 100 : 1;
      const damage = Math.round(base * crit * (1 - fixture.resistance / 100));
      assert.equal(damage, fixture.expectedDamage, fixture.id);
      assert.equal(100 - damage, fixture.expectedHealth, fixture.id);
      const woundSeverity = damage > 45 ? 'Moderate' : damage > 25 || result === 'Critical Success' ? 'Light' : null;
      assert.equal(woundSeverity, fixture.wound, fixture.id);
      const context = createInitialContext({ universe: 'fantasy', playerName: 'Mira', race: 'Human', charClass: 'Warrior', initialPrompt: 'Attack', startingYear: 1000, startingMonth: 'January', startingDay: 1, startTime: '08:00', weather: 'Clear' }, 'en');
      context.currentTurnNumber = 2; context.preGeneratedDices1d20 = fixture.rolls;
      const player = context.playerCharacter;
      const npc = { ...player, NPCId: 'npc-combat', name: 'Guard', maxHealth: 100, currentHealth: 100, wounds: [], characteristics: { ...player.characteristics, modifiedConstitution: 0 } };
      context.encounteredNPCs = [npc];
      context.enemiesDataForCurrentTurn = [{ NPCId: 'npc-combat', name: 'Guard', isGroup: false, maxHealth: '100%', currentHealth: '100%', actions: [] }];
      const partial = { items_and_stat_calculations: ['Player attacks Guard.'], _internal_flags_: { isCombatActive: true } };
      const logs = await executeStepWithCorrection('Step3_Logs_CombatAnalysis_TaskGuide', getStep3Logs, context, partial, new AbortController().signal, () => {}, () => {}, () => {});
      const logPacket = packets.at(-1);
      assert.equal(logPacket.ruleBundleId, undefined); assert.ok(logPacket.prompt.length > 2_000_000);
      const audit = await executeStepWithCorrection('Step3_Combat_TaskGuide', getStep3, context, logs.response, new AbortController().signal, () => {}, () => {}, () => {});
      const auditContext = JSON.parse(packets.at(-1).prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
      assert.ok(JSON.parse(auditContext.partiallyGeneratedResponse).items_and_stat_calculations.some(line => line.includes(`Synthetic oracle ${fixture.id}`)));
      const state = { playerCharacter: player, players: [player], activePlayerIndex: 0, currentLocationData: context.currentLocation, activeQuests: [], completedQuests: [], encounteredNPCs: [npc], encounteredFactions: [], enemiesData: [], alliesData: [], playerCustomStates: [], plotOutline: null, worldStateFlags: [], worldEventsLog: [], imageCache: {}, networkRole: 'none', myPeerId: null, peers: [], isConnectedToHost: true };
      const { newState, processedResponse } = processAndApplyResponse(audit.response, state, context.gameSettings, key => key, true, 2, context.worldMap);
      assert.equal(newState.encounteredNPCs[0].currentHealth, fixture.expectedHealth, fixture.id);
      assert.equal(newState.encounteredNPCs[0].wounds.length, fixture.wound ? 1 : 0, fixture.id);
      if (fixture.wound) {
        assert.equal(newState.encounteredNPCs[0].wounds[0].severity, fixture.wound);
        assert.equal(newState.encounteredNPCs[0].wounds[0].generatedEffects[0].effectId, `wound-effect-${fixture.id}`);
      }
      const next = buildNextContext(context, processedResponse, newState, [], true);
      assert.equal(next.encounteredNPCs[0].currentHealth, fixture.expectedHealth);
      assert.equal(next.encounteredNPCs[0].wounds.length, fixture.wound ? 1 : 0);
    }
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    await server.close();
  }
});
