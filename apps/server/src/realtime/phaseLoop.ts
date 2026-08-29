// ---------------------------------------------------------------------------
// Phase transitions: advancing NIGHT -> DAY_DISCUSSION -> DAY_VOTE -> NIGHT
// (or -> GAME_OVER), driven by the scheduler in scheduler.ts. This is the
// one place resolveNight, resolveVote, and checkWinCondition get called,
// and the one place that flushes the phase's accumulated events to MongoDB
// (see persistence.ts and the hot-path boundary comment in db/index.ts).
//
// HUMAN MODERATOR MODEL — a phase resolving does NOT auto-start the next
// phase's timer or auto-narrate to players anymore. The host is the game's
// designated narrator/moderator (see realtime/index.ts's cheat-vector list,
// items 20/23/24), and now sits in the loop at every transition:
//   1. A phase resolves (deadline fires, tryResolveEarly, or the host calls
//      endPhaseNow) -> `advancePhase` computes the outcome (deaths/votes)
//      and applies it to state IMMEDIATELY, same as before. But instead of
//      scheduling the next phase's timer, it parks the result in
//      `state.pendingNarration` (the engine's suggested wording + the
//      structured outcome) and broadcasts ONLY the private per-player state
//      (detective results, hasActedThisPhase resets, etc) — not the
//      narration itself. `state.phase` has already moved on to the next
//      phase at this point, but that phase has no running timer yet.
//   2. The host reviews/edits the suggested text and calls `revealNarration`
//      (handlers/revealNarration.ts) with whatever final wording they want
//      players to see. That's what actually broadcasts `phaseChanged` to
//      everyone and clears `pendingNarration`.
//   3. The host calls `startPhaseTimer` (handlers/startPhaseTimer.ts)
//      whenever they're ready to begin the new phase's countdown for real.
// See `advancePhase`/`revealPendingNarration`/`startCurrentPhase` below for
// the three steps as functions.
//
// TIMING CONTRACT — see scheduler.ts for the full rationale:
//   - Every phase's deadline is an ABSOLUTE epoch-ms timestamp
//     (`session.state.phaseTimer.endsAt`), computed once when the timer
//     starts (now via `startCurrentPhase`, host-triggered) and never
//     recomputed from "time remaining" on a retry/resume.
//   - Clients receive that same absolute timestamp and are expected to
//     render their own local countdown from it. The server never accepts
//     or trusts a client-reported "my timer says X" — timing is 100%
//     server-authoritative.
//   - `advancePhase` can be reached three ways: the scheduled deadline
//     fires (`onDeadlineReached`), a handler detects every required action
//     is in and calls `tryResolveEarly`, or the host calls `endPhaseNow` —
//     all three converge on the exact same `advancePhase` logic, so there
//     is no separate "early"/"forced" code path that could apply different
//     rules than the timeout path.
// ---------------------------------------------------------------------------

import { DEFAULT_PHASE_DURATIONS_MS, nextApplicableNightSubPhase } from '@mafia/shared';
import type { FullGameState, Phase, PhaseOutcome } from '@mafia/shared';
import { checkJesterWin, checkWinCondition, resolveNight, resolveNominations, resolveVote, type EngineEffect } from '../engine';
import type { GameSession } from './VillageManager';
import { villageManager } from './VillageManager';
import { broadcastPhaseChange, broadcastStateToVillage, type GameServer } from './emit';
import { isPhaseReadyToResolveEarly } from './earlyResolution';
import { persistGameEnd, persistPhaseBoundary } from './persistence';
import { clearDeadline, scheduleDeadline } from './scheduler';

/** Resolves the actual duration to use for `phase` on this session: the
 * host's configured override if one was set (via updateVillageSettings —
 * LOBBY-only, locked in once the game starts, see VillageManager.ts), else
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
      // Never scheduled on a timer — see startCurrentPhase below — so
      // reaching here would be a caller bug, not a game-rule edge case.
      throw new Error(`nextPhaseAfter: ${phase} does not have a timed successor`);
  }
}

/**
 * Starts (or restarts, on process recovery) the timer for the session's
 * CURRENT phase — schedules the deadline that will auto-advance it, and
 * stamps that same absolute deadline onto `session.state.phaseTimer` so
 * it's included in every state broadcast a client receives (see
 * engine/redact.ts — `phaseTimer` passes through PlayerView unchanged,
 * since it carries no private information).
 *
 * Under the human-moderator model (see this module's header) this is no
 * longer called automatically when a phase resolves — `advancePhase` parks
 * the result in `pendingNarration` instead and waits for the host. This
 * function's three remaining callers are: `startCurrentPhase`
 * (handlers/startPhaseTimer.ts, the host's explicit "begin the countdown"
 * action), `startGame`/`playAgain` are intentionally NOT callers anymore
 * (a freshly started game also waits for the host's first
 * `startPhaseTimer`), and `restart.ts`'s crash-recovery path, which still
 * restarts a resumed phase's timer immediately (a mid-phase player-facing
 * pause isn't a state worth trying to reconstruct across a process
 * restart — see that module's own header for the full rationale).
 *
 * `startedAtMs` should be `Date.now()` from the caller at the moment the
 * phase actually began — passed in rather than read here so a restart
 * resuming a phase can supply the ORIGINAL start time (reconstructed from
 * the persisted game record) instead of restarting the clock, keeping the
 * deadline stable across a restart rather than granting bonus time.
 */
