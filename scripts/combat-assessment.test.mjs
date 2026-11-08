import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessCombat, auditCalculationLines, evaluateArithmetic } from '../utils/combatAssessment.js';
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

test('every calculation the rulebook works out as an example adds up', () => {
  const lines = getGameMasterGuideRules().split('\n');
  const { checked, failures } = auditCalculationLines(lines);
  assert.ok(checked > 100, `the guide states plenty of arithmetic, saw only ${checked}`);
  assert.deepEqual(failures.map(f => f.line), [], 'a worked example with wrong arithmetic teaches the game master to miscount');
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
  assert.match(tracker, /import \{ assessCombat \} from '\.\.\/utils\/combatAssessment\.js';/);
  assert.match(tracker, /calculationLines: \(gameLog \|\| \[\]\)\.slice\(-40\)/);
  assert.match(tracker, /t\('Combat Summary'\)/);
  for (const [name, source] of [['the side panel', panel], ['the full-screen view', host]]) {
    assert.match(source, /gameLog=\{gameLog\}/, `${name} must pass the log into the combat view`);
  }
});
