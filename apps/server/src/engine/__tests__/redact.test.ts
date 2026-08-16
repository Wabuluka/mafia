import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { brandFullGameState, type FullGameState, type Role } from '@mafia/shared';
import { redactStateFor } from '../redact';
import { buildState, pid } from './helpers';

const ROLES: Role[] = ['VILLAGER', 'MAFIA', 'DETECTIVE', 'DOCTOR', 'JESTER'];

describe('redactStateFor', () => {
  it('never leaks another player\'s role', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'detective1', name: 'Det', role: 'DETECTIVE' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });

    const view = redactStateFor(state, pid('villager1'));
    const otherPlayers = view.players.filter((p) => p.id !== pid('villager1'));
    for (const p of otherPlayers) {
      expect((p as { role?: unknown }).role).toBeUndefined();
      expect(p.revealedRole).toBeUndefined();
    }
  });

  it('includes the viewer\'s own role only in `you`, never in the players array', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });

    const view = redactStateFor(state, pid('mafia1'));
    expect(view.you.role).toBe('MAFIA');
    const selfEntry = view.players.find((p) => p.id === pid('mafia1'));
    expect((selfEntry as { role?: unknown } | undefined)?.role).toBeUndefined();
  });

  it('reveals a role once it has been publicly revealed (revealedRole)', () => {
    const state = brandFullGameState({
      roomCode: 'ABCD' as FullGameState['roomCode'],
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: pid('mafia1'), name: 'M', role: 'MAFIA', revealedRole: 'MAFIA', status: 'DEAD', connected: true, isHost: false, isReady: true, joinedAt: 0 },
        { id: pid('villager1'), name: 'V', role: 'VILLAGER', status: 'ALIVE', connected: true, isHost: false, isReady: true, joinedAt: 0 },
      ],
      nightActions: [],
      votes: [],
      chatLog: [],
    });

    const view = redactStateFor(state, pid('villager1'));
    const dead = view.players.find((p) => p.id === pid('mafia1'));
    expect(dead?.revealedRole).toBe('MAFIA');
  });

  it('gives the mafia player their living teammates\' ids', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M1', role: 'MAFIA' },
        { id: 'mafia2', name: 'M2', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });

    const view = redactStateFor(state, pid('mafia1'));
    expect(view.you.mafiaTeammateIds).toEqual([pid('mafia2')]);
  });

  it('does not populate mafiaTeammateIds for a non-mafia viewer', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });

    const view = redactStateFor(state, pid('villager1'));
    expect(view.you.mafiaTeammateIds).toBeUndefined();
  });

  it('gives the detective their own investigation history, target roles included only as isMafia', () => {
    const state = buildState({
      roundNumber: 1,
      players: [
        { id: 'detective1', name: 'Det', role: 'DETECTIVE' },
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('detective1'), actorRole: 'DETECTIVE', targetId: pid('mafia1'), nightNumber: 1, submittedAt: 10 },
      ],
    });

    const view = redactStateFor(state, pid('detective1'));
    expect(view.you.detectiveResults).toEqual([{ targetId: pid('mafia1'), isMafia: true, nightNumber: 1 }]);
  });

  it('filters mafia chat out of a non-mafia viewer\'s chat log', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
      chatLog: [
        { id: 'c1', channel: 'MAFIA', senderId: pid('mafia1'), senderName: 'M', body: 'secret plan', sentAt: 1 },
        { id: 'c2', channel: 'DAY', senderId: pid('villager1'), senderName: 'V', body: 'hello', sentAt: 2 },
      ],
    });

    const view = redactStateFor(state, pid('villager1'));
    expect(view.chatLog.map((m) => m.id)).toEqual(['c2']);
  });

  it('lets a living mafia member see the mafia chat channel', () => {
    const state = buildState({
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
      chatLog: [
        { id: 'c1', channel: 'MAFIA', senderId: pid('mafia1'), senderName: 'M', body: 'secret plan', sentAt: 1 },
      ],
    });

    const view = redactStateFor(state, pid('mafia1'));
    expect(view.chatLog.map((m) => m.id)).toEqual(['c1']);
  });

  it('gives a mafia viewer a live tally of every teammate\'s current-round target during NIGHT', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 2,
      players: [
        { id: 'mafia1', name: 'M1', role: 'MAFIA' },
        { id: 'mafia2', name: 'M2', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('mafia1'), actorRole: 'MAFIA', targetId: pid('villager1'), nightNumber: 2, submittedAt: 1 },
        // mafia2 hasn't acted yet this round.
        { id: 'a0', actorId: pid('mafia2'), actorRole: 'MAFIA', targetId: pid('mafia1'), nightNumber: 1, submittedAt: 1 }, // prior round, must not count
      ],
    });

    const view = redactStateFor(state, pid('mafia1'));
    expect(view.you.mafiaNightTargets).toEqual(
      expect.arrayContaining([
        { actorId: pid('mafia1'), targetId: pid('villager1') },
        { actorId: pid('mafia2'), targetId: undefined },
      ]),
    );
    expect(view.you.mafiaNightTargets).toHaveLength(2);
  });

  it('does not populate mafiaNightTargets outside of NIGHT', () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      players: [{ id: 'mafia1', name: 'M', role: 'MAFIA' }],
    });
    const view = redactStateFor(state, pid('mafia1'));
    expect(view.you.mafiaNightTargets).toBeUndefined();
  });

  it('does not populate mafiaNightTargets for a non-mafia viewer', () => {
    const state = buildState({
      phase: 'NIGHT',
      players: [
        { id: 'mafia1', name: 'M', role: 'MAFIA' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
    });
    const view = redactStateFor(state, pid('villager1'));
    expect(view.you.mafiaNightTargets).toBeUndefined();
  });

  it('gives the doctor lastProtectedPlayerId when they protected someone the immediately preceding night', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 2,
      players: [
        { id: 'doctor1', name: 'Doc', role: 'DOCTOR' },
        { id: 'villager1', name: 'V', role: 'VILLAGER' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('villager1'), nightNumber: 1, submittedAt: 1 },
      ],
    });

    const view = redactStateFor(state, pid('doctor1'));
    expect(view.you.lastProtectedPlayerId).toBe(pid('villager1'));
  });

  it('leaves lastProtectedPlayerId undefined on the first night', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      players: [{ id: 'doctor1', name: 'Doc', role: 'DOCTOR' }],
    });
    const view = redactStateFor(state, pid('doctor1'));
    expect(view.you.lastProtectedPlayerId).toBeUndefined();
  });

  it('leaves lastProtectedPlayerId undefined when the doctor protected someone two nights ago but someone else last night', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 3,
      players: [
        { id: 'doctor1', name: 'Doc', role: 'DOCTOR' },
        { id: 'v1', name: 'V1', role: 'VILLAGER' },
        { id: 'v2', name: 'V2', role: 'VILLAGER' },
      ],
      nightActions: [
        { id: 'a1', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('v1'), nightNumber: 1, submittedAt: 1 },
        { id: 'a2', actorId: pid('doctor1'), actorRole: 'DOCTOR', targetId: pid('v2'), nightNumber: 2, submittedAt: 1 },
      ],
    });

    const view = redactStateFor(state, pid('doctor1'));
    // Round 3's lockout is keyed on round 2's target (v2), not round 1's (v1).
    expect(view.you.lastProtectedPlayerId).toBe(pid('v2'));
  });

  it('does not populate lastProtectedPlayerId for a non-doctor viewer', () => {
    const state = buildState({
      phase: 'NIGHT',
      players: [{ id: 'villager1', name: 'V', role: 'VILLAGER' }],
    });
    const view = redactStateFor(state, pid('villager1'));
    expect(view.you.lastProtectedPlayerId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Property-based test: for any randomly generated FullGameState and any
// player in it, the resulting PlayerView — after JSON serialization, as it
// would actually cross the wire — never contains a role string belonging to
// a *different* player. This is the strongest guarantee this function
// makes; the property test tries to break it with structures the example
// tests above wouldn't think to construct.
// ---------------------------------------------------------------------------

const roleArb = fc.constantFrom(...ROLES);

const playerArb = fc.record({
  idSuffix: fc.integer({ min: 0, max: 999 }),
  role: roleArb,
  status: fc.constantFrom<'ALIVE' | 'DEAD'>('ALIVE', 'DEAD'),
  reveal: fc.boolean(),
});

const gameArb = fc
  .array(playerArb, { minLength: 1, maxLength: 12 })
  .map((players) =>
    players.map((p, index) => ({ ...p, idSuffix: index })), // guarantee unique ids
  )
  .chain((players) =>
    fc.record({
      players: fc.constant(players),
      viewerIndex: fc.integer({ min: 0, max: players.length - 1 }),
    }),
  );

describe('redactStateFor property: no cross-player role leakage', () => {
  it('the serialized PlayerView never contains another player\'s role string', () => {
    fc.assert(
      fc.property(gameArb, ({ players, viewerIndex }) => {
        const state = brandFullGameState({
          roomCode: 'ABCD' as FullGameState['roomCode'],
          phase: 'DAY_DISCUSSION',
          roundNumber: 1,
          players: players.map((p) => ({
            id: pid(`p${p.idSuffix}`),
            name: `Player ${p.idSuffix}`,
            role: p.role,
            revealedRole: p.reveal ? p.role : undefined,
            status: p.status,
            connected: true,
            isHost: p.idSuffix === 0,
            isReady: true,
            joinedAt: 0,
          })),
          nightActions: [],
          votes: [],
          chatLog: [],
        });

        const viewer = players[viewerIndex];
        if (!viewer) return; // shouldn't happen given the generator's bounds

        const viewerId = pid(`p${viewer.idSuffix}`);
        const view = redactStateFor(state, viewerId);

        // Round-trip through JSON, exactly like a socket.io emit would, so
        // the property covers what actually reaches the wire, not just the
        // in-memory object shape.
        const serialized = JSON.parse(JSON.stringify(view)) as typeof view;

        for (const other of players) {
          if (other.idSuffix === viewer.idSuffix) continue; // self is allowed via `you`
          const otherId = `p${other.idSuffix}`;
          const publicEntry = serialized.players.find((p) => p.id === otherId);
          expect(publicEntry).toBeDefined();

          // `role` must never appear on another player's public entry at all.
          expect(Object.prototype.hasOwnProperty.call(publicEntry, 'role')).toBe(false);

          // `revealedRole`, when present, is allowed to equal the real role
          // — that's the whole point of a public reveal — but it must be
          // absent when the fixture never revealed this player.
          if (!other.reveal) {
            expect(publicEntry?.revealedRole).toBeUndefined();
          }
        }

        // The viewer's own role must appear exactly where expected: in
        // `you.role`, and nowhere on their own public roster entry.
        expect(serialized.you.role).toBe(viewer.role);
        const selfEntry = serialized.players.find((p) => p.id === `p${viewer.idSuffix}`);
        expect(Object.prototype.hasOwnProperty.call(selfEntry, 'role')).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
