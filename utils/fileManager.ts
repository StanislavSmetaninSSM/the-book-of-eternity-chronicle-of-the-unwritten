

import { ChatMessage, GameContext, GameState, SaveFile, DBSaveSlotInfo } from "../types";

type TFunction = (key: string, replacements?: Record<string, string | number>) => string;

export interface PreparedSaveFile {
  filename: string;
  url: string;
}

/** Prepare a save as a Blob URL; the UI renders a real user-clickable download link. */
export function prepareSaveGameFile(saveData: SaveFile): PreparedSaveFile {
  const blob = new Blob([JSON.stringify(saveData)], { type: 'application/json;charset=utf-8' });
  return {
    filename: `gemini-rpg-save-${new Date().toISOString().slice(0, 10)}.json`,
    url: URL.createObjectURL(blob),
  };
}

export function releasePreparedSaveFile(saveFile: PreparedSaveFile): void {
  URL.revokeObjectURL(saveFile.url);
}

/** Prepare a configuration as a Blob URL so the UI can offer a real clickable download link. */
export function prepareConfigurationFile(configData: unknown): PreparedSaveFile {
  const blob = new Blob([JSON.stringify(configData, null, 2)], { type: 'application/json;charset=utf-8' });
  return {
    filename: `gemini-rpg-config-${new Date().toISOString().slice(0, 10)}.json`,
    url: URL.createObjectURL(blob),
  };
}

export function loadGameFromFile(t: TFunction): Promise<SaveFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    let fileSelected = false; 

    const cleanup = () => {
      if (document.body.contains(input)) {
        document.body.removeChild(input);
      }
      window.removeEventListener('focus', handleFocus);
    };

    const handleFocus = () => {
      setTimeout(() => {
        if (!fileSelected) {
          console.log('Load operation cancelled by user.');
          cleanup();
          resolve(null);
        }
      }, 500);
    };
    
    window.addEventListener('focus', handleFocus, { once: true });

    input.onchange = async (event: Event) => {
      fileSelected = true;
      const target = event.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        const file = target.files[0];
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          
          if (data && data.gameContext && data.gameState) {
            resolve(data as SaveFile);
          } else {
            alert(t('Invalid save file format.'));
            resolve(null);
          }
        } catch (err) {
          console.error('Error parsing save file:', err);
          alert(t('Could not read or parse the save file.'));
          resolve(null);
        } finally {
          cleanup();
        }
      } else {
        cleanup();
        resolve(null);
      }
    };

    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
  });
}

export function loadConfigurationFromFile(t: TFunction): Promise<any | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    let fileSelected = false;

    const cleanup = () => {
      if (document.body.contains(input)) {
        document.body.removeChild(input);
      }
      window.removeEventListener('focus', handleFocus);
    };

    const handleFocus = () => {
      setTimeout(() => {
        if (!fileSelected) {
          console.log('Load operation cancelled by user.');
          cleanup();
          resolve(null);
        }
      }, 500);
    };
    
    window.addEventListener('focus', handleFocus, { once: true });

    input.onchange = async (event: Event) => {
      fileSelected = true;
      const target = event.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        const file = target.files[0];
        try {
          const text = await file.text();
          const data = JSON.parse(text);

          if (data && data.formData && !data.gameContext && !data.gameState) {
            resolve(data);
          } else {
            alert(t('Invalid configuration file format.'));
            resolve(null);
          }
        } catch (err) {
          console.error('Error parsing configuration file:', err);
          alert(t('Could not read or parse the configuration file.'));
          resolve(null);
        } finally {
          cleanup();
        }
      } else {
        cleanup();
        resolve(null);
      }
    };

    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
  });
}

// --- IndexedDB ---

