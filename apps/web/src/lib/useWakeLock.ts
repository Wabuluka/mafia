'use client';

// ---------------------------------------------------------------------------
// useWakeLock — keeps the screen awake for as long as `active` is true, via
// the Wake Lock API. Scoped to active night/day play (see the game page's
// `phase !== 'GAME_OVER'` call site): a phone passed around a physical
// table, or held by a player mid-round, going to sleep mid-night-action or
// mid-vote is the exact "the game stalls because someone's screen locked"
// failure this exists to prevent — the lobby and game-over screens have no
// timer racing against a locked screen, so they don't request one.
//
// Graceful degradation is the whole design here, not an edge case: Wake
// Lock is unsupported in several real browsers this app will be used in
// (notably iOS Safari on older versions), and even where supported, a
// lock is silently released by the UA whenever the tab is backgrounded
// (`visibilitychange` -> hidden) — re-acquiring on `visibilitychange` back
// to `visible` is what makes returning to the app after switching apps
// resume the lock instead of leaving the screen sleep-prone for the rest
// of the round. Every failure path (unsupported API, permission denial,
// a battery-saver mode refusing the request) is caught and swallowed:
// this is a nice-to-have, never something worth surfacing as an error to
// a player mid-game.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';

interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export function useWakeLock(active: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return; // unsupported: no-op

    let cancelled = false;

    async function acquire() {
      try {
        const sentinel = (await (navigator as unknown as {
          wakeLock: { request(type: 'screen'): Promise<WakeLockSentinel> };
        }).wakeLock.request('screen')) as WakeLockSentinel;
        if (cancelled) {
          void sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Permission denied, battery saver, or any other UA refusal —
        // the game is still fully playable, just without this convenience.
      }
    }

    void acquire();

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && !sentinelRef.current) {
        void acquire();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [active]);
}
