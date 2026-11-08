import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessCombat, auditCalculationLines, auditComparisonLines, auditCombatLog, evaluateArithmetic } from '../utils/combatAssessment.js';
import { getGameMasterGuideRules } from '../prompts/mainPromptModule.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('the reader computes what the logged line claims, and refuses the rest', () => {
  assert.equal(evaluateArithmetic('30 + 15'), 45);
  assert.equal(evaluateArithmetic('28 + 2 + 5'), 35);
  assert.equal(evaluateArithmetic('58 * 1.51'), 87.58);
  assert.equal(evaluateArithmetic('round(198.73 * (1 - 0.18))'), 163);
  assert.equal(evaluateArithmetic('min(90, max(-100, 120))'), 90);
  assert.equal(evaluateArithmetic('(17 + 33) - (5 + 1)'), 44);
  // Nothing to accuse when the line cannot be read at all.
  assert.equal(evaluateArithmetic('50 / 0'), null);
  assert.equal(evaluateArithmetic('2 +'), null);
  assert.equal(evaluateArithmetic('Total Base (58%) times the multiplier'), null);
  assert.equal(evaluateArithmetic(undefined), null);
});

test('a power is arithmetic the reader can follow', () => {
  assert.equal(evaluateArithmetic('5 ^ 2.5'), Math.pow(5, 2.5));
  assert.equal(evaluateArithmetic('floor(100 * (5 ^ 2.5))'), 5590);
  assert.equal(evaluateArithmetic('2 ** 3 ** 2'), 512, 'powers bind tighter than multiplication and group to the right');
  assert.equal(evaluateArithmetic('15 + pow(100, 0.8) * 1.2'), 15 + Math.pow(100, 0.8) * 1.2);
  assert.equal(evaluateArithmetic('2 ^'), null, 'an unreadable exponent is skipped, not accused');

  // The party-power example in the rules is written in this shape. Three of its terms did not add
  // up as long as the reader could not multiply a level by itself a fractional number of times.
  const guide = getGameMasterGuideRules().split('\n').map(line => line.trim());
  assert.ok(guide.includes('- Sir Kaelen: (25 ^ 1.2) = 47.6'), 'the rulebook states each term to one decimal');
  assert.equal(auditCalculationLines(guide.filter(line => line.includes('^ 1.2'))).checked, 3,
    'and each of those three lines is one the reader recomputes');
});

test('a calculation is re-checked only when the line states one', () => {
  const clean = auditCalculationLines([
    '- CriticalCarryWeight = 30kg + 15kg = 45kg',
    'Damage After Crit = 58 * 1.51 = 87.58% (unrounded)',
    "- Kaelen's criticalWeight = 50 + 15 = 65kg.",
    'Check: 55kg <= 65kg. RESULT: TRUE',
    'S1 = 10',
    '{ "response": "a = b" }',
    '',
  ]);
  assert.equal(clean.checked, 3, 'a comparison, a bare label, JSON and an empty line are not arithmetic');
  assert.deepEqual(clean.failures, []);

  const broken = auditCalculationLines([
    'TotalProspectiveWeight = 28kg + 2kg + 5kg = 36kg',
    'Armor holds: 40 * 0.7 = 27%',
    'Economy: 10 + (5 - 2) = 13',
  ]);
  assert.equal(broken.checked, 3);
  assert.deepEqual(broken.failures.map(f => [f.claimed, f.computed]), [[36, 35], [27, 28]]);

  // Rounding is the rules' own convention, so a whole number is forgiven half a point.
  assert.equal(auditCalculationLines(['X = 34.6']).failures.length, 0);
  assert.deepEqual(auditCalculationLines(['X = 4 + 30.6']).failures, []);
});

test('a chain of substitutions is checked step by step, and a sum of terms is left alone', () => {
  const chain = [
    '- maxHealth = (100 + 13 * 2) = 100 + 26 = 126%',
    '- LevelDifference = PL - LD_calc = 10 - 15 = -5',
    "Calculation: 'BaseResistValue' (Boss, EL=100) = round(15 + pow(100, 0.8) * 1.2) = round(15 + 39.8 * 1.2) = round(15 + 47.8) = 63%.",
  ];
  const sound = auditCalculationLines(chain);
  assert.ok(sound.checked >= chain.length + 1, `every step of a chain is a claim of its own, saw ${sound.checked}`);
  assert.deepEqual(sound.failures, []);

  // The middle step disagrees with both of its neighbours, so both are named: the substitution the
  // turn wrote, and the total that was carried on from it.
  const broken = auditCalculationLines(['- maxHealth = (100 + 13 * 2) = 100 + 27 = 126%']);
  assert.equal(broken.checked, 2);
  assert.deepEqual(broken.failures.map(f => [f.claimed, f.computed]), [[126, 127], [127, 126]]);

  // Written this way the pieces belong to different sums, and pairing them would invent a mistake.
  assert.deepEqual(auditCalculationLines(['- Attack = 7% + Guard = 16% = 23%']), { checked: 0, failures: [] });
});