const DB_NAME = 'gemini-rpg-db';
const DB_VERSION = 3;
const AUTOSAVE_STORE_NAME = 'autosaves';
const SLOTS_STORE_NAME = 'save_slots';
const INTERRUPTED_TURNS_STORE_NAME = 'interrupted_turns';
const AUTOSAVE_ID = 'current_autosave';
const INTERRUPTED_TURN_ID = 'pending-turn';
const CRASH_RECOVERY_ID = 'last_known_good_save';
const START_SCREEN_FORM_DRAFT_ID = 'start_screen_form_draft';
const START_SCREEN_WORLD_DRAFT_ID = 'start_screen_world_draft';
const AUTOSAVE_TIMESTAMP_STORAGE_KEY = 'gemini-rpg-autosave-timestamp';
const SAVE_SLOT_METADATA_STORAGE_KEY = 'gemini-rpg-save-slot-metadata';
const CRASH_RECOVERY_METADATA_STORAGE_KEY = 'gemini-rpg-crash-recovery-metadata';
const CRASH_RECOVERY_MARKER_STORAGE_KEY = 'gemini-rpg-crash-recovery-marker';
const STARTUP_LOAD_REQUEST_STORAGE_KEY = 'gemini-rpg-startup-load-request';
export const UNKNOWN_AUTOSAVE_TIMESTAMP = 'autosave-available-without-timestamp';

export type CrashRecoveryReason = 'stable' | 'pre_action' | 'loaded';
export type StartupLoadRequest = 'crashRecovery' | 'autosave';

export interface CrashRecoveryMetadata {
  timestamp: string;
  reason: CrashRecoveryReason;
  playerName: string;
  locationName: string;
  turnNumber: number | null;
  networkRole: string;
}

export interface InterruptedTurnRecovery {
  id: 'pending-turn';
  createdAt: string;
  context: GameContext;
  baseState: GameState;
  history: ChatMessage[];
}

export interface CrashRecoveryMarker {
  timestamp: string;
  source: string;
  message: string;
  stack?: string;
  componentStack?: string;
  recoveryTimestamp: string | null;
  recoveryTurnNumber: number | null;
  recoveryAttemptedAt?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function readStorageValue(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    // Metadata is only an optimization; IndexedDB remains the source of truth.
  }
}

function removeStorageValue(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch {
    // Metadata cleanup should never block the game.
  }
}

function buildSlotInfo(slotId: number, saveData: SaveFile): DBSaveSlotInfo {
  return {
    slotId,
    timestamp: saveData.timestamp,
    playerName: saveData.gameState.playerCharacter.name,
    playerLevel: saveData.gameState.playerCharacter.level,
    locationName: saveData.gameState.currentLocationData.name,
    turnNumber: saveData.gameContext.currentTurnNumber,
  };
}

function buildCrashRecoveryMetadata(saveData: SaveFile, reason: CrashRecoveryReason): CrashRecoveryMetadata {
  return {
    timestamp: saveData.timestamp,
    reason,
    playerName: saveData.gameState?.playerCharacter?.name || 'Unknown',
    locationName: saveData.gameState?.currentLocationData?.name || 'Unknown',
    turnNumber: typeof saveData.gameContext?.currentTurnNumber === 'number' ? saveData.gameContext.currentTurnNumber : null,
    networkRole: saveData.gameState?.networkRole || 'none',
  };
}

function readCrashRecoveryMetadataFromStorage(): CrashRecoveryMetadata | null {
  const raw = readStorageValue(CRASH_RECOVERY_METADATA_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.timestamp === 'string' &&
      typeof parsed.reason === 'string' &&
      typeof parsed.playerName === 'string' &&
      typeof parsed.locationName === 'string' &&
      (typeof parsed.turnNumber === 'number' || parsed.turnNumber === null) &&
      typeof parsed.networkRole === 'string'
    ) {
      return parsed as CrashRecoveryMetadata;
    }
  } catch {
    return null;
  }

  return null;
}

function writeCrashRecoveryMetadataToStorage(metadata: CrashRecoveryMetadata): void {
  writeStorageValue(CRASH_RECOVERY_METADATA_STORAGE_KEY, JSON.stringify(metadata));
}

