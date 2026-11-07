import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTestServer, closeTestServer } from './helpers/testServer.mjs';

const source = readFileSync(fileURLToPath(new URL('../components/StartScreen.tsx', import.meta.url)), 'utf8');

// The starting descriptions of the optional systems are ~546 KB of prose. They used to be
// imported statically, so every visitor downloaded all of it to render the start screen.
test('start screen loads only the preset descriptions of the selected universe', async () => {
  assert.ok(!/import\s*\{[^}]*\}\s*from\s*'\.\.\/utils\/translations\/presetRules\//.test(source),
    'StartScreen must not statically import a preset pack');
  assert.match(source, /import \{ loadPresetRuleTexts, type PresetRuleTexts \} from '\.\.\/utils\/translations\/presetRules';/);

  const vite = await getTestServer();
  try {
    const { loadPresetRuleTexts, resetPresetRuleCache } = await vite.ssrLoadModule('/utils/translations/presetRules/index.ts');
    resetPresetRuleCache();

    const fantasy = await loadPresetRuleTexts('fantasy');
    assert.deepEqual(Object.keys(fantasy).sort(), ['cultivationSystemDescription', 'magicSystemDescription', 'priesthoodSystemDescription']);
    for (const [field, text] of Object.entries(fantasy)) {
      assert.ok(text.en.length > 100, `${field} has an English description`);
      assert.ok(text.ru.length > 100, `${field} has a Russian description`);
      assert.notEqual(text.en, text.ru, `${field} is translated`);
    }
    assert.equal(await loadPresetRuleTexts('fantasy'), fantasy, 'a load is cached');

    const postApocalypse = await loadPresetRuleTexts('post_apocalypse');
    assert.deepEqual(Object.keys(postApocalypse).sort(), ['hungerSystemDescription', 'psionicSystemDescription', 'radiationSystemDescription', 'thirstSystemDescription']);
    assert.deepEqual(await loadPresetRuleTexts('custom'), {}, 'a hand written universe brings no pack');
    assert.deepEqual(await loadPresetRuleTexts('nonsense'), {});
  } finally {
    await closeTestServer();
  }
});

test('preset defaults never overwrite a description the player edited', async () => {
  const vite = await getTestServer();
  try {
    const { fillPresetRuleDefaults } = await vite.ssrLoadModule('/utils/presetRuleDefaults.ts');
    const texts = { magicSystemDescription: { en: 'English magic', ru: 'Русская магия' } };

    assert.deepEqual(fillPresetRuleDefaults({ magicSystemDescription: '' }, texts, 'ru'), { magicSystemDescription: 'Русская магия' });
    assert.deepEqual(fillPresetRuleDefaults({ magicSystemDescription: 'English magic' }, texts, 'ru'), { magicSystemDescription: 'Русская магия' }, 'a shipped default follows the language');
    assert.deepEqual(fillPresetRuleDefaults({ magicSystemDescription: 'My own words' }, texts, 'ru'), { magicSystemDescription: 'My own words' }, 'an edited description stays');
    const untouched = { magicSystemDescription: 'Русская магия' };
    assert.equal(fillPresetRuleDefaults(untouched, texts, 'ru'), untouched, 'nothing to do returns the same object');
    assert.deepEqual(fillPresetRuleDefaults({}, texts, 'en'), { magicSystemDescription: 'English magic' });
  } finally {
    await closeTestServer();
  }
});
