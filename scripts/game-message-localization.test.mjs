import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTestServer, closeTestServer } from './helpers/testServer.mjs';

const read = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

// Load, recovery and upload messages used to be written as `language === 'ru' ? '...' : '...'`,
// so every new wording had to be kept in two places and the RU branch was easy to forget.
const convertedFiles = ['hooks/useGameLogic.ts', 'components/InputBar.tsx'];
const messageKeys = [
  'load_unavailable_while_game_changing',
  'interrupted_turn_recovery_needs_local_idle_game',
  'interrupted_turn_recovery_resume_state_changed',
  'interrupted_turn_recovery_legacy_network_checkpoint',
  'interrupted_turn_discard_unavailable',
  'interrupted_turn_checkpoint_not_found',
  'interrupted_turn_checkpoint_changed',
  'crash_recovery_unavailable_while_game_busy',
  'crash_recovery_state_not_found',
  'crash_recovery_state_changed',
  'quest_reward_scaled_for_danger',
  'image_upload_unsupported_type',
  'image_upload_too_large',
];

test('game logic messages go through the dictionaries instead of ru/en ternaries', async () => {
  for (const file of convertedFiles) {
    const source = read(file);
    assert.ok(!source.includes("language === 'ru'"), `${file} still pairs its own ru/en strings`);
  }

  const vite = await getTestServer();
  try {
    const { translations } = await vite.ssrLoadModule('/utils/localizationTranslations.ts');
    const missing = messageKeys.filter(key => !(key in translations.en) || !(key in translations.ru));
    assert.deepEqual(missing, [], 'these keys are missing from a dictionary');
    const untranslated = messageKeys.filter(key => translations.ru[key] === translations.en[key]);
    assert.deepEqual(untranslated, [], 'these Russian entries are still the English text');

    const { translate } = await vite.ssrLoadModule('/utils/localization.ts');
    const interpolated = translate('en', 'quest_reward_scaled_for_danger', { name: 'Find the well', old: 40, new: 80 });
    assert.ok(interpolated.includes('Find the well') && interpolated.includes('40') && interpolated.includes('80'), interpolated);
    const russian = translate('ru', 'quest_reward_scaled_for_danger', { name: 'Найти колодец', old: 40, new: 80 });
    assert.ok(russian.includes('Найти колодец') && russian.includes('«'), russian);
  } finally {
    await closeTestServer();
  }
});
