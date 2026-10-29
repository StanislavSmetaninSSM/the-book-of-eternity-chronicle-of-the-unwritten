import type { ChatMessage, GameContext, GameResponse, GameState } from '../types';

export const ARENA_GM_PROTOCOL_VERSION = 1 as const;
const REQUEST_EVENT = 'arena-gm-relay:request';
const ACTIVE_RELAY_CORRELATION_KEY = 'arena-gm-relay:active-correlation-id';

export interface ArenaGmTurnRequest {
  kind: 'arena-gm-turn';
  protocolVersion: typeof ARENA_GM_PROTOCOL_VERSION;
  correlationId: string;
  createdAt: string;
  instructions: string;
  turn: {
    number: number;
    playerAction: string;
    history: Array<Pick<ChatMessage, 'sender' | 'content'>>;
    gameContext: Omit<GameContext, 'image' | 'message' | 'responseHistory' | 'partiallyGeneratedResponse'>;
    authoritativeState: Pick<GameState,
      'players' | 'currentLocationData' | 'activeQuests' | 'completedQuests' | 'encounteredNPCs' |
      'worldStateFlags' | 'encounteredFactions' | 'enemiesData' | 'alliesData' |
      'playerCustomStates' | 'plotOutline' | 'worldEventsLog'>;
  };
}

export interface ArenaGmTurnResponse {
  kind: 'arena-gm-response';
  protocolVersion: typeof ARENA_GM_PROTOCOL_VERSION;
  correlationId: string;
  response: GameResponse;
}

export interface ArenaGmStepRequest {
  kind: 'arena-gm-step';
  protocolVersion: typeof ARENA_GM_PROTOCOL_VERSION;
  correlationId: string;
  createdAt: string;
  stepName: string;
  modelName: string;
  attempt: number;
  systemInstruction?: string;
  instructions: string;
  prompt: string;
}

export interface ArenaGmStepResponse {
  kind: 'arena-gm-step-response';
  protocolVersion: typeof ARENA_GM_PROTOCOL_VERSION;
  correlationId: string;
  output: Record<string, unknown>;
  thoughtSignature?: string;
}

export interface ArenaGmImageRequest {
  kind: 'arena-gm-image';
  protocolVersion: typeof ARENA_GM_PROTOCOL_VERSION;
  correlationId: string;
  createdAt: string;
  prompt: string;
  width: number;
  height: number;
  instructions: string;
}

export interface ArenaGmImageResponse {
  kind: 'arena-gm-image-response';
  protocolVersion: typeof ARENA_GM_PROTOCOL_VERSION;
  correlationId: string;
}

interface RelayRequestEventDetail {
  request: ArenaGmTurnRequest;
  resolve: (response: GameResponse) => void;
  reject: (reason: Error) => void;
}

const newCorrelationId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export function isArenaGmRelayEnabled(): boolean {
  // AI generation is intentionally fixed to the Arena relay.
  return true;
}

export function createArenaGmTurnRequest(
  context: GameContext,
  state: GameState,
  history: ChatMessage[],
): ArenaGmTurnRequest {
  const { image: _image, message, responseHistory: _responseHistory, partiallyGeneratedResponse: _partial, ...restContext } = context;
  const gameContext = {
    ...restContext,
    gameSettings: { ...restContext.gameSettings },
  };
  const authoritativeState = {
    players: state.players,
    currentLocationData: state.currentLocationData,
    activeQuests: state.activeQuests,
    completedQuests: state.completedQuests,
    encounteredNPCs: state.encounteredNPCs,
    worldStateFlags: state.worldStateFlags,
    encounteredFactions: state.encounteredFactions,
    enemiesData: state.enemiesData,
    alliesData: state.alliesData,
    playerCustomStates: state.playerCustomStates,
    plotOutline: state.plotOutline,
    worldEventsLog: state.worldEventsLog,
  };
  return {
    kind: 'arena-gm-turn',
    protocolVersion: ARENA_GM_PROTOCOL_VERSION,
    correlationId: newCorrelationId(),
    createdAt: new Date().toISOString(),
    instructions: [
      'Act as the game master for this role-playing game. Resolve the player action consistently with the supplied world state, game settings, and instructions.',
      'Return only a JSON object with kind="arena-gm-response", protocolVersion=1, the same correlationId, and a response object. Write it atomically to .arena-gm-relay/responses/<correlationId>.json.',
      'The response object must follow the game response schema. Include response (narrative) and only state changes that are warranted.',
      'Do not claim to have changed state outside the structured response; the application applies the response.',
    ].join(' '),
    turn: {
      number: context.currentTurnNumber,
      playerAction: message,
      history: history.slice(-20).map(({ sender, content }) => ({ sender, content })),
      gameContext: gameContext as ArenaGmTurnRequest['turn']['gameContext'],
      authoritativeState,
    },
  };
}

