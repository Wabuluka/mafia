// ---------------------------------------------------------------------------
// Shared engine types: the Result union every fallible engine function
// returns, and the Effect union describing side effects the (impure) caller
// must carry out. The engine itself never performs these effects — it only
// describes them, alongside the new state.
// ---------------------------------------------------------------------------

import type {
  ChatMessage,
  DetectiveResult,
  FullGameState,
  GameEndReason,
  NightAction,
  PlayerId,
  Team,
  Vote,
} from '@mafia/shared';

/**
 * A discriminated-union result type for engine operations that can be
 * rejected for expected, "the caller did something invalid" reasons (dead
 * player acting, wrong phase, already acted, etc). These are NOT thrown —
 * a thrown error is reserved for programmer mistakes (calling the engine
 * with a state it doesn't recognize), not for expected game-rule rejections
 * a socket handler needs to turn into a clean `error` event.
 */
export type EngineResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: EngineRejectionReason; message: string };

export type EngineRejectionReason =
  | 'PLAYER_NOT_FOUND'
  | 'PLAYER_DEAD'
  | 'WRONG_PHASE'
  | 'WRONG_ROLE'
  | 'ALREADY_ACTED'
  | 'INVALID_TARGET'
  | 'TARGET_DEAD'
  | 'GAME_ALREADY_OVER';

export function ok<T>(value: T): EngineResult<T> {
  return { ok: true, value };
}

export function reject<T>(reason: EngineRejectionReason, message: string): EngineResult<T> {
  return { ok: false, reason, message };
}

// ---------------------------------------------------------------------------
// Effects — descriptions of work the impure caller (socket layer) should
// perform after applying the returned state: broadcasting narration,
// persisting a checkpoint, sending a private reveal, etc. The engine
// produces these as plain data; it never calls a socket or a repository
// itself.
// ---------------------------------------------------------------------------

export type EngineEffect =
  | { type: 'NARRATION'; text: string }
  | { type: 'PRIVATE_DETECTIVE_RESULT'; playerId: PlayerId; result: DetectiveResult }
  | { type: 'PLAYER_DIED'; playerId: PlayerId; cause: 'MAFIA_KILL' | 'VOTE_ELIMINATION' }
  | { type: 'GAME_ENDED'; reason: GameEndReason; winningTeam?: Team };

/** Common shape for a "state transition + effects" result, used by the
 * phase-resolution functions (`resolveNight`, `resolveVote`) which cannot
 * be rejected — they only ever run when the phase is already correct. */
export interface Resolution {
  state: FullGameState;
  effects: EngineEffect[];
}

// Re-exported for convenience so engine modules have a single import
// surface for the shared types they work with most.
export type { ChatMessage, FullGameState, NightAction, PlayerId, Vote };
