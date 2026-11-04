import type { GameSettings, GameState } from '../types';
import { recalculateAllWeights } from './inventoryManager';
import { recalculateDerivedStats } from './gameContext';
import { idOccurrences } from './clientInventoryStack';

type Move = { playerId: string; itemId: string; destinationId: string | null };
type Result = { status: 'applied'; state: GameState } | { status: 'rejected'; state: GameState; reason: string };
/** Conservative single-level container candidate. Not yet exposed on wire. */
export function applyAuthoritativeMove(state: GameState, request: Move, settings: GameSettings): Result {
    const reject = (reason: string): Result => ({ status: 'rejected', state, reason });
    try {
        if (settings?.cooperativeGameType !== 'FullParty') return reject('unsupported_mode');
        if (state.networkRole !== 'host' || !state.myPeerId || state.playerCharacter?.playerId !== state.myPeerId ||
            !request.playerId || request.playerId === state.myPeerId || !Array.isArray(state.players)) return reject('owner');
        const ids = state.players.map(p => p?.playerId);
        if (ids.some(id => !id) || new Set(ids).size !== ids.length || !ids.includes(state.myPeerId)) return reject('identity');
        const index = ids.indexOf(request.playerId);
        if (index < 0) return reject('owner');
        if (typeof request.itemId !== 'string' || !request.itemId || (request.destinationId !== null &&
            (typeof request.destinationId !== 'string' || !request.destinationId || request.destinationId === request.itemId))) return reject('invalid');
        const player = state.players[index], inventory = player.inventory;
        if (!Array.isArray(inventory) || !player.equippedItems || typeof player.equippedItems !== 'object' || Array.isArray(player.equippedItems)) return reject('inventory');
        if (inventory.some(item => !item || !item.existedId || !Number.isSafeInteger(item.count) || item.count <= 0 ||
            typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight < 0 ||
            typeof item.volume !== 'number' || !Number.isFinite(item.volume) || item.volume < 0 ||
            !Number.isFinite(item.weight * item.count) || !Number.isFinite(item.volume * item.count))) return reject('inventory');
        const allIds = inventory.map(item => item.existedId);
        if (Object.values(player.equippedItems).some(id => id !== null && (typeof id !== 'string' || !allIds.includes(id)))) return reject('slots');
        if (new Set(allIds).size !== allIds.length || idOccurrences(state, request.itemId) !== 1 ||
            (request.destinationId && idOccurrences(state, request.destinationId) !== 1)) return reject('identity');
        const containers = inventory.filter(item => item.isContainer);
        if (containers.some(item => item.count !== 1 || item.isSentient || item.initialId !== undefined || item.contentsPath || typeof item.name !== 'string' || !item.name.trim() || item.name.includes('/') ||
            (item.capacity !== null && item.capacity !== undefined && (!Number.isSafeInteger(item.capacity) || item.capacity < 0)) ||
            (item.weightReduction !== null && item.weightReduction !== undefined && (typeof item.weightReduction !== 'number' || !Number.isFinite(item.weightReduction) || item.weightReduction < 0 || item.weightReduction > 100)) ||
            (item.containerWeight !== null && item.containerWeight !== undefined && (typeof item.containerWeight !== 'number' || !Number.isFinite(item.containerWeight) || item.containerWeight < 0)))) return reject('container');
        if (new Set(containers.map(item => item.name)).size !== containers.length) return reject('container');
        if (inventory.some(item => item.contentsPath !== null && item.contentsPath !== undefined &&
            (!Array.isArray(item.contentsPath) || item.contentsPath.length !== 1 || !containers.some(container => container.name === item.contentsPath![0])))) return reject('container');
        for (const container of containers) {
            const contents = inventory.filter(item => item.contentsPath?.[0] === container.name);
            const volume = contents.reduce((sum, item) => sum + item.volume * item.count, 0);
            const weight = contents.reduce((sum, item) => sum + item.weight * item.count, 0);
            if (!Number.isFinite(volume) || !Number.isFinite(weight) || (container.capacity != null && contents.length > container.capacity) || volume > container.volume) return reject('container');
        }
        const item = inventory.find(entry => entry.existedId === request.itemId);
        if (!item || item.isContainer || item.isSentient || item.initialId !== undefined || Object.values(player.equippedItems).includes(item.existedId)) return reject('item');
        const destination = request.destinationId === null ? null : containers.find(entry => entry.existedId === request.destinationId);
        if (destination && Object.values(player.equippedItems).includes(destination.existedId)) return reject('container');
        if (request.destinationId !== null && !destination) return reject('container');
        const currentName = item.contentsPath?.[0] ?? null;
        if ((destination?.name ?? null) === currentName) return reject('item');
        if (destination) {
            const contents = inventory.filter(entry => entry !== item && entry.contentsPath?.[0] === destination.name);
            const volume = contents.reduce((sum, entry) => sum + entry.volume * entry.count, 0) + item.volume * item.count;
            if (!Number.isFinite(volume) || (destination.capacity != null && contents.length >= destination.capacity) || volume > destination.volume) return reject('capacity');
        }
        const updatedInventory = inventory.map(entry => entry === item ? { ...entry, contentsPath: destination ? [destination.name] : null } : entry);
        const updated = recalculateDerivedStats(recalculateAllWeights({ ...player, inventory: updatedInventory }));
        if (typeof updated.totalWeight !== 'number' || !Number.isFinite(updated.totalWeight)) return reject('inventory');
        const players = state.players.slice(); players[index] = updated;
        return { status: 'applied', state: { ...state, players } };
    } catch { return reject('invalid_state'); }
}
