import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withGameContext } from '../utils/relayPromptContext.js';

test('stage prompts include action, state and accumulated stage results', () => {
  const context = { message: 'Войти в таверну', currentTurnNumber: 1, gameSettings: { language: 'ru' }, partiallyGeneratedResponse: '{"test":true}', image: null };
  const prompt = withGameContext('stage instructions', context);
  const value = JSON.parse(prompt.split('<CurrentGameContext>\n')[1].split('\n</CurrentGameContext>')[0]);
  assert.deepEqual(value, context);
});

test('attached image survives in the game context', () => {
  const context = { message: 'Что изображено?', gameSettings: {}, image: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } };
  const prompt = withGameContext('rules', context);
  const parsed = JSON.parse(prompt.split('<CurrentGameContext>\n')[1].split('\n</CurrentGameContext>')[0]);
  assert.deepEqual(parsed.image, context.image);
});

test('an active packet attachment can be extracted byte-for-byte', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'relay-image-test-'));
  try {
    const bytes = Buffer.from('example image bytes');
    const prompt = withGameContext('stage', { image: { mimeType: 'image/png', data: bytes.toString('base64') } });
    await writeFile(join(dir, 'pending.json'), JSON.stringify({ correlationId: 'test-123', prompt }));
    const output = execFileSync(process.execPath, ['scripts/arena-gm-extract-attachment.mjs'], { env: { ...process.env, ARENA_GM_RELAY_DIR: dir }, encoding: 'utf8' }).trim();
    assert.deepEqual(await readFile(output), bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
