const BRIDGE_URL = 'http://127.0.0.1:8765';
const TOOLS = new Set(['game.pending', 'game.respond', 'game.rules.search', 'game.rules.read']);
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

async function getToken() {
  const stored = await chrome.storage.local.get('pairingToken');
  return typeof stored.pairingToken === 'string' ? stored.pairingToken : '';
}

async function bridgeFetch(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  if (!token) throw new Error('Pair this extension with the local bridge first (open the extension toolbar popup).');
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${BRIDGE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Cannot reach 127.0.0.1:8765. Start `npm run bridge:local` on the game computer.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Local bridge returned HTTP ${response.status}.`);
  return payload;
}

function validateToolMessage(message) {
  const payload = message?.payload;
  if (!payload || payload.bridge !== 'book-of-eternity' || payload.version !== 1 ||
      !payload.call || typeof payload.call !== 'object' || Array.isArray(payload.call) ||
      !TOOLS.has(payload.call.tool) || !payload.call.arguments || typeof payload.call.arguments !== 'object' || Array.isArray(payload.call.arguments)) {
    throw new Error('Unsupported tool block. Only the documented Book of Eternity local game tools are allowed.');
  }
  return payload.call;
}

async function runTool(message) {
  const call = validateToolMessage(message);
  const result = await bridgeFetch('/v1/tool', { method: 'POST', body: { tool: call.tool, arguments: call.arguments } });
  return { tool: call.tool, result: result.result };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !['RUN_LOCAL_TOOL', 'TEST_LOCAL_BRIDGE'].includes(message.type)) return undefined;
  const extensionId = sender?.id || chrome.runtime.id;
  if (!EXTENSION_ID_PATTERN.test(extensionId)) {
    sendResponse({ ok: false, error: 'Unexpected extension identity.' });
    return undefined;
  }
  if (message.type === 'RUN_LOCAL_TOOL' && !/^https:\/\/(?:www\.)?arena\.ai\//.test(sender?.url || '')) {
    sendResponse({ ok: false, error: 'Local game calls may only originate from the Arena chat page.' });
    return undefined;
  }
  const operation = message.type === 'TEST_LOCAL_BRIDGE'
    ? bridgeFetch('/v1/status').then(status => ({ status }))
    : runTool(message);
  operation.then(value => sendResponse({ ok: true, ...value })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