export function formatArenaGmTurnRequest(request: ArenaGmTurnRequest): string {
  return JSON.stringify(request, null, 2);
}

const waitForNextPoll = (signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Turn cancelled.', 'AbortError')); return; }
  const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
  const abort = () => { window.clearTimeout(timeout); signal?.removeEventListener('abort', abort); reject(new DOMException('Turn cancelled.', 'AbortError')); };
  const timeout = window.setTimeout(finish, 900);
  signal?.addEventListener('abort', abort, { once: true });
});

interface QueuedImageJob {
  run: (signal: AbortSignal) => Promise<string>;
  signal?: AbortSignal;
  resolve: (image: string) => void;
  reject: (error: Error) => void;
  started: boolean;
  preempted: boolean;
  attemptController?: AbortController;
  abortHandler?: () => void;
}

const queuedImageJobs: QueuedImageJob[] = [];
const waitingTurnLeases: Array<(release: () => void) => void> = [];
let imageJobActive = false;
let activeImageJob: QueuedImageJob | null = null;
let turnLeaseActive = false;

/** A game turn must not infer ownership completion from an empty interval in the relay queue. */
function pumpRelayJobs(): void {
  if (imageJobActive || turnLeaseActive) return;
  while (queuedImageJobs.length && queuedImageJobs[0].signal?.aborted) {
    const cancelled = queuedImageJobs.shift()!;
    if (cancelled.abortHandler) cancelled.signal?.removeEventListener('abort', cancelled.abortHandler);
    cancelled.reject(new DOMException('Image request cancelled.', 'AbortError'));
  }
  if (waitingTurnLeases.length) {
    turnLeaseActive = true;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      turnLeaseActive = false;
      pumpRelayJobs();
    };
    waitingTurnLeases.shift()!(release);
    return;
  }
  const job = queuedImageJobs.shift();
  if (!job) return;
  if (job.signal?.aborted) {
    job.signal?.removeEventListener('abort', job.abortHandler!);
    job.reject(new DOMException('Image request cancelled.', 'AbortError'));
    pumpRelayJobs();
    return;
  }

  job.started = true;
  job.preempted = false;
  imageJobActive = true;
  activeImageJob = job;
  const attemptController = new AbortController();
  job.attemptController = attemptController;
  const abortAttempt = () => attemptController.abort();
  job.signal?.addEventListener('abort', abortAttempt, { once: true });

  job.run(attemptController.signal).then(image => {
    job.resolve(image);
    job.signal?.removeEventListener('abort', job.abortHandler!);
  }, error => {
    if (job.preempted && !job.signal?.aborted) {
      // Abort this correlation ID cleanly, then retry the image after the waiting turn.
      job.started = false;
      job.preempted = false;
      queuedImageJobs.unshift(job);
    } else {
      job.signal?.removeEventListener('abort', job.abortHandler!);
      job.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }).finally(() => {
    job.signal?.removeEventListener('abort', abortAttempt);
    job.attemptController = undefined;
    if (activeImageJob === job) activeImageJob = null;
    imageJobActive = false;
    pumpRelayJobs();
  });
}

/** Hold images while the full staged game turn is in progress. */
export function acquireArenaGmTurnLease(): Promise<() => void> {
  return new Promise(resolve => {
    waitingTurnLeases.push(resolve);
    // A portrait may already be generating during cold start. Cancel only that image
    // attempt, retain its job, and retry it after every waiting turn lease is released.
    if (activeImageJob && !activeImageJob.signal?.aborted) {
      activeImageJob.preempted = true;
      activeImageJob.attemptController?.abort();
    }
    pumpRelayJobs();
  });
}

function enqueueArenaGmImage(run: (signal: AbortSignal) => Promise<string>, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new DOMException('Image request cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const job: QueuedImageJob = { run, signal, resolve, reject, started: false, preempted: false };
    job.abortHandler = () => {
      if (job.started) {
        job.attemptController?.abort();
        return;
      }
      const index = queuedImageJobs.indexOf(job);
      if (index >= 0) queuedImageJobs.splice(index, 1);
      signal?.removeEventListener('abort', job.abortHandler!);
      reject(new DOMException('Image request cancelled.', 'AbortError'));
      pumpRelayJobs();
    };
    signal?.addEventListener('abort', job.abortHandler, { once: true });
    queuedImageJobs.push(job);
    pumpRelayJobs();
  });
}

function rememberActiveRelayCorrelation(correlationId: string): void {
  try { window.sessionStorage.setItem(ACTIVE_RELAY_CORRELATION_KEY, correlationId); } catch { /* Session storage is a recovery aid only. */ }
}

