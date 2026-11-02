import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGameMasterGuideRules } from '../prompts/mainPromptModule.js';

// A rule oracle, not a runtime implementation: Arena GM performs the calculation.
test('armor resistance is counted once, capped, rounded once and then thresholded', () => {
  const rules = getGameMasterGuideRules();
  const armor = rules.split('<Rule id="15.A.2">')[1].split('</Rule>')[0];
  const resistance = rules.split('<Rule id="14.3.1">')[1].split('</Rule>')[0];
  assert.match(armor, /TotalReduction% = FinalResistance%/);
  assert.match(armor, /Do NOT add equipped-item DamageReduction a second time/);
  assert.match(armor, /Round the post-reduction result, not the intermediate critical damage/);
  assert.match(resistance, /FinalResistance% = min\(90, max\(-100, TotalResistanceBeforeCap%\)\)/);
  const resolve = ({ damage, innate, armor, additional = 0, threshold }) => {
    const reduction = Math.min(90, Math.max(-100, innate + armor + additional));
    const postReduction = Math.max(0, Math.round(damage * (1 - reduction / 100)));
    return { reduction, postReduction, healthDamage: postReduction <= threshold ? 0 : postReduction };
  };
  assert.deepEqual(resolve({ damage: 40, innate: 10, armor: 20, threshold: 28 }), { reduction: 30, postReduction: 28, healthDamage: 0 });
  assert.deepEqual(resolve({ damage: 40, innate: 10, armor: 20, threshold: 27 }), { reduction: 30, postReduction: 28, healthDamage: 28 });
  assert.deepEqual(resolve({ damage: 40, innate: 10, armor: 70, additional: 15, threshold: 0 }), { reduction: 90, postReduction: 4, healthDamage: 4 });
  assert.deepEqual(resolve({ damage: 40, innate: -50, armor: 0, threshold: 0 }), { reduction: -50, postReduction: 60, healthDamage: 60 });
  assert.deepEqual(resolve({ damage: 10 * 1.55, innate: 0, armor: 15, threshold: 0 }), { reduction: 15, postReduction: 13, healthDamage: 13 });
});

test('worked combat examples use level resistance and critical math consistently', () => {
  const rules = getGameMasterGuideRules();
  assert.match(rules, /LevelResist\(L25, all\)=\+4% \+ ConstResist\(ModConst60, all\)=\+6%/);
  assert.match(rules, /10% \+ 30% \+ 35% = 75%/);
  assert.match(rules, /Доп\. бонусы \(55%\) = 95%/);
  assert.match(rules, /Damage After Crit = Total Base \(58%\) \* Crit Multiplier \(1\.51\) = 87\.58% \(unrounded\)/);
  assert.match(rules, /38 \* 1\.57 = 59\.66%/);
  assert.match(rules, /DamageAfterCrit=49\*1\.55=75\.95%/);
  assert.match(rules, /round\(198\.73 \* \(1 - 0\.18\)\) = 163%/);
  assert.match(rules, /generic combatant without an NPC record, include the complete Wound Object/);
});

test('combat task examples and generic critical rules retain damage and wound semantics', async () => {
  const { getStep0, getStep3Logs } = await import('../prompts/mainPromptSteps.js');
  const step0 = getStep0(), logs = getStep3Logs(), rules = getGameMasterGuideRules();
  assert.match(step0, /\(Бросок 17 \+ StatMod 22\) - \(Бросок ГМ 5 \+ Сложность 4\) = 39 - 9 = 30/);
  assert.match(step0, /round\(85\.25 \* \(1 - 0\.20\)\) = 68%/);
  assert.match(logs, /round\(57\.35 \* \(1 - 0 \/ 100\)\) = 57%/);
  assert.match(logs, /гоблин получает отдельную лёгкую рану от ошибки при атаке/);
  assert.match(rules, /For generic attackers, Rule #15\.2\.3\.A already applied the 1\.5 critical multiplier/);
  assert.match(rules, /natural 20 or when the target critically fails its defensive check/);
  assert.equal(Math.round((15 + 23 + 5 + 7 + 5) * 1.55 * 0.8), 68);
  assert.equal(Math.round((18 + 7 + 12) * 1.55), 57);
});

test('direct combat cleanup handoff keeps stage scope and requires evidence for NPC outcomes', async () => {
  const { getStep3Logs, getStep3, getStep4 } = await import('../prompts/mainPromptSteps.js');
  const logs = getStep3Logs(), combat = getStep3(), npc = getStep4();
  assert.match(logs, /final actual health on the NPC scale/);
  assert.match(combat, /Combat End \(Rule #13\.7\.1\)/);
  assert.match(combat, /that key is forbidden in this step/);
  const whitelist = combat.split('<AllowedKeys>')[1].split('</AllowedKeys>')[0];
  assert.doesNotMatch(whitelist, /<Key>NPCsData<\/Key>/);
  assert.match(npc, /Combat End Handoff/);
  assert.match(npc, /do not infer a result from the pre-turn roster/);
});
