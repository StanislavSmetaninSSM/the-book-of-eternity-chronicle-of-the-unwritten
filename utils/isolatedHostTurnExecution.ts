import { createTurnManager } from '../hooks/logic/turn';
import type { ChatMessage, GameState, Language, SaveFile } from '../types';

type Input = {
    snapshot: SaveFile;
    kind: 'action' | 'question';
    text: string;
    image: { data: string; mimeType: string } | null;
    language: Language;
    t: (key: string, replacements?: any) => string;
    signal?: AbortSignal;
};
type Result = { status: 'candidate'; saveFile: SaveFile } | { status: 'failed' | 'cancelled'; error?: string };

/** Run the existing host turn manager against a private, isolated snapshot.
 * This does NOT commit, publish, reserve authority, validate a network actor,
 * or prove that the original snapshot is still current. The caller must do
 * all of those things and retain its hold through the eventual React commit. */
export async function executeIsolatedHostTurn(input: Input): Promise<Result> {
    if (input.signal?.aborted) return { status: 'cancelled' };
    if (input.snapshot?.gameState?.networkRole !== 'host' || !input.snapshot.gameContext ||
        !input.text.trim() || (input.kind !== 'action' && input.kind !== 'question')) return { status: 'failed', error: 'Invalid host turn' };
    let copy: SaveFile;
    try { copy = structuredClone(input.snapshot); }
    catch { return { status: 'failed', error: 'Host snapshot cannot be isolated' }; }
    const stateRef: { current: GameState | null } = { current: copy.gameState };
    const contextRef = { current: copy.gameContext };
    const abortControllerRef: { current: AbortController | null } = { current: null };
    let history: ChatMessage[] = copy.gameHistory;
    let error: string | null = null;
    let result: SaveFile | null = null;
    const noop = () => {};
    const manager = createTurnManager({
        gameState: copy.gameState,
        setGameState: update => { stateRef.current = typeof update === 'function' ? update(stateRef.current) : update; },
        gameHistory: history,
        setGameHistory: update => { history = typeof update === 'function' ? update(history) : update; },
        isLoading: false, setIsLoading: noop,
        setError: update => { error = typeof update === 'function' ? update(error) : update; },
        setLastJsonResponse: noop, setLastRequestJson: noop, setGameLog: noop, setCombatLog: noop,
        setSceneImagePrompt: noop, setSuggestedActions: noop, setWorldMap: noop, setVisitedLocations: noop,
        setWorldState: noop, setTurnNumber: noop, gameContextRef: contextRef, abortControllerRef,
        setSuperInstructions: noop, setGameSettings: noop, setLanguage: noop, t: input.t,
        turnStartTimeRef: { current: null }, setTurnTime: noop, setCurrentStep: noop, setCurrentModel: noop,
        language: input.language, gameSettings: copy.gameContext.gameSettings,
        hostConnectionRef: { current: null }, gameStateRef: stateRef,
        broadcastFullSync: save => { result = save; }, combatLog: copy.combatLog, gameLog: copy.gameLog
    });
    const abort = () => abortControllerRef.current?.abort(input.signal?.reason);
    input.signal?.addEventListener('abort', abort, { once: true });
    try {
        // Recheck after listener registration to close the pre-start race.
        if (input.signal?.aborted) return { status: 'cancelled' };
        if (input.kind === 'action') await manager.sendMessage(input.text, input.image);
        else await manager.askQuestion(input.text, input.image);
        if (input.signal?.aborted) return { status: 'cancelled' };
        if (result) return { status: 'candidate', saveFile: result };
        return { status: 'failed', ...(error ? { error } : {}) };
    } catch (e) {
        if (input.signal?.aborted) return { status: 'cancelled' };
        return { status: 'failed', error: e instanceof Error ? e.message : 'Host generation failed' };
    } finally {
        input.signal?.removeEventListener('abort', abort);
    }
}
