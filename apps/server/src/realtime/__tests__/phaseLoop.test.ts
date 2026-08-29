// ---------------------------------------------------------------------------
// Unit tests for the two host-moderation additions to phaseLoop.ts:
// pauseCurrentPhase/resumeCurrentPhase (freeze/unfreeze the countdown) and
// advancePhase's mafia-chat purge on NIGHT -> DAY_DISCUSSION ("deleted by
// morning"). Uses a minimal fake GameServer/GameSession rather than a real
// Socket.IO server or Mongo connection — these functions only ever call
// `io.to(...).emit(...)` and read/write `session.state`/`session.deadline`,
// so a fake with just enough shape to satisfy that is sufficient and much
// faster than spinning up the real stack.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { buildState, pid } from '../../engine/__tests__/helpers';
import type { GameSession } from '../VillageManager';
import { villageManager } from '../VillageManager';
import type { GameServer } from '../emit';
import { advancePhase, pauseCurrentPhase, resumeCurrentPhase, revealPendingNarration, startCurrentPhase, tryResolveEarly } from '../phaseLoop';

function fakeIo(): GameServer {
  return { to: () => ({ emit: vi.fn() }) } as unknown as GameServer;
}

/** Like fakeIo(), but every `io.to(...).emit(...)` funnels through one
 * shared spy so a test can assert the village actually received a push. */
function spyingIo(): { io: GameServer; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn();
  return { io: { to: () => ({ emit }) } as unknown as GameServer, emit };
}

function fakeSession(overrides: Partial<GameSession> = {}): GameSession {
  const state = overrides.state ?? buildState({ phase: 'NIGHT', players: [{ id: 'm1', name: 'M', role: 'MAFIA' }] });
  const session: GameSession = {
    villageCode: state.villageCode,
    state,
    sockets: new Map(),
    seenActionIds: new Set(),
    roleSeed: 1,
    pendingEvents: [],
    phaseDurationOverridesMs: {},
    pendingRequests: new Map(),
    ...overrides,
  };
  // pauseCurrentPhase/resumeCurrentPhase/advancePhase all route state writes
  // through villageManager.setState, which no-ops for a session it doesn't
  // know about — register it so those writes actually stick and later
  // reads of session.state reflect them.
  villageManager.create(session);
  return session;
}

