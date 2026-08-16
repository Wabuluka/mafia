import { describe, expect, it } from 'vitest';
import { assignRoles, type UnassignedPlayer } from '../assignRoles';
import { pid } from './helpers';

function unassignedPlayers(count: number): UnassignedPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: pid(`p${i}`),
    name: `Player ${i}`,
    connected: true,
    isHost: i === 0,
    isReady: true,
    joinedAt: i,
  }));
}

describe('assignRoles', () => {
  it('is deterministic for the same seed', () => {
    const players = unassignedPlayers(8);
    const a = assignRoles(players, { seed: 42 });
    const b = assignRoles(players, { seed: 42 });
    expect(a.map((p) => p.role)).toEqual(b.map((p) => p.role));
  });

  it('produces a different assignment for a different seed (usually)', () => {
    const players = unassignedPlayers(8);
    const a = assignRoles(players, { seed: 1 });
    const b = assignRoles(players, { seed: 2 });
    expect(a.map((p) => p.role)).not.toEqual(b.map((p) => p.role));
  });

  it('assigns exactly one role per player, matching the distribution table', () => {
    const players = unassignedPlayers(8);
    const assigned = assignRoles(players, { seed: 7 });
    expect(assigned).toHaveLength(8);

    const counts = new Map<string, number>();
    for (const p of assigned) counts.set(p.role, (counts.get(p.role) ?? 0) + 1);

    // From DEFAULT_ROLE_DISTRIBUTION[8]: MAFIA:2, DETECTIVE:1, DOCTOR:1, JESTER:1, rest VILLAGER
    expect(counts.get('MAFIA')).toBe(2);
    expect(counts.get('DETECTIVE')).toBe(1);
    expect(counts.get('DOCTOR')).toBe(1);
    expect(counts.get('JESTER')).toBe(1);
    expect(counts.get('VILLAGER')).toBe(3);
  });

  it('preserves every non-role field from the input roster', () => {
    const players = unassignedPlayers(5);
    const assigned = assignRoles(players, { seed: 3 });
    for (const original of players) {
      const match = assigned.find((p) => p.id === original.id);
      expect(match).toBeDefined();
      expect(match?.name).toBe(original.name);
      expect(match?.isHost).toBe(original.isHost);
      expect(match?.joinedAt).toBe(original.joinedAt);
    }
  });

  it('starts every player ALIVE', () => {
    const assigned = assignRoles(unassignedPlayers(6), { seed: 5 });
    expect(assigned.every((p) => p.status === 'ALIVE')).toBe(true);
  });

  it('throws for an empty player list', () => {
    expect(() => assignRoles([], { seed: 1 })).toThrow();
  });
});
