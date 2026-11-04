import type { GameState } from '../types';
import type { TurnSyncStamp } from './networkTurnProtocol';

// A pre-turn save is asynchronous. A role, player, active participant,
// connection or grant can change independently of the restore revision.
export function captureTurnSubmissionIdentity(state: GameState | null, stamp: TurnSyncStamp | null, connection: { open?: boolean } | null) {
    return {
        role: state?.networkRole,
        myPeerId: state?.myPeerId,
        hostPeerId: state?.hostPeerId,
        activeIndex: state?.activePlayerIndex,
        activePlayerId: state?.players?.[state.activePlayerIndex]?.playerId,
        needsCharacter: state?.playerNeedsToCreateCharacter,
        // Only the client's host connection/grant has meaning here; cosmetic
        // changes or peer churn on the host must not cancel an unrelated turn.
        connection: state?.networkRole === 'player' ? connection : null,
        connectionOpen: state?.networkRole === 'player' ? connection?.open : undefined,
        stampVersion: state?.networkRole === 'player' ? stamp?.version : undefined,
        stampSession: state?.networkRole === 'player' ? stamp?.sessionId : undefined,
        stampRevision: state?.networkRole === 'player' ? stamp?.revision : undefined,
    };
}

export function sameTurnSubmissionIdentity(a: ReturnType<typeof captureTurnSubmissionIdentity>, b: ReturnType<typeof captureTurnSubmissionIdentity>): boolean {
    return (Object.keys(a) as (keyof typeof a)[]).every(key => a[key] === b[key]);
}
