import { describe, expect, it } from 'vitest';
import { buildState, pid } from '../../engine/__tests__/helpers';
import { isNightResolutionReady, isPhaseReadyToResolveEarly, isVoteResolutionReady } from '../earlyResolution';

describe('isNightResolutionReady', () => {
  it('is false outside the NIGHT phase', () => {
    const state = buildState({ phase: 'DAY_VOTE', players: [{ id: 'm1', name: 'M', role: 'MAFIA' }] });
    expect(isNightResolutionReady(state)).toBe(false);
  });

  it('is false when a living night-acting role has not yet submitted', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      players: [
        { id: 'm1', name: 'M', role: 'MAFIA' },
        { id: 'd1', name: 'D', role: 'DOCTOR' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('m1'), actorRole: 'MAFIA', targetId: pid('d1'), nightNumber: 1, submittedAt: 1 },
      ],
    });
    expect(isNightResolutionReady(state)).toBe(false);
  });

  it('is true once every living night-acting role has submitted', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      players: [
        { id: 'm1', name: 'M', role: 'MAFIA' },
        { id: 'd1', name: 'D', role: 'DOCTOR' },
        { id: 'v1', name: 'V', role: 'VILLAGER' }, // villagers don't act at night
      ],
      nightActions: [
        { id: 'a1', actorId: pid('m1'), actorRole: 'MAFIA', targetId: pid('v1'), nightNumber: 1, submittedAt: 1 },
        { id: 'a2', actorId: pid('d1'), actorRole: 'DOCTOR', targetId: pid('d1'), nightNumber: 1, submittedAt: 2 },
      ],
    });
    expect(isNightResolutionReady(state)).toBe(true);
  });

  it('ignores a dead night-acting role — their absence never blocks resolution', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      players: [
        { id: 'm1', name: 'M', role: 'MAFIA' },
        { id: 'd1', name: 'D', role: 'DOCTOR', status: 'DEAD' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('m1'), actorRole: 'MAFIA', targetId: pid('m1'), nightNumber: 1, submittedAt: 1 },
      ],
    });
    expect(isNightResolutionReady(state)).toBe(true);
  });

  it('ignores an action from a prior round when checking the current round', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 2,
      players: [{ id: 'm1', name: 'M', role: 'MAFIA' }],
      nightActions: [
        { id: 'a1', actorId: pid('m1'), actorRole: 'MAFIA', targetId: pid('m1'), nightNumber: 1, submittedAt: 1 },
      ],
    });
    expect(isNightResolutionReady(state)).toBe(false);
  });

  it('is vacuously true when no living player has a night-acting role', () => {
    const state = buildState({
      phase: 'NIGHT',
      players: [{ id: 'v1', name: 'V', role: 'VILLAGER' }],
    });
    expect(isNightResolutionReady(state)).toBe(true);
  });
});

describe('isVoteResolutionReady', () => {
  it('is false outside DAY_VOTE', () => {
    const state = buildState({ phase: 'NIGHT', players: [{ id: 'v1', name: 'V', role: 'VILLAGER' }] });
    expect(isVoteResolutionReady(state)).toBe(false);
  });

  it('is false until every living player has voted', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
      votes: [{ voterId: pid('v1'), targetId: pid('v2'), dayNumber: 1, submittedAt: 1 }],
    });
    expect(isVoteResolutionReady(state)).toBe(false);
  });

  it('is true once every living player has voted, including explicit abstains', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
      votes: [
        { voterId: pid('v1'), targetId: pid('v2'), dayNumber: 1, submittedAt: 1 },
        { voterId: pid('v2'), targetId: undefined, dayNumber: 1, submittedAt: 2 }, // abstain
      ],
    });
    expect(isVoteResolutionReady(state)).toBe(true);
  });

  it('does not require a dead player to vote', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER', status: 'DEAD' },
      ],
      votes: [{ voterId: pid('v1'), targetId: undefined, dayNumber: 1, submittedAt: 1 }],
    });
    expect(isVoteResolutionReady(state)).toBe(true);
  });
});

describe('isPhaseReadyToResolveEarly', () => {
  it('never resolves DAY_DISCUSSION early — there is nothing to wait for', () => {
    const state = buildState({ phase: 'DAY_DISCUSSION', players: [{ id: 'v1', name: 'V', role: 'VILLAGER' }] });
    expect(isPhaseReadyToResolveEarly(state)).toBe(false);
  });

  it('delegates to isNightResolutionReady during NIGHT', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      players: [{ id: 'm1', name: 'M', role: 'MAFIA' }],
      nightActions: [
        { id: 'a1', actorId: pid('m1'), actorRole: 'MAFIA', targetId: pid('m1'), nightNumber: 1, submittedAt: 1 },
      ],
    });
    expect(isPhaseReadyToResolveEarly(state)).toBe(true);
  });
});
