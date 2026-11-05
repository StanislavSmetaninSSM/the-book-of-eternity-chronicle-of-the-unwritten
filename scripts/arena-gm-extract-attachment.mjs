// Extract a player's image from the active relay packet for the Arena agent to inspect.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const relayDirectory = path.resolve(process.env.ARENA_GM_RELAY_DIR || '.arena-gm-relay');
const packet = JSON.parse(await readFile(path.join(relayDirectory, 'pending.json'), 'utf8'));
const id = packet.correlationId;
if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid correlation ID.');
const opening = '\n\n<CurrentGameContext>\n';
const closing = '\n</CurrentGameContext>';
const start = packet.prompt?.lastIndexOf(opening) ?? -1;
const end = start < 0 ? -1 : packet.prompt.indexOf(closing, start + opening.length);
if (start < 0 || end < 0) throw new Error('The active request has no game context.');
const context = JSON.parse(packet.prompt.slice(start + opening.length, end));
if (!context.image) throw new Error('The active request has no image attachment.');
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };
const extension = extensions[context.image.mimeType];
const data = context.image.data;
if (!extension || typeof data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
  throw new Error('Unsupported image type or invalid base64 image data.');
}
const directory = path.join(relayDirectory, 'input-images');
await mkdir(directory, { recursive: true });
const output = path.join(directory, `${id}.${extension}`);
await writeFile(output, Buffer.from(data, 'base64'));
console.log(output);
