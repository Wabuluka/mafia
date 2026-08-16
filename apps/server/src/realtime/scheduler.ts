// ---------------------------------------------------------------------------
// The phase scheduler: a single, drift-resistant timer per village that fires
// exactly once when a phase's absolute deadline is reached (or is cancelled
// early — see earlyResolution.ts). This is the ONLY place `setTimeout` is
// used to drive phase advancement; nothing else schedules a phase change.
//
// WHY NOT A NAIVE setTimeout(fn, durationMs)
// ---------------------------------------------------------------------------
// A single `setTimeout` call is accurate to the event loop, but "accurate
// to the event loop" is not the same as "accurate to wall-clock time":
//   - Node's timers can fire late under load (a busy event loop, a GC
//     pause, a long synchronous handler elsewhere) — never early, but
//     potentially by seconds under real load.
//   - `setTimeout`'s delay argument is clamped to a signed 32-bit int
//     (~24.8 days); irrelevant at our phase durations (tens of seconds)
//     but worth noting as a reason to route ALL scheduling through one
//     module rather than ad-hoc `setTimeout` calls that might not respect
//     that ceiling somewhere else.
// The fix is to never trust "how long has it been since I called
// setTimeout" and instead always schedule against an ABSOLUTE deadline
// (`endsAt`, a wall-clock epoch-ms timestamp) computed once when the phase
// starts. If the timer fires late, or the process is even briefly paused,
// `scheduleDeadline` below re-derives "how much longer do I actually need
// to wait" from `endsAt - Date.now()` rather than assuming the original
// duration elapsed — so a delayed fire self-corrects instead of
// compounding drift across phases. Clients receive this same absolute
// `endsAt` (never a duration) and render their own countdown from it,
// which is the client-side half of the same principle: the server's clock
// is the only clock that matters (see PhaseTimer in @mafia/shared and the
// module header in VillageManager.ts).
// ---------------------------------------------------------------------------

/** A single pending deadline. Held on the GameSession (see VillageManager.ts)
 * so it can always be located and cleared — see `clearDeadline`. */
export interface ScheduledDeadline {
  endsAt: number;
  handle: NodeJS.Timeout;
}

/**
 * Schedules `onDeadline` to fire once, at or after `endsAtMs` (an absolute
 * epoch-ms timestamp, NOT a duration). Returns a handle the caller must
 * hold and eventually pass to `clearDeadline` — either when the deadline
 * fires normally, when it's cancelled early (all actions in), or when the
 * village is torn down, so a session's timer is never leaked.
 *
 * If `endsAtMs` has already passed (e.g. the process was paused, or a
 * caller is rescheduling after a restart against a deadline computed
 * before boot), fires on the next tick rather than computing a negative
 * `setTimeout` delay (which Node clamps to 0 anyway, but being explicit
 * here documents the intent rather than relying on that clamping).
 */
export function scheduleDeadline(endsAtMs: number, onDeadline: () => void): ScheduledDeadline {
  const delayMs = Math.max(0, endsAtMs - Date.now());
  const handle = setTimeout(onDeadline, delayMs);
  return { endsAt: endsAtMs, handle };
}

/** Cancels a previously scheduled deadline. Safe to call on `undefined` —
 * every call site that might not have a pending deadline (LOBBY/GAME_OVER
 * phases, a session that was just created) can call this unconditionally
 * rather than null-checking at every call site. */
export function clearDeadline(deadline: ScheduledDeadline | undefined): void {
  if (deadline) {
    clearTimeout(deadline.handle);
  }
}
