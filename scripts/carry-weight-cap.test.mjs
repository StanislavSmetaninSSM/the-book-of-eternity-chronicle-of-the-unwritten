import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_CRITICAL_EXCESS_WEIGHT,
  canCarryWeight,
  criticalCarryWeight,
  isEncumbered,
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

});

test('being overloaded is the load passing the threshold, and nothing else', () => {
  assert.equal(isEncumbered(50, 50), false, 'the threshold itself is still bearable');
  assert.equal(isEncumbered(50, 50.5), true);
  assert.equal(isEncumbered(50, undefined), false);
  // No capacity stated is no load declared too heavy: an absent number must not become a
  // condition with consequences attached to it.
  assert.equal(isEncumbered(undefined, 500), false);
});

test('the flag follows the weight and the capacity, so it cannot go stale', async () => {
  const [weights, stats] = await Promise.all([
    read('../utils/inventoryManager.ts'),
    read('../utils/gameContext.ts'),
  ]);
  for (const [name, source] of [['the weight pass', weights], ['the capacity pass', stats]]) {
    assert.match(source, /isOverloaded = isEncumbered\(newPc\.maxWeight, newPc\.totalWeight\)/, `${name} must publish the flag`);
  }
  const [loader, transfers, restore, party, tracker] = await Promise.all([
    read('../hooks/useGameLogic.ts'),
    read('../hooks/logic/inventoryActions.ts'),
    read('../utils/restorePlayer.ts'),
    read('../components/CharacterSheet/Header.tsx'),
    read('../components/CombatTracker.tsx'),
  ]);
  for (const [name, source] of [['the loader', loader], ['the transfers', transfers], ['the restore', restore]]) {
    assert.doesNotMatch(source, /isOverloaded = /, `${name} must not compare the two numbers itself`);
  }
  for (const [name, source] of [['the character sheet', party], ['the combat tracker', tracker]]) {
    assert.match(source, /isEncumbered\(/, `${name} must read the state through the same helper`);
  }
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
  assert.doesNotMatch(await read('../utils/carryWeight.js'), /maxCarryWeight\(/, 'the ceiling module does not own the capacity formula');
  for (const [name, source] of [['character creation', creation], ['restoring a character', restore], ['loading a save', loader]]) {
    assert.match(source, /DEFAULT_CRITICAL_EXCESS_WEIGHT/, `${name} must default the constant from one place`);
    assert.doesNotMatch(source, /criticalExcessWeight[:=] 15/, `${name} must not restate the constant`);
  }
});
