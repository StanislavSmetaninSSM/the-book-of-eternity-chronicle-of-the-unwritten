import { isClientEditCommand, type ClientEditCommand } from './clientEditProtocol';

export type ClientEditIntentStatus = 'draft' | 'pending' | 'unknown' | 'conflict' | 'rejected' | 'committed';
export type ClientEditIntent = { command: ClientEditCommand; hostPeerId: string; createdAt: string; revision: number; status: ClientEditIntentStatus; reason?: string };
const DB = 'book-client-edit-intents-v1', STORE = 'intents', EPOCHS = 'hostEpochs', LIMIT = 128;
const transitions: Record<ClientEditIntentStatus, ClientEditIntentStatus[]> = {
    draft: ['pending'], pending: ['unknown', 'conflict', 'rejected', 'committed'],
    unknown: ['conflict', 'rejected', 'committed'], conflict: [], rejected: [], committed: [],
};
let dbPromise: Promise<IDBDatabase> | null = null;
function openIntentDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
        dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(DB, 3);
            let abandoned = false;
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'command.commandId' });
                if (!req.result.objectStoreNames.contains(EPOCHS)) req.result.createObjectStore(EPOCHS);
                else {
                    // Upgrade the short-lived v2 numeric markers without
                    // deleting intents or allowing the counter to repeat.
                    const cursor = req.transaction!.objectStore(EPOCHS).openCursor();
                    cursor.onsuccess = () => {
                        const entry = cursor.result;
                        if (!entry) return;
                        if (Number.isSafeInteger(entry.value) && entry.value >= 0) entry.update(crypto.randomUUID());
                        entry.continue();
                    };
                }
            };
            req.onerror = () => reject(req.error || new Error('Cannot open intent storage'));
            req.onblocked = () => { abandoned = true; reject(new Error('Intent storage upgrade is blocked by another tab')); };
            req.onsuccess = () => { if (abandoned) { req.result.close(); return; } req.result.onversionchange = () => { req.result.close(); dbPromise = null; }; resolve(req.result); };
        }).catch(error => { dbPromise = null; throw error; });
    }
    return dbPromise;
}
const validPeer = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128 && id.trim() === id && !/[\u0000-\u001f\u007f]/.test(id);
function validIntent(value: any): value is ClientEditIntent {
    return !!value && typeof value === 'object' && ['command,createdAt,hostPeerId,revision,status','command,createdAt,hostPeerId,reason,revision,status'].includes(Object.keys(value).sort().join(',')) &&
        isClientEditCommand(value.command) && validPeer(value.hostPeerId) && typeof value.createdAt === 'string' &&
        Number.isFinite(Date.parse(value.createdAt)) && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
        Object.prototype.hasOwnProperty.call(transitions, value.status) && (value.reason === undefined || (typeof value.reason === 'string' && /^[a-z_]{1,64}$/.test(value.reason)));
}
const sameIntent = (a: ClientEditIntent, b: ClientEditIntent) => validIntent(a) && validIntent(b) && JSON.stringify(a) === JSON.stringify(b);
function finished(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error || new Error('Intent transaction failed')); tx.onabort = () => reject(tx.error || new Error('Intent transaction aborted')); });
}
// The epoch and intent mutation share one IndexedDB transaction. A tab that
// never observed an intent can still detect its creation and later removal.
const validEpoch = (value: unknown): value is string => typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function bumpEpoch(tx: IDBTransaction, host: string): void {
    const store = tx.objectStore(EPOCHS), request = store.get(host);
    request.onsuccess = () => {
        if (request.result !== undefined && !validEpoch(request.result)) { tx.abort(); return; }
        // A fresh random marker avoids ABA if browser storage is cleared and
        // recreated while another tab still retains an old grant.
        store.put(crypto.randomUUID(), host);
    };
}
export async function getClientEditEpoch(host: string): Promise<string | null> {
    if (!validPeer(host)) throw new Error('Invalid host identity');
    const db = await openIntentDb(), tx = db.transaction(EPOCHS, 'readonly'), request = tx.objectStore(EPOCHS).get(host);
    let value: unknown;
    request.onsuccess = () => { value = request.result === undefined ? null : request.result; };
    await finished(tx);
    if (value !== null && !validEpoch(value)) throw new Error('Invalid host edit epoch');
    return value as string | null;
}
export class ClientEditIntentAlreadyExists extends Error {
    constructor() { super('An unresolved intent already exists for this host'); this.name = 'ClientEditIntentAlreadyExists'; }
}
export async function createClientEditIntent(input: { hostPeerId: string; command: ClientEditCommand }): Promise<ClientEditIntent> {
    if (!validPeer(input.hostPeerId) || !isClientEditCommand(input.command)) throw new Error('Invalid client edit intent');
    const intent: ClientEditIntent = { command: JSON.parse(JSON.stringify(input.command)), hostPeerId: input.hostPeerId, createdAt: new Date().toISOString(), revision: 0, status: 'draft' };
    // IndexedDB serializes readwrite transactions across tabs. Checking and
    // creating in the same transaction closes the check-then-create race.
    const db = await openIntentDb(), tx = db.transaction([STORE, EPOCHS], 'readwrite'), store = tx.objectStore(STORE), all = store.getAll();
    let blocked = false, corrupt = false;
    all.onsuccess = () => {
        if (!Array.isArray(all.result) || all.result.length > LIMIT || all.result.some(value => !validIntent(value))) { corrupt = true; tx.abort(); }
        else if (all.result.some(value => value.hostPeerId === input.hostPeerId && value.status !== 'committed')) { blocked = true; tx.abort(); }
        else if (all.result.length >= LIMIT) tx.abort();
        else { store.add(intent); bumpEpoch(tx, input.hostPeerId); }
    };
    try { await finished(tx); } catch (error) {
        if (blocked) throw new ClientEditIntentAlreadyExists();
        if (corrupt) throw new Error('Client edit intent storage contains invalid data');
        throw error;
    }
    return intent;
}
export async function listClientEditIntents(): Promise<ClientEditIntent[]> {
    const db = await openIntentDb(), tx = db.transaction(STORE, 'readonly'), request = tx.objectStore(STORE).getAll();
    let result: ClientEditIntent[] = []; let corrupt = false;
    request.onsuccess = () => { if (!Array.isArray(request.result) || request.result.length > LIMIT || request.result.some(item => !validIntent(item))) corrupt = true; else result = request.result; };
    await finished(tx);
    if (corrupt) throw new Error('Client edit intent storage contains invalid data');
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.command.commandId.localeCompare(b.command.commandId));
}
export async function transitionClientEditIntent(expected: ClientEditIntent, status: ClientEditIntentStatus, reason?: string): Promise<ClientEditIntent | null> {
    if (!validIntent(expected) || !transitions[expected.status].includes(status) || (reason !== undefined && !/^[a-z_]{1,64}$/.test(reason))) return null;
    const db = await openIntentDb(), tx = db.transaction([STORE, EPOCHS], 'readwrite'), store = tx.objectStore(STORE), request = store.get(expected.command.commandId);
    let updated: ClientEditIntent | null = null;
    request.onsuccess = () => {
        if (sameIntent(request.result, expected) && expected.revision < Number.MAX_SAFE_INTEGER) {
            updated = { ...expected, status, revision: expected.revision + 1, ...(reason ? { reason } : {}) }; store.put(updated); bumpEpoch(tx, expected.hostPeerId);
        }
    };
    await finished(tx);
    return updated;
}
/** Only a confirmed commit may be cleared automatically. Explicit discard
 * never asserts that a pending or unknown delivery did not reach the host. */
export async function deleteClientEditIntent(expected: ClientEditIntent, explicit: boolean): Promise<boolean> {
    if (!validIntent(expected) || (!explicit && expected.status !== 'committed')) return false;
    const db = await openIntentDb(), tx = db.transaction([STORE, EPOCHS], 'readwrite'), store = tx.objectStore(STORE), request = store.get(expected.command.commandId);
    let deleted = false;
    request.onsuccess = () => { if (sameIntent(request.result, expected)) { store.delete(expected.command.commandId); bumpEpoch(tx, expected.hostPeerId); deleted = true; } };
    await finished(tx);
    return deleted;
}
