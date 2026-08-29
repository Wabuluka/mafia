'use client';

// ---------------------------------------------------------------------------
// ShareVillageCode — the prominent shareable village code display: large
// letter-spaced code, a native share-sheet button (Web Share API) where
// supported, falling back to copy-to-clipboard everywhere else (and as a
// secondary action even where share IS supported, since some players will
// still want to paste the code manually into an existing chat thread).
// ---------------------------------------------------------------------------

import { useState } from 'react';

export interface ShareVillageCodeProps {
  code: string;
  /** Purely cosmetic display name (see VillageDocument.name's doc comment
   * on the server) — shown above the code and folded into the share
   * text/title so an invite reads as "Join Shadowy Hollow" rather than
   * just a bare 4-character code. */
  name: string;
  /** Full joinable URL, e.g. `https://mafia.app/join?code=ABCD` — used as
   * the share payload / copy target so a tapped link goes straight into
   * the join flow instead of just handing over the bare code. */
  joinUrl: string;
}

export function ShareVillageCode({ code, name, joinUrl }: ShareVillageCodeProps) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function handleShare() {
    try {
      await navigator.share({
        title: `Join ${name}`,
        text: `Join my Mafia game, ${name} — code ${code}`,
        url: joinUrl,
      });
    } catch {
      // AbortError when the user dismisses the share sheet is normal and
      // not a failure worth surfacing — anything else falls through to
      // the copy button already on screen as the recovery path.
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be denied by permissions policy in some
      // embedded/in-app browser contexts — the code is still visibly
      // displayed on screen as the ultimate fallback, so this failure is
      // silent rather than surfaced as an error state.
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-elevated p-5">
      <span className="text-center text-lg font-bold text-base-content">{name}</span>
      <span className="text-sm text-base-content/60">Village code</span>
      <span className="select-all text-4xl font-black tracking-[0.3em] text-primary" aria-label={`Village code ${code.split('').join(' ')}`}>
        {code}
      </span>

      <div className="flex w-full gap-2">
        {canShare && (
          <button
            type="button"
            onClick={handleShare}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-content active:brightness-90"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M13 4a2 2 0 114 0 2 2 0 01-4 0zM3 10a2 2 0 114 0 2 2 0 01-4 0zM13 16a2 2 0 114 0 2 2 0 01-4 0z" />
              <path d="M6.5 8.8l7-3.4M6.5 11.2l7 3.4" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            Share
          </button>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className={[
            'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition-colors motion-reduce:transition-none',
            copied ? 'bg-village-accent/20 text-village-accent' : 'bg-base-content/10 text-base-content active:bg-base-content/15',
          ].join(' ')}
        >
          {copied ? (
            <>
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Copied
            </>
          ) : (
            'Copy link'
          )}
        </button>
      </div>
    </div>
  );
}