function clearActiveRelayCorrelation(correlationId: string): void {
  try {
    if (window.sessionStorage.getItem(ACTIVE_RELAY_CORRELATION_KEY) === correlationId) {
      window.sessionStorage.removeItem(ACTIVE_RELAY_CORRELATION_KEY);
    }
  } catch { /* Ignore unavailable storage. */ }
}

async function cancelQueuedRelayRequest(correlationId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/__arena_gm/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correlationId }), keepalive: true,
    });
  } catch { /* Best-effort cancellation; the server still isolates every response by correlationId. */ }
  clearActiveRelayCorrelation(correlationId);
}

/** Cancel the previous page's remembered request before replaying an interrupted turn. */
export async function cancelInterruptedArenaGmRequest(): Promise<void> {
  if (typeof window === 'undefined') return;
  let correlationId: string | null = null;
  try { correlationId = window.sessionStorage.getItem(ACTIVE_RELAY_CORRELATION_KEY); } catch { /* Ignore unavailable storage. */ }
  if (correlationId) await cancelQueuedRelayRequest(correlationId);
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Turn cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

const isRetryableHttpStatus = (status: number): boolean => status === 408 || status === 425 || status === 429 || status >= 500;

async function postAndWaitForRelayResponse<T extends { kind: string; protocolVersion: number; correlationId: string }>(
  request: ArenaGmTurnRequest | ArenaGmStepRequest | ArenaGmImageRequest,
  expectedKind: T['kind'],
  signal?: AbortSignal,
): Promise<T> {
  if (typeof window === 'undefined') throw new Error('Arena GM Relay requires a browser window.');
  if (!isArenaGmRelayEnabled()) throw new Error('Arena GM Relay is disabled.');
  if (signal?.aborted) throw new DOMException('Turn cancelled.', 'AbortError');

  let completed = false;
  let accepted = false;
  let retryDelay = 900;
  rememberActiveRelayCorrelation(request.correlationId);
  try {
    // Reposting the exact packet is safe: the relay treats matching correlation IDs idempotently.
    while (true) {
      while (!accepted) {
      if (signal?.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
      let response: Response;
      try {
        response = await fetch('/__arena_gm/turn', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
        });
      } catch (error) {
        if (signal?.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
        console.warn('Arena GM relay connection interrupted while submitting; retrying the same request.', error);
        await waitForRetry(retryDelay, signal);
        retryDelay = Math.min(10_000, Math.round(retryDelay * 1.7));
        continue;
      }
      if (response.ok) {
        accepted = true;
        retryDelay = 900;
        break;
      }
      if (isRetryableHttpStatus(response.status)) {
        console.warn(`Arena GM relay returned ${response.status} while submitting; retrying.`);
        await waitForRetry(retryDelay, signal);
        retryDelay = Math.min(10_000, Math.round(retryDelay * 1.7));
        continue;
      }
      throw new Error(`Relay server returned ${response.status}.`);
    }

    while (!signal?.aborted) {
      await waitForNextPoll(signal);
      let result: Response;
      try {
        result = await fetch(`/__arena_gm/response?correlationId=${encodeURIComponent(request.correlationId)}`, { cache: 'no-store', signal });
      } catch (error) {
        if (signal?.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
        console.warn('Arena GM relay poll interrupted; keeping the request active and retrying.', error);
        await waitForRetry(retryDelay, signal);
        retryDelay = Math.min(10_000, Math.round(retryDelay * 1.7));
        continue;
      }
      if (result.status === 204) {
        retryDelay = 900;
        continue;
      }
      if (isRetryableHttpStatus(result.status)) {
        console.warn(`Arena GM relay poll returned ${result.status}; retrying without cancelling the request.`);
        await waitForRetry(retryDelay, signal);
        retryDelay = Math.min(10_000, Math.round(retryDelay * 1.7));
        continue;
      }
      if (result.status === 410 && request.kind === 'arena-gm-image') {
        // The image lease may expire while its browser owner is disconnected. If this
        // owner is still polling (and hasn't explicitly aborted), safely requeue the
        // same correlation ID instead of failing a recoverable image request.
        console.warn('Arena GM image request expired without a heartbeat; resubmitting the same image request.');
        accepted = false;
        retryDelay = 900;
        break;
      }
      if (!result.ok) throw new Error(`Relay response read failed (${result.status}).`);
      const envelope = await result.json();
      completed = true;
      clearActiveRelayCorrelation(request.correlationId);
      if (envelope?.kind !== expectedKind || envelope?.protocolVersion !== ARENA_GM_PROTOCOL_VERSION || envelope?.correlationId !== request.correlationId) {
        throw new Error('The mailbox returned a response for a different request or protocol.');
      }
      return envelope as T;
      }
      if (signal?.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
      if (!accepted && request.kind === 'arena-gm-image') continue;
      throw new DOMException('Turn cancelled.', 'AbortError');
    }
  } finally {
    // Only an explicit AbortController cancellation may delete an unfinished request.
    // Transient network errors are retried above; page reloads are recovered from a saved turn checkpoint.
    if (!completed && signal?.aborted) await cancelQueuedRelayRequest(request.correlationId);
  }
}

export async function requestArenaGmStep(
  prompt: string,
  stepName: string,
  modelName: string,
  attempt: number,
  signal?: AbortSignal,
  systemInstruction?: string,
): Promise<{ text: string; thoughtSignature?: string }> {
  const request: ArenaGmStepRequest = {
    kind: 'arena-gm-step', protocolVersion: ARENA_GM_PROTOCOL_VERSION,
    correlationId: newCorrelationId(), createdAt: new Date().toISOString(),
    stepName, modelName, attempt, systemInstruction,
    instructions: 'Perform exactly this generation step from the game pipeline. Read and obey the supplied systemInstruction (if present) and prompt, especially the allowed-key/output contract. Return one arena-gm-step-response JSON envelope with this correlationId and output containing only the JSON object for this step. Write it atomically to .arena-gm-relay/responses/<correlationId>.json. Do not skip or combine steps.',
    prompt,
  };
  const envelope = await postAndWaitForRelayResponse<ArenaGmStepResponse>(request, 'arena-gm-step-response', signal);
  if (!envelope.output || typeof envelope.output !== 'object' || Array.isArray(envelope.output)) {
    throw new Error(`Relay output for ${stepName} must be a JSON object.`);
  }
  return { text: JSON.stringify(envelope.output), thoughtSignature: envelope.thoughtSignature };
}

async function requestArenaGmImageDirect(
  prompt: string,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<string> {
  const request: ArenaGmImageRequest = {
    kind: 'arena-gm-image', protocolVersion: ARENA_GM_PROTOCOL_VERSION,
    correlationId: newCorrelationId(), createdAt: new Date().toISOString(),
    prompt, width, height,
    instructions: 'Generate one image from the prompt and save it at .arena-gm-relay/images/<correlationId>.png. Then write an arena-gm-image-response envelope atomically to .arena-gm-relay/responses/<correlationId>.json. Do not alter the game or invent a text reply.',
  };
  const envelope = await postAndWaitForRelayResponse<ArenaGmImageResponse>(request, 'arena-gm-image-response', signal);
  const imageResponse = await fetch(`/__arena_gm/image?correlationId=${encodeURIComponent(envelope.correlationId)}`, { cache: 'no-store', signal });
  if (!imageResponse.ok) throw new Error(`Arena image file is unavailable (${imageResponse.status}).`);
  const blob = await imageResponse.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read generated image.'));
    reader.onerror = () => reject(reader.error || new Error('Could not read generated image.'));
    reader.readAsDataURL(blob);
  });
}

/** Images are serialized and deferred until all active game-turn stages have finished. */
export function requestArenaGmImage(
  prompt: string,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<string> {
  return enqueueArenaGmImage(attemptSignal => requestArenaGmImageDirect(prompt, width, height, attemptSignal), signal);
}

export async function requestArenaGmTurn(request: ArenaGmTurnRequest, signal?: AbortSignal): Promise<GameResponse> {
  const envelope = await postAndWaitForRelayResponse<ArenaGmTurnResponse>(request, 'arena-gm-response', signal);
  if (!envelope.response || typeof envelope.response !== 'object' || typeof envelope.response.response !== 'string') {
    throw new Error('Relay response is missing its structured narrative response.');
  }
  return envelope.response;
}

/** Parse a pasted response, optionally accepting a Markdown JSON code fence. */
export function parseArenaGmTurnResponse(input: string, expectedCorrelationId: string): ArenaGmTurnResponse {
  const trimmed = input.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value: unknown;
  try { value = JSON.parse(trimmed); }
  catch { throw new Error('Invalid JSON. Paste the complete arena-gm-response object.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Response must be a JSON object.');
  const envelope = value as Partial<ArenaGmTurnResponse>;
  if (envelope.kind !== 'arena-gm-response') throw new Error('Expected kind "arena-gm-response".');
  if (envelope.protocolVersion !== ARENA_GM_PROTOCOL_VERSION) throw new Error(`Unsupported protocol version: ${String(envelope.protocolVersion)}.`);
  if (envelope.correlationId !== expectedCorrelationId) throw new Error('This response belongs to a different game turn.');
  if (!envelope.response || typeof envelope.response !== 'object' || Array.isArray(envelope.response)) throw new Error('Missing structured response object.');
  if (typeof envelope.response.response !== 'string') throw new Error('Structured response must include a narrative "response" string.');
  return envelope as ArenaGmTurnResponse;
}

export function getArenaGmRequestEventName(): string { return REQUEST_EVENT; }
