// ---------------------------------------------------------------------------
// End-to-end-within-the-engine flow tests: chaining resolveNight/resolveVote
// into checkWinCondition, the way the (impure) game loop actually would.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { resolveNight } from '../nightActions';
import { resolveVote } from '../voting';
import { checkWinCondition } from '../winCondition';
import { buildState, pid } from './helpers';

describe('mafia reaching parity ends the game', () => {
  it('a mafia night kill that brings mafia to parity with the town ends the game as a mafia win', () => {
    // 1 mafia, 2 town alive. Mafia kills one villager -> 1 mafia vs 1 town: parity.
    const state = buildState({
      roundNumber: 1,
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V1', role: 'VILLAGER' },
        { id: 'villager2', name: 'V2', role: 'VILLAGER' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('villager1'), nightNumber: 1, submittedAt: 1 },
      ],
    });

    const { state: afterNight } = resolveNight(state);
    const verdict = checkWinCondition(afterNight);

    expect(verdict).toEqual({ isOver: true, reason: 'MAFIA_WIN', winningTeam: 'MAFIA' });
  });

  it('the game does not end while the town still outnumbers the mafia after a kill', () => {
    const state = buildState({
      roundNumber: 1,
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V1', role: 'VILLAGER' },
        { id: 'villager2', name: 'V2', role: 'VILLAGER' },
        { id: 'villager3', name: 'V3', role: 'VILLAGER' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('villager1'), nightNumber: 1, submittedAt: 1 },
      ],
    });

    const { state: afterNight } = resolveNight(state);
    expect(checkWinCondition(afterNight)).toEqual({ isOver: false });
  });

  it('a day vote that eliminates the last mafia ends the game as a town win', () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      roundNumber: 1,
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V1', role: 'VILLAGER' },
        { id: 'villager2', name: 'V2', role: 'VILLAGER' },
      ],
      votes: [
        { voterId: pid('villager1'), targetId: pid('mafia1'), dayNumber: 1, submittedAt: 1 },
        { voterId: pid('villager2'), targetId: pid('mafia1'), dayNumber: 1, submittedAt: 2 },
      ],
    });

    const { state: afterVote } = resolveVote(state);
    expect(checkWinCondition(afterVote)).toEqual({ isOver: true, reason: 'TOWN_WIN', winningTeam: 'TOWN' });
  });

  it('a full night+day cycle that does not eliminate the last mafia keeps the game going', () => {
    const night = buildState({
      roundNumber: 1,
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V1', role: 'VILLAGER' },
        { id: 'villager2', name: 'V2', role: 'VILLAGER' },
        { id: 'villager3', name: 'V3', role: 'VILLAGER' },
      ],
      nightActions: [],
    });

    const { state: afterNight } = resolveNight(night);
    expect(checkWinCondition(afterNight)).toEqual({ isOver: false });

    const day = { ...afterNight, phase: 'DAY_VOTE' as const, votes: [
      { voterId: pid('villager1'), targetId: pid('villager3'), dayNumber: 1, submittedAt: 1 },
      { voterId: pid('villager2'), targetId: pid('villager1'), dayNumber: 1, submittedAt: 2 },
    ]};

    const { state: afterVote } = resolveVote(day);
    // Tie: nobody eliminated, mafia still 1 vs town still 3 -> game continues.
    expect(checkWinCondition(afterVote)).toEqual({ isOver: false });
  });
});