test('the rules hand the client the two shapes it re-computes', () => {
  const guide = getGameMasterGuideRules().split('\n').map(line => line.trim());
  assert.ok(guide.includes('- maxHealth = (100 + 13 * 2) = 100 + 26 = 126%'), 'the chain the rules show is one the reader follows');
  assert.ok(guide.includes('- Attack = 7% + Guard = 16% = 23%'), 'and so is the shape they warn against');
  assert.ok(guide.includes('- Threshold Check: 360 >= 360. RESULT: TRUE. The project step is COMPLETE.'), 'a world threshold is written with its verdict');
});

test('every calculation and every verdict the rulebook works out as an example holds', () => {
  const lines = getGameMasterGuideRules().split('\n');
  const { checked, failures } = auditCalculationLines(lines);
  assert.ok(checked > 220, `the guide states plenty of arithmetic, saw only ${checked}`);
  assert.deepEqual(failures.map(f => f.line), [], 'a worked example with wrong arithmetic teaches the game master to miscount');

  const verdicts = auditComparisonLines(lines);
  assert.ok(verdicts.checked >= 12, `the guide states its threshold checks in the auditable form, saw only ${verdicts.checked}`);
  assert.deepEqual(verdicts.failures.map(f => f.line), [], 'a worked example whose verdict contradicts its own comparison teaches the game master to misjudge');
});

test('a verdict that contradicts the comparison on its own line is reported', () => {
  const holding = auditComparisonLines([
    '- Step 5 (Threshold Check): 10 <= 10. RESULT: TRUE. The Armor Holds.',
    "- Check: '3720 >= 4960'? FALSE.",
    '- Check: 45 <= 60. Status: TRUE.',
    '**Step 1 (Check):** 6000 >= 5590. TRUE. Level-up triggered.',
  ]);
  assert.equal(holding.checked, 4);
  assert.deepEqual(holding.failures, []);

  const broken = auditComparisonLines([
    '- Step 5 (Threshold Check): 21 <= 10. RESULT: TRUE. The Armor Holds.',
    '- Threshold Check: 7 >= 10. RESULT: TRUE.',
  ]);
  assert.equal(broken.checked, 2);
  assert.deepEqual(broken.failures.map(f => [f.kind, f.claimed, f.computed]), [
    ['comparison', 'TRUE', 'FALSE'],
    ['comparison', 'TRUE', 'FALSE'],
  ]);

  // A threshold written as a rule, a comparison with no verdict, a word in the way of a number and
  // the template the rules hand out for these lines: none of them claims anything about this turn.
  assert.deepEqual(auditComparisonLines([
    '- If Difference >= 10:      Result = Critical Success',
    '- Reasoning: 2160 <= 2280. This event happened during the rest.',
    '- Check: Is -5 <= 0? TRUE.',
    '- Result: LEVEL UP! (13,500 >= 13,200).',
    '- Threshold Check: [Difference] [>= or <=] [bound]. RESULT: TRUE|FALSE.',
    'Check: 55kg <= 65kg. RESULT: TRUE, but only just - the label is prose and the rest is two sums: 30 + 15 = 45',
  ]), { checked: 1, failures: [] }, 'a readable comparison in an unreadable line is still a claim');

  // Both readers feed one list, in the order the log states them.
  const merged = assessCombat({
    calculationLines: ['Damage: 3 + 4 = 8', '- Threshold Check: 7 >= 10. RESULT: TRUE.', 'Weight: 30 + 15 = 45kg'],
  });
  assert.equal(merged.calculations.checked, 3);
  assert.deepEqual(merged.calculations.failures.map(f => [f.order, f.kind]), [[0, 'equality'], [1, 'comparison']]);
});

