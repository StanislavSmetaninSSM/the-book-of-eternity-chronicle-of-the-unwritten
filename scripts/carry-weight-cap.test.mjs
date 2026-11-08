import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARRY_CAPACITY_BASE_WEIGHT,
  DEFAULT_CRITICAL_EXCESS_WEIGHT,
  canCarryWeight,
  criticalCarryWeight,
  maxCarryWeight,
} from '../utils/carryWeight.js';
import { getGameMasterGuideRules } from '../prompts/mainPromptModule.js';

// The game master rules an acquisition in; the interface gates the transfers it decides alone
// (stash, container, giving to a companion). Both apply one ceiling, and the ceiling is the
// number the character sheet shows, so neither side may invent its own constant or rounding.

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('the ceiling of a load is the threshold plus the extra capacity, boundary included', () => {
  assert.equal(DEFAULT_CRITICAL_EXCESS_WEIGHT, 15);
  assert.equal(criticalCarryWeight(50, 15), 65);
  // A character whose record never got the field is carried by the universal constant.
  assert.equal(criticalCarryWeight(50, undefined), 65);
  assert.equal(criticalCarryWeight(undefined, 15), 15);
  assert.equal(criticalCarryWeight(50, NaN), 65);

  assert.equal(canCarryWeight(50, 15, 55), true);
  assert.equal(canCarryWeight(50, 15, 65), true, 'the ceiling itself is still carried');
  assert.equal(canCarryWeight(50, 15, 65.5), false);
  assert.equal(canCarryWeight(50, 15, undefined), true);
});

test('capacity is base weight plus one rounded term of strength and constitution', () => {
  assert.equal(CARRY_CAPACITY_BASE_WEIGHT, 30);
  assert.equal(maxCarryWeight(10, 10), 52);
  // The rule rounds the two contributions once, together: 11 * 1.8 + 6 * 0.4 = 22.2 -> 22.
  // Rounding each term apart would claim 19 + 2 and lose a kilo the character does have.
  assert.equal(maxCarryWeight(11, 6), 52);
  assert.equal(maxCarryWeight(undefined, undefined), 32, 'a missing characteristic counts as 1');
});

test('the rulebook states the same ceiling for a player and for a companion', () => {
  const rules = getGameMasterGuideRules();
  const ruleBlock = id => {
    const start = rules.indexOf(`<Rule id="${id}">`);
    assert.notEqual(start, -1, `Rule #${id} must be in the guide`);
    return rules.slice(start, rules.indexOf('</Rule>', start));
  };

  const playerCheck = ruleBlock('10.1.0.1');
  assert.match(playerCheck, /CriticalCarryWeight = MaxCarryWeight_Overload \+ Value of 'criticalExcessWeight' from Context/);
  assert.match(playerCheck, /CanCarry = \(CriticalCarryWeight >= TotalProspectiveWeight\)/);
  assert.match(playerCheck, /the universal value is 15 kg/i);
  // No second number for a constant that has one value, and no example that contradicts it.
  assert.doesNotMatch(playerCheck, /typically 10 or 15/);
  assert.doesNotMatch(playerCheck, /criticalExcessWeight: 10kg/);
  // The worked example is arithmetically consistent with the shared helper.
  assert.match(playerCheck, /- CriticalCarryWeight = 30kg \+ 15kg = 45kg/);
  assert.equal(canCarryWeight(30, DEFAULT_CRITICAL_EXCESS_WEIGHT, 28 + 2 + 5), true);
  assert.equal(criticalCarryWeight(30, DEFAULT_CRITICAL_EXCESS_WEIGHT), 45);

  const companionCheck = ruleBlock('19.C.1');
  assert.match(companionCheck, /criticalWeight_NPC = maxWeight_NPC \+ criticalExcessWeight/);
  assert.match(companionCheck, /15 kg/);
  assert.equal(criticalCarryWeight(50, DEFAULT_CRITICAL_EXCESS_WEIGHT), 65);
  assert.equal(canCarryWeight(50, DEFAULT_CRITICAL_EXCESS_WEIGHT, 40 + 15), true);

  assert.match(rules, /MaxWeight_kg = 30 \+ floor\(PermanentlyModifiedStrength \* 1\.8 \+ PermanentlyModifiedConstitution \* 0\.4\)/);
});

test('every gate asks the shared helper instead of adding the constant itself', async () => {
  const gates = [
    '../hooks/logic/playerActions.ts',
    '../hooks/logic/inventoryActions.ts',
    '../components/StashView.tsx',
    '../components/CharacterSheet/Header.tsx',
  ];
  for (const path of gates) {
    const source = await read(path);
    assert.match(source, /canCarryWeight\(|criticalCarryWeight\(/, `${path} must apply the shared ceiling`);
    assert.doesNotMatch(source, /criticalExcessWeight[^)]*\|\|\s*15/, `${path} must not restate the constant`);
  }

  const [weightMath, creation, restore, loader] = await Promise.all([
    read('../utils/gameContext.ts'),
    read('../utils/characterManager.ts'),
    read('../utils/restorePlayer.ts'),
    read('../hooks/useGameLogic.ts'),
  ]);
  assert.match(weightMath, /newPc\.maxWeight = maxCarryWeight\(pmStr, pmCon\);/);
  assert.match(creation, /const maxWeight = maxCarryWeight\(stdStr, stdCon\);/);
  for (const [name, source] of [['character creation', creation], ['restoring a character', restore], ['loading a save', loader]]) {
    assert.match(source, /DEFAULT_CRITICAL_EXCESS_WEIGHT/, `${name} must default the constant from one place`);
    assert.doesNotMatch(source, /criticalExcessWeight[:=] 15/, `${name} must not restate the constant`);
  }
  assert.match(weightMath, /maxHealth = 100 \+ Math\.floor\(pmCon \* 2\.0\)/, 'capacity alone is rounded jointly; health keeps its terms apart');
});
