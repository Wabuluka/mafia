// ---------------------------------------------------------------------------
// Early phase resolution: detecting "everyone who needs to act has acted"
// so a phase can advance immediately instead of idling out its full
// duration. Called after every submitNightAction/castVote that succeeds —
// see those handlers in handlers/. Purely a read of the current
// FullGameState; never mutates anything itself.
// ---------------------------------------------------------------------------

import type { FullGameState } from '@mafia/shared';

/**
 * True once NIGHT's moderator-driven sub-sequence (MAFIA -> DETECTIVE ->
 * DOCTOR, skipping roles no living player holds — see @mafia/shared's
 * nextApplicableNightSubPhase) has reached COMPLETE. Sub-phases only
 * advance via the host's explicit `advanceNightSubPhase` action (see that
 * handler), not automatically the instant a role submits — so in practice
 * this is only ever true right as that handler itself steps into COMPLETE,
 * which is also the one place that calls `tryResolveEarly`/`advancePhase`
 * for NIGHT. Kept as its own function (rather than inlined there) so
 * `isPhaseReadyToResolveEarly` stays the single, general "is this phase
 * done" query other callers can rely on.
 */
export function isNightResolutionReady(state: FullGameState): boolean {
  return state.phase === 'NIGHT' && state.nightSubPhase === 'COMPLETE';
}

/**
 * True once every living player has cast a vote (or explicitly abstained
 * — both count as "voted", per engine/voting.ts's Vote shape, which
 * records an abstain as a Vote with `targetId: undefined` rather than the
 * voter being absent from `state.votes` entirely) for the current day.
 */
export function isVoteResolutionReady(state: FullGameState): boolean {
  if (state.phase !== 'DAY_VOTE') return false;

  // The host/moderator never votes (see Player.isHost's doc comment) and
  // must be excluded from "who must act" here — otherwise a phase with an
  // alive host would never resolve early, since a vote from them can never
  // arrive (castVote itself rejects it — see engine/voting.ts).
  const livingPlayers = state.players.filter((p) => p.status === 'ALIVE' && !p.isHost);
  if (livingPlayers.length === 0) return true; // vacuously ready; shouldn't happen in practice

  return livingPlayers.every((p) =>
    state.votes.some((v) => v.voterId === p.id && v.dayNumber === state.roundNumber),
  );
}

/**
 * True once every living player has submitted a nomination (or an explicit
 * decline — both count, per engine/nominations.ts's Nomination shape,
 * mirroring how an abstained Vote still counts as "voted" above) for the
 * current DAY_DISCUSSION round.
 */
export function isNominationResolutionReady(state: FullGameState): boolean {
  if (state.phase !== 'DAY_DISCUSSION') return false;

  // Same host exclusion as isVoteResolutionReady above — see its comment.
  const livingPlayers = state.players.filter((p) => p.status === 'ALIVE' && !p.isHost);
  if (livingPlayers.length === 0) return true; // vacuously ready; shouldn't happen in practice

  return livingPlayers.every((p) =>
    state.nominations.some((n) => n.nominatorId === p.id && n.dayNumber === state.roundNumber),
  );
}

/** True if the current phase's required actions are all in and it should
 * advance immediately rather than waiting for its timer. LOBBY and
 * GAME_OVER aren't timer-driven at all (see scheduler.ts / phaseLoop.ts)
 * and never qualify. */
export function isPhaseReadyToResolveEarly(state: FullGameState): boolean {
  return isNightResolutionReady(state) || isVoteResolutionReady(state) || isNominationResolutionReady(state);
}
