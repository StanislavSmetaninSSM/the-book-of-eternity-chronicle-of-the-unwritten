import type { GameSettings, GameState, Item } from '../types';
import { recalculateAllWeights } from './inventoryManager';
import { recalculateDerivedStats } from './gameContext';

type Split = { playerId: string; commandId: string; itemId: string; quantity: number };
type Result = { status: 'applied'; state: GameState } | { status: 'rejected'; state: GameState; reason: string };

/** Fail closed if an ID already occurs anywhere in the state, or traversal is
 * unreasonably large. The state may contain shared references. */
export function idOccurrences(state: unknown, id: string): number {
    const seen = new WeakSet<object>(), todo: unknown[] = [state];
    let count = 0, occurrences = 0;
    while (todo.length) {
        const value = todo.pop();
        if (!value || typeof value !== 'object') continue;
        // Count every reference to an item, even when two containers share
        // the same object. Serializing such aliases creates duplicate IDs.
        if (!Array.isArray(value) && (value as { existedId?: unknown }).existedId === id) occurrences++;
        if (seen.has(value)) continue;
        if (++count > 200000) return -1;
        seen.add(value);
        for (const entry of Object.values(value)) if (entry && typeof entry === 'object') todo.push(entry);
    }
    return occurrences;
}

/** Experimental, pure candidate only: not yet exposed as a wire command.
 * The host must authorize/reserve the operation and publish only after commit. */
export function applyAuthoritativeSplit(state: GameState, request: Split, settings: GameSettings): Result {
    const reject = (reason: string): Result => ({ status: 'rejected', state, reason });
    try {
        if (settings?.cooperativeGameType !== 'FullParty') return reject('unsupported_mode');
        if (state.networkRole !== 'host' || !state.myPeerId || state.playerCharacter?.playerId !== state.myPeerId ||
            !request.playerId || request.playerId === state.myPeerId || !Array.isArray(state.players)) return reject('owner');
        const ids = state.players.map(p => p?.playerId);
        if (ids.some(id => !id) || new Set(ids).size !== ids.length || !ids.includes(state.myPeerId)) return reject('identity');
        const index = ids.indexOf(request.playerId);
        if (index < 0) return reject('owner');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(request.commandId) ||
            typeof request.itemId !== 'string' || !request.itemId || !Number.isSafeInteger(request.quantity) || request.quantity <= 0) return reject('invalid');
        const player = state.players[index], inventory = player.inventory;
        if (!Array.isArray(inventory) || !player.equippedItems || typeof player.equippedItems !== 'object' || Array.isArray(player.equippedItems)) return reject('inventory');
        if (inventory.some(item => !item || !item.existedId || !Number.isSafeInteger(item.count) || item.count <= 0 ||
            typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight < 0)) return reject('inventory');
        // Derived-weight calculation is unsafe for overflowing totals and
        // legacy container paths; do not guess their contents or reduction.
        if (inventory.some(item => item.isContainer || item.contentsPath || !Number.isFinite(item.weight * item.count)) ||
            !Number.isFinite(inventory.reduce((sum, item) => sum + item.weight * item.count, 0))) return reject('inventory');
        const itemIds = inventory.map(item => item.existedId);
        if (new Set(itemIds).size !== itemIds.length) return reject('identity');
        const item = inventory.find(entry => entry.existedId === request.itemId);
        if (!item || item.count <= request.quantity || item.isContainer || item.isSentient || item.contentsPath || item.equipmentSlot || item.initialId !== undefined ||
            Object.values(player.equippedItems).includes(item.existedId)) return reject('item');
        const hasResource = item.resource !== undefined || item.maximumResource !== undefined;
        if (hasResource && (typeof item.resource !== 'number' || typeof item.maximumResource !== 'number' || !Number.isFinite(item.resource) ||
            !Number.isFinite(item.maximumResource) || item.maximumResource <= 0 || item.resource < 0 || item.resource > item.maximumResource)) return reject('resource');
        const newId = `item-cmd-${request.commandId}`;
        if (idOccurrences(state, request.itemId) !== 1 || idOccurrences(state, newId) !== 0) return reject('identity');
        const remaining: Item = { ...item, count: item.count - request.quantity };
        const split: Item = { ...item, existedId: newId, count: request.quantity, contentsPath: null,
            ...(hasResource ? { resource: item.maximumResource } : {}) };
        const updatedInventory = inventory.map(entry => entry === item ? remaining : entry).concat(split);
        const updated = recalculateDerivedStats(recalculateAllWeights({ ...player, inventory: updatedInventory }));
        const players = state.players.slice(); players[index] = updated;
        return { status: 'applied', state: { ...state, players } };
    } catch { return reject('invalid_state'); }
}

