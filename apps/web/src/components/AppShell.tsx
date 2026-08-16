'use client';

// ---------------------------------------------------------------------------
// AppShell — the viewport-locked layout every game screen is built inside.
// Three fixed regions:
//
//   header      — fixed height, safe-area-top padded, never scrolls
//   content     — the ONLY scrollable region in the shell
//   actionBar   — fixed height, safe-area-bottom padded, sits within thumb
//                 reach at the bottom, never scrolls
//
// The shell itself is exactly `100dvh` tall (dynamic viewport height — see
// tailwind.config.ts's `height.dvh` and the module comment there for why
// dvh over vh: dvh tracks the CURRENTLY visible viewport as mobile browser
// chrome — the URL bar — shows and hides, where 100vh is pinned to the
// LARGEST possible viewport and gets clipped behind the chrome instead).
// `overflow-hidden` on the shell root, combined with `overflow-y-auto` on
// ONLY the content region, is what prevents the classic mobile bug of the
// page and an inner container both trying to scroll independently.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';

export interface AppShellProps {
  header: ReactNode;
  children: ReactNode;
  actionBar?: ReactNode;
}

export function AppShell({ header, children, actionBar }: AppShellProps) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface">
      <header className="shrink-0 border-b border-white/5 bg-surface pt-safe-top">
        {header}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</main>

      {actionBar && <footer className="shrink-0">{actionBar}</footer>}
    </div>
  );
}
