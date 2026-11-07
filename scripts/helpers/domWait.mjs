/**
 * DOM tests used to sleep for a fixed number of milliseconds and then assert. Screens now
 * wait for lazily loaded dictionaries before rendering their forms, so a fixed sleep is a
 * race: on a loaded machine the form is not there yet and the test fails for no reason.
 * `waitForDom` polls a condition while letting React commit between attempts.
 */
export async function waitForDom(act, predicate, { timeout = 15_000, interval = 25, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let result = null;
    try {
      result = predicate();
    } catch {
      result = null;
    }
    if (result) return result;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeout} ms waiting for ${label}`);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, interval)); });
  }
}