export function startCurrentPhase(io: GameServer, session: GameSession, startedAtMs: number = Date.now()): void {
  clearDeadline(session.deadline);
  session.deadline = undefined;
  // A new phase always starts unpaused, even if the previous one ended
  // while paused (advancePhase resolves the phase regardless of pause
  // state — see its own doc comment) — stale pause bookkeeping from the
  // phase that just ended must never leak into the one that's starting.
  session.pausedRemainingMs = undefined;

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
  villageManager.setState(session.villageCode, session.state);

  session.deadline = scheduleDeadline(endsAt, () => {
    void advancePhase(io, session);
  });

  // Push the freshly-started timer to every client NOW — same as
  // pause/resumeTimer below. Without this the countdown only appears on a
  // player's screen at the next unrelated state broadcast (a chat message,
  // someone acting), so "moderator started the timer" looks like nothing
  // happened.
  broadcastStateToVillage(io, session);
}

/**
 * Freezes the current phase's countdown: un-schedules the pending deadline
 * (so it can never fire mid-pause) and stamps `pausedAt`/the remaining time
 * onto both the session (server bookkeeping) and `session.state.phaseTimer`
 * (the client-visible fact — see PhaseTimerSchema.pausedAt). Caller
 * (handlers/pauseTimer.ts) is responsible for validating the phase actually
 * has a running timer and isn't already paused before calling this.
 */
export function pauseCurrentPhase(io: GameServer, session: GameSession): void {
  const timer = session.state.phaseTimer;
  if (!timer) return;

  const remainingMs = Math.max(0, timer.endsAt - Date.now());
  clearDeadline(session.deadline);
  session.deadline = undefined;
  session.pausedRemainingMs = remainingMs;

  session.state = { ...session.state, phaseTimer: { ...timer, pausedAt: Date.now() } };
  villageManager.setState(session.villageCode, session.state);
  broadcastStateToVillage(io, session);
}

/**
 * Resumes a paused phase's countdown, granting exactly the time that
 * remained at the moment it was paused (`session.pausedRemainingMs`) —
 * never a fresh full duration, matching the module header's "no bonus
 * time" principle for restarts. Caller (handlers/resumeTimer.ts) is
 * responsible for validating the phase is actually paused before calling
 * this.
 */
export function resumeCurrentPhase(io: GameServer, session: GameSession): void {
  const timer = session.state.phaseTimer;
  if (!timer || timer.pausedAt === undefined || session.pausedRemainingMs === undefined) return;

  const remainingMs = session.pausedRemainingMs;
  session.pausedRemainingMs = undefined;

  const endsAt = Date.now() + remainingMs;
  session.state = {
    ...session.state,
    phaseTimer: { ...timer, endsAt, pausedAt: undefined },
  };
  villageManager.setState(session.villageCode, session.state);

  session.deadline = scheduleDeadline(endsAt, () => {
    void advancePhase(io, session);
  });

  broadcastStateToVillage(io, session);
}

/**
 * Called by submitNightAction/castVote after a successful action, to check
 * whether the phase can now resolve early (see earlyResolution.ts). A
 * no-op if the phase isn't ready yet — the scheduled deadline remains the
 * fallback in that case, so a phase can never stall forever even if this
 * is never satisfied (e.g. a disconnected player who never acts).
 *
 * Also a no-op while the host has paused the phase (`phaseTimer.pausedAt`
 * set): actions can still be submitted while paused (nothing here blocks
 * that), but they must never be able to force the phase to advance out
 * from under a deliberately held game — only an explicit `resumeTimer`
 * (see resumeCurrentPhase) may let the phase move again.
 */
export function tryResolveEarly(io: GameServer, session: GameSession): void {
  if (session.state.phaseTimer?.pausedAt !== undefined) return;
  if (isPhaseReadyToResolveEarly(session.state)) {
    void advancePhase(io, session);
  }
}

