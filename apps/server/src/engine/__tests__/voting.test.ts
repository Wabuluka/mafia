import { describe, expect, it } from 'vitest';
import { ABSTAIN, castVote, resolveVote } from '../voting';
import { buildState, pid } from './helpers';

describe('castVote', () => {
  it('rejects a vote from a dead player', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER', status: 'DEAD' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
    });

    const result = castVote(state, { voterId: pid('v1'), target: pid('v2'), now: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('PLAYER_DEAD');
  });

  it('rejects a vote outside DAY_VOTE', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
    });

    const result = castVote(state, { voterId: pid('v1'), target: pid('v2'), now: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('WRONG_PHASE');
  });

  it('rejects voting to eliminate a dead player', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER', status: 'DEAD' },
      ],
    });

    const result = castVote(state, { voterId: pid('v1'), target: pid('v2'), now: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('TARGET_DEAD');
  });

  it('accepts ABSTAIN as a valid vote', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      players: [{ id: 'v1', name: 'A', role: 'VILLAGER' }],
    });

    const result = castVote(state, { voterId: pid('v1'), target: ABSTAIN, now: 100 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.votes[0]).toMatchObject({ voterId: pid('v1'), targetId: undefined });
    }
  });

  it('rejects a vote from the host/moderator', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      players: [
        { id: 'host', name: 'Host', isHost: true },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
      ],
    });

    const result = castVote(state, { voterId: pid('host'), target: pid('v1'), now: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NOT_A_PARTICIPANT');
  });

  it('rejects voting to eliminate the host/moderator', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'host', name: 'Host', isHost: true },
      ],
    });

    const result = castVote(state, { voterId: pid('v1'), target: pid('host'), now: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NOT_A_PARTICIPANT');
  });

  it('rejects voting for a player who was not shortlisted', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      shortlistedIds: [pid('v2')],
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
        { id: 'v3', name: 'C', role: 'VILLAGER' },
      ],
    });

    const result = castVote(state, { voterId: pid('v1'), target: pid('v3'), now: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('INVALID_TARGET');
  });

  it('accepts voting for a shortlisted player', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      shortlistedIds: [pid('v2')],
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
    });

    const result = castVote(state, { voterId: pid('v1'), target: pid('v2'), now: 100 });
    expect(result.ok).toBe(true);
  });

  it('an empty shortlist imposes no restriction (open vote)', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      shortlistedIds: [],
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
    });

    const result = castVote(state, { voterId: pid('v1'), target: pid('v2'), now: 100 });
    expect(result.ok).toBe(true);
  });

  it('replaces a prior vote from the same voter in the same round instead of stacking', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
        { id: 'v3', name: 'C', role: 'VILLAGER' },
      ],
    });

    const first = castVote(state, { voterId: pid('v1'), target: pid('v2'), now: 100 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = castVote(first.value, { voterId: pid('v1'), target: pid('v3'), now: 200 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const v1Votes = second.value.votes.filter((v) => v.voterId === pid('v1'));
    expect(v1Votes).toHaveLength(1);
    expect(v1Votes[0]?.targetId).toBe(pid('v3'));
  });
});

describe('resolveVote', () => {
  it('eliminates the plurality target', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
        { id: 'v3', name: 'C', role: 'MAFIA' },
      ],
      votes: [
        { voterId: pid('v1'), targetId: pid('v3'), dayNumber: 1, submittedAt: 1 },
        { voterId: pid('v2'), targetId: pid('v3'), dayNumber: 1, submittedAt: 2 },
        { voterId: pid('v3'), targetId: pid('v1'), dayNumber: 1, submittedAt: 3 },
      ],
    });

    const { state: next, effects } = resolveVote(state);
    const eliminated = next.players.find((p) => p.id === pid('v3'));
    expect(eliminated?.status).toBe('DEAD');
    expect(effects).toContainEqual({ type: 'PLAYER_DIED', playerId: pid('v3'), role: 'MAFIA', cause: 'VOTE_ELIMINATION' });
    expect(eliminated?.revealedRole).toBe('MAFIA');
  });

  it('a tie vote eliminates nobody', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
      votes: [
        { voterId: pid('v1'), targetId: pid('v2'), dayNumber: 1, submittedAt: 1 },
        { voterId: pid('v2'), targetId: pid('v1'), dayNumber: 1, submittedAt: 2 },
      ],
    });

    const { state: next, effects } = resolveVote(state);
    expect(next.players.every((p) => p.status === 'ALIVE')).toBe(true);
    expect(effects.some((e) => e.type === 'PLAYER_DIED')).toBe(false);
    expect(effects).toContainEqual({ type: 'VOTE_TIED' });
    expect(effects).toContainEqual({ type: 'NARRATION', text: 'The vote ended in a tie. No one is eliminated today.' });
  });

  it('a three-way tie for the lead also eliminates nobody', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
        { id: 'v3', name: 'C', role: 'VILLAGER' },
      ],
      votes: [
        { voterId: pid('v1'), targetId: pid('v2'), dayNumber: 1, submittedAt: 1 },
        { voterId: pid('v2'), targetId: pid('v3'), dayNumber: 1, submittedAt: 2 },
        { voterId: pid('v3'), targetId: pid('v1'), dayNumber: 1, submittedAt: 3 },
      ],
    });

    const { state: next, effects } = resolveVote(state);
    expect(next.players.every((p) => p.status === 'ALIVE')).toBe(true);
    expect(effects).toContainEqual({ type: 'VOTE_TIED' });
  });

  it('all-abstain eliminates nobody and is NOT reported as a tie (no votes were cast at all)', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
      votes: [
        { voterId: pid('v1'), targetId: undefined, dayNumber: 1, submittedAt: 1 },
        { voterId: pid('v2'), targetId: undefined, dayNumber: 1, submittedAt: 2 },
      ],
    });

    const { state: next, effects } = resolveVote(state);
    expect(next.players.every((p) => p.status === 'ALIVE')).toBe(true);
    expect(effects.some((e) => e.type === 'VOTE_TIED')).toBe(false);
    expect(effects).toContainEqual({ type: 'NARRATION', text: 'No votes were cast. No one is eliminated today.' });
  });
});
