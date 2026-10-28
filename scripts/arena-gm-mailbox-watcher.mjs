import { readFile, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

const mailbox = path.resolve(process.cwd(), '.arena-gm-relay/pending.json');
let lastId = '';
let lastFingerprint = '';
console.log(`Arena GM mailbox watcher active: ${mailbox}`);

while (true) {
  try {
    const info = await stat(mailbox);
    const fingerprint = `${info.size}:${info.mtimeMs}`;
    if (fingerprint !== lastFingerprint) {
      // Let the writer finish before parsing the file.
      lastFingerprint = fingerprint;
      await delay(150);
      const packet = JSON.parse(await readFile(mailbox, 'utf8'));
      if (packet.correlationId && packet.correlationId !== lastId) {
        lastId = packet.correlationId;
        console.log(`ARENA_GM_STEP_READY ${JSON.stringify({
          correlationId: packet.correlationId,
          stepName: packet.stepName || packet.kind,
          attempt: packet.attempt || 1,
        })}`);
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      console.error(`Mailbox watcher error: ${error.message}`);
    }
  }
  await delay(300);
}
