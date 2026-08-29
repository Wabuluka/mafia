import { describe, expect, it } from 'vitest';
import { buildState, pid } from '../../engine/__tests__/helpers';
import {
  isNightResolutionReady,
  isNominationResolutionReady,
  isPhaseReadyToResolveEarly,
  isVoteResolutionReady,
} from '../earlyResolution';

describe('isNightResolutionReady', () => {
  // Under the moderator-driven night flow, "ready" is purely a question of
  // whether NIGHT's internal sub-sequence (MAFIA -> DETECTIVE -> DOCTOR,
  // see @mafia/shared's NightSubPhaseSchema) has reached COMPLETE — that
  // only ever happens via the host's explicit `advanceNightSubPhase`
  // action, not automatically the instant a role submits an action. See
  // engine/nightActions.test.ts for submission-level behavior and
  // realtime/handlers/__tests__ (if any) for the moderator-advance flow.
  it('is false outside the NIGHT phase', () => {
    const state = buildState({ phase: 'DAY_VOTE', players: [{ id: 'm1', name: 'M', role: 'MAFIA' }] });
    expect(isNightResolutionReady(state)).toBe(false);
  });

  it('is false while the night sub-sequence has not reached COMPLETE, even if every role has submitted', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      nightSubPhase: 'DOCTOR',
      players: [
        { id: 'm1', name: 'M', role: 'MAFIA' },
        { id: 'd1', name: 'D', role: 'DOCTOR' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('m1'), actorRole: 'MAFIA', targetId: pid('d1'), nightNumber: 1, submittedAt: 1 },
        { id: 'a2', actorId: pid('d1'), actorRole: 'DOCTOR', targetId: pid('d1'), nightNumber: 1, submittedAt: 2 },
      ],
    });
    expect(isNightResolutionReady(state)).toBe(false);
  });

  it('is true once the night sub-sequence has reached COMPLETE', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      nightSubPhase: 'COMPLETE',
      players: [
        { id: 'm1', name: 'M', role: 'MAFIA' },
        { id: 'd1', name: 'D', role: 'DOCTOR' },
        { id: 'v1', name: 'V', role: 'VILLAGER' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('m1'), actorRole: 'MAFIA', targetId: pid('v1'), nightNumber: 1, submittedAt: 1 },
        { id: 'a2', actorId: pid('d1'), actorRole: 'DOCTOR', targetId: pid('d1'), nightNumber: 1, submittedAt: 2 },
      ],
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

  it('does not require an alive host/moderator to vote — a vote from them can never arrive', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      roundNumber: 1,
      players: [
        { id: 'host', name: 'Host', isHost: true },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
      ],
      votes: [{ voterId: pid('v1'), targetId: undefined, dayNumber: 1, submittedAt: 1 }],
    });
    expect(isVoteResolutionReady(state)).toBe(true);
  });
});

describe('isNominationResolutionReady', () => {
  it('is false outside DAY_DISCUSSION', () => {
    const state = buildState({ phase: 'DAY_VOTE', players: [{ id: 'v1', name: 'V', role: 'VILLAGER' }] });
    expect(isNominationResolutionReady(state)).toBe(false);
  });

  it('is false until every living player has nominated', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
      nominations: [{ nominatorId: pid('v1'), targetId: pid('v2'), dayNumber: 1, submittedAt: 1 }],
    });
    expect(isNominationResolutionReady(state)).toBe(false);
  });

  it('is true once every living player has nominated, including explicit declines', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
      nominations: [
        { nominatorId: pid('v1'), targetId: pid('v2'), dayNumber: 1, submittedAt: 1 },
        { nominatorId: pid('v2'), targetId: undefined, dayNumber: 1, submittedAt: 2 }, // decline
      ],
    });
    expect(isNominationResolutionReady(state)).toBe(true);
  });

  it('does not require a dead player to nominate', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER', status: 'DEAD' },
      ],
      nominations: [{ nominatorId: pid('v1'), targetId: undefined, dayNumber: 1, submittedAt: 1 }],
    });
    expect(isNominationResolutionReady(state)).toBe(true);
  });

  it('does not require an alive host/moderator to nominate — a nomination from them can never arrive', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'host', name: 'Host', isHost: true },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
      ],
      nominations: [{ nominatorId: pid('v1'), targetId: undefined, dayNumber: 1, submittedAt: 1 }],
    });
    expect(isNominationResolutionReady(state)).toBe(true);
  });
});

describe('isPhaseReadyToResolveEarly', () => {
  it('does not resolve DAY_DISCUSSION early while a living player has not yet nominated', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [{ id: 'v1', name: 'V', role: 'VILLAGER' }],
    });
    expect(isPhaseReadyToResolveEarly(state)).toBe(false);
  });

  it('resolves DAY_DISCUSSION early once every living player has nominated (or declined)', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'V', role: 'VILLAGER' },
        { id: 'v2', name: 'V2', role: 'VILLAGER' },
      ],
      nominations: [
        { nominatorId: pid('v1'), targetId: pid('v2'), dayNumber: 1, submittedAt: 1 },
        { nominatorId: pid('v2'), targetId: undefined, dayNumber: 1, submittedAt: 2 },
      ],
    });
    expect(isPhaseReadyToResolveEarly(state)).toBe(true);
  });

  it('delegates to isNightResolutionReady during NIGHT', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      nightSubPhase: 'COMPLETE',
      players: [{ id: 'm1', name: 'M', role: 'MAFIA' }],
      nightActions: [
        { id: 'a1', actorId: pid('m1'), actorRole: 'MAFIA', targetId: pid('m1'), nightNumber: 1, submittedAt: 1 },
      ],
    });
    expect(isPhaseReadyToResolveEarly(state)).toBe(true);
  });
});
