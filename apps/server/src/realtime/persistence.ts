// ---------------------------------------------------------------------------
// The only place realtime/ talks to MongoDB. Every function here is called
// from exactly one of the three points the db/index.ts hot-path comment
// describes: phase boundaries, game end, and lobby lifecycle. Nothing in
// the per-action handlers (submitNightAction, castVote, sendChat) calls
// into this module directly — those mutate in-memory state and broadcast;
// only the phase-transition code (phaseLoop.ts) and the lobby handlers
// reach here.
// ---------------------------------------------------------------------------

import type { FullGameState, GameEndReason, Phase } from '@mafia/shared';
import { gameEventsRepository, gamesRepository } from '../db';
import type { GameEventDocument } from '../db/types';

type NewEvent = Omit<GameEventDocument, '_id' | 'sequence' | 'createdAt'>;

/** Starts the DB-side game record when a lobby transitions into its first
 * NIGHT. Returns the generated gameId the session should hold onto for
 * every subsequent checkpoint write. */
export async function persistGameStart(state: FullGameState): Promise<string> {
  const game = await gamesRepository.createGame(state);
  return game._id;
}

/**
 * Flushes everything accumulated during the phase that just ended: the
 * phase-transition marker itself, plus one batched event per night action,
 * vote, and chat message recorded since the previous flush. Called once
 * per phase boundary — never per individual action.
 */
export async function persistPhaseBoundary(
  gameId: string,
  fromPhase: Phase,
  toPhase: Phase,
  state: FullGameState,
  newEvents: NewEvent[],
): Promise<void> {
  const phaseChangeEvent: NewEvent = {
    gameId,
    type: 'PHASE_CHANGED',
    payload: { fromPhase, toPhase, roundNumber: state.roundNumber },
  };

  await Promise.all([
    gamesRepository.recordPhaseTransition(gameId, toPhase, state.roundNumber),
    gameEventsRepository.appendEvents([...newEvents, phaseChangeEvent]),
  ]);
}

/** Marks the game record COMPLETED and appends the final GAME_ENDED event.
 * Called exactly once, when checkWinCondition (or a JESTER win) first
 * reports the game is over. */
export async function persistGameEnd(
  gameId: string,
  reason: GameEndReason,
  winningTeam: string | undefined,
  trailingEvents: NewEvent[],
): Promise<void> {
  const endEvent: NewEvent = {
    gameId,
    type: 'GAME_ENDED',
    payload: { endReason: reason, winningTeam },
  };

  await Promise.all([
    gamesRepository.completeGame(gameId, reason, winningTeam),
    gameEventsRepository.appendEvents([...trailingEvents, endEvent]),
  ]);

  gameEventsRepository.forgetSequenceCounter(gameId);
}

/** Marks a game ABANDONED — e.g. every player disconnected and the village
 * was torn down mid-game. Not a phase boundary, but still a terminal,
 * comparatively rare event worth its own explicit entry point. */
export async function persistGameAbandoned(gameId: string): Promise<void> {
  await gamesRepository.abandonGame(gameId);
  gameEventsRepository.forgetSequenceCounter(gameId);
}

