'use client';

// ---------------------------------------------------------------------------
// Home — the app's entry screen: large Create Village / Join Village buttons.
// No game state, no village membership yet; this screen's only job is
// routing the player toward name entry (if needed) and then either village
// creation or the join-code flow.
// ---------------------------------------------------------------------------

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { HomeAtmosphere } from '@/components/HomeAtmosphere';
import { HowToPlayModal } from '@/components/HowToPlayModal';
import { Modal } from '@/components/Modal';
import { NightSkyBackdrop } from '@/components/NightSkyBackdrop';
import { clearSession } from '@/lib/api';
import { useStoredName } from '@/lib/useStoredName';
import { useThemeSync } from '@/lib/useThemeSync';
import { useToast } from '@/components/Toast';

export default function HomePage() {
  useThemeSync('mafia');
  const router = useRouter();
  const toast = useToast();
  const [storedName, setStoredName] = useStoredName();
  const [resetting, setResetting] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);

  function goToCreate() {
    const target = '/lobby/create';
    router.push(storedName ? target : `/name?next=${encodeURIComponent(target)}`);
  }

  function goToJoin() {
    const target = '/join';
    router.push(storedName ? target : `/name?next=${encodeURIComponent(target)}`);
  }

  // Escape hatch for a stuck/stale identity — e.g. a dev environment whose
  // database was wiped out from under a browser's still-held session
  // cookie, or any other case where "start over from a clean slate" is
  // what the player actually wants. Clears BOTH halves of client-side
  // identity: the session cookie (server-side, via clearSession — see its
  // own doc comment on why the cookie can't be cleared from JS directly)
  // and the remembered display name (localStorage), since leaving the old
  // name in place after wiping the session would just produce a
  // half-reset that still looks like the old identity on the next screen.
  //
  // CONFIRM BEFORE CLEARING, ON PURPOSE: this screen has no way to know
  // whether the browser is currently the host of a live lobby/game
  // elsewhere in another tab (Home carries no village/socket state at
  // all). A village's host identity is a fixed snapshot taken at creation
  // time (see server/http/routes/villages.routes.ts) with no reconciliation
  // if the cookie underneath it changes — resetting out from under an
  // active hosting session silently strands that lobby with nobody able to
  // start it. The confirmation step exists specifically to surface that
  // risk before it happens, since this button can't detect the risky case
  // and prevent it outright.
  async function handleResetSession() {
    setConfirmResetOpen(false);
    setResetting(true);
    try {
      await clearSession();
      setStoredName('');
      toast.show('Session reset. You can start fresh.', { tone: 'success' });
    } catch {
      toast.show('Could not reset your session. Check your connection and try again.', { tone: 'danger' });
    } finally {
      setResetting(false);
    }
  }

  return (
    <AppShell
      backdrop={
        <>
          <NightSkyBackdrop />
          <HomeAtmosphere />
        </>
      }
      header={
        <div className="flex items-center justify-between px-4 py-3">
          {/* The lockup already renders "MAFIA" as part of the image, so
           * this doubles as the header's <h1> — no separate text heading
           * alongside it (see the hero below for the same reasoning). A
           * real `alt`, not `aria-hidden`, since the wordmark is the only
           * place this page's title is announced to assistive tech. A
           * static logo asset from /public has no benefit from next/image's
           * responsive-srcset machinery, hence the plain <img>. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/mafia_logo_dark.svg" alt="Mafia" className="h-9" />

          {/* Reset session lives here now, not in the primary vertical
           * flow below — it's a rare, destructive escape hatch (see
           * handleResetSession's doc comment), not something that should
           * compete with Create/Join for attention on the screen a player
           * sees every single time. Same "small icon button in the
           * header, opens a sheet" shape as HowToPlayButton elsewhere in
           * the app (see HowToPlayModal.tsx's module header) — this is
           * that exact pattern, just local to this screen since nothing
           * else needs a reset-session trigger. */}
          <button
            type="button"
            onClick={() => setConfirmResetOpen(true)}
            disabled={resetting}
            aria-label={resetting ? 'Resetting session…' : 'Reset session'}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-base-content/5 text-base-content/50 transition-colors active:bg-base-content/10 disabled:opacity-50"
          >
            {resetting ? (
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
              />
            ) : (
              <ResetIcon />
            )}
          </button>
        </div>
      }
    >
      <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
        <div className="flex flex-col items-center text-center">
          {/* Wordmark + tagline ("IF IT WASN'T YOU, WHO WAS IT?") are both
           * baked into this image — no separate <h2>/<p> repeating them,
           * same reasoning as the header's lockup above. Despite the
           * filename, `_dark` is the light-fill variant meant for a dark
           * background (confirmed by inspecting its fill colors — near-
           * white #F4F6F3) and `_white` is the dark-fill variant meant for
           * a light background; `_dark` is correct here against
           * NightSkyBackdrop's near-black gradient. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logos/mafia_logo_dark.svg"
            alt="Mafia — if it wasn't you, who was it?"
            className="h-28 w-auto max-w-full drop-shadow-[0_0_40px_hsl(var(--color-mafia-accent)/0.28)]"
          />
        </div>

        <div className="flex w-full max-w-xs flex-col gap-3.5">
          <button
            type="button"
            onClick={goToCreate}
            className="group relative flex min-h-14 items-center justify-center overflow-hidden rounded-2xl bg-primary text-lg font-bold text-primary-content shadow-[0_8px_30px_-8px] shadow-primary/50 transition-transform active:scale-[0.98] motion-reduce:transition-none"
          >
            {/* A faint diagonal sheen, purely decorative — the one bit of
             * "modern glossy surface" texture on the primary action,
             * restrained to a static gradient rather than a moving
             * shimmer so it doesn't compete with the ring-pulse/starfield
             * motion already happening in the backdrop behind it. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/15 to-transparent"
            />
            <span className="relative">Create Village</span>
          </button>
          <button
            type="button"
            onClick={goToJoin}
            className="flex min-h-14 items-center justify-center rounded-2xl border border-base-content/15 bg-base-content/[0.06] text-lg font-bold text-base-content backdrop-blur-md transition-colors active:bg-base-content/10 motion-reduce:transition-none"
          >
            Join Village
          </button>
        </div>

        <button
          type="button"
          onClick={() => setHowToPlayOpen(true)}
          className="flex items-center gap-1.5 text-sm font-medium text-base-content/55 underline-offset-4 active:underline"
        >
          New to Mafia? <span className="text-primary">Here&apos;s how it works</span>
        </button>
      </div>

      <HowToPlayModal open={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} />

      <Modal
        open={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        title="Reset session?"
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmResetOpen(false)}
              className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-base-content/10 text-base font-semibold active:bg-base-content/15"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleResetSession}
              className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-danger text-base font-semibold text-white active:opacity-90"
            >
              Reset
            </button>
          </div>
        }
      >
        <p className="text-sm text-base-content/70">
          This clears your saved name and identity on this device. If you&apos;re currently hosting a lobby or game
          in another tab, you&apos;ll lose the ability to control it — anyone still in that lobby will need a new
          host to be picked, or the game may be left unable to start.
        </p>
      </Modal>
    </AppShell>
  );
}

/** Same inline-SVG-on-a-20x20-viewBox convention as HowToPlayModal.tsx's
 * InfoIcon (see that file's module header) — `currentColor` stroke so it
 * tints with the button's own text color rather than a hardcoded fill. */
function ResetIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M15.5 6.5A6 6 0 1 0 16.9 10" strokeLinecap="round" />
      <path d="M15.5 2.75V6.5h-3.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
