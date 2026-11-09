import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { closeTestServer, getTestServer } from './helpers/testServer.mjs';

after(closeTestServer);

test('image-cache changes trigger an autosave even when the turn is unchanged', async () => {
  const vite = await getTestServer();
  const { shouldAutosaveGameState } = await vite.ssrLoadModule('/hooks/logic/autosave.ts');
  const savedCache = { portrait: { src: 'data:image/png;base64,AA==' } };

  assert.equal(shouldAutosaveGameState(12, 12, savedCache, savedCache), false, 'unchanged state does not autosave twice');
  assert.equal(shouldAutosaveGameState(12, 12, { ...savedCache }, savedCache), true, 'a new image cache is autosaved in the same turn');
  assert.equal(shouldAutosaveGameState(13, 12, savedCache, savedCache), true, 'a new turn is still autosaved');
  assert.equal(shouldAutosaveGameState(0, null, savedCache, null), false, 'setup state is not autosaved');
});

test('the persistent relay-active badge is removed from the game UI and translations', () => {
  const panel = readFileSync(fileURLToPath(new URL('../components/ArenaGmRelayPanel.tsx', import.meta.url)), 'utf8');
  const commonTranslations = readFileSync(fileURLToPath(new URL('../utils/translations/ui/common.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(panel, /relay_active_badge|Arena GM: active/);
  assert.doesNotMatch(commonTranslations, /relay_active_badge|Arena GM: active|Arena GM: активен/);
});
