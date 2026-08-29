'use client';

// ---------------------------------------------------------------------------
// useInstallPrompt — captures the browser's `beforeinstallprompt` event (the
// deferred, re-triggerable install prompt Chromium-based browsers fire) and
// exposes it as `promptInstall()`, plus a `markGameCompleted()` the caller
// invokes once a full game has actually finished.
//
// WHY gated on "completed a first full game", not shown on first load: a
// party game's install pitch only makes sense once someone has proven to
// themselves it's worth playing again with the same group (see
// GameOverScreen, the only screen that calls markGameCompleted) — an install
// prompt on the Home screen before a single round has been played is the
// generic "please install my website" nag every mobile user has learned to
// dismiss on reflex. Persisted to localStorage (`mafia:hasCompletedGame`,
// same naming convention as useStoredName.ts) so the eligibility survives
// across visits — a player quitting mid-lobby today and returning tomorrow
// to finish a game should still see the prompt on THAT later completion,
// and once eligible, stays eligible (no reason to re-litigate it every
// session once earned).
//
// The captured event is also stored in a MODULE-level variable, not just
// component state: `beforeinstallprompt` fires at most once per page load,
// often before GameOverScreen (the only consumer) has mounted — capturing
// it at the hook's first mount (Providers, root layout, mounted for every
// route) and caching it module-wide means a later mount of this hook
// (e.g. after navigating to the game-over screen) still has access to the
// same captured event instead of missing it entirely.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';

const COMPLETED_KEY = 'mafia:hasCompletedGame';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let capturedEvent: BeforeInstallPromptEvent | null = null;
let capturedListeners: Array<() => void> = [];

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // suppress the browser's own mini-infobar; we drive timing instead
    capturedEvent = event as BeforeInstallPromptEvent;
    capturedListeners.forEach((listener) => listener());
  });
  window.addEventListener('appinstalled', () => {
    capturedEvent = null;
  });
}

function readHasCompletedGame(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COMPLETED_KEY) === '1';
  } catch {
    return false;
  }
}

export function useInstallPrompt() {
  const [available, setAvailable] = useState(() => capturedEvent !== null);
  const [hasCompletedGame, setHasCompletedGame] = useState(readHasCompletedGame);

  useEffect(() => {
    const listener = () => setAvailable(true);
    capturedListeners.push(listener);
    return () => {
      capturedListeners = capturedListeners.filter((l) => l !== listener);
    };
  }, []);

  const markGameCompleted = useCallback(() => {
    setHasCompletedGame(true);
    try {
      window.localStorage.setItem(COMPLETED_KEY, '1');
    } catch {
      // Non-fatal — worst case the install prompt is re-offered next game.
    }
  }, []);

  const promptInstall = useCallback(async () => {
    if (!capturedEvent) return 'unavailable' as const;
    await capturedEvent.prompt();
    const { outcome } = await capturedEvent.userChoice;
    capturedEvent = null;
    setAvailable(false);
    return outcome;
  }, []);

  return {
    // Only "worth showing" once BOTH the browser says it's installable AND
    // this player has actually finished a game.
    canShowInstallPrompt: available && hasCompletedGame,
    markGameCompleted,
    promptInstall,
  };
}