/**
 * Resolves the phase that just ended (deaths/votes computed and applied to
 * state), checks for a win, and applies the next phase (or GAME_OVER) —
 * exactly as before. What changed under the human-moderator model (see
 * this module's header): rather than immediately scheduling the next
 * phase's timer and broadcasting the narration to every player, this now
 * parks the suggested narration + structured outcome in
 * `state.pendingNarration` and waits for the host to call
 * `revealNarration`. This is the engine's only caller for `resolveNight` /
 * `resolveVote` / `checkWinCondition`; nothing else advances a phase.
 *
 * Idempotency guard: the scheduled deadline, an early-resolution call, AND
 * a host's `endPhaseNow` can all theoretically race to call this for the
 * same phase. Since this function unconditionally clears `session.deadline`
 * up front, and `state.phaseTimer` is cleared once a phase resolves (there
 * is no running timer once `pendingNarration` is set — see
 * `startCurrentPhase`, which is the only place a new one is scheduled), a
 * second call after the phase has already moved on would be operating on
 * stale `fromPhase`/`effects` derived from a phase that's no longer
 * current — guarded against here by snapshotting `fromPhase` and
 * re-deriving everything from `session.state` at call time, never from a
 * closure over an earlier state.
 *
 * On top of that, `session.resolving` is an explicit re-entrancy guard: this
 * function is `async` and does real `await`ed work (the persistence calls
 * below) between reading `session.state.phase` and writing the resolved
 * result back, so a caller that isn't purely synchronous up to its
 * `advancePhase` call could otherwise land a second, overlapping resolution
 * mid-flight. A second call while one is already in progress is a no-op.
 */
export async function advancePhase(io: GameServer, session: GameSession): Promise<void> {
  if (session.resolving) return;
  session.resolving = true;
  try {
    await advancePhaseUnguarded(io, session);
  } finally {
    session.resolving = false;
  }
}

async function advancePhaseUnguarded(io: GameServer, session: GameSession): Promise<void> {
  clearDeadline(session.deadline);
  session.deadline = undefined;
  session.pausedRemainingMs = undefined;

  const fromPhase = session.state.phase;
  let resolved: FullGameState = session.state;
  let effects: EngineEffect[] = [];

  if (fromPhase === 'NIGHT') {
    // Under the moderator-driven flow, NIGHT is "done" once its internal
    // sub-sequence (MAFIA -> DETECTIVE -> DOCTOR) reaches COMPLETE — see
    // @mafia/shared's NightSubPhaseSchema. Reaching here mid-sequence means
    // the phase deadline fired, or the host forced it via `endPhaseNow`,
    // while some role hadn't been prompted/hadn't acted yet: the escape
    // hatch still resolves regardless (resolveNight already tolerates
    // missing actions gracefully — see its own doc comment), but the
    // sub-phase is snapped to COMPLETE first so the state this resolution
    // is computed from — and everything downstream of it — is internally
    // consistent rather than showing a stale mid-sequence value.
    if (session.state.nightSubPhase !== 'COMPLETE') {
      session.state = { ...session.state, nightSubPhase: 'COMPLETE' };
    }
    ({ state: resolved, effects } = resolveNight(session.state));
    // "Deleted by morning" — the mafia's night coordination chat is
    // ephemeral by design (see redact.ts's MAFIA channel restriction):
    // once the night resolves, its messages are purged from state
    // entirely, not merely hidden from non-mafia by redaction. This also
    // means they were never queued into `session.pendingEvents` for
    // persistence in the first place — see sendChat.ts, which skips the
    // MAFIA channel when appending to pendingEvents — so there's nothing
    // to unwrite from Mongo here, only the live in-memory log to clear.
    resolved = { ...resolved, chatLog: resolved.chatLog.filter((m) => m.channel !== 'MAFIA') };
  } else if (fromPhase === 'DAY_VOTE') {
    ({ state: resolved, effects } = resolveVote(session.state));
  } else if (fromPhase === 'DAY_DISCUSSION') {
    // Computes `shortlistedIds` — the only valid DAY_VOTE targets for the
    // day — from this round's public nominations, falling back to every
    // living player if nobody nominated anyone. See engine/nominations.ts.
    ({ state: resolved, effects } = resolveNominations(session.state));
  }

  emitPrivateDetectiveEffects(io, effects);

  // The jester's win is a special immediate-win triggered by this specific
  // elimination, checked before the ongoing mafia/town parity condition.
  const eliminatedId = findPlayerDiedId(effects);
  const eliminatedPlayer = eliminatedId ? resolved.players.find((p) => p.id === eliminatedId) : undefined;
  const jesterVerdict = checkJesterWin(eliminatedPlayer);
  const winVerdict = jesterVerdict.isOver ? jesterVerdict : checkWinCondition(resolved);

  const isOver = winVerdict.isOver;
  const toPhase: Phase = isOver ? 'GAME_OVER' : nextPhaseAfter(fromPhase === 'LOBBY' ? 'NIGHT' : fromPhase);

  const narration = narrationFor(fromPhase, effects);
  const outcome = outcomeFor(effects);

  // `nightSubPhase` only means something while `phase === 'NIGHT'`: cleared
  // when leaving NIGHT (the `resolveNight` branch above already snapped it
  // to COMPLETE, which is no longer meaningful once resolved), and
  // (re)computed to the first applicable role when NIGHT is being entered
  // (the DAY_VOTE -> NIGHT transition — see nextApplicableNightSubPhase's
  // doc comment for what "applicable" skips).
  const nightSubPhase = toPhase === 'NIGHT' ? nextApplicableNightSubPhase(resolved.players, undefined) : undefined;

  resolved = isOver
    ? { ...resolved, phase: 'GAME_OVER', endReason: winVerdict.reason, winningTeam: winVerdict.winningTeam, phaseTimer: undefined, pendingNarration: undefined, nightSubPhase: undefined }
    : {
        ...resolved,
        phase: toPhase,
        roundNumber: toPhase === 'NIGHT' ? resolved.roundNumber + 1 : resolved.roundNumber,
        phaseTimer: undefined,
        pendingNarration: { forPhase: fromPhase, text: narration, outcome },
        nightSubPhase,
        // `shortlistedIds` is only meaningful for the day it was computed
        // for (the DAY_VOTE that immediately follows the DAY_DISCUSSION
        // that produced it) — reset to [] the instant a new day begins
        // (DAY_VOTE -> NIGHT -> next DAY_DISCUSSION), so a stale prior
        // day's shortlist can never leak into a new round's vote. Left
        // untouched on every OTHER transition (including DAY_DISCUSSION
        // -> DAY_VOTE itself, where resolveNominations just set it).
        shortlistedIds: toPhase === 'NIGHT' ? [] : resolved.shortlistedIds,
      };

  villageManager.setState(session.villageCode, resolved);

  if (session.gameId) {
    if (isOver) {
      await persistGameEnd(session.gameId, resolved.endReason ?? 'ABANDONED', resolved.winningTeam, session.pendingEvents);
    } else {
      await persistPhaseBoundary(session.gameId, fromPhase, toPhase, resolved, session.pendingEvents);
    }
  }
  session.pendingEvents = [];

  // A GAME_OVER win still narrates immediately (there's no next phase for
  // the host to gate — see revealPendingNarration below on why a
  // GAME_OVER's narration is sent straight through rather than parked).
  if (isOver) {
    broadcastPhaseChange(io, session, fromPhase, narration, outcome);
  }
  // Every player's `you` block (detective results, hasActedThisPhase
  // reset, etc) and `pendingNarration` (identical for every viewer, see
  // its doc comment) reach clients via this broadcast regardless of
  // isOver — the host's UI needs `pendingNarration` to render the
  // edit-before-reveal screen just as much as regular players need their
  // refreshed `you` block.
  broadcastStateToVillage(io, session);
}

