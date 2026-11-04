import type { GameState, GameSettings } from '../types';
import type { ClientEditCommand } from './clientEditProtocol';
import { equipItem, unequipItem, recalculateAllWeights } from './inventoryManager';
import { recalculateDerivedStats } from './gameContext';
import { validateSerializableCharacter, idOccurrences } from './clientInventoryStack';

const SLOTS = new Set(['Underwear_Top', 'Head', 'Accessory1', 'Underwear_Bottom', 'Neck', 'Accessory4', 'Back', 'Chest', 'Sigil', 'Wrists', 'Waist', 'Hands', 'MainHand', 'Legs', 'OffHand', 'Finger1', 'Feet', 'Finger2', 'Accessory2', 'Accessory3']);
type Result = { status: 'applied'; state: GameState } | { status: 'rejected'; state: GameState; reason: string };

/** Pure candidate builder; caller must validate connection/base and commit the
 * returned state under the host authority hold before declaring success. */
export function applyAuthoritativeEquipment(state: GameState, request: Extract<ClientEditCommand, { version: 1 }>, settings: GameSettings): Result {
    const reject = (reason: string): Result => ({ status: 'rejected', state, reason });
    try {
        if (settings?.cooperativeGameType !== 'FullParty') return reject('unsupported_mode');
        if (state.networkRole !== 'host' || !state.myPeerId || request.playerId === state.myPeerId ||
            state.playerCharacter?.playerId !== state.myPeerId || !Array.isArray(state.players)) return reject('owner');
        const ids = state.players.map(player => player?.playerId);
        if (ids.some(id => !id) || new Set(ids).size !== ids.length || !ids.includes(state.myPeerId)) return reject('identity');
        const index = ids.indexOf(request.playerId);
        if (index < 0) return reject('owner');
        const player = state.players[index];
        if (!Array.isArray(player.inventory) || !player.equippedItems || typeof player.equippedItems !== 'object' || Array.isArray(player.equippedItems)) return reject('inventory');
        const inventory = player.inventory;
        if (inventory.some(item => !item || !Number.isSafeInteger(item.count) || item.count <= 0 ||
            typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight < 0 || !Number.isFinite(item.weight * item.count) || item.isContainer || item.contentsPath) ||
            !Number.isFinite(inventory.reduce((sum, item) => sum + item.weight * item.count, 0))) return reject('inventory');
        validateSerializableCharacter(player);
        const itemIds = inventory.map(item => item?.existedId);
        if (itemIds.some(id => !id) || new Set(itemIds).size !== itemIds.length) return reject('identity');
        const matches = inventory.filter(item => item.existedId === request.command.itemId);
        if (matches.length !== 1 || idOccurrences(state, request.command.itemId) !== 1) return reject('item');
        const item = matches[0];
        if (item.isContainer || item.isSentient || item.initialId !== undefined || typeof item.durability !== 'string' ||
            (item.requiresTwoHands !== undefined && typeof item.requiresTwoHands !== 'boolean')) return reject('item');

        // Every occupied slot must resolve unambiguously, including displaced
        // hands. Reject inconsistent legacy equipment rather than guessing.
        const occurrences = new Map<string, string[]>();
        for (const [slot, id] of Object.entries(player.equippedItems)) {
            if (!SLOTS.has(slot) || (id !== null && typeof id !== 'string')) return reject('slots');
            if (!id) continue;
            if (inventory.filter(i => i.existedId === id).length !== 1) return reject('slots');
            const list = occurrences.get(id) || [];
            list.push(slot); occurrences.set(id, list);
        }
        for (const [id, slots] of occurrences) {
            const equipped = inventory.find(i => i.existedId === id)!;
            if (equipped.requiresTwoHands) {
                if (slots.length !== 2 || !slots.includes('MainHand') || !slots.includes('OffHand')) return reject('slots');
            } else if (slots.length !== 1) return reject('slots');
        }
        const operation = request.command;
        let proposed: GameState;
        const temporary = { ...state, playerCharacter: player };
        if (operation.type === 'equip') {
            const slot = operation.slot;
            const eligibleSlots = Array.isArray(item.equipmentSlot) ? item.equipmentSlot : [item.equipmentSlot];
            if (!SLOTS.has(slot) || !Object.prototype.hasOwnProperty.call(player.equippedItems, slot) || !eligibleSlots.includes(slot) ||
                (item.requiresTwoHands && slot !== 'MainHand' && slot !== 'OffHand') ||
                (item.requiresTwoHands && (!Object.prototype.hasOwnProperty.call(player.equippedItems, 'MainHand') || !Object.prototype.hasOwnProperty.call(player.equippedItems, 'OffHand'))) ||
                /^\s*0+(?:\.0+)?%\s*$/.test(item.durability || '') || occurrences.has(item.existedId!)) return reject('slot');
            proposed = equipItem(item, slot, temporary);
        } else {
            if (!occurrences.has(item.existedId!)) return reject('slot');
            proposed = unequipItem(item, temporary);
        }
        if (proposed === temporary) return reject('item');
        const updated = recalculateDerivedStats(recalculateAllWeights(proposed.playerCharacter));
        if (!Number.isFinite(updated.totalWeight)) return reject('inventory');
        const players = state.players.slice();
        players[index] = updated;
        return { status: 'applied', state: { ...state, players } };
    } catch {
        // Malformed legacy data or an unsupported derived-stat calculation
        // fails without changing any part of the authoritative input.
        return reject('invalid_state');
    }
}