test('the rules require a verdict to be written where it can be re-checked', () => {
  const guide = getGameMasterGuideRules();
  assert.match(guide, /#12\.7\.5\. The Threshold Check Lines \(MANDATORY FORMAT\)/);
  assert.match(guide, /- Threshold Check: \[Difference\] \[>= or <=\] \[bound\]\. RESULT: TRUE\|FALSE\./);
  assert.match(guide, /- Threshold Check: 7 >= 5\. RESULT: TRUE\./);
});

test('the fight is summed up from the lists, the characters behind them and the log', () => {
  const assessment = assessCombat({
    enemies: [
      { NPCId: 'goblin-1', name: 'Гоблин', currentHealth: '40%', maxHealth: '100%' },
      { name: 'Волки', isGroup: true, count: 3, healthStates: ['100%', '100%', '100%'], maxHealth: '100%' },
      { NPCId: 'goblin-1', name: 'Гоблин', currentHealth: '120%', maxHealth: '100%' },
    ],
    allies: [{ NPCId: 'kaelen', name: 'Каэлен', currentHealth: '55%', maxHealth: '65%' }],
    npcs: [{
      NPCId: 'kaelen', name: 'Каэлен',
      wounds: [{ healingState: { currentState: 'Fresh' } }, { healingState: { currentState: 'Healed' } }],
      activeEffects: [{ duration: 2 }],
    }],
    player: { currentHealth: 62, maxHealth: 128, wounds: [{ healingState: { currentState: 'Fresh' } }], activePlayerEffects: [], isOverloaded: true },
    calculationLines: ['Kaelen: 40 + 15 = 55kg', 'Broken: 2 + 2 = 5'],
  });

  // 40% of the goblin, the pack averaged over its three rows, and the copy that reports 120%
  // of a 100% body - all three are listed, none of them is down.
  assert.deepEqual(assessment.enemies, { total: 3, standing: 3, wounds: 0, effects: 0, healthPercent: 87 });
  assert.deepEqual(assessment.allies, { total: 1, standing: 1, wounds: 1, effects: 1, healthPercent: 85 });
  assert.deepEqual(assessment.player, { healthPercent: 48, wounds: 1, effects: 0, overloaded: true });
  assert.deepEqual(assessment.issues.map(issue => issue.kind), ['health_above_max', 'duplicate_participant']);
  assert.equal(assessment.calculations.checked, 2);
  assert.deepEqual(assessment.calculations.failures.map(f => f.line), ['Broken: 2 + 2 = 5']);
});

test('a group that lists fewer bodies than health rows is reported, and a clean fight is silent', () => {
  const mismatched = assessCombat({
    enemies: [{ name: 'Солдаты', isGroup: true, count: 2, healthStates: ['100%', '100%', '100%'], maxHealth: '100%' }],
  });
  assert.deepEqual(mismatched.issues, [{ kind: 'group_size_mismatch', units: 3, count: 2, subject: 'Солдаты' }]);
  assert.equal(mismatched.enemies.healthPercent, 100);

  for (const input of [{}, { enemies: [null, undefined], allies: [] }, { enemies: [{ name: 'Тень' }] }]) {
    const assessment = assessCombat(input);
    assert.equal(assessment.issues.length, 0, 'unknown numbers are left alone');
    assert.deepEqual(assessment.calculations, { checked: 0, failures: [] });
  }
  assert.equal(assessCombat({}).player, null);
  assert.equal(assessCombat({ enemies: [{ name: 'А', isGroup: true, maxHealth: '50%' }] }).enemies.standing, 1);
});

test('both combat views are given the log to re-check', async () => {
  const [tracker, panel, host] = await Promise.all([
    read('../components/CombatTracker.tsx'),
    read('../components/SidePanel.tsx'),
    read('../components/GameHost.tsx'),
  ]);
  // The import list may grow with other readers of the panel, so only this reader is pinned here.
  assert.match(tracker, /import \{[^}]*assessCombat[^}]*\} from '\.\.\/utils\/combatAssessment\.js';/);
  assert.match(tracker, /calculationLines: \(gameLog \|\| \[\]\)\.slice\(-40\)/);
  assert.match(tracker, /t\('Combat Summary'\)/);
  for (const [name, source] of [['the side panel', panel], ['the full-screen view', host]]) {
    assert.match(source, /gameLog=\{gameLog\}/, `${name} must pass the log into the combat view`);
  }
});

