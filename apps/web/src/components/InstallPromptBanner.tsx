'use client';

// ---------------------------------------------------------------------------
// InstallPromptBanner — the subtle install pitch, rendered only where its
// caller decides `canShowInstallPrompt` (see lib/useInstallPrompt.ts) is
// true — currently just GameOverScreen, right after a completed game. Not a
// modal/overlay: sits inline in the page flow so it never blocks the win
// banner or role reveal a player actually came to this screen for, and is
// dismissible without installing (a player can decline every game without
// being nagged again until the browser re-offers `beforeinstallprompt`).
// ---------------------------------------------------------------------------

import { useState } from 'react';

export interface InstallPromptBannerProps {
  onInstall: () => void;
}

export function InstallPromptBanner({ onInstall }: InstallPromptBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-elevated px-4 py-3">
      <span aria-hidden="true" className="text-2xl">
        🔪
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-base-content">Install Mafia</p>
        <p className="text-xs text-base-content/60">Play again faster next time — add it to your home screen.</p>
      </div>
      <button
        type="button"
        onClick={onInstall}
        className="shrink-0 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-content"
      >
        Install
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss install prompt"
        className="shrink-0 px-1 text-base-content/40"
      >
        ✕
      </button>
    </div>
  );
}
