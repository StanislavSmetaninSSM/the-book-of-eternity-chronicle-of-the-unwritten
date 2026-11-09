const tokenInput = document.querySelector('#token');
const status = document.querySelector('#status');
const saveButton = document.querySelector('#save');
const clearButton = document.querySelector('#clear');

function showStatus(text, state = '') {
  status.textContent = text;
  status.dataset.state = state;
}

chrome.storage.local.get('pairingToken').then(({ pairingToken }) => {
  if (typeof pairingToken === 'string') tokenInput.value = pairingToken;
  if (pairingToken) showStatus('Pairing token saved. Test the local connection.', '');
});

saveButton.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (token.length < 32) { showStatus('The pairing token looks too short.', 'error'); return; }
  saveButton.disabled = true;
  showStatus('Checking the local bridge…');
  try {
    await chrome.storage.local.set({ pairingToken: token });
    const result = await chrome.runtime.sendMessage({ type: 'TEST_LOCAL_BRIDGE' });
    if (!result?.ok) throw new Error(result?.error || 'Connection failed.');
    const { hasPending, kind } = result.status;
    showStatus(hasPending ? `Connected · waiting request: ${kind}` : 'Connected · no game request is pending.', 'ok');
  } catch (error) {
    showStatus(error.message || 'Connection failed.', 'error');
  } finally {
    saveButton.disabled = false;
  }
});

clearButton.addEventListener('click', async () => {
  await chrome.storage.local.remove('pairingToken');
  tokenInput.value = '';
  showStatus('Pairing token forgotten.');
});