test('the fighter’s card reads the lists it shows, and the summary reads none', async () => {
    const tracker = await read('../components/CombatTracker.tsx');
    assert.match(tracker, /const combatantNotes = \[/, 'the card starts its own reading');
    assert.match(tracker, /effects: combatant\.activeBuffs, wounds: allWounds/, 'over the buffs it renders');
    assert.match(tracker, /effects: combatant\.activeDebuffs, wounds: allWounds/, 'and the debuffs it renders');
    assert.match(tracker, /assessWoundProgress\(woundsToDisplay, combatant\.name \|\| '\?'\)/, 'and over the very wounds the card lists');
    assert.match(tracker, /<WorldStateNotes notes=\{combatantNotes\} compact/, 'shown inside the card, next to the health bar');
    assert.doesNotMatch(tracker, /effectNotes/, 'the summary keeps the counts and leaves the verdicts to the cards');

    // The same reader, so a card and a sheet cannot disagree about one and the same effect.
    assert.match(tracker, /import \{ assessEffects \} from '\.\.\/utils\/effectAssessment\.js';/);

    const assessment = assessCombat({
        enemies: [{
            name: 'Frost Troll',
            wounds: [{ woundId: 'w1', healingState: { currentState: 'Stabilized', treatmentProgress: 20, progressNeeded: 20 } }],
            activeDebuffs: [{ effectType: 'Buff', targetType: 'strength', duration: 0 }],
        }],
    });
    assert.equal(assessment.effectNotes, undefined, 'the reading is not the summary’s to own');
    assert.equal(assessment.rows.length, 1, 'while the summary still counts what it shows');
});

test('the player keeps their wounds under the field the player uses', () => {
  const assessment = assessCombat({
    player: {
      name: 'Aria',
      playerWounds: [
        { healingState: { currentState: 'Untreated' } },
        { healingState: { currentState: 'Healed' } },
      ],
    },
  });

  assert.equal(assessment.player.wounds, 1, 'the closed wound is history, and the open one has to be counted');
});

test('the sheet keeps the heading its boxed reading needs', async () => {
  const tracker = await read('../components/CombatTracker.tsx');
  assert.doesNotMatch(tracker, /combat-effect-notes/, 'the combat panel no longer prints a verdict of its own');

  const sheet = await read('../components/CharacterSheet/ConditionsView.tsx');
  assert.match(sheet, /t\('Active Effects'\)/, 'and the player’s own effects stay where they are listed');
});
test('the log is read back for what #28.1.3 keeps out of it', () => {
  const { notes, byIndex } = auditCombatLog([
    'Anya strikes the Wild Boar with Frost Shard for 47 cold damage!',
    'Valerius hits the guard: 12 + 44 = 56 damage!',
    'Kaelen rolls 1d20+5 against the ogre.',
  ]);

  assert.deepEqual(Object.keys(byIndex), ['1', '2'], 'only the two entries that wrote what they were told not to write');
  assert.equal(byIndex[1][0].kind, 'calculation');
  assert.equal(byIndex[2][0].kind, 'dice');
  assert.equal(notes.length, 2);
  // The note arrives with its own key, because the panel must not know which namespace its strings live in.
  assert.equal(notes[0].key, 'combat_log_notes_calculation');
  // An entry that both rolled and summed is accused once, of the calculation it computed.
  assert.equal(auditCombatLog(['Damage: 1d6 + 2 = 5']).notes[0].kind, 'calculation');
});

test('an outcome, a range and a year are not calculations', () => {
  // The entries below are the ones the guide itself shows, plus the shapes a reader must not mistake for math.
  const clean = [
    'Anya critically strikes the Wild Boar with Frost Shard for 47 cold damage!',
    "Anya's Frost Shard Chills the Wild Boar.",
    'Town Guard strikes the Wild Boar with Spear Jab for 8 piercing damage.',
    "The Wild Boar's attack misses Anya.",
    'The Bandit takes 5-10 poison damage from Serpent Kiss.',
    'Ronan regenerates 10 health from the Regeneration Potion.',
    '1024 г., [14:30]: Бой у переправы, отряд потерял 2 человек.',
    'Змеиный укус: урон 5-10 ед., яд 3 раунда.',
    'The Ogre enters a Battle Rage!',
  ];

  assert.equal(auditCombatLog(clean).notes.length, 0, 'none of these states a calculation');
  assert.equal(auditCombatLog([]).notes.length, 0);
  assert.equal(auditCombatLog([null, '', {}, 'a = b']).notes.length, 0, 'a broken entry is not an accusation');
});

test('the mark sits under the entry it is about', async () => {
  const [tracker, strings] = await Promise.all([
    read('../components/CombatTracker.tsx'),
    read('../utils/translations/ui/common.ts'),
  ]);

  assert.match(tracker, /auditCombatLog\(combatLog \|\| \[\]\)/, 'the log the panel shows is the log that is read');
  assert.match(tracker, /logNotes\.byIndex\[index\]\?\.length/, 'and the note is looked up by the entry it marks');

  const start = tracker.indexOf('{(combatLog ?? []).map(');
  assert.ok(start > -1, 'the entries are rendered in one place');
  const block = tracker.slice(start, start + 900);
  assert.match(block, /<WorldStateNotes notes=\{logNotes\.byIndex\[index\]\} compact/, 'as a compact line under the entry');
  assert.doesNotMatch(tracker, /notes=\{logNotes\.notes\}/, 'never the whole list of them above the log');

  for (const key of ['combat_log_notes_calculation', 'combat_log_notes_dice']) {
    assert.equal((strings.match(new RegExp(`"${key}"`, 'g')) || []).length, 2, `${key} has to be answered in both locales`);
  }
});
