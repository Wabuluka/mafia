// ---------------------------------------------------------------------------
// Day vote phase: casting a vote (or abstaining) and resolving the day's
// plurality result. Pure — see the module header in nightActions.ts for the
// same ground rules (no clocks, no I/O, Result union, never throws).
// ---------------------------------------------------------------------------

import type { FullGameState, PlayerId, Vote } from '@mafia/shared';
import { ok, reject, type EngineEffect, type EngineResult, type Resolution } from './types';

/** Sentinel meaning "this voter explicitly abstains" as opposed to simply
 * not having voted yet. Distinct from `undefined` so callers can express
 * intent unambiguously; internally this still stores as `targetId: undefined`
 * on the Vote record, matching the shared VoteSchema. */
export const ABSTAIN = Symbol('ABSTAIN');
export type VoteTarget = PlayerId | typeof ABSTAIN;

function findPlayer(state: FullGameState, playerId: PlayerId) {
  return state.players.find((p) => p.id === playerId);
}

export interface CastVoteInput {
  voterId: PlayerId;
  target: VoteTarget;
  now: number;
}

/**
 * Validates and records one player's vote for the current day. A player may
 * change their vote before the phase resolves — a new CastVote call for the
 * same voter this round replaces their previous vote rather than being
 * rejected as "already acted", since real deliberation involves changing
 * your mind before the gavel falls.
 */
export function castVote(state: FullGameState, input: CastVoteInput): EngineResult<FullGameState> {
  if (state.phase !== 'DAY_VOTE') {
    return reject('WRONG_PHASE', 'Votes can only be cast during the DAY_VOTE phase.');
  }

  const voter = findPlayer(state, input.voterId);
  if (!voter) {
    return reject('PLAYER_NOT_FOUND', 'Voter is not a player in this game.');
  }
  if (voter.status === 'DEAD') {
    return reject('PLAYER_DEAD', 'Dead players cannot vote.');
  }

  const targetId = input.target === ABSTAIN ? undefined : input.target;
  if (targetId !== undefined) {
    const target = findPlayer(state, targetId);
    if (!target) {
      return reject('INVALID_TARGET', 'Vote target is not a player in this game.');
    }
    if (target.status === 'DEAD') {
      return reject('TARGET_DEAD', 'Cannot vote to eliminate a player who is already dead.');
    }
  }

  const vote: Vote = {
    voterId: input.voterId,
    targetId,
    dayNumber: state.roundNumber,
    submittedAt: input.now,
  };

  // Replace this voter's existing vote for the current day, if any.
  const votes = [
    ...state.votes.filter((v) => !(v.voterId === input.voterId && v.dayNumber === state.roundNumber)),
    vote,
  ];

  return ok({ ...state, votes });
}

function votesThisRound(state: FullGameState) {
  return state.votes.filter((v) => v.dayNumber === state.roundNumber);
}

/**
 * Resolves the DAY_VOTE phase by plurality: the target with the most votes
 * is eliminated. A tie for the lead — including every player abstaining —
 * eliminates nobody. Always succeeds, same guarantee as `resolveNight`.
 */
export function resolveVote(state: FullGameState): Resolution {
  const votes = votesThisRound(state);

  const tally = new Map<PlayerId, number>();
  for (const vote of votes) {
    if (vote.targetId === undefined) continue; // abstain: no tally entry
    tally.set(vote.targetId, (tally.get(vote.targetId) ?? 0) + 1);
  }

  let eliminatedId: PlayerId | undefined;
  let maxVotes = 0;
  let tied = false;
  for (const [targetId, count] of tally) {
    if (count > maxVotes) {
      maxVotes = count;
      eliminatedId = targetId;
      tied = false;
    } else if (count === maxVotes) {
      tied = true;
    }
  }
  if (tied) {
    eliminatedId = undefined;
  }

  let players = state.players;
  const effects: EngineEffect[] = [];

  if (eliminatedId !== undefined) {
    const eliminated = state.players.find((p) => p.id === eliminatedId);
    players = players.map((p) => (p.id === eliminatedId ? { ...p, status: 'DEAD' } : p));
    effects.push({ type: 'PLAYER_DIED', playerId: eliminatedId, cause: 'VOTE_ELIMINATION' });
    effects.push({
      type: 'NARRATION',
      text: `The town has voted to eliminate ${eliminated?.name ?? 'a player'}.`,
    });
  } else {
    effects.push({
      type: 'NARRATION',
      text: 'The vote ended in a tie. No one is eliminated today.',
    });
  }

  return {
    state: { ...state, players },
    effects,
  };
}