describe('startCurrentPhase', () => {
  it('stamps a full-duration timer AND broadcasts it to the village immediately', () => {
    const state = buildState({ phase: 'DAY_DISCUSSION', players: [{ id: 'v1', name: 'V', role: 'VILLAGER' }] });
    const session = fakeSession({ state });
    const { io, emit } = spyingIo();

    const before = Date.now();
    startCurrentPhase(io, session, before);

    expect(session.state.phaseTimer).toBeDefined();
    expect(session.state.phaseTimer?.phase).toBe('DAY_DISCUSSION');
    expect(session.state.phaseTimer?.startedAt).toBe(before);
    expect(session.state.phaseTimer?.endsAt).toBe(before + (session.state.phaseTimer?.durationMs ?? 0));
    expect(session.deadline).toBeDefined();
    // The whole point of this test: a player's client learns about the
    // started countdown NOW, not at some later unrelated broadcast.
    expect(emit).toHaveBeenCalled();

    if (session.deadline) clearTimeout(session.deadline.handle);
  });

  it('clears the timer and does not schedule/broadcast for a non-timed phase', () => {
    const state = buildState({ phase: 'LOBBY', players: [{ id: 'v1', name: 'V', role: 'VILLAGER' }] });
    const session = fakeSession({ state });
    const { io, emit } = spyingIo();

    startCurrentPhase(io, session);

    expect(session.state.phaseTimer).toBeUndefined();
    expect(session.deadline).toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('pauseCurrentPhase / resumeCurrentPhase', () => {
  it('freezes the countdown: clears the deadline and stamps pausedAt', () => {
    const state = buildState({ phase: 'DAY_DISCUSSION', players: [{ id: 'v1', name: 'V', role: 'VILLAGER' }] });
    const withTimer = { ...state, phaseTimer: { phase: 'DAY_DISCUSSION' as const, startedAt: 0, endsAt: 100_000, durationMs: 100_000 } };
    const session = fakeSession({ state: withTimer, deadline: { endsAt: 100_000, handle: setTimeout(() => {}, 100_000) } });

    pauseCurrentPhase(fakeIo(), session);

    expect(session.deadline).toBeUndefined();
    expect(session.state.phaseTimer?.pausedAt).toBeDefined();
    expect(session.pausedRemainingMs).toBeGreaterThanOrEqual(0);
  });

  it('is a no-op when there is no running timer', () => {
    const state = buildState({ phase: 'LOBBY', players: [{ id: 'v1', name: 'V', role: 'VILLAGER' }] });
    const session = fakeSession({ state });

    pauseCurrentPhase(fakeIo(), session);

    expect(session.state.phaseTimer).toBeUndefined();
  });

  it('resume grants exactly the remaining time, not a fresh full duration', () => {
    const state = buildState({ phase: 'DAY_DISCUSSION', players: [{ id: 'v1', name: 'V', role: 'VILLAGER' }] });
    const withTimer = { ...state, phaseTimer: { phase: 'DAY_DISCUSSION' as const, startedAt: 0, endsAt: 100_000, durationMs: 100_000 } };
    const session = fakeSession({ state: withTimer });
    session.pausedRemainingMs = 5_000;
    session.state = { ...session.state, phaseTimer: { ...withTimer.phaseTimer, pausedAt: Date.now() } };

    const before = Date.now();
    resumeCurrentPhase(fakeIo(), session);
    const after = Date.now();

    expect(session.state.phaseTimer?.pausedAt).toBeUndefined();
    expect(session.pausedRemainingMs).toBeUndefined();
    expect(session.deadline).toBeDefined();
    // endsAt should be ~now + 5000, not the original 100_000 far-future value.
    expect(session.state.phaseTimer?.endsAt).toBeGreaterThanOrEqual(before + 5_000);
    expect(session.state.phaseTimer?.endsAt).toBeLessThanOrEqual(after + 5_000);

    if (session.deadline) clearTimeout(session.deadline.handle);
  });

  it('resume is a no-op when the phase is not actually paused', () => {
    const state = buildState({ phase: 'DAY_DISCUSSION', players: [{ id: 'v1', name: 'V', role: 'VILLAGER' }] });
    const withTimer = { ...state, phaseTimer: { phase: 'DAY_DISCUSSION' as const, startedAt: 0, endsAt: 100_000, durationMs: 100_000 } };
    const session = fakeSession({ state: withTimer });

    resumeCurrentPhase(fakeIo(), session);

    expect(session.deadline).toBeUndefined();
    expect(session.state.phaseTimer?.endsAt).toBe(100_000);
  });
});

describe('tryResolveEarly — paused guard', () => {
  it('does not advance the phase while paused, even if every action is in', () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      players: [{ id: 'm1', name: 'M', role: 'MAFIA' }],
      nightActions: [{ id: 'a1', actorId: pid('m1'), actorRole: 'MAFIA', targetId: undefined, nightNumber: 1, submittedAt: 1 }],
    });
    const withTimer = { ...state, phaseTimer: { phase: 'NIGHT' as const, startedAt: 0, endsAt: 999_999_999_999, pausedAt: Date.now(), durationMs: 1000 } };
    const session = fakeSession({ state: withTimer });

    tryResolveEarly(fakeIo(), session);

    // Still NIGHT — the phase never advanced despite resolution readiness.
    expect(session.state.phase).toBe('NIGHT');
  });
});

describe('advancePhase — mafia chat purge on NIGHT -> DAY_DISCUSSION', () => {
  it('strips MAFIA-channel messages from chatLog once the night resolves, keeping other channels', async () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      players: [{ id: 'm1', name: 'M', role: 'MAFIA' }],
      chatLog: [
        { id: 'c1', channel: 'MAFIA', senderId: pid('m1'), senderName: 'M', body: 'kill v1', sentAt: 1 },
        { id: 'c2', channel: 'LOBBY', senderId: pid('m1'), senderName: 'M', body: 'hi', sentAt: 2 },
      ],
    });
    const session = fakeSession({ state });

    await advancePhase(fakeIo(), session);

    expect(session.state.chatLog.some((m) => m.channel === 'MAFIA')).toBe(false);
    expect(session.state.chatLog.some((m) => m.channel === 'LOBBY')).toBe(true);
  });
});

