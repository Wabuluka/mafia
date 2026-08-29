'use client';

// ---------------------------------------------------------------------------
// DawnReveal — the emotional beat at the start of the day: an animated
// reveal of who (if anyone) died overnight, with their role. Requirements
// from the spec, enforced here:
//   - "feel like a moment": staged reveal (pause -> name -> role), not an
//     instant dump of text.
//   - "skippable": a tap anywhere jumps straight to the end state.
//   - "under four seconds": the auto-advance timeout is capped at 3.5s
//     REGARDLESS of how many stages the animation has, so a slow reader
//     never gets stuck here — they can always read the end state (which
//     stays visible) at their own pace after the ~4s window; what's capped
//     is the SCRIPTED reveal, not the player's ability to keep looking.
//   - prefers-reduced-motion: falls straight to the end state with no
//     staged reveal at all, per this component's own check (in addition to
//     the global animation-neutralizing rule in globals.css, since the
//     STAGING here is a setTimeout sequence, not a CSS animation the
//     global rule would catch).
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import type { PhaseOutcome, PublicPlayer } from '@mafia/shared';
import { NightSkyBackdrop } from '@/components/NightSkyBackdrop';
import { playSound, vibrate } from '@/lib/useFeedback';
import { useThemeSync } from '@/lib/useThemeSync';

export interface DawnRevealProps {
  outcome: PhaseOutcome;
  players: PublicPlayer[];
  onDone: () => void;
}

const ROLE_LABEL: Record<string, string> = {
  VILLAGER: 'Resident',
  MAFIA: 'Mafia',
  DETECTIVE: 'Detective',
  DOCTOR: 'Doctor',
  JESTER: 'Jester',
};

const MAX_AUTO_ADVANCE_MS = 3500;
const STAGE_DELAY_MS = 900;

type Stage = 'dawn' | 'reveal';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const listener = () => setReduced(query.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return reduced;
}

export function DawnReveal({ outcome, players, onDone }: DawnRevealProps) {
  // Stays on the dark "mafia" theme through this whole reveal — even
  // though the server's phase has already moved to DAY_DISCUSSION by the
  // time this renders — and only flips once the player dismisses it and
  // DiscussionPhase mounts. See useThemeSync's module header for why this
  // component (not view.phase) owns that decision.
  useThemeSync('mafia');
  const reducedMotion = usePrefersReducedMotion();
  const [stage, setStage] = useState<Stage>(reducedMotion ? 'reveal' : 'dawn');
  const [done, setDone] = useState(false);

  const victim = outcome.died[0];
  const victimName = useMemo(
    () => (victim ? players.find((p) => p.id === victim.playerId)?.name ?? 'A resident' : null),
    [victim, players],
  );

  useEffect(() => {
    if (reducedMotion) return;
    const timer = setTimeout(() => setStage('reveal'), STAGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [reducedMotion]);

  useEffect(() => {
    const timer = setTimeout(() => setDone(true), MAX_AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, []);

  // Fires exactly once, at the moment the outcome is actually shown — the
  // payoff, not the setup. Covers both paths that reach `stage === 'reveal'`
  // (the natural STAGE_DELAY_MS timer, and a tap-to-skip) in one place,
  // since both funnel through the same state transition. Deliberately not
  // gated on `reducedMotion` — see useFeedback's module header.
  useEffect(() => {
    if (stage !== 'reveal') return;
    playSound('reveal');
    vibrate(20);
  }, [stage]);

  function skip() {
    setStage('reveal');
    setDone(true);
  }

  return (
    <button
      type="button"
      onClick={done ? onDone : skip}
      className="relative flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center"
      aria-label={done ? 'Continue to the day' : 'Skip dawn reveal'}
    >
      <NightSkyBackdrop />

      <div className="relative z-10 flex flex-col items-center gap-4">
        <span aria-hidden="true" className="text-5xl">
          🌅
        </span>

        {stage === 'dawn' && (
          <p className="animate-fade-in text-xl font-semibold text-base-content/80 motion-reduce:animate-none">
            The town wakes up…
          </p>
        )}

        {stage === 'reveal' && (
          <div className="animate-scale-in flex flex-col items-center gap-2 motion-reduce:animate-none">
            {victim && victimName ? (
              <>
                <p className="text-lg text-base-content/70">Overnight, the village lost</p>
                <p className="text-3xl font-black text-danger">{victimName}</p>
                <p className="text-base-content/60">
                  They were <span className="font-semibold text-base-content">{ROLE_LABEL[victim.role] ?? victim.role}</span>.
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-village-accent">Everyone survived the night.</p>
                <p className="text-base-content/60">No one died. The village is safe, for now.</p>
              </>
            )}
          </div>
        )}

        <p className="mt-4 text-xs text-base-content/30">
          {done ? 'Tap to continue' : 'Tap to skip'}
        </p>
      </div>
    </button>
  );
}