function readSlotMetadataFromStorage(): DBSaveSlotInfo[] | null {
  const raw = readStorageValue(SAVE_SLOT_METADATA_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((slot): slot is DBSaveSlotInfo =>
        slot &&
        typeof slot.slotId === 'number' &&
        typeof slot.timestamp === 'string' &&
        typeof slot.playerName === 'string' &&
        typeof slot.playerLevel === 'number' &&
        typeof slot.locationName === 'string' &&
        typeof slot.turnNumber === 'number'
      )
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch {
    return null;
  }
}

function writeSlotMetadataToStorage(slots: DBSaveSlotInfo[]): void {
  writeStorageValue(
    SAVE_SLOT_METADATA_STORAGE_KEY,
    JSON.stringify(slots.sort((a, b) => b.timestamp.localeCompare(a.timestamp)))
  );
}

function upsertSlotMetadata(slotInfo: DBSaveSlotInfo): void {
  const existingSlots = readSlotMetadataFromStorage() || [];
  const nextSlots = [
    slotInfo,
    ...existingSlots.filter(slot => slot.slotId !== slotInfo.slotId)
  ];
  writeSlotMetadataToStorage(nextSlots);
}

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB error:', request.error);
        reject(request.error);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(AUTOSAVE_STORE_NAME)) {
          db.createObjectStore(AUTOSAVE_STORE_NAME, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(SLOTS_STORE_NAME)) {
          db.createObjectStore(SLOTS_STORE_NAME, { keyPath: 'slotId' });
        }
        if (!db.objectStoreNames.contains(INTERRUPTED_TURNS_STORE_NAME)) {
          db.createObjectStore(INTERRUPTED_TURNS_STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        resolve(db);
      };
    });
  }
  return dbPromise;
}

// --- Start-screen draft Functions ---

export interface StartScreenDraft {
  formData: Record<string, unknown> | null;
  customGameData: unknown | null;
}

export async function saveStartScreenFormDraft(formData: Record<string, unknown>): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
  transaction.objectStore(AUTOSAVE_STORE_NAME).put({
    id: START_SCREEN_FORM_DRAFT_ID,
    updatedAt: new Date().toISOString(),
    data: formData,
  });
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveStartScreenWorldDraft(customGameData: unknown): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
  transaction.objectStore(AUTOSAVE_STORE_NAME).put({
    id: START_SCREEN_WORLD_DRAFT_ID,
    updatedAt: new Date().toISOString(),
    data: customGameData,
  });
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function loadStartScreenDraft(): Promise<StartScreenDraft> {
  try {
    const db = await openDB();
    const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readonly');
    const store = transaction.objectStore(AUTOSAVE_STORE_NAME);
    const formRequest = store.get(START_SCREEN_FORM_DRAFT_ID);
    const worldRequest = store.get(START_SCREEN_WORLD_DRAFT_ID);
    const [formRecord, worldRecord] = await Promise.all([
      new Promise<any>((resolve, reject) => {
        formRequest.onsuccess = () => resolve(formRequest.result);
        formRequest.onerror = () => reject(formRequest.error);
      }),
      new Promise<any>((resolve, reject) => {
        worldRequest.onsuccess = () => resolve(worldRequest.result);
        worldRequest.onerror = () => reject(worldRequest.error);
      }),
    ]);
    return {
      formData: formRecord?.data && typeof formRecord.data === 'object' ? formRecord.data : null,
      customGameData: worldRecord?.data ?? null,
    };
  } catch (error) {
    console.error('Failed to load start-screen draft from IndexedDB:', error);
    return { formData: null, customGameData: null };
  }
}

export interface PlayerActionDraft {
  content: string;
  isQuestionMode: boolean;
}

export async function loadPlayerActionDraft(playerId: string): Promise<PlayerActionDraft | null> {
  try {
    const db = await openDB();
    const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(AUTOSAVE_STORE_NAME).get(`player_action_draft:${playerId}`);
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const data = request.result?.data;
        resolve(data && typeof data.content === 'string'
          ? { content: data.content, isQuestionMode: Boolean(data.isQuestionMode) }
          : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to load player action draft from IndexedDB:', error);
    return null;
  }
}

export async function savePlayerActionDraft(playerId: string, draft: PlayerActionDraft | null): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(AUTOSAVE_STORE_NAME);
  const id = `player_action_draft:${playerId}`;
  if (draft?.content.trim()) {
    store.put({ id, updatedAt: new Date().toISOString(), data: draft });
  } else {
    store.delete(id);
  }
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function clearStartScreenDraft(): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(AUTOSAVE_STORE_NAME);
  store.delete(START_SCREEN_FORM_DRAFT_ID);
  store.delete(START_SCREEN_WORLD_DRAFT_ID);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

// --- Autosave Functions ---

export async function saveToDB(saveData: SaveFile): Promise<void> {
  try {
    const db = await openDB();
    const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(AUTOSAVE_STORE_NAME);
    const dataToStore = { id: AUTOSAVE_ID, saveData };
    store.put(dataToStore);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        console.error('IndexedDB save transaction error:', transaction.error);
        reject(transaction.error);
      };
    });
    writeStorageValue(AUTOSAVE_TIMESTAMP_STORAGE_KEY, saveData.timestamp);
  } catch (error) {
    console.error('Failed to save to IndexedDB:', error);
    throw error;
  }
}

