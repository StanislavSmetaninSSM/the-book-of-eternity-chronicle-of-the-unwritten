import type { ChatMessage, GameContext, GameResponse, GameState } from '../types';

export const ARENA_GM_PROTOCOL_VERSION = 1 as const;
const STORAGE_KEY = 'arena-gm-relay-enabled-v2';
const REQUEST_EVENT = 'arena-gm-relay:request';

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
  // Default to the Arena mailbox so a fresh Arena preview never falls through to
  // browser-side Gemini/OpenRouter calls. Users may explicitly switch it off.
  try { return localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { return true; }
}

export function setArenaGmRelayEnabled(enabled: boolean): void {
  try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch { /* storage may be unavailable */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('arena-gm-relay:setting'));
}

export function createArenaGmTurnRequest(
  context: GameContext,
  state: GameState,
  history: ChatMessage[],
): ArenaGmTurnRequest {
  const { image: _image, message, responseHistory: _responseHistory, partiallyGeneratedResponse: _partial, ...restContext } = context;
  const gameContext = {
    ...restContext,
    gameSettings: { ...restContext.gameSettings, openRouterApiKey: '' },
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
      'Return only a JSON object with kind="arena-gm-response", protocolVersion=1, the same correlationId, and a response object.',
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

async function postAndWaitForRelayResponse<T extends { kind: string; protocolVersion: number; correlationId: string }>(
  request: ArenaGmTurnRequest | ArenaGmStepRequest | ArenaGmImageRequest,
  expectedKind: T['kind'],
  signal?: AbortSignal,
): Promise<T> {
  if (typeof window === 'undefined') throw new Error('Arena GM Relay requires a browser window.');
  if (!isArenaGmRelayEnabled()) throw new Error('Arena GM Relay is disabled.');
  if (signal?.aborted) throw new DOMException('Turn cancelled.', 'AbortError');
  const accepted = await fetch('/__arena_gm/turn', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
  });
  if (!accepted.ok) throw new Error(`Relay server returned ${accepted.status}.`);
  while (!signal?.aborted) {
    await waitForNextPoll(signal);
    const result = await fetch(`/__arena_gm/response?correlationId=${encodeURIComponent(request.correlationId)}`, { cache: 'no-store', signal });
    if (result.status === 204) continue;
    if (!result.ok) throw new Error(`Relay response read failed (${result.status}).`);
    const envelope = await result.json();
    if (envelope?.kind !== expectedKind || envelope?.protocolVersion !== ARENA_GM_PROTOCOL_VERSION || envelope?.correlationId !== request.correlationId) {
      throw new Error('The mailbox returned a response for a different request or protocol.');
    }
    return envelope as T;
  }
  throw new DOMException('Turn cancelled.', 'AbortError');
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
    instructions: 'Perform exactly this generation step from the game pipeline. Read and obey the supplied systemInstruction (if present) and prompt, especially the allowed-key/output contract. Return one arena-gm-step-response JSON envelope with this correlationId and output containing only the JSON object for this step. Do not skip or combine steps.',
    prompt,
  };
  const envelope = await postAndWaitForRelayResponse<ArenaGmStepResponse>(request, 'arena-gm-step-response', signal);
  if (!envelope.output || typeof envelope.output !== 'object' || Array.isArray(envelope.output)) {
    throw new Error(`Relay output for ${stepName} must be a JSON object.`);
  }
  return { text: JSON.stringify(envelope.output), thoughtSignature: envelope.thoughtSignature };
}

export async function requestArenaGmImage(
  prompt: string,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<string> {
  const request: ArenaGmImageRequest = {
    kind: 'arena-gm-image', protocolVersion: ARENA_GM_PROTOCOL_VERSION,
    correlationId: newCorrelationId(), createdAt: new Date().toISOString(),
    prompt, width, height,
    instructions: 'Generate one image from the prompt and save it at .arena-gm-relay/images/<correlationId>.png. Then write an arena-gm-image-response envelope to .arena-gm-relay/response.json with this exact correlationId. Do not alter the game or invent a text reply.',
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
