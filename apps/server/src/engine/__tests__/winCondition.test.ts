import { describe, expect, it } from 'vitest';
import { checkJesterWin, checkWinCondition } from '../winCondition';
import { buildState, pid } from './helpers';

describe('checkWinCondition', () => {
  it('town wins when all mafia are eliminated', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA', status: 'DEAD' },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'doc1', name: 'D', role: 'DOCTOR' },
      ],
    });
    const verdict = checkWinCondition(state);
    expect(verdict).toEqual({ isOver: true, reason: 'TOWN_WIN', winningTeam: 'TOWN' });
  });

  it('mafia wins when they reach parity with the town', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
      ],
    });
    const verdict = checkWinCondition(state);
    expect(verdict).toEqual({ isOver: true, reason: 'MAFIA_WIN', winningTeam: 'MAFIA' });
  });

  it('mafia wins when they exceed the town', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M1', role: 'MAFIA' },
        { id: 'mafia2', name: 'M2', role: 'MAFIA' },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
      ],
    });
    const verdict = checkWinCondition(state);
    expect(verdict.isOver).toBe(true);
    expect(verdict.reason).toBe('MAFIA_WIN');
  });

  it('game continues when town outnumbers mafia and mafia are still alive', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
        { id: 'doc1', name: 'D', role: 'DOCTOR' },
      ],
    });
    const verdict = checkWinCondition(state);
    expect(verdict).toEqual({ isOver: false });
  });

  it('never counts an alive host/moderator toward any team\'s tally', () => {
    // 1 mafia vs 1 town, plus an alive, role-less host — if the host were
    // ever counted, this would look like a 1v2 town lead and the game
    // would continue; instead it must resolve as exact parity (mafia wins)
    // since the host is invisible to every team tally.
    const state = buildState({
      players: [
        { id: 'host', name: 'Host', isHost: true },
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
      ],
    });
    const verdict = checkWinCondition(state);
    expect(verdict).toEqual({ isOver: true, reason: 'MAFIA_WIN', winningTeam: 'MAFIA' });
  });

  it('counts a neutral (jester) toward the non-mafia side for parity purposes', () => {
    // 1 mafia vs 1 jester alive: mafia is NOT yet at parity because the
    // jester still counts as a non-mafia vote against them.
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'jester1', name: 'J', role: 'JESTER' },
        { id: 'v1', name: 'A', role: 'VILLAGER' },
      ],
    });
    const verdict = checkWinCondition(state);
    expect(verdict.isOver).toBe(false);
  });

  it('mafia reaches parity when town+neutral combined equals mafia, even with zero town left', () => {
    // 1 mafia vs 1 jester and no town at all: mafia is still at parity
    // against the *combined* non-mafia count, not against town alone —
    // pins down that NEUTRAL is folded into the parity check deliberately
    // (see the doc comment on checkWinCondition), not just "reduces the
    // threshold town needs to hit."
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'jester1', name: 'J', role: 'JESTER' },
      ],
    });
    const verdict = checkWinCondition(state);
    expect(verdict).toEqual({ isOver: true, reason: 'MAFIA_WIN', winningTeam: 'MAFIA' });
  });
});

describe('checkJesterWin', () => {
  it('the jester wins immediately if voted out', () => {
    const verdict = checkJesterWin({
      id: pid('jester1'),
      name: 'J',
      role: 'JESTER',
      status: 'DEAD',
      connected: true,
      isHost: false,
      isReady: true,
      joinedAt: 0,
    });
    expect(verdict).toEqual({ isOver: true, reason: 'JESTER_WIN', winningTeam: 'NEUTRAL' });
  });

  it('does not trigger for a non-jester elimination', () => {
    const verdict = checkJesterWin({
      id: pid('v1'),
      name: 'V',
      role: 'VILLAGER',
      status: 'DEAD',
      connected: true,
      isHost: false,
      isReady: true,
      joinedAt: 0,
    });
    expect(verdict).toEqual({ isOver: false });
  });

  it('does not trigger when nobody was eliminated', () => {
    expect(checkJesterWin(undefined)).toEqual({ isOver: false });
  });
});
