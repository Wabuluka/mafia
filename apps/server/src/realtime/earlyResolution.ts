// ---------------------------------------------------------------------------
// Early phase resolution: detecting "everyone who needs to act has acted"
// so a phase can advance immediately instead of idling out its full
// duration. Called after every submitNightAction/castVote that succeeds —
// see those handlers in handlers/. Purely a read of the current
// FullGameState; never mutates anything itself.
// ---------------------------------------------------------------------------

import type { FullGameState } from '@mafia/shared';

const NIGHT_ACTING_ROLES = new Set(['MAFIA', 'DOCTOR', 'DETECTIVE']);

/**
 * True once every living player whose role acts at night has submitted a
 * night action for the current round. "All mafia agreed" specifically
 * means every living MAFIA member has submitted (they may target different
 * players mid-deliberation — resolveNight already takes the LAST mafia
 * submission as the agreed kill, see engine/nightActions.ts — but the
 * phase shouldn't advance until each of them has actively weighed in at
 * least once, not just one of several).
 */
export function isNightResolutionReady(state: FullGameState): boolean {
  if (state.phase !== 'NIGHT') return false;

  const actingPlayers = state.players.filter((p) => p.status === 'ALIVE' && p.role && NIGHT_ACTING_ROLES.has(p.role));
  if (actingPlayers.length === 0) {
    // No living role that acts at night exists (edge case — e.g. every
    // special role has died and only villagers remain). Nothing to wait
    // for; the phase is vacuously ready to resolve early.
    return true;
  }

  return actingPlayers.every((p) =>
    state.nightActions.some((a) => a.actorId === p.id && a.nightNumber === state.roundNumber),
  );
}

/**
 * True once every living player has cast a vote (or explicitly abstained
 * — both count as "voted", per engine/voting.ts's Vote shape, which
 * records an abstain as a Vote with `targetId: undefined` rather than the
 * voter being absent from `state.votes` entirely) for the current day.
 */
export function isVoteResolutionReady(state: FullGameState): boolean {
  if (state.phase !== 'DAY_VOTE') return false;

  const livingPlayers = state.players.filter((p) => p.status === 'ALIVE');
  if (livingPlayers.length === 0) return true; // vacuously ready; shouldn't happen in practice

  return livingPlayers.every((p) =>
    state.votes.some((v) => v.voterId === p.id && v.dayNumber === state.roundNumber),
  );
}

/** True if the current phase's required actions are all in and it should
 * advance immediately rather than waiting for its timer. DAY_DISCUSSION
 * has no required actions (it's pure deliberation) so it never resolves
 * early — LOBBY and GAME_OVER aren't timer-driven at all (see
 * scheduler.ts / phaseLoop.ts) and also never qualify. */
export function isPhaseReadyToResolveEarly(state: FullGameState): boolean {
  return isNightResolutionReady(state) || isVoteResolutionReady(state);
}
