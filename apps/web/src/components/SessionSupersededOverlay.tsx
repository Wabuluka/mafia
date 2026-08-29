'use client';

// ---------------------------------------------------------------------------
// SessionSupersededOverlay — the terminal, full-screen lockout shown the
// moment this tab's socket receives `sessionSuperseded` (see
// realtime/handlers/joinVillage.ts's eviction logic and socket-context.tsx's
// `status: 'superseded'`). Mounted once, above everything else, in
// Providers — a second tab/device opening the SAME session can happen from
// ANY screen (lobby, in-game, even Home), so this can't live inside one
// screen's component tree.
//
// Deliberately offers no retry: `connect()` in socket-context.tsx refuses
// to redial once superseded, matching the "clear message, locked out, full
// stop" this scenario calls for — the newer tab/device is the one actively
// playing now, and this tab reconnecting would just re-evict it right back
// in an infinite tug-of-war.
// ---------------------------------------------------------------------------

import { useSocket } from '@/lib/socket-context';

export function SessionSupersededOverlay() {
  const { status } = useSocket();

  if (status !== 'superseded') return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
      <span aria-hidden="true" className="text-4xl">
        📵
      </span>
      <h1 className="text-xl font-bold">Opened in another tab</h1>
      <p className="max-w-xs text-base-content/60">
        This session is now active somewhere else — another tab, or another device. Only one place can play at a
        time, so this tab has been disconnected.
      </p>
      <p className="max-w-xs text-sm text-base-content/40">
        Switch to the other tab to keep playing, or close this one.
      </p>
    </div>
  );
}
