import type { PlayerCharacter } from '../types';

/**
 * Party views read the roster, but the active slot can lag behind
 * `playerCharacter`: most in-game edits (character editing, inventory moves,
 * crafting, wounds) update only the live character and the roster is refreshed
 * when a turn or party transition commits. Substitute the live character so the
 * active card, party status and character sheets never show an outdated copy.
 */
export function withLiveActivePlayer(
    players: PlayerCharacter[] | undefined | null,
    playerCharacter: PlayerCharacter | null | undefined,
): PlayerCharacter[] {
    if (!Array.isArray(players)) return [];
    const activeId = playerCharacter?.playerId;
    if (!activeId) return players;
    const index = players.findIndex(player => player?.playerId === activeId);
    if (index === -1 || players[index] === playerCharacter) return players;
    const shown = [...players];
    // Roster entries can carry party-only fields (personal reputations), so the
    // live character is layered on top instead of replacing the entry.
    shown[index] = { ...players[index], ...playerCharacter };
    return shown;
}
