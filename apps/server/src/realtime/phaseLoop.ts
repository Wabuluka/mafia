// ---------------------------------------------------------------------------
// Phase transitions: advancing NIGHT -> DAY_DISCUSSION -> DAY_VOTE -> NIGHT
// (or -> GAME_OVER), driven by the scheduler in scheduler.ts. This is the
// one place resolveNight, resolveVote, and checkWinCondition get called,
// and the one place that flushes the phase's accumulated events to MongoDB
// (see persistence.ts and the hot-path boundary comment in db/index.ts).
//
// TIMING CONTRACT — see scheduler.ts for the full rationale:
//   - Every phase's deadline is an ABSOLUTE epoch-ms timestamp
//     (`session.state.phaseTimer.endsAt`), computed once when the phase
//     starts and never recomputed from "time remaining" on a retry/resume.
//   - Clients receive that same absolute timestamp and are expected to
//     render their own local countdown from it. The server never accepts
//     or trusts a client-reported "my timer says X" — timing is 100%
//     server-authoritative.
//   - `advancePhase` can be reached two ways: the scheduled deadline fires
//     (`onDeadlineReached`), or a handler detects every required action is
//     in and calls `tryResolveEarly` — both paths converge on the exact
//     same `advancePhase` logic, so there is no separate "early" code path
//     that could apply different rules than the timeout path.
// ---------------------------------------------------------------------------

import { DEFAULT_PHASE_DURATIONS_MS } from '@mafia/shared';
import type { FullGameState, Phase } from '@mafia/shared';
import { checkJesterWin, checkWinCondition, resolveNight, resolveVote, type EngineEffect } from '../engine';
import type { GameSession } from './RoomManager';
import { roomManager } from './RoomManager';
import { broadcastPhaseChange, broadcastStateToRoom, type GameServer } from './emit';
import { isPhaseReadyToResolveEarly } from './earlyResolution';
import { persistGameEnd, persistPhaseBoundary } from './persistence';
import { clearDeadline, scheduleDeadline } from './scheduler';

/** Resolves the actual duration to use for `phase` on this session: the
 * host's configured override if one was set (via updateRoomSettings —
 * LOBBY-only, locked in once the game starts, see RoomManager.ts), else
 * the shared default. LOBBY/GAME_OVER are never configurable (see
 * @mafia/shared's ConfigurablePhaseDurationKey) and always resolve to the
 * default (0, meaning "not timer-driven"). */
function durationFor(session: GameSession, phase: Phase): number {
  if (phase === 'NIGHT' || phase === 'DAY_DISCUSSION' || phase === 'DAY_VOTE') {
    return session.phaseDurationOverridesMs[phase] ?? DEFAULT_PHASE_DURATIONS_MS[phase];
  }
  return DEFAULT_PHASE_DURATIONS_MS[phase];
}

function nextPhaseAfter(phase: Phase): Phase {
  switch (phase) {
    case 'NIGHT':
      return 'DAY_DISCUSSION';
    case 'DAY_DISCUSSION':
      return 'DAY_VOTE';
    case 'DAY_VOTE':
      return 'NIGHT';
    case 'LOBBY':
    case 'GAME_OVER':
      // Never scheduled on a timer — see scheduleNextPhase below — so
      // reaching here would be a caller bug, not a game-rule edge case.
      throw new Error(`nextPhaseAfter: ${phase} does not have a timed successor`);
  }
}

/**
 * Schedules the deadline that will auto-advance the session out of its
 * current phase, and stamps that same absolute deadline onto
 * `session.state.phaseTimer` so it's included in every state broadcast a
 * client receives (see engine/redact.ts — `phaseTimer` passes through
 * PlayerView unchanged, since it carries no private information). Call
 * after every phase transition that lands on NIGHT, DAY_DISCUSSION, or
 * DAY_VOTE. LOBBY and GAME_OVER are not scheduled — LOBBY advances only
 * when the host calls startGame, GAME_OVER doesn't advance at all.
 *
 * `startedAtMs` should be `Date.now()` from the caller at the moment the
 * phase actually began — passed in rather than read here so a restart
 * resuming a phase can supply the ORIGINAL start time (reconstructed from
 * the persisted game record) instead of restarting the clock, keeping the
 * deadline stable across a restart rather than granting bonus time.
 */
export function scheduleNextPhase(io: GameServer, session: GameSession, startedAtMs: number = Date.now()): void {
  clearDeadline(session.deadline);
  session.deadline = undefined;

  if (session.state.phase === 'LOBBY' || session.state.phase === 'GAME_OVER') {
    session.state = { ...session.state, phaseTimer: undefined };
    return;
  }

  const durationMs = durationFor(session, session.state.phase);
  const endsAt = startedAtMs + durationMs;

  session.state = {
    ...session.state,
    phaseTimer: { phase: session.state.phase, startedAt: startedAtMs, endsAt, durationMs },
  };
  roomManager.setState(session.roomCode, session.state);

  session.deadline = scheduleDeadline(endsAt, () => {
    void advancePhase(io, session);
  });
}

/**
 * Called by submitNightAction/castVote after a successful action, to check
 * whether the phase can now resolve early (see earlyResolution.ts). A
 * no-op if the phase isn't ready yet — the scheduled deadline remains the
 * fallback in that case, so a phase can never stall forever even if this
 * is never satisfied (e.g. a disconnected player who never acts).
 */
export function tryResolveEarly(io: GameServer, session: GameSession): void {
  if (isPhaseReadyToResolveEarly(session.state)) {
    void advancePhase(io, session);
  }
}

