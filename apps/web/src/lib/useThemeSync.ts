'use client';

// ---------------------------------------------------------------------------
// useThemeSync — the day/night theme switching mechanism (see
// tailwind.config.ts's header comment for the two registered daisyUI
// themes, "mafia" and "day").
//
// WHY THIS ISN'T DRIVEN BY view.phase DIRECTLY: the phase-transition reveal
// animations (DawnReveal, EliminationReveal) are meant to hold the PREVIOUS
// theme for their entire on-screen lifetime and only flip once the player
// dismisses them — but by the time a reveal is showing, the server's
// `view.phase` has already advanced to the NEW phase (see DayPhase.tsx's
// module header on the phaseChangeQueue). So `view.phase` alone can't tell
// "a reveal for the old phase is still showing" apart from "the new phase's
// live screen is showing" — only the identity of which COMPONENT is
// currently mounted can.
//
// The fix: each screen-level component (NightPhase, DawnReveal,
// DiscussionPhase, VotingPhase, EliminationReveal, GameOverScreen, and the
// always-dark pre-game pages) calls this hook with the theme IT represents,
// not the phase it happens to correspond to. Because DawnReveal/
// EliminationReveal are separate components from the live day/night
// screens, React's mount/unmount of one and mount of the next IS exactly
// the reveal-dismissal boundary — no explicit "flip now" call is needed
// anywhere else.
//
// Imperative DOM write, not React context: `data-theme` needs to live on
// `<html>`, several levels above where any of these components render, and
// daisyUI only reads it as a plain DOM attribute — a context provider
// re-rendering the tree on every phase change would be pure overhead for a
// single attribute write.
//
// NO RESET ON UNMOUNT, DELIBERATELY: if this cleared `data-theme` back to
// some default when a component unmounts, there'd be a one-frame window
// between the old screen unmounting and the new one's effect running where
// the attribute is wrong (or absent). Instead, whichever screen mounts LAST
// simply overwrites the attribute with its own theme — there is always
// exactly one "owner" of `data-theme` at a time, and the transition is a
// single write, never a write-then-reset-then-write.
// ---------------------------------------------------------------------------

import { useEffect } from 'react';

export type GameTheme = 'mafia' | 'day';

/** Matches each theme's `base-100` — see tailwind.config.ts. Exported so
 * app/layout.tsx's SSR default and this hook's runtime updates never drift
 * out of sync with each other or with the theme config itself. */
export const THEME_COLOR: Record<GameTheme, string> = {
  mafia: '#0b0d12',
  day: '#faf6ef',
};

/** Sets `data-theme` on `<html>` (and the `theme-color` meta tag, so OS/PWA
 * chrome matches) for as long as the calling component is mounted. Call
 * this from screen-level components only — see the module header for which
 * ones and why. */
export function useThemeSync(theme: GameTheme): void {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;

    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', THEME_COLOR[theme]);
  }, [theme]);
}