export async function loadFromDB(): Promise<SaveFile | null> {
  try {
    const db = await openDB();
    const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readonly');
    const store = transaction.objectStore(AUTOSAVE_STORE_NAME);
    const request = store.get(AUTOSAVE_ID);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.saveData);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => {
        console.error('Failed to load from IndexedDB:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to load from IndexedDB:', error);
    return null;
  }
}

export async function saveInterruptedTurnRecovery(recovery: Omit<InterruptedTurnRecovery, 'id' | 'createdAt'>): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(INTERRUPTED_TURNS_STORE_NAME, 'readwrite');
  transaction.objectStore(INTERRUPTED_TURNS_STORE_NAME).put({
    id: INTERRUPTED_TURN_ID,
    createdAt: new Date().toISOString(),
    ...recovery,
  } satisfies InterruptedTurnRecovery);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Interrupted-turn checkpoint write was aborted.'));
  });
}

export async function loadInterruptedTurnRecovery(): Promise<InterruptedTurnRecovery | null> {
  try {
    const db = await openDB();
    const transaction = db.transaction(INTERRUPTED_TURNS_STORE_NAME, 'readonly');
    const request = transaction.objectStore(INTERRUPTED_TURNS_STORE_NAME).get(INTERRUPTED_TURN_ID);
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to load interrupted-turn checkpoint:', error);
    return null;
  }
}

export async function clearInterruptedTurnRecovery(): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(INTERRUPTED_TURNS_STORE_NAME, 'readwrite');
  transaction.objectStore(INTERRUPTED_TURNS_STORE_NAME).delete(INTERRUPTED_TURN_ID);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Interrupted-turn checkpoint deletion was aborted.'));
  });
}

export async function saveCrashRecoveryPoint(saveData: SaveFile, reason: CrashRecoveryReason = 'stable'): Promise<CrashRecoveryMetadata> {
  const metadata = buildCrashRecoveryMetadata(saveData, reason);

  try {
    const db = await openDB();
    const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(AUTOSAVE_STORE_NAME);
    store.put({ id: CRASH_RECOVERY_ID, saveData });

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        console.error('IndexedDB crash recovery transaction error:', transaction.error);
        reject(transaction.error);
      };
    });

    writeCrashRecoveryMetadataToStorage(metadata);
    return metadata;
  } catch (error) {
    console.error('Failed to save crash recovery point:', error);
    throw error;
  }
}

export async function loadCrashRecoveryPoint(): Promise<SaveFile | null> {
  try {
    const db = await openDB();
    const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readonly');
    const store = transaction.objectStore(AUTOSAVE_STORE_NAME);
    const request = store.get(CRASH_RECOVERY_ID);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result?.saveData ?? null);
      };
      request.onerror = () => {
        console.error('Failed to load crash recovery point:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to load crash recovery point:', error);
    return null;
  }
}

export function getCrashRecoveryMetadata(): CrashRecoveryMetadata | null {
  return readCrashRecoveryMetadataFromStorage();
}

function describeCrashReason(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || 'Unknown error',
      stack: error.stack?.slice(0, 8000),
    };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  try {
    return { message: JSON.stringify(error) || 'Unknown error' };
  } catch {
    return { message: String(error) };
  }
}

export function getCrashRecoveryMarker(): CrashRecoveryMarker | null {
  const raw = readStorageValue(CRASH_RECOVERY_MARKER_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.timestamp === 'string' &&
      typeof parsed.source === 'string' &&
      typeof parsed.message === 'string' &&
      (typeof parsed.recoveryTimestamp === 'string' || parsed.recoveryTimestamp === null) &&
      (typeof parsed.recoveryTurnNumber === 'number' || parsed.recoveryTurnNumber === null)
    ) {
      return parsed as CrashRecoveryMarker;
    }
  } catch {
    return null;
  }

  return null;
}