/**
 * The host's `revealNarration` action: broadcasts the (possibly-edited)
 * final narration text for `state.pendingNarration.forPhase`, together with
 * the outcome computed back when `advancePhase` resolved it, then clears
 * `pendingNarration` — the next phase now has no running timer and is
 * waiting on the host's `startPhaseTimer`. Caller (handlers/
 * revealNarration.ts) is responsible for validating a `pendingNarration`
 * actually exists before calling this.
 */
export function revealPendingNarration(io: GameServer, session: GameSession, text: string): void {
  const pending = session.state.pendingNarration;
  if (!pending) return;

  session.state = { ...session.state, pendingNarration: undefined };
  villageManager.setState(session.villageCode, session.state);

  broadcastPhaseChange(io, session, pending.forPhase, text, pending.outcome);
  broadcastStateToVillage(io, session);
}

function findPlayerDiedId(effects: EngineEffect[]) {
  const diedEffect = effects.find((e): e is Extract<EngineEffect, { type: 'PLAYER_DIED' }> => e.type === 'PLAYER_DIED');
  return diedEffect?.playerId;
}

/** Builds the structured PhaseOutcome (see the schema doc in
 * @mafia/shared/events.ts) straight from this resolution's effects — the
 * exact same PLAYER_DIED/VOTE_TIED effects `narrationFor` reads, so the
 * prose and the structured data can never disagree about what happened. */
function outcomeFor(effects: EngineEffect[]): PhaseOutcome {
  const died = effects
    .filter((e): e is Extract<EngineEffect, { type: 'PLAYER_DIED' }> => e.type === 'PLAYER_DIED')
    .map((e) => ({ playerId: e.playerId, role: e.role }));
  const wasTie = effects.some((e) => e.type === 'VOTE_TIED');
  const wasOpenNomination = effects.some((e) => e.type === 'NOMINATION_OPEN');
  return { died, wasTie, ...(wasOpenNomination ? { wasOpenNomination } : {}) };
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
