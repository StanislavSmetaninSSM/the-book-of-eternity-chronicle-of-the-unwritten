import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTestServer, closeTestServer } from './helpers/testServer.mjs';

// The attack shortcut sends a plain sentence to the game master, so it has to follow the
// interface language instead of always being Russian.
test('the attack command is translated for both languages', async () => {
  const vite = await getTestServer();
  try {
    const { translate } = await vite.ssrLoadModule('/utils/localization.ts');
    assert.equal(translate('en', 'attack_command', { name: 'Goblin' }), 'I attack Goblin');
    assert.equal(translate('ru', 'attack_command', { name: 'Goblin' }), 'Я атакую Goblin');

    // The relay panel reaches English players as well.
    for (const key of ['relay_title', 'relay_hint', 'relay_apply', 'relay_active_badge']) {
      assert.notEqual(translate('en', key), key, `${key} must exist in English`);
      assert.notEqual(translate('ru', key), key, `${key} must exist in Russian`);
      assert.notEqual(translate('ru', key), translate('en', key), `${key} must be translated`);
    }
  } finally {
    await closeTestServer();
  }
});