export function markCrashDetected(
  source: string,
  error: unknown,
  componentStack?: string
): CrashRecoveryMarker {
  const recovery = getCrashRecoveryMetadata();
  const described = describeCrashReason(error);
  const marker: CrashRecoveryMarker = {
    timestamp: new Date().toISOString(),
    source,
    message: described.message.slice(0, 1000),
    stack: described.stack,
    componentStack: componentStack?.slice(0, 8000),
    recoveryTimestamp: recovery?.timestamp ?? null,
    recoveryTurnNumber: recovery?.turnNumber ?? null,
  };

  writeStorageValue(CRASH_RECOVERY_MARKER_STORAGE_KEY, JSON.stringify(marker));
  return marker;
}

export function markCrashRecoveryAttempt(): CrashRecoveryMarker | null {
  const marker = getCrashRecoveryMarker();
  if (!marker) return null;

  const updatedMarker: CrashRecoveryMarker = {
    ...marker,
    recoveryAttemptedAt: new Date().toISOString(),
  };
  writeStorageValue(CRASH_RECOVERY_MARKER_STORAGE_KEY, JSON.stringify(updatedMarker));
  return updatedMarker;
}

export function clearCrashRecoveryMarker(): void {
  removeStorageValue(CRASH_RECOVERY_MARKER_STORAGE_KEY);
}

export function requestStartupLoad(request: StartupLoadRequest): void {
  writeStorageValue(STARTUP_LOAD_REQUEST_STORAGE_KEY, request);
}

export function consumeStartupLoadRequest(): StartupLoadRequest | null {
  const request = readStorageValue(STARTUP_LOAD_REQUEST_STORAGE_KEY);
  removeStorageValue(STARTUP_LOAD_REQUEST_STORAGE_KEY);

  if (request === 'crashRecovery' || request === 'autosave') {
    return request;
  }

  return null;
}

export async function getAutosaveTimestampFromDB(): Promise<string | null> {
  try {
    const cachedTimestamp = readStorageValue(AUTOSAVE_TIMESTAMP_STORAGE_KEY);
    if (cachedTimestamp) return cachedTimestamp;

    const db = await openDB();
    const transaction = db.transaction(AUTOSAVE_STORE_NAME, 'readonly');
    const store = transaction.objectStore(AUTOSAVE_STORE_NAME);
    const request = store.getKey(AUTOSAVE_ID);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result ? UNKNOWN_AUTOSAVE_TIMESTAMP : null);
      };
      request.onerror = () => {
        console.error('Failed to get timestamp from IndexedDB:', request.error);
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to get timestamp from IndexedDB:', error);
    return null;
  }
}

// --- Save Slot Functions ---

export async function saveToDBSlot(slotId: number, saveData: SaveFile): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(SLOTS_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(SLOTS_STORE_NAME);
  store.put({ slotId, saveData });

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  upsertSlotMetadata(buildSlotInfo(slotId, saveData));
}

export async function loadFromDBSlot(slotId: number): Promise<SaveFile | null> {
  const db = await openDB();
  const transaction = db.transaction(SLOTS_STORE_NAME, 'readonly');
  const store = transaction.objectStore(SLOTS_STORE_NAME);
  const request = store.get(slotId);

  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result?.saveData || null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteDBSlot(slotId: number): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(SLOTS_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(SLOTS_STORE_NAME);
  store.delete(slotId);

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  const existingSlots = readSlotMetadataFromStorage();
  if (existingSlots) {
    writeSlotMetadataToStorage(existingSlots.filter(slot => slot.slotId !== slotId));
  }
}

export async function listDBSlots(): Promise<DBSaveSlotInfo[]> {
  const cachedSlots = readSlotMetadataFromStorage();
  if (cachedSlots) return cachedSlots;

  const db = await openDB();
  const transaction = db.transaction(SLOTS_STORE_NAME, 'readonly');
  const store = transaction.objectStore(SLOTS_STORE_NAME);
  const request = store.getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const slots: DBSaveSlotInfo[] = request.result.map(item => buildSlotInfo(item.slotId, item.saveData));
      writeSlotMetadataToStorage(slots);
      resolve(slots.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
    };
    request.onerror = () => reject(request.error);
  });
}