describe('advancePhase — DAY_DISCUSSION -> DAY_VOTE (nomination resolution)', () => {
  it('computes shortlistedIds from this round\'s nominations and moves to DAY_VOTE', async () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
        { id: 'v3', name: 'C', role: 'MAFIA' },
      ],
      nominations: [
        { nominatorId: pid('v1'), targetId: pid('v3'), dayNumber: 1, submittedAt: 1 },
        { nominatorId: pid('v2'), targetId: pid('v3'), dayNumber: 1, submittedAt: 2 },
      ],
    });
    const session = fakeSession({ state });

    await advancePhase(fakeIo(), session);

    expect(session.state.phase).toBe('DAY_VOTE');
    expect(session.state.shortlistedIds).toEqual([pid('v3')]);
    expect(session.state.pendingNarration?.forPhase).toBe('DAY_DISCUSSION');
    expect(session.state.pendingNarration?.outcome.wasOpenNomination).toBeUndefined();
  });

  it('falls back to an open vote and flags wasOpenNomination when nobody nominated anyone', async () => {
    const state = buildState({
      phase: 'DAY_DISCUSSION',
      roundNumber: 1,
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
        { id: 'v3', name: 'C', role: 'MAFIA' },
      ],
      nominations: [],
    });
    const session = fakeSession({ state });

    await advancePhase(fakeIo(), session);

    expect(session.state.phase).toBe('DAY_VOTE');
    expect(new Set(session.state.shortlistedIds)).toEqual(new Set([pid('v1'), pid('v2'), pid('v3')]));
    expect(session.state.pendingNarration?.outcome.wasOpenNomination).toBe(true);
  });

  it('resets shortlistedIds to empty once a new day begins (DAY_VOTE -> NIGHT -> next DAY_DISCUSSION)', async () => {
    const state = buildState({
      phase: 'DAY_VOTE',
      roundNumber: 1,
      shortlistedIds: [pid('v2')],
      players: [
        { id: 'v1', name: 'A', role: 'VILLAGER' },
        { id: 'v2', name: 'B', role: 'VILLAGER' },
        { id: 'v3', name: 'C', role: 'MAFIA' },
      ],
    });
    const session = fakeSession({ state });

    await advancePhase(fakeIo(), session);

    expect(session.state.phase).toBe('NIGHT');
    expect(session.state.shortlistedIds).toEqual([]);
  });
});

describe('advancePhase — human moderator model (pendingNarration gate)', () => {
  it('resolves the phase, moves to the next one, but does NOT start a timer — it parks pendingNarration instead', async () => {
    // Two villagers alongside the mafia so a quiet night (no kill
    // submitted) doesn't itself reach mafia parity and end the game —
    // this test is about the pendingNarration gate on an ONGOING game.
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      players: [
        { id: 'm1', name: 'M', role: 'MAFIA' },
        { id: 'v1', name: 'V1', role: 'VILLAGER' },
        { id: 'v2', name: 'V2', role: 'VILLAGER' },
      ],
    });
    const session = fakeSession({ state });

    await advancePhase(fakeIo(), session);

    expect(session.state.phase).toBe('DAY_DISCUSSION');
    expect(session.state.phaseTimer).toBeUndefined();
    expect(session.state.pendingNarration).toBeDefined();
    expect(session.state.pendingNarration?.forPhase).toBe('NIGHT');
  });

  it('a GAME_OVER resolution narrates immediately rather than parking — there is no next phase for a host to gate', async () => {
    // Two players, one mafia — killing the lone villager ends the game
    // immediately (mafia parity reached), which should skip the
    // pendingNarration gate entirely per phaseLoop.ts's isOver branch.
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      players: [
        { id: 'm1', name: 'M', role: 'MAFIA' },
        { id: 'v1', name: 'V', role: 'VILLAGER' },
      ],
      nightActions: [{ id: 'a1', actorId: pid('m1'), actorRole: 'MAFIA', targetId: pid('v1'), nightNumber: 1, submittedAt: 1 }],
    });
    const session = fakeSession({ state });

    await advancePhase(fakeIo(), session);

    expect(session.state.phase).toBe('GAME_OVER');
    expect(session.state.pendingNarration).toBeUndefined();
  });
});

describe('revealPendingNarration', () => {
  it('broadcasts the given text and clears pendingNarration, leaving the timer unset', async () => {
    const state = buildState({
      phase: 'NIGHT',
      roundNumber: 1,
      players: [
        { id: 'm1', name: 'M', role: 'MAFIA' },
        { id: 'v1', name: 'V1', role: 'VILLAGER' },
        { id: 'v2', name: 'V2', role: 'VILLAGER' },
      ],
    });
    const session = fakeSession({ state });
    await advancePhase(fakeIo(), session);
    expect(session.state.pendingNarration).toBeDefined();

    revealPendingNarration(fakeIo(), session, 'A custom narrated version of events.');

    expect(session.state.pendingNarration).toBeUndefined();
    expect(session.state.phaseTimer).toBeUndefined();
  });

  it('is a no-op when there is no pendingNarration', () => {
    const state = buildState({ phase: 'DAY_DISCUSSION', players: [{ id: 'v1', name: 'V', role: 'VILLAGER' }] });
    const session = fakeSession({ state });

    revealPendingNarration(fakeIo(), session, 'irrelevant');

    expect(session.state.phase).toBe('DAY_DISCUSSION');
  });
});