/**
 * Resolves the phase that just ended, checks for a win, applies the next
 * phase (or GAME_OVER), persists the checkpoint, broadcasts the redacted
 * result to every player, and — unless the game just ended — schedules the
 * next deadline. This is the engine's only caller for `resolveNight` /
 * `resolveVote` / `checkWinCondition`; nothing else advances a phase.
 *
 * Idempotency guard: both the scheduled deadline AND an early-resolution
 * call can theoretically race to call this for the same phase (e.g. the
 * last required vote comes in in the same tick the deadline fires). Since
 * `scheduleNextPhase` unconditionally clears `session.deadline` up front,
 * and this function is only ever invoked either via that deadline's own
 * callback or via `tryResolveEarly`'s explicit check, a second call after
 * the phase has already moved on would be operating on stale
 * `fromPhase`/`effects` derived from a phase that's no longer current —
 * guarded against here by snapshotting `fromPhase` and re-deriving
 * everything from `session.state` at call time, never from a closure over
 * an earlier state.
 */
export async function advancePhase(io: GameServer, session: GameSession): Promise<void> {
  clearDeadline(session.deadline);
  session.deadline = undefined;

  const fromPhase = session.state.phase;
  let resolved: FullGameState = session.state;
  let effects: EngineEffect[] = [];

  if (fromPhase === 'NIGHT') {
    ({ state: resolved, effects } = resolveNight(session.state));
  } else if (fromPhase === 'DAY_VOTE') {
    ({ state: resolved, effects } = resolveVote(session.state));
  }
  // DAY_DISCUSSION has no resolution step — it's pure deliberation with no
  // engine-tracked actions — so it falls through with `resolved` unchanged
  // apart from the phase transition applied below.

  emitPrivateDetectiveEffects(io, effects);

  // The jester's win is a special immediate-win triggered by this specific
  // elimination, checked before the ongoing mafia/town parity condition.
  const eliminatedId = findPlayerDiedId(effects);
  const eliminatedPlayer = eliminatedId ? resolved.players.find((p) => p.id === eliminatedId) : undefined;
  const jesterVerdict = checkJesterWin(eliminatedPlayer);
  const winVerdict = jesterVerdict.isOver ? jesterVerdict : checkWinCondition(resolved);

  const isOver = winVerdict.isOver;
  const toPhase: Phase = isOver ? 'GAME_OVER' : nextPhaseAfter(fromPhase === 'LOBBY' ? 'NIGHT' : fromPhase);

  resolved = isOver
    ? { ...resolved, phase: 'GAME_OVER', endReason: winVerdict.reason, winningTeam: winVerdict.winningTeam, phaseTimer: undefined }
    : { ...resolved, phase: toPhase, roundNumber: toPhase === 'NIGHT' ? resolved.roundNumber + 1 : resolved.roundNumber };

  roomManager.setState(session.roomCode, resolved);

  if (session.gameId) {
    if (isOver) {
      await persistGameEnd(session.gameId, resolved.endReason ?? 'ABANDONED', resolved.winningTeam, session.pendingEvents);
    } else {
      await persistPhaseBoundary(session.gameId, fromPhase, toPhase, resolved, session.pendingEvents);
    }
  }
  session.pendingEvents = [];

  // Schedule the NEXT phase's deadline BEFORE broadcasting: scheduleNextPhase
  // stamps the new absolute deadline onto session.state.phaseTimer (or
  // clears it for GAME_OVER), and clients must never receive a
  // phaseChanged/stateUpdate for the new phase without its timer already
  // attached. `resolved` was already committed to `session.state` above, so
  // GAME_OVER (which never schedules) needs nothing further here.
  if (!isOver) {
    scheduleNextPhase(io, session, Date.now());
  }

  const narration = narrationFor(fromPhase, effects);
  broadcastPhaseChange(io, session.state, fromPhase, narration);
  // Re-broadcast full state too, so every player's `you` block (detective
  // results, hasActedThisPhase reset, etc) reflects the resolution.
  broadcastStateToRoom(io, session.state);
}

function findPlayerDiedId(effects: EngineEffect[]) {
  const diedEffect = effects.find((e): e is Extract<EngineEffect, { type: 'PLAYER_DIED' }> => e.type === 'PLAYER_DIED');
  return diedEffect?.playerId;
}

/** Collapses this resolution's NARRATION effects into the single string
 * carried on `phaseChanged` (see the schema change in @mafia/shared).
 * DAY_DISCUSSION endings produce no engine effects (nothing resolves), so
 * they get a fixed line describing what's about to happen instead of what
 * just did. */
function narrationFor(fromPhase: Phase, effects: EngineEffect[]): string {
  const lines = effects.filter((e): e is Extract<EngineEffect, { type: 'NARRATION' }> => e.type === 'NARRATION').map((e) => e.text);
  if (lines.length > 0) return lines.join(' ');
  if (fromPhase === 'DAY_DISCUSSION') return 'Discussion has ended. It is time to vote.';
  return 'The phase has ended.';
}

function emitPrivateDetectiveEffects(io: GameServer, effects: EngineEffect[]): void {
  for (const effect of effects) {
    if (effect.type === 'PRIVATE_DETECTIVE_RESULT') {
      io.to(`player:${effect.playerId}`).emit('privateInfo', {
        kind: 'DETECTIVE_RESULT',
        message: effect.result.isMafia
          ? 'Your investigation reveals suspicious ties to the mafia.'
          : 'Your investigation finds nothing suspicious.',
        relatedPlayerId: effect.result.targetId,
      });
    }
  }
}
