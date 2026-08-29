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
//
// OPTIONAL `backdrop` SLOT: for a screen that wants full-bleed atmosphere
// behind BOTH the header and the content as one continuous scene — e.g.
// Home mounting NightSkyBackdrop so the app's front door reads as the same
// world as the in-game night screens, rather than a plain flat surface
// with a starry game hiding behind it. When present, header/content/
// actionBar all go transparent so the backdrop (rendered first, absolutely
// positioned, behind everything via z-index) shows through uninterrupted;
// omit it and the shell renders exactly as before; NightSkyBackdrop/
// DaySkyBackdrop's own header comments cover why they're safe to reuse
// here (purely decorative, identical for every viewer, aria-hidden).
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';

export interface AppShellProps {
  header: ReactNode;
  children: ReactNode;
  actionBar?: ReactNode;
  backdrop?: ReactNode;
}

export function AppShell({ header, children, actionBar, backdrop }: AppShellProps) {
  return (
    <div className={`relative flex h-dvh flex-col overflow-hidden ${backdrop ? '' : 'bg-surface'}`}>
      {backdrop}

      <header
        className={`relative z-10 shrink-0 pt-safe-top ${backdrop ? '' : 'border-b border-base-content/10 bg-surface'}`}
      >
        {header}
      </header>

      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</main>

      {actionBar && <footer className="relative z-10 shrink-0">{actionBar}</footer>}
    </div>
  );
}
