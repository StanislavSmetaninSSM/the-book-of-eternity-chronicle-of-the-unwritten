import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BASE_EXPERIENCE,
  BASE_HEALTH_PERCENT,
  CARRY_CAPACITY_BASE_WEIGHT,
  EXPERIENCE_LEVEL_EXPONENT,
  critChanceBuffFromLuck,
  criticalHitThreshold,
  experienceFormulaLabel,
  experienceForLevelTransition,
  maxCarryWeight,
  maxEnergyPercent,
  maxHealthPercent,
} from '../utils/derivedStats.js';
import { getGameMasterGuideRules } from '../prompts/mainPromptModule.js';

// These four numbers are computed twice in the interface - once when the sheet is built at
// character creation, once after every change the game master reports - and the game master
// recomputes them a third time from the rule text. Every copy has to be the same arithmetic.

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('health and energy pools follow the percentages the rule states', () => {
  const rules = getGameMasterGuideRules();
  assert.match(rules, /MaxHealth% = 100 \+ floor\(PermanentlyModifiedConstitution \* 2\.0\) \+ floor\(PermanentlyModifiedStrength \* 1\.0\)/);
  assert.equal(maxHealthPercent(100, 100), 400, 'the rule names 400% as the ceiling of both at 100');
  assert.equal(maxHealthPercent(11, 6), 128);
  assert.equal(maxHealthPercent(undefined, undefined), 103, 'a missing characteristic counts as 1');

  assert.match(rules, /MaxEnergy% = 100 \+ floor\(PermanentlyModifiedConstitution \* 0\.75\)/);
  assert.equal(maxEnergyPercent(100, 100, 100, 100), 400, 'the rule names 400% for all four at 100');
  assert.equal(maxEnergyPercent(11, 11, 11, 11), 132, 'each contribution is rounded apart');
});

test('carrying capacity rounds strength and constitution together', () => {
  assert.equal(CARRY_CAPACITY_BASE_WEIGHT, 30);
  assert.match(getGameMasterGuideRules(), /MaxWeight_kg = 30 \+ floor\(PermanentlyModifiedStrength \* 1\.8 \+ PermanentlyModifiedConstitution \* 0\.4\)/);
  assert.equal(maxCarryWeight(10, 10), 52);
  // floor(19.8 + 2.4) is 22, while rounding the two terms apart would claim 19 + 2 = 21.
  assert.equal(maxCarryWeight(11, 6), 52);
  assert.equal(maxCarryWeight(100, 100), 250, 'the rule states this result as approximately 250 kg');
});

test('the critical threshold stays a roll a d20 can answer', () => {
  const rules = getGameMasterGuideRules();
  const clamped = "CritChanceThreshold = min(20, max(1, 20 - floor(PermanentlyModifiedLuck / 20)))";
  assert.equal(rules.split(clamped).length - 1, 3, 'every copy of the formula in the guide carries the bounds');
  assert.doesNotMatch(rules, /CritChanceThreshold = 20 - floor\(PermanentlyModifiedLuck \/ 20\)/);

  assert.equal(critChanceBuffFromLuck(100), 5);
  assert.equal(criticalHitThreshold(0), 20, 'without luck a critical needs a natural 20');
  assert.equal(criticalHitThreshold(100), 15, 'the rule works this example out as crits on 15-20');
  assert.equal(criticalHitThreshold(400), 1, 'enough luck makes every roll critical, never better than that');
  assert.equal(criticalHitThreshold(1000), 1);
  assert.equal(criticalHitThreshold(-20), 20, 'a curse cannot take the natural 20 away');
});

test('both places that build a character ask the same module', async () => {
  const [recalculation, creation] = await Promise.all([
    read('../utils/gameContext.ts'),
    read('../utils/characterManager.ts'),
  ]);
  for (const [name, source] of [['the recalculation', recalculation], ['character creation', creation]]) {
    assert.match(source, /maxHealthPercent\(/, `${name} must derive health from the rules module`);
    assert.match(source, /maxEnergyPercent\(/, `${name} must derive energy from the rules module`);
    assert.match(source, /maxCarryWeight\(/, `${name} must derive capacity from the rules module`);
    assert.match(source, /criticalHitThreshold\(/, `${name} must derive the critical threshold from the rules module`);
    assert.doesNotMatch(source, /100 \+ Math\.floor/, `${name} must not keep a copy of the health formula`);
    assert.doesNotMatch(source, /20 - (?:newPc\.)?critChanceBuffFromLuck|20 - Math\.floor/, `${name} must not keep a copy of the critical formula`);
  }
});

test('the experience a level costs has one owner, including the number printed on the sheet', async () => {
  const rules = getGameMasterGuideRules();
  assert.match(rules, /'TotalXPForLevel\(L\) = floor\(BaseXP \* \(L \^ 2\.5\)\)'/, 'the rule states the formula the code implements');
  assert.match(rules, /- Example: TotalXPForLevel\(5\) = floor\(100 \* \(5 \^ 2\.5\)\) = 5590/, 'and works one level out to a number');

  assert.equal(BASE_EXPERIENCE, 100);
  assert.equal(EXPERIENCE_LEVEL_EXPONENT, 2.5);
  assert.equal(experienceForLevelTransition(1), 100);
  assert.equal(experienceForLevelTransition(5), 5590, 'the guide states 5590 XP for the fifth level');
  assert.equal(experienceForLevelTransition(0), 100, 'a level below the table still costs the base');
  assert.equal(experienceFormulaLabel, 'floor(100 * (Lvl ^ 2.5))', 'the sheet quotes the constants it actually uses');

  const [levelUp, creation] = await Promise.all([
    read('../utils/responseProcessor.ts'),
    read('../utils/characterManager.ts'),
  ]);
  for (const [name, source] of [['the level-up pass', levelUp], ['character creation', creation]]) {
    assert.match(source, /experienceForLevelTransition\(/, `${name} must ask the rules module what a level costs`);
    assert.doesNotMatch(source, /Math\.pow\(level, 2\.5\)|Math\.pow\((?:newPc|newPlayer)\.level, 2\.5\)/, `${name} must not keep a copy of the progression formula`);
  }
});

test('the sheet explains a total rather than recomputing one', async () => {
  const header = await read('../components/CharacterSheet/Header.tsx');
  // Health and energy are built from the permanently modified characteristics - gear folded in -
  // which the sheet does not carry. Breaking the total into terms from the standard values made
  // the parts disagree with the number beside them, and printed NaN for a character whose sheet
  // states no characteristics at all.
  assert.doesNotMatch(header, /Math\.floor\(character\.characteristics\.standard/, 'the breakdown must not re-derive a formula');
  assert.match(header, /value: `\$\{BASE_HEALTH_PERCENT\}`/, 'the base row quotes the constant the formula starts from');
  assert.match(header, /experienceFormulaLabel/, 'the quoted formula comes from the module that applies it');

  const details = await read('../utils/translations/ui/details.ts');
  for (const pair of [
    'Characteristics Bonus": "Characteristics Bonus',
    'Characteristics Bonus": "Бонус характеристик',
  ]) {
    assert.ok(details.includes(pair), `the details dictionary needs: ${pair}`);
  }
});
