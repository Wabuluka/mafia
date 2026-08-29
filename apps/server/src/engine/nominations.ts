// ---------------------------------------------------------------------------
// Day discussion phase: submitting a public suspect nomination (or an
// explicit decline) and resolving the round's shortlist. Pure — see the
// module header in nightActions.ts for the same ground rules (no clocks, no
// I/O, Result union, never throws).
//
// Kept as its own module rather than folded into voting.ts: nomination and
// vote share the exact same "one live submission per living player per
// round, revocable, replace-not-reject" shape, but their RESOLUTION
// semantics are genuinely different — a nomination round produces a
// shortlist SET (every distinct target that got at least one nomination),
// not a plurality winner — matching how this codebase already keeps
// nightActions.ts and voting.ts separate despite a similar submit-then-
// resolve structure. See DiscussionPhase.tsx for the client side: this
// replaces free-text DAY chat entirely (see sendChat.ts's DAY-channel
// rejection during DAY_DISCUSSION).
// ---------------------------------------------------------------------------

import type { FullGameState, Nomination, PlayerId } from '@mafia/shared';
import { ok, reject, type EngineEffect, type EngineResult, type Resolution } from './types';

/** Sentinel meaning "this nominator explicitly declines to nominate anyone"
 * as opposed to simply not having acted yet — same purpose as voting.ts's
 * ABSTAIN, distinct from `undefined` so callers can express intent
 * unambiguously. Internally this still stores as `targetId: undefined` on
 * the Nomination record, matching NominationSchema. */
export const DECLINE = Symbol('DECLINE');
export type NominationTarget = PlayerId | typeof DECLINE;

function findPlayer(state: FullGameState, playerId: PlayerId) {
  return state.players.find((p) => p.id === playerId);
}

export interface SubmitNominationInput {
  nominatorId: PlayerId;
  target: NominationTarget;
  now: number;
}

/**
 * Validates and records one player's nomination for the current
 * DAY_DISCUSSION round. A player may change their nomination before the
 * phase resolves — a new call for the same nominator this round replaces
 * their previous nomination rather than being rejected as "already acted",
 * same revocable-vote precedent as castVote. Self-nomination is allowed —
 * there is nothing here (or in castVote) that blocks targeting yourself.
 */
export function nominate(state: FullGameState, input: SubmitNominationInput): EngineResult<FullGameState> {
  if (state.phase !== 'DAY_DISCUSSION') {
    return reject('WRONG_PHASE', 'Nominations can only be submitted during the DAY_DISCUSSION phase.');
  }

  const nominator = findPlayer(state, input.nominatorId);
  if (!nominator) {
    return reject('PLAYER_NOT_FOUND', 'Nominator is not a player in this game.');
  }
  if (nominator.status === 'DEAD') {
    return reject('PLAYER_DEAD', 'Dead players cannot nominate.');
  }
  // The host/moderator never nominates — see Player.isHost's doc comment.
  // Structurally near-impossible to reach (DiscussionPhase.tsx never
  // renders an action bar for the host), checked here too for the same
  // defense-in-depth reason as the DEAD check above.
  if (nominator.isHost) {
    return reject('NOT_A_PARTICIPANT', 'The moderator does not nominate.');
  }

  const targetId = input.target === DECLINE ? undefined : input.target;
  if (targetId !== undefined) {
    const target = findPlayer(state, targetId);
    if (!target) {
      return reject('INVALID_TARGET', 'Nomination target is not a player in this game.');
    }
    if (target.status === 'DEAD') {
      return reject('TARGET_DEAD', 'Cannot nominate a player who is already dead.');
    }
    if (target.isHost) {
      return reject('NOT_A_PARTICIPANT', 'Cannot nominate the moderator.');
    }
  }

  const nomination: Nomination = {
    nominatorId: input.nominatorId,
    targetId,
    dayNumber: state.roundNumber,
    submittedAt: input.now,
  };

  // Replace this nominator's existing nomination for the current day, if any.
  const nominations = [
    ...state.nominations.filter((n) => !(n.nominatorId === input.nominatorId && n.dayNumber === state.roundNumber)),
    nomination,
  ];

  return ok({ ...state, nominations });
}

function nominationsThisRound(state: FullGameState) {
  return state.nominations.filter((n) => n.dayNumber === state.roundNumber);
}

/**
 * Resolves the DAY_DISCUSSION phase: computes the shortlist of every
 * distinct player who received at least one nomination this round — the
 * ONLY valid DAY_VOTE targets for the day (see engine/voting.ts's
 * castVote). Always succeeds, same guarantee as resolveNight/resolveVote.
 *
 * FALLBACK: if nobody nominated anyone (every living player declined, or
 * simply never acted before the phase was forced to resolve), the
 * shortlist falls back to every currently-living player — an open vote,
 * matching today's pre-nomination behavior — rather than leaving DAY_VOTE
 * with no valid targets at all. This is resolved HERE, once, as actual
 * data (`shortlistedIds`), not left for castVote to special-case an empty
 * array at every vote-cast call.
 */
export function resolveNominations(state: FullGameState): Resolution {
  const nominations = nominationsThisRound(state);

  const nominatedIds = new Set<PlayerId>();
  for (const nomination of nominations) {
    if (nomination.targetId !== undefined) nominatedIds.add(nomination.targetId);
  }

  const wasOpenNomination = nominatedIds.size === 0;
  // The fallback (open vote) must exclude the host — they're alive by
  // status but never a valid vote target (see engine/voting.ts's castVote,
  // which also independently rejects a host target defensively). Without
  // this filter a hostless-nomination round would incorrectly shortlist
  // the moderator as votable.
  const shortlistedIds = wasOpenNomination
    ? state.players.filter((p) => p.status === 'ALIVE' && !p.isHost).map((p) => p.id)
    : [...nominatedIds];

  const effects: EngineEffect[] = [
    {
      type: 'NARRATION',
      text: wasOpenNomination
        ? 'No one was nominated. The vote is open to everyone.'
        : `The village has shortlisted ${shortlistedIds.length} suspect${shortlistedIds.length === 1 ? '' : 's'} for the vote.`,
    },
  ];
  if (wasOpenNomination) {
    effects.push({ type: 'NOMINATION_OPEN' });
  }

  return {
    state: { ...state, shortlistedIds },
    effects,
  };
}
