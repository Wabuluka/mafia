'use client';

// ---------------------------------------------------------------------------
// CountdownRing — renders a countdown against a server-provided absolute
// deadline. Consistent with the server's timing contract (see
// apps/server/src/realtime/scheduler.ts): this component NEVER accepts a
// duration and counts down locally from render time — it always derives
// "time remaining" from `endsAt` (an absolute epoch-ms timestamp) minus
// `Date.now()`, recomputed on every tick. A client whose local clock is
// off, or that was backgrounded and resumed, self-corrects on the very
// next tick instead of drifting, because nothing is accumulated locally.
//
// Animation: the sweep is driven by `stroke-dashoffset`, which is neither a
// layout property nor a compositor-only transform, but IS paint-only (no
// layout/reflow) similar in cost to opacity — the ring's geometry never
// changes, only how much of the pre-computed stroke path is visible. No
// numeric re-layout occurs on each tick.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';

export interface CountdownRingProps {
  /** Absolute epoch-ms deadline — matches PhaseTimer.endsAt from
   * @mafia/shared. Never a duration. */
  endsAt: number;
  /** Needed to compute the ring's starting fraction; matches
   * PhaseTimer.durationMs. */
  durationMs: number;
  size?: number;
  strokeWidth?: number;
  /** Called once when the countdown reaches zero. */
  onComplete?: () => void;
}

const TICK_MS = 200;

export function CountdownRing({
  endsAt,
  durationMs,
  size = 72,
  strokeWidth = 6,
  onComplete,
}: CountdownRingProps) {
  // Initialize from props (`endsAt - durationMs`, the phase's start time),
  // NOT `Date.now()` — reading the real clock during the initial render
  // would produce a different value on the server than on the client
  // during hydration (two different instants in time), causing a
  // hydration mismatch on the derived `stroke-dashoffset` below. Ticking
  // to the actual current time only happens after mount, in the effect.
  const [now, setNow] = useState(() => endsAt - durationMs);

  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const remainingMs = Math.max(0, endsAt - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const fraction = durationMs > 0 ? Math.min(1, Math.max(0, remainingMs / durationMs)) : 0;

  useEffect(() => {
    if (remainingMs === 0) {
      onComplete?.();
    }
    // Intentionally depends only on the zero-crossing, not the callback
    // identity — onComplete firing more than once per crossing would be
    // the actual bug to avoid here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs === 0]);

  const radius = (size - strokeWidth) / 2;
  const circumference = useMemo(() => 2 * Math.PI * radius, [radius]);
  const dashOffset = circumference * (1 - fraction);

  const urgent = fraction < 0.2;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="timer"
      aria-live="off"
      aria-label={`${remainingSeconds} seconds remaining`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-base-content/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={[
            'transition-[stroke-dashoffset] duration-200 ease-linear motion-reduce:transition-none',
            urgent ? 'stroke-danger' : 'stroke-primary',
          ].join(' ')}
        />
      </svg>
      <span
        className={[
          'absolute text-lg font-bold tabular-nums',
          urgent ? 'text-danger animate-ring-pulse motion-reduce:animate-none' : 'text-base-content',
        ].join(' ')}
      >
        {remainingSeconds}
      </span>
    </div>
  );
}