type Merge = { playerId: string; sourceId: string; targetId: string };
// Canonicalize only strictly JSON-compatible data. Undefined/non-finite values
// must not disappear during comparison and accidentally make stacks equal.
function canonical(value: unknown, ancestors = new Set<object>()): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (!value || typeof value !== 'object' || ancestors.has(value)) throw new Error('Non-JSON metadata');
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new Error('Non-plain metadata');
    if (Array.isArray(value)) {
        if (Object.keys(value).length !== value.length) throw new Error('Sparse or extended array');
        for (let i = 0; i < value.length; i++) if (!Object.prototype.hasOwnProperty.call(value, i)) throw new Error('Sparse array');
    }
    ancestors.add(value);
    const result = Array.isArray(value)
        ? `[${value.map(item => canonical(item, ancestors)).join(',')}]`
        : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], ancestors)}`).join(',')}}`;
    ancestors.delete(value);
    return result;
}

/** Conservative merge: only entirely equal metadata except IDs/counts, and
 * only full resources. Candidate is pure and not connected to the wire yet. */
export function applyAuthoritativeMerge(state: GameState, request: Merge, settings: GameSettings): Result {
    const reject = (reason: string): Result => ({ status: 'rejected', state, reason });
    try {
        if (settings?.cooperativeGameType !== 'FullParty') return reject('unsupported_mode');
        if (state.networkRole !== 'host' || !state.myPeerId || state.playerCharacter?.playerId !== state.myPeerId ||
            !request.playerId || request.playerId === state.myPeerId || !Array.isArray(state.players)) return reject('owner');
        const ids = state.players.map(p => p?.playerId);
        if (ids.some(id => !id) || new Set(ids).size !== ids.length || !ids.includes(state.myPeerId)) return reject('identity');
        const index = ids.indexOf(request.playerId);
        if (index < 0) return reject('owner');
        if (typeof request.sourceId !== 'string' || !request.sourceId || typeof request.targetId !== 'string' ||
            !request.targetId || request.sourceId === request.targetId) return reject('invalid');
        const player = state.players[index], inventory = player.inventory;
        if (!Array.isArray(inventory) || !player.equippedItems || typeof player.equippedItems !== 'object' || Array.isArray(player.equippedItems)) return reject('inventory');
        if (inventory.some(item => !item || !item.existedId || !Number.isSafeInteger(item.count) || item.count <= 0 ||
            typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight < 0 || item.isContainer || item.contentsPath ||
            !Number.isFinite(item.weight * item.count)) || !Number.isFinite(inventory.reduce((sum, item) => sum + item.weight * item.count, 0))) return reject('inventory');
        const itemIds = inventory.map(item => item.existedId);
        if (new Set(itemIds).size !== itemIds.length) return reject('identity');
        const source = inventory.find(item => item.existedId === request.sourceId), target = inventory.find(item => item.existedId === request.targetId);
        if (!source || !target || !Number.isSafeInteger(source.count + target.count)) return reject('item');
        if (idOccurrences(state, request.sourceId) !== 1 || idOccurrences(state, request.targetId) !== 1) return reject('identity');
        for (const item of [source, target]) {
            if (item.isSentient || item.isContainer || item.contentsPath || item.equipmentSlot || item.initialId !== undefined ||
                Object.values(player.equippedItems).includes(item.existedId)) return reject('item');
            const hasResource = item.resource !== undefined || item.maximumResource !== undefined;
            if (hasResource && (typeof item.resource !== 'number' || typeof item.maximumResource !== 'number' ||
                !Number.isFinite(item.resource) || !Number.isFinite(item.maximumResource) || item.maximumResource <= 0 || item.resource !== item.maximumResource)) return reject('resource');
        }
        const { existedId: _sourceId, count: _sourceCount, ...sourceMetadata } = source;
        const { existedId: _targetId, count: _targetCount, ...targetMetadata } = target;
        if (canonical(sourceMetadata) !== canonical(targetMetadata)) return reject('metadata');
        const merged: Item = { ...target, count: source.count + target.count };
        const updatedInventory = inventory.filter(item => item !== source).map(item => item === target ? merged : item);
        const updated = recalculateDerivedStats(recalculateAllWeights({ ...player, inventory: updatedInventory }));
        const players = state.players.slice(); players[index] = updated;
        return { status: 'applied', state: { ...state, players } };
    } catch { return reject('invalid_state'); }
}
