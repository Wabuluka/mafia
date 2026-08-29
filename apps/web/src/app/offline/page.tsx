'use client';

// ---------------------------------------------------------------------------
// Offline fallback — what the service worker serves for a failed navigation
// when there's no cached page to fall back to (see public/sw.js's fetch
// handler). Deliberately static and self-contained: no socket, no fetch, no
// game state read — any of those would just fail again offline. The only
// interactive bit is "Try again", a plain reload so the browser re-attempts
// the network once connectivity is back.
// ---------------------------------------------------------------------------

import { AppShell } from '@/components/AppShell';
import { useThemeSync } from '@/lib/useThemeSync';

export default function OfflinePage() {
  useThemeSync('mafia');
  return (
    <AppShell
      header={
        <div className="px-4 py-3">
          <h1 className="text-lg font-bold">Mafia</h1>
        </div>
      }
    >
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <span aria-hidden="true" className="text-5xl">
          📡
        </span>
        <h2 className="text-2xl font-bold">You&apos;re offline</h2>
        <p className="max-w-xs text-sm text-base-content/60">
          Mafia needs a live connection to play — a village&apos;s state can&apos;t be trusted from a
          cache. Reconnect and try again.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 flex min-h-14 w-full max-w-xs items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-content transition-transform active:scale-[0.98] motion-reduce:transition-none"
        >
          Try again
        </button>
      </div>
    </AppShell>
  );
}
