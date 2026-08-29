import { describe, expect, it } from 'vitest';
import { DECLINE, nominate, resolveNominations } from '../nominations';
import { buildState, pid } from './helpers';

describe('nominate', () => {
  it('rejects a nomination from a dead player', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER', status: 'DEAD' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
    });

    const result = nominate(state, { nominatorId: pid('v1'), target: pid('v2'), now: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('PLAYER_DEAD');
  });

  it('rejects a nomination outside DAY_DISCUSSION', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
    });

    const result = nominate(state, { nominatorId: pid('v1'), target: pid('v2'), now: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('WRONG_PHASE');
  });

  it('rejects a nomination from the host/moderator', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      players: [
        { id: 'host', name: 'Host', isHost: true },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
      ],
    });

    const result = nominate(state, { nominatorId: pid('host'), target: pid('v1'), now: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NOT_A_PARTICIPANT');
  });

  it('rejects nominating the host/moderator', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'host', name: 'Host', isHost: true },
      ],
    });

    const result = nominate(state, { nominatorId: pid('v1'), target: pid('host'), now: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NOT_A_PARTICIPANT');
  });

  it('rejects nominating a dead player', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER', status: 'DEAD' },
      ],
    });

    const result = nominate(state, { nominatorId: pid('v1'), target: pid('v2'), now: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('TARGET_DEAD');
  });

  it('rejects nominating a nonexistent player', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      players: [{ id: 'v1', name: 'A', role: 'VILLAGER' }],
    });

    const result = nominate(state, { nominatorId: pid('v1'), target: pid('ghost'), now: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('INVALID_TARGET');
  });

  it('accepts DECLINE as a valid nomination', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      players: [{ id: 'v1', name: 'A', role: 'VILLAGER' }],
    });

    const result = nominate(state, { nominatorId: pid('v1'), target: DECLINE, now: 100 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nominations[0]).toMatchObject({ nominatorId: pid('v1'), targetId: undefined });
    }
  });

  it('allows self-nomination', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      players: [{ id: 'v1', name: 'A', role: 'VILLAGER' }],
    });

    const result = nominate(state, { nominatorId: pid('v1'), target: pid('v1'), now: 100 });
    expect(result.ok).toBe(true);
  });

  it('replaces a prior nomination from the same nominator in the same round instead of stacking', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
        { id: 'v3', name: 'C', role: 'VILLAGER' },
      ],
    });

    const first = nominate(state, { nominatorId: pid('v1'), target: pid('v2'), now: 100 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = nominate(first.value, { nominatorId: pid('v1'), target: pid('v3'), now: 200 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const v1Nominations = second.value.nominations.filter((n) => n.nominatorId === pid('v1'));
    expect(v1Nominations).toHaveLength(1);
    expect(v1Nominations[0]?.targetId).toBe(pid('v3'));
  });
});

describe('resolveNominations', () => {
  it('shortlists every distinct nominated player', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
        { id: 'v3', name: 'C', role: 'VILLAGER' },
      ],
      nominations: [
        { nominatorId: pid('v1'), targetId: pid('v3'), dayNumber: 1, submittedAt: 1 },
        { nominatorId: pid('v2'), targetId: pid('v3'), dayNumber: 1, submittedAt: 2 },
      ],
    });

    const { state: next, effects } = resolveNominations(state);
    expect(next.shortlistedIds).toEqual([pid('v3')]);
    expect(effects.some((e) => e.type === 'NOMINATION_OPEN')).toBe(false);
  });

  it('shortlists multiple distinct nominees, deduplicated', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
        { id: 'v3', name: 'C', role: 'VILLAGER' },
      ],
      nominations: [
        { nominatorId: pid('v1'), targetId: pid('v2'), dayNumber: 1, submittedAt: 1 },
        { nominatorId: pid('v2'), targetId: pid('v3'), dayNumber: 1, submittedAt: 2 },
        { nominatorId: pid('v3'), targetId: pid('v2'), dayNumber: 1, submittedAt: 3 },
      ],
    });

    const { state: next } = resolveNominations(state);
    expect(new Set(next.shortlistedIds)).toEqual(new Set([pid('v2'), pid('v3')]));
  });

  it('falls back to every living player when nobody nominated anyone', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
        { id: 'v3', name: 'C', role: 'VILLAGER', status: 'DEAD' },
      ],
      nominations: [
        { nominatorId: pid('v1'), targetId: undefined, dayNumber: 1, submittedAt: 1 },
        { nominatorId: pid('v2'), targetId: undefined, dayNumber: 1, submittedAt: 2 },
      ],
    });

    const { state: next, effects } = resolveNominations(state);
    expect(new Set(next.shortlistedIds)).toEqual(new Set([pid('v1'), pid('v2')]));
    expect(effects).toContainEqual({ type: 'NOMINATION_OPEN' });
    expect(effects).toContainEqual({ type: 'NARRATION', text: 'No one was nominated. The vote is open to everyone.' });
  });

  it('falls back to every living player when the phase resolves with zero nominations submitted at all', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
      nominations: [],
    });

    const { state: next } = resolveNominations(state);
    expect(new Set(next.shortlistedIds)).toEqual(new Set([pid('v1'), pid('v2')]));
  });

  it('excludes an alive host/moderator from the open-vote fallback shortlist', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'host', name: 'Host', isHost: true },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
      nominations: [],
    });

    const { state: next } = resolveNominations(state);
    expect(new Set(next.shortlistedIds)).toEqual(new Set([pid('v1'), pid('v2')]));
    expect(next.shortlistedIds).not.toContain(pid('host'));
  });

  it('ignores a nomination from a prior round when resolving the current round', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 2,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
      ],
      nominations: [{ nominatorId: pid('v1'), targetId: pid('v2'), dayNumber: 1, submittedAt: 1 }],
    });

    const { state: next } = resolveNominations(state);
    // Round 2 had no nominations of its own -> falls back to everyone living.
    expect(new Set(next.shortlistedIds)).toEqual(new Set([pid('v1'), pid('v2')]));
  });
});
