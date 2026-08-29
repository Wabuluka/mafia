'use client';

// ---------------------------------------------------------------------------
// EliminationReveal — the end-of-vote moment: a dramatic pause, then the
// eliminated player's role (or, on a tie, its own distinct narration
// rather than being silently lumped in with "nobody died"). Structurally
// similar in spirit to DawnReveal (staged, skippable, time-capped) but a
// separate component since the framing is different: this is the
// CONSEQUENCE of a vote the whole village just participated in, not an
// overnight mystery — the pause here is about tension before a verdict,
// not atmosphere.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import type { PhaseOutcome, PublicPlayer } from '@mafia/shared';
import { playSound, vibrate } from '@/lib/useFeedback';
import { useThemeSync } from '@/lib/useThemeSync';

export interface EliminationRevealProps {
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

const PAUSE_MS = 1200;
const MAX_AUTO_ADVANCE_MS = 3500;

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

export function EliminationReveal({ outcome, players, onDone }: EliminationRevealProps) {
  // Stays on the light "day" theme through this whole reveal — even though
  // the server's phase has already moved to NIGHT by the time this
  // renders — and only flips once the player dismisses it and NightPhase
  // mounts. See useThemeSync's module header for why this component (not
  // view.phase) owns that decision; mirrors DawnReveal's identical choice
  // in the opposite direction.
  useThemeSync('day');
  const reducedMotion = usePrefersReducedMotion();
  const [revealed, setRevealed] = useState(reducedMotion);
  const [done, setDone] = useState(false);

  const eliminated = outcome.died[0];
  const eliminatedName = eliminated ? players.find((p) => p.id === eliminated.playerId)?.name ?? 'A resident' : null;

  useEffect(() => {
    if (reducedMotion) return;
    const timer = setTimeout(() => setRevealed(true), PAUSE_MS);
    return () => clearTimeout(timer);
  }, [reducedMotion]);

  // Same "fire once, at the payoff moment" treatment as DawnReveal's
  // mirror-image effect — see that file's comment for the full rationale.
  useEffect(() => {
    if (!revealed) return;
    playSound('reveal');
    vibrate(20);
  }, [revealed]);

  useEffect(() => {
    const timer = setTimeout(() => setDone(true), MAX_AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, []);

  function skip() {
    setRevealed(true);
    setDone(true);
  }

  return (
    <button
      type="button"
      onClick={done ? onDone : skip}
      className="flex h-full w-full flex-col items-center justify-center gap-4 bg-surface px-6 text-center"
      aria-label={done ? 'Continue' : 'Skip elimination reveal'}
    >
      <span aria-hidden="true" className="text-5xl">
        ⚖️
      </span>

      {!revealed && (
        <p className="animate-fade-in text-xl font-semibold text-base-content/70 motion-reduce:animate-none">
          The village has decided…
        </p>
      )}

      {revealed && (
        <div className="animate-scale-in flex flex-col items-center gap-2 motion-reduce:animate-none">
          {outcome.wasTie ? (
            <>
              <p className="text-2xl font-bold text-primary">It&apos;s a tie.</p>
              <p className="text-base-content/60">No one is eliminated today.</p>
            </>
          ) : eliminated && eliminatedName ? (
            <>
              <p className="text-lg text-base-content/70">The village has eliminated</p>
              <p className="text-3xl font-black text-danger">{eliminatedName}</p>
              <p className="text-base-content/60">
                They were <span className="font-semibold text-base-content">{ROLE_LABEL[eliminated.role] ?? eliminated.role}</span>.
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-village-accent">No votes were cast.</p>
              <p className="text-base-content/60">No one is eliminated today.</p>
            </>
          )}
        </div>
      )}

      <p className="mt-4 text-xs text-base-content/30">{done ? 'Tap to continue' : 'Tap to skip'}</p>
    </button>
  );
}
