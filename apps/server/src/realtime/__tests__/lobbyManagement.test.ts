import { describe, expect, it } from 'vitest';
import { buildState, pid } from '../../engine/__tests__/helpers';
import { ensureLobbyHasHost, pickNextHost, transferHostIfNeeded } from '../lobbyManagement';

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
      phase: 'LOBBY',
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
      phase: 'LOBBY',
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
      phase: 'LOBBY',
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

  it('is frozen once the game has left LOBBY — a mid-game host disconnect never transfers host', () => {
    // The host never plays (see Player.isHost's doc comment) — handing
    // host to a player who already has a role/team parity mid-game would
    // either corrupt win-condition math or break "host is never a
    // participant". See this function's own doc comment.
    const state = buildState({
      phase: 'NIGHT',
      players: [
        { id: 'host', name: 'Host', isHost: true },
        { id: 'b', name: 'B', role: 'VILLAGER' },
        { id: 'c', name: 'C', role: 'MAFIA' },
      ],
    });

    const result = transferHostIfNeeded(state, pid('host'));
    expect(result).toBe(state); // same reference — genuinely a no-op
    expect(result.players.find((p) => p.id === pid('host'))?.isHost).toBe(true);
  });
});

describe('ensureLobbyHasHost', () => {
  it('is a no-op (same reference) when a connected host already exists', () => {
    const state = buildState({
      players: [
        { id: 'host', name: 'Host', role: 'VILLAGER', isHost: true },
        { id: 'guest', name: 'Guest', role: 'VILLAGER' },
      ],
    });
    const result = ensureLobbyHasHost(state);
    expect(result).toBe(state);
  });

  it('promotes the longest-connected player when the recorded host is no longer in the roster', () => {
    // Simulates the actual bug: a host's session was lost and they rejoined
    // as a different player id, so the ORIGINAL host entry is simply gone
    // — nobody in the roster has isHost: true at all.
    const state = buildState({
      players: [
        { id: 'b', name: 'B', role: 'VILLAGER' },
        { id: 'c', name: 'C', role: 'VILLAGER' },
      ],
    });
    const joinedAts = [50, 20];
    const withTimes = {
      ...state,
      players: state.players.map((p, i) => ({ ...p, joinedAt: joinedAts[i] ?? 0 })),
    };

    const result = ensureLobbyHasHost(withTimes);
    expect(result.players.find((p) => p.id === pid('c'))?.isHost).toBe(true);
    expect(result.players.find((p) => p.id === pid('b'))?.isHost).toBe(false);
  });

  it('promotes a connected player when the recorded host is present but disconnected', () => {
    const state = buildState({
      players: [
        { id: 'host', name: 'Host', role: 'VILLAGER', isHost: true },
        { id: 'guest', name: 'Guest', role: 'VILLAGER' },
      ],
    });
    const staleHost = {
      ...state,
      players: state.players.map((p) => (p.id === pid('host') ? { ...p, connected: false } : p)),
    };

    const result = ensureLobbyHasHost(staleHost);
    expect(result.players.find((p) => p.id === pid('host'))?.isHost).toBe(false);
    expect(result.players.find((p) => p.id === pid('guest'))?.isHost).toBe(true);
  });

  it('leaves the lobby hostless (unchanged) when nobody is connected yet', () => {
    const state = buildState({
      players: [{ id: 'a', name: 'A', role: 'VILLAGER' }],
    });
    const disconnected = { ...state, players: state.players.map((p) => ({ ...p, connected: false })) };
    const result = ensureLobbyHasHost(disconnected);
    expect(result).toBe(disconnected);
  });
});
