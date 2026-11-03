import type { GameState } from '../types';

/** Keep the host's edited, locally displayed character in its player record.
 * Never infer an owner from activePlayerIndex, which may refer to another peer. */
export function reconcileHostEditedCharacter(previous: GameState | null, next: GameState | null): GameState | null {
    if (!previous || !next || previous.networkRole !== 'host' || next.networkRole !== 'host' ||
        !previous.myPeerId || previous.myPeerId !== next.myPeerId ||
        !previous.playerCharacter || !next.playerCharacter ||
        previous.playerCharacter === next.playerCharacter ||
        previous.playerCharacter.playerId !== previous.myPeerId || next.playerCharacter.playerId !== previous.myPeerId ||
        !Array.isArray(next.players)) return next;
    const indices = next.players.flatMap((player, index) => player?.playerId === previous.myPeerId ? [index] : []);
    if (indices.length !== 1 || next.players[indices[0]] === next.playerCharacter) return next;
    const players = [...next.players];
    players[indices[0]] = next.playerCharacter;
    return { ...next, players };
}
