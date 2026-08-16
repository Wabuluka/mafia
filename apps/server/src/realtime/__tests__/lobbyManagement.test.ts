import { describe, expect, it } from 'vitest';
import { buildState, pid } from '../../engine/__tests__/helpers';
import { pickNextHost, transferHostIfNeeded } from '../lobbyManagement';

describe('pickNextHost', () => {
  it('picks the longest-connected (smallest joinedAt) among connected players', () => {
    const state = buildState({
      players: [
        { id: 'a', name: 'A', role: 'VILLAGER' },
        { id: 'b', name: 'B', role: 'VILLAGER' },
        { id: 'c', name: 'C', role: 'VILLAGER' },
      ],
    });
    // buildState defaults joinedAt to 0 for all — override manually for this test.
    const joinedAts = [30, 10, 20];
    const players = state.players.map((p, i) => ({ ...p, joinedAt: joinedAts[i] ?? 0 }));
    const next = pickNextHost(players);
    expect(next?.id).toBe(pid('b'));
  });

  it('skips disconnected players even if they joined first', () => {
    const state = buildState({
      players: [
        { id: 'a', name: 'A', role: 'VILLAGER' },
        { id: 'b', name: 'B', role: 'VILLAGER' },
      ],
    });
    const [playerA, playerB] = state.players;
    if (!playerA || !playerB) throw new Error('fixture must have two players');
    const players = [
      { ...playerA, joinedAt: 1, connected: false },
      { ...playerB, joinedAt: 100, connected: true },
    ];
    const next = pickNextHost(players);
    expect(next?.id).toBe(pid('b'));
  });

  it('returns undefined when nobody is connected', () => {
    const state = buildState({ players: [{ id: 'a', name: 'A', role: 'VILLAGER' }] });
    const players = state.players.map((p) => ({ ...p, connected: false }));
    expect(pickNextHost(players)).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(pickNextHost([])).toBeUndefined();
  });
});

describe('transferHostIfNeeded', () => {
  it('does nothing if the outgoing player was not host', () => {
    const state = buildState({
      players: [
        { id: 'host', name: 'Host', role: 'VILLAGER', isHost: true },
        { id: 'guest', name: 'Guest', role: 'VILLAGER' },
      ],
    });
    const result = transferHostIfNeeded(state, pid('guest'));
    expect(result).toBe(state); // same reference — genuinely a no-op
  });

  it('transfers host to the longest-connected remaining player', () => {
    const state = buildState({
      players: [
        { id: 'host', name: 'Host', role: 'VILLAGER', isHost: true },
        { id: 'b', name: 'B', role: 'VILLAGER' },
        { id: 'c', name: 'C', role: 'VILLAGER' },
      ],
    });
    const joinedAts = [0, 50, 20];
    const withTimes = {
      ...state,
      players: state.players.map((p, i) => ({ ...p, joinedAt: joinedAts[i] ?? 0 })),
    };

    const result = transferHostIfNeeded(withTimes, pid('host'));
    const oldHost = result.players.find((p) => p.id === pid('host'));
    const newHost = result.players.find((p) => p.id === pid('c'));
    const other = result.players.find((p) => p.id === pid('b'));

    expect(oldHost?.isHost).toBe(false);
    expect(newHost?.isHost).toBe(true);
    expect(other?.isHost).toBe(false);
  });

  it('strips the outgoing host flag with no successor when nobody else is connected', () => {
    const state = buildState({
      players: [
        { id: 'host', name: 'Host', role: 'VILLAGER', isHost: true },
        { id: 'b', name: 'B', role: 'VILLAGER' },
      ],
    });
    const disconnected = { ...state, players: state.players.map((p) => (p.id === pid('b') ? { ...p, connected: false } : p)) };

    const result = transferHostIfNeeded(disconnected, pid('host'));
    expect(result.players.find((p) => p.id === pid('host'))?.isHost).toBe(false);
    expect(result.players.some((p) => p.isHost)).toBe(false);
  });
});
