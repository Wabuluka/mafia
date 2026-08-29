'use client';

// ---------------------------------------------------------------------------
// ServerShuttingDownOverlay — the terminal, full-screen notice shown the
// moment this tab's socket receives `serverShuttingDown` (see
// realtime/shutdown.ts and socket-context.tsx's `status: 'shuttingDown'`).
// Sibling to SessionSupersededOverlay — same reasoning for living in
// Providers rather than one screen's tree (a shutdown can hit any active
// game, from any screen), same terminal "don't auto-retry" contract.
//
// Unlike SessionSupersededOverlay, this DOES suggest a concrete recovery
// action (reload) rather than just "this is done" — the server coming back
// up (a redeploy finishing) is the expected near-term outcome, not a
// permanent state, so a player who waits a few seconds and reloads should
// reasonably expect to get back in via the normal join flow.
// ---------------------------------------------------------------------------

import { useSocket } from '@/lib/socket-context';

export function ServerShuttingDownOverlay() {
  const { status } = useSocket();

  if (status !== 'shuttingDown') return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
      <span aria-hidden="true" className="text-4xl">
        🛠️
      </span>
      <h1 className="text-xl font-bold">Server restarting</h1>
      <p className="max-w-xs text-base-content/60">
        The server is restarting for maintenance and this game couldn&apos;t continue. Give it a moment, then reload
        to start a new one.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-2 flex min-h-14 w-full max-w-xs items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-content transition-transform active:scale-[0.98] motion-reduce:transition-none"
      >
        Reload
      </button>
    </div>
  );
}
