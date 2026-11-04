import type { GameSettings, GameState, Item } from '../types';
import { recalculateAllWeights } from './inventoryManager';
import { recalculateDerivedStats } from './gameContext';
import { canonical, idOccurrences } from './clientInventoryStack';

type Request = { type: 'stash_drop'; playerId: string; itemId: string; commandId: string } |
    { type: 'stash_take'; playerId: string; itemId: string; commandId: string; quantity: number };
type Result = { status: 'applied'; state: GameState } | { status: 'rejected'; state: GameState; reason: string };
/** Conservative pure candidate. The network/commit path must also atomically
 * commit (or roll back) both player and stash before this is exposed. */
export function applyAuthoritativeStash(state: GameState, request: Request, settings: GameSettings): Result {
    const reject = (reason: string): Result => ({ status: 'rejected', state, reason });
    try {
        if (settings?.cooperativeGameType !== 'FullParty') return reject('unsupported_mode');
        if (state.networkRole !== 'host' || !state.myPeerId || state.playerCharacter?.playerId !== state.myPeerId ||
            !request.playerId || request.playerId === state.myPeerId || !Array.isArray(state.players)) return reject('owner');
        const ids = state.players.map(p => p?.playerId);
        if (ids.some(id => !id) || new Set(ids).size !== ids.length || !ids.includes(state.myPeerId)) return reject('identity');
        const index = ids.indexOf(request.playerId);
        if (index < 0) return reject('owner');
        if ((request.type !== 'stash_drop' && request.type !== 'stash_take') || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(request.commandId) ||
            typeof request.itemId !== 'string' || !request.itemId ||
            (request.type === 'stash_take' && (!Number.isSafeInteger(request.quantity) || request.quantity <= 0))) return reject('invalid');
        const player = state.players[index], inventory = player.inventory, stash = state.temporaryStash ?? [];
        if (!Array.isArray(inventory) || !Array.isArray(stash) || !player.equippedItems || typeof player.equippedItems !== 'object' || Array.isArray(player.equippedItems)) return reject('inventory');
        if (inventory.some(item => !item || !item.existedId || !Number.isSafeInteger(item.count) || item.count <= 0 ||
            !Number.isFinite(item.weight) || item.weight < 0 || !Number.isFinite(item.weight * item.count) || item.isContainer || item.contentsPath)) return reject('inventory');
        // Derived-stat helpers serialize the character; never silently strip
        // non-JSON item metadata during the cross-entity transfer.
        for (const entry of inventory) canonical(entry);
        const inventoryIds = inventory.map(item => item.existedId);
        if (new Set(inventoryIds).size !== inventoryIds.length || Object.values(player.equippedItems).some(id => id !== null && (typeof id !== 'string' || !inventoryIds.includes(id)))) return reject('identity');
        const source = request.type === 'stash_drop' ? inventory : stash;
        const matches = source.filter(item => item?.existedId === request.itemId);
        if (matches.length !== 1 || idOccurrences(state, request.itemId) !== 1) return reject('identity');
        const item = matches[0];
        canonical(item);
        if (item.isContainer || item.isSentient || item.contentsPath || item.initialId !== undefined ||
            !Number.isSafeInteger(item.count) || item.count <= 0 || !Number.isFinite(item.weight) || item.weight < 0 ||
            !Number.isFinite(item.weight * item.count) || Object.values(player.equippedItems).includes(item.existedId)) return reject('item');
        const hasResource = item.resource !== undefined || item.maximumResource !== undefined;
        if (hasResource && (typeof item.resource !== 'number' || typeof item.maximumResource !== 'number' ||
            !Number.isFinite(item.resource) || !Number.isFinite(item.maximumResource) || item.maximumResource <= 0 ||
            item.resource < 0 || item.resource > item.maximumResource)) return reject('resource');
        let newInventory: Item[], newStash: Item[];
        if (request.type === 'stash_drop') {
            newInventory = inventory.filter(entry => entry !== item);
            newStash = [...stash, { ...item, contentsPath: null }];
        } else {
            if (request.quantity > item.count) return reject('quantity');
            const partial = request.quantity < item.count;
            const newId = partial ? `item-cmd-${request.commandId}` : item.existedId!;
            if (partial && idOccurrences(state, newId) !== 0) return reject('identity');
            const moved: Item = { ...item, existedId: newId, count: request.quantity, contentsPath: null,
                ...(partial && hasResource ? { resource: item.maximumResource } : {}) };
            newInventory = [...inventory, moved];
            newStash = partial ? stash.map(entry => entry === item ? { ...item, count: item.count - request.quantity } : entry) : stash.filter(entry => entry !== item);
        }
        const updated = recalculateDerivedStats(recalculateAllWeights({ ...player, inventory: newInventory }));
        if (!Number.isFinite(updated.totalWeight) || !Number.isFinite(updated.maxWeight) || !Number.isFinite(updated.criticalExcessWeight) ||
            !Number.isFinite(updated.maxWeight + updated.criticalExcessWeight)) return reject('inventory');
        if (request.type === 'stash_take' && updated.totalWeight > updated.maxWeight + updated.criticalExcessWeight) return reject('weight');
        const players = state.players.slice(); players[index] = updated;
        return { status: 'applied', state: { ...state, players, temporaryStash: newStash } };
    } catch { return reject('invalid_state'); }
}
