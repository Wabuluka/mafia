import { describe, expect, it } from 'vitest';
import { applyNightAction, resolveNight } from '../nightActions';
import { buildState, pid } from './helpers';

describe('applyNightAction', () => {
  it('rejects an action from a dead player', () => {
    const state = buildState({
      phase: 'NIGHT',
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA', status: 'DEAD' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });

    const result = applyNightAction(state, {
      actorId: pid('mafia1'),
      targetId: pid('villager1'),
      actionId: 'a1',
      now: 1000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('PLAYER_DEAD');
  });

  it('rejects an action outside the NIGHT phase', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });

    const result = applyNightAction(state, {
      actorId: pid('mafia1'),
      targetId: pid('villager1'),
      actionId: 'a1',
      now: 1000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('WRONG_PHASE');
  });

  it('rejects an action from a role that does not act at night', () => {
    const state = buildState({
      players: [
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
        { id: 'villager2', name: 'V2', role: 'VILLAGER' },
      ],
    });

    const result = applyNightAction(state, {
      actorId: pid('villager1'),
      targetId: pid('villager2'),
      actionId: 'a1',
      now: 1000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('WRONG_ROLE');
  });

  it('rejects a second action from the same actor in the same round', () => {
    const state = buildState({
      roundNumber: 1,
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
      nightActions: [
        { id: 'a0', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('villager1'), nightNumber: 1, submittedAt: 500 },
      ],
    });

    const result = applyNightAction(state, {
      actorId: pid('mafia1'),
      targetId: pid('villager1'),
      actionId: 'a1',
      now: 1000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ALREADY_ACTED');
  });

  it('rejects targeting a dead player', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER', status: 'DEAD' },
      ],
    });

    const result = applyNightAction(state, {
      actorId: pid('mafia1'),
      targetId: pid('villager1'),
      actionId: 'a1',
      now: 1000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('TARGET_DEAD');
  });

  it('rejects targeting a nonexistent player', () => {
    const state = buildState({
      players: [{ id: 'mafia1', name: 'M', role: 'MAFIA' }],
    });

    const result = applyNightAction(state, {
      actorId: pid('mafia1'),
      targetId: pid('ghost'),
      actionId: 'a1',
      now: 1000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('INVALID_TARGET');
  });

  it('accepts a valid action and records it', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });

    const result = applyNightAction(state, {
      actorId: pid('mafia1'),
      targetId: pid('villager1'),
      actionId: 'a1',
      now: 1000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nightActions).toHaveLength(1);
      expect(result.value.nightActions[0]).toMatchObject({
        actorId: pid('mafia1'),
        actorRole: 'MAFIA',
        targetId: pid('villager1'),
      });
    }
  });
});

describe('resolveNight', () => {
  it('doctor saves the mafia target: the target survives', () => {
    const state = buildState({
      roundNumber: 1,
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'doctor1', name: 'D', role: 'DOCTOR' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('villager1'), nightNumber: 1, submittedAt: 100 },
        { id: 'a2', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('villager1'), nightNumber: 1, submittedAt: 100 },
      ],
    });

    const { state: next, effects } = resolveNight(state);

    const villager = next.players.find((p) => p.id === pid('villager1'));
    expect(villager?.status).toBe('ALIVE');
    expect(effects.some((e) => e.type === 'PLAYER_DIED')).toBe(false);
    expect(effects.some((e) => e.type === 'NARRATION' && e.text.includes('saved'))).toBe(true);
  });

  it('mafia kill succeeds when the doctor protects someone else', () => {
    const state = buildState({
      roundNumber: 1,
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'doctor1', name: 'D', role: 'DOCTOR' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('villager1'), nightNumber: 1, submittedAt: 100 },
        { id: 'a2', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('doctor1'), nightNumber: 1, submittedAt: 100 },
      ],
    });

    const { state: next, effects } = resolveNight(state);

    const villager = next.players.find((p) => p.id === pid('villager1'));
    expect(villager?.status).toBe('DEAD');
    expect(effects).toContainEqual({ type: 'PLAYER_DIED', playerId: pid('villager1'), cause: 'MAFIA_KILL' });
  });

  it('doctor cannot repeat protection on the same target two nights in a row', () => {
    // Night 1: doctor protects villager1 (recorded in history).
    // Night 2: doctor protects villager1 again, mafia kills villager1 —
    // the repeat protection is a no-op, so the kill succeeds.
    const state = buildState({
      roundNumber: 2,
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'doctor1', name: 'D', role: 'DOCTOR' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
      nightActions: [
        // Night 1 history
        { id: 'a0', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('villager1'), nightNumber: 1, submittedAt: 50 },
        // Night 2 actions
        { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('villager1'), nightNumber: 2, submittedAt: 100 },
        { id: 'a2', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('villager1'), nightNumber: 2, submittedAt: 100 },
      ],
    });

    const { state: next, effects } = resolveNight(state);

    const villager = next.players.find((p) => p.id === pid('villager1'));
    expect(villager?.status).toBe('DEAD');
    expect(effects).toContainEqual({ type: 'PLAYER_DIED', playerId: pid('villager1'), cause: 'MAFIA_KILL' });
  });

  it('doctor MAY protect the same target again after a night protecting someone else', () => {
    const state = buildState({
      roundNumber: 3,
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'doctor1', name: 'D', role: 'DOCTOR' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
        { id: 'villager2', name: 'V2', role: 'VILLAGER' },
      ],
      nightActions: [
        { id: 'a0', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('villager1'), nightNumber: 1, submittedAt: 10 },
        { id: 'a1', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('villager2'), nightNumber: 2, submittedAt: 20 },
        // Night 3: doctor protects villager1 again — allowed, since night 2 protected someone else.
        { id: 'a2', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('villager1'), nightNumber: 3, submittedAt: 30 },
        { id: 'a3', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('villager1'), nightNumber: 3, submittedAt: 30 },
      ],
    });

    const { state: next } = resolveNight(state);
    const villager = next.players.find((p) => p.id === pid('villager1'));
    expect(villager?.status).toBe('ALIVE');
  });

  it('detective gets a correct isMafia=true result when investigating a mafia member', () => {
    const state = buildState({
      roundNumber: 1,
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'detective1', name: 'Det', role: 'DETECTIVE' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('detective1'), actorRole: 'DETECTIVE', targetId: pid('mafia1'), nightNumber: 1, submittedAt: 100 },
      ],
    });

    const { effects } = resolveNight(state);
    const result = effects.find((e) => e.type === 'PRIVATE_DETECTIVE_RESULT');
    expect(result).toMatchObject({
      type: 'PRIVATE_DETECTIVE_RESULT',
      playerId: pid('detective1'),
      result: { targetId: pid('mafia1'), isMafia: true, nightNumber: 1 },
    });
  });

  it('detective gets a correct isMafia=false result when investigating a townsperson', () => {
    const state = buildState({
      roundNumber: 1,
      players: [
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
        { id: 'detective1', name: 'Det', role: 'DETECTIVE' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('detective1'), actorRole: 'DETECTIVE', targetId: pid('villager1'), nightNumber: 1, submittedAt: 100 },
      ],
    });

    const { effects } = resolveNight(state);
    const result = effects.find((e) => e.type === 'PRIVATE_DETECTIVE_RESULT');
    expect(result).toMatchObject({
      type: 'PRIVATE_DETECTIVE_RESULT',
      playerId: pid('detective1'),
      result: { targetId: pid('villager1'), isMafia: false, nightNumber: 1 },
    });
  });

  it('produces a neutral narration when nothing happens', () => {
    const state = buildState({
      players: [{ id: 'villager1', name: 'V', role: 'VILLAGER' }],
      nightActions: [],
    });
    const { effects } = resolveNight(state);
    expect(effects).toContainEqual({ type: 'NARRATION', text: 'The night passes without incident.' });
  });
});
