import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getGameMasterGuideRules } from '../prompts/mainPromptModule.js';
import { withGameContext } from '../utils/relayPromptContext.js';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const branch = (guide, condition) => {
  const opening = `<ConditionalInstruction when="${condition}">\n`;
  assert(guide.includes(opening));
  return guide.split(opening)[1].split('\n    </ConditionalInstruction>')[0];
};

test('the entire guide is invariant across different turn contexts', () => {
  const guide = getGameMasterGuideRules();
  assert.equal(guide, getGameMasterGuideRules({ message: 'UNIQUE-PLAYER-MESSAGE', currentTurnNumber: 17, gameSettings: { doNotUseWorldEvents: true } }));
  assert.equal(guide, getGameMasterGuideRules({ message: 'ANOTHER-MESSAGE', isRegenerationAttempt: true, regenerationReason: 'UNIQUE-RETRY', gameSettings: { doNotUseWorldEvents: false } }));
  assert(!guide.includes('UNIQUE-PLAYER-MESSAGE'));
  assert(!guide.includes('UNIQUE-RETRY'));
  assert.match(guide, /\{\{context\.message\}\}/);
  assert.match(guide, /\{\{context\.partiallyGeneratedResponse\}\}/);
  assert.match(guide, /\{\{context\.regenerationReason\}\}/);
  // Intentional guide edits require an explicit snapshot update and review.
  // Updated for the explicit inventory-transfer protocol.
  assert.equal(sha256(guide), 'ac7790bcd5a44540f3bd9cf3e11c5e4d44d177247a337a5aab1f9eb5fbc74d46');
  assert.match(guide, /saved history.*separated from active wounds/);
  assert.match(guide, /a WoundReference is not required/);
  assert.match(guide, /Apply each wound-generated effect once only/);
  assert.match(guide, /NPCWoundChanges' as one flat object per wound/);
  const currentHealthRule = guide.split('<Rule id="14.1.2">')[1].split('</Rule>')[0];
  assert.match(currentHealthRule, /Preserve their existing 'currentHealth' from 'encounteredNPCs'/);
  assert.match(currentHealthRule, /only when no prior current health exists/);
  assert.doesNotMatch(currentHealthRule, /Initialized to 'maxHealth%'/);
  assert.doesNotMatch(guide, /NPCWoundChanges' array \(\{ \"NPCId\": \"guid\", \"wounds\"/);
});

test('both original world-event branches survive intact under explicit conditions', () => {
  const guide = getGameMasterGuideRules();
  const disabled = branch(guide, 'context.gameSettings.doNotUseWorldEvents is true: apply ONLY this disabled branch; ignore the enabled branch below');
  const enabled = branch(guide, 'context.gameSettings.doNotUseWorldEvents is false or absent: apply ONLY this enabled branch');
  // The enabled branch includes intentionally updated threat-completion examples.
  assert.equal(sha256(disabled), 'd67b66b0f5af9e6d6541c398fad71ee561b71e6efe6e7e0b1f2f47066167ad20');
  assert.equal(sha256(enabled), 'd3893fa46fea0437bb12de27f183857de4edff2cc7385c411c2aefe17a01ef61');
  assert.match(guide, /ConditionalInstruction when="context\.isRegenerationAttempt is true"/);
});

test('context document retains values and stage metadata without leaking the API key', () => {
  const context = {
    message: 'Действие «тест»\nстрока', superInstructions: 'Играть осторожно', currentTurnNumber: 7,
    gameSettings: { language: 'ru', doNotUseWorldEvents: true, youtubeApiKey: 'SECRET_KEY', multiplePersonalitiesSettings: { shareInventory: false } },
    playerCharacter: { name: 'Мира', characteristics: { standardStrength: 4 }, inventory: [{ name: 'ключ' }], stealthState: { isActive: false, detectionLevel: 0 } },
    players: [{ name: 'Мира' }], currentLocation: { name: 'дом' }, visitedLocations: [],
    activeQuests: [{ name: 'Поиск' }], completedQuests: [], encounteredNPCs: [{ name: 'Ива' }], npcSkillMasteryData: [],
    lootForCurrentTurn: [], preGeneratedDices1d20: [1, 20], worldState: { day: 1, currentTimeInMinutes: 0, date: { timeOfDay: '00:00' } }, worldStateFlags: [],
    previousTurnResponse: null, encounteredFactions: [], plotOutline: null, worldMap: {}, responseHistory: [{ sender: 'player', content: 'раньше' }],
    currentStepFocus: 'Step2_CoreState_TaskGuide', partiallyGeneratedResponse: '{"_internal_flags_":{"isCombatActive":false}}',
    enemiesDataForCurrentTurn: [], alliesDataForCurrentTurn: [], playerCustomStates: [], worldEventsLog: [],
    isRegenerationAttempt: true, regenerationReason: 'Ошибка', image: { mimeType: 'image/png', data: 'aW1hZ2U=' },
  };
  const prompt = withGameContext(getGameMasterGuideRules(), context);
  assert(!prompt.includes('SECRET_KEY'));
  const parsed = JSON.parse(prompt.split('\n\n<CurrentGameContext>\n').at(-1).split('\n</CurrentGameContext>')[0]);
  const { youtubeApiKey: _, ...safeSettings } = context.gameSettings;
  assert.deepEqual(parsed, { ...context, gameSettings: safeSettings });
  assert.match(prompt, /<ContextDocumentDescription>/);
});

test('all original field substitutions remain in order with their original fallbacks', () => {
  const guide = getGameMasterGuideRules();
  const references = [...guide.matchAll(/\{\{context\.([^}]+)\}\}/g)]
    .map(match => match[1])
    .filter(name => name !== 'field' && name !== 'regenerationReason');
  // Golden digest derived from the 106 value expressions in the pre-separation guide,
  // normalized by unwrapping JSON.stringify and converting optional chains to paths.
  assert.equal(references.length, 106);
  assert.equal(sha256(JSON.stringify(references)), '3a2fb61e306a9eb3b483eeb31594cd54cdeef7413448f9070f54f74f5e7440ff');
  assert.match(guide, /\{\{context\.regenerationReason\}\}/);
});

test('context document preserves the old substitutions and fallback values', async () => {
  const { readFile } = await import('node:fs/promises');
  const original = JSON.parse(await readFile(new URL('./fixtures/legacy-context-expressions.json', import.meta.url), 'utf8'));
  const refs = [...getGameMasterGuideRules().matchAll(/\{\{context\.([^}]+)\}\}/g)]
    .map(m => m[1]).filter(name => name !== 'field' && name !== 'regenerationReason');
  assert.equal(original.length, refs.length);
  const populated = {
    message: '«Действие»', superInstructions: 'Условие', currentTurnNumber: 3,
    worldState: { day: 2, currentTimeInMinutes: 0, weather: 'Дождь', lastWorldProgressionTimeInMinutes: 0, lastFactionProgressionTimeInMinutes: 50, date: { currentYear: 900, currentMonthName: 'Май', dayOfMonth: 4, timeOfDay: '09:00' } },
    worldStateFlags: [{ flagId: 'f', value: false }], gameSettings: { language: 'ru', nonMagicMode: false, gameWorldInformation: { name: 'Мир' }, hardMode: false, impossibleMode: true, cooperativeGameType: 'FullParty', multiplePersonalitiesSettings: { shareCharacteristics: false, shareSkills: true, shareNpcReputation: false, shareFactionReputation: true, shareInventory: false }, allowHistoryManipulation: false, youtubeApiKey: 'SECRET' },
    players: [{ name: 'Мира' }], playerCharacter: { name: 'Мира', race: 'Человек', class: 'Маг', age: 0, appearanceDescription: 'Тест', image_prompt: 'portrait', raceDescription: 'r', classDescription: 'c', level: 1, levelOnPreviousTurn: 1, experience: 0, experienceForNextLevel: 100, money: 0, currentHealth: 1, maxHealth: 10, currentEnergy: 0, maxEnergy: 20, maxWeight: 12, totalWeight: 0, criticalExcessWeight: 0, critChanceBuffFromLuck: 0, critChanceThreshold: 20, characteristics: {}, activeSkills: [], passiveSkills: [], skillMasteryData: [], knownRecipes: [], inventory: [{ name: 'ключ' }], equippedItems: {}, activePlayerEffects: [], playerWounds: [], autoCombatSkill: null, stealthState: { isActive: false, detectionLevel: 0, description: '' }, effortTracker: { lastUsedCharacteristic: null, consecutivePartialSuccesses: 0 }, characterChronicle: [] },
    currentLocation: { name: 'Дом' }, activeQuests: [], completedQuests: [], encounteredNPCs: [], npcSkillMasteryData: [], lootForCurrentTurn: [], preGeneratedDices1d20: [1, 20], previousTurnResponse: null, encounteredFactions: [], plotOutline: null, worldMap: {}, responseHistory: [{ content: 'Привет' }], enemiesDataForCurrentTurn: [], alliesDataForCurrentTurn: [], playerCustomStates: [], worldEventsLog: [], currentStepFocus: 'Step2', partiallyGeneratedResponse: '{"a":1}',
  };
  for (const suffix of ['Strength','Dexterity','Constitution','Intelligence','Wisdom','Faith','Attractiveness','Trade','Persuasion','Perception','Luck','Speed']) {
    populated.playerCharacter.characteristics[`standard${suffix}`] = 1;
    populated.playerCharacter.characteristics[`modified${suffix}`] = 2;
  }
  const optionalMissing = structuredClone(populated);
  delete optionalMissing.gameSettings.multiplePersonalitiesSettings;
  delete optionalMissing.playerCharacter.effortTracker;
  delete optionalMissing.worldState.date;
  const cases = [populated, optionalMissing];
  for (const input of cases) {
    const packet = withGameContext('', input);
    const ctx = JSON.parse(packet.split('\n\n<CurrentGameContext>\n')[1].split('\n</CurrentGameContext>')[0]);
    assert.equal(ctx.gameSettings.youtubeApiKey, undefined);
    for (let i = 0; i < refs.length; i++) {
      const expression = original[i];
      // These are trusted, version-controlled legacy source expressions, not player input.
      const evaluateOld = Function('context', `with (context) { return (${expression}); }`);
      const raw = evaluateOld(input);
      const oldValue = expression.startsWith('JSON.stringify(') && raw !== undefined ? JSON.parse(raw) : raw;
      const [path, fallback] = refs[i].split(/\s+(?:\|\||\?\?)\s+/);
      let value = path.split('.').reduce((item, key) => item?.[key], ctx);
      if (fallback !== undefined && (refs[i].includes(' ?? ') ? value == null : !value)) {
        value = fallback === 'false' ? false : fallback === 'null' ? null : fallback === '0' ? 0 : fallback.slice(1, -1);
      }
      assert.deepEqual(value, oldValue, `${expression} -> ${refs[i]}`);
    }
  }
});

test('explicit transfer protocol is available in the inventory stage and supersedes legacy transfer examples', async () => {
  const { getStep0, getStep4, getStep5 } = await import('../prompts/mainPromptSteps.js');
  assert.match(getGameMasterGuideRules(), /InventoryTransferProtocol priority="overrides older transfer examples and directions"/);
  assert.match(getGameMasterGuideRules(), /client does not enforce those narrative rules/);
  assert.match(getStep0(), /For every player\/NPC item transfer this MUST be true/);
  assert.match(getStep4(), /Step 5 exclusively emits inventoryTransfers/);
  assert.match(getStep5(), /<Key>inventoryTransfers<\/Key>/);
  assert.match(getStep5(), /Do not output any legacy inventory/);
  assert.match(getGameMasterGuideRules(), /client rejects the entire turn, including all other transfers/);
});
