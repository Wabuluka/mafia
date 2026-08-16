'use client';

// ---------------------------------------------------------------------------
// NightSkyBackdrop — the ambient "the town is asleep" visual: a darker-
// than-daytime surface with a faint star field. Purely decorative (aria-
// hidden, absolutely positioned behind content), and the exact same for
// EVERY role — a villager's screen and a mafia member's screen render this
// identically, which is the point: nothing about the ambient chrome itself
// can leak who's who to someone glancing at a neighbor's phone.
//
// CSS-only, no JS animation loop — the twinkle is a CSS keyframe
// (opacity-only, see globals.css's animation registry) so it's free to
// disable under prefers-reduced-motion without any component-level branch.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';

const STAR_COUNT = 40;

interface Star {
  top: string;
  left: string;
  size: number;
  delay: string;
}

function generateStars(seed: number): Star[] {
  // A tiny deterministic PRNG so the star field doesn't visibly reflow on
  // every re-render (a fresh Math.random() layout per render would be a
  // subtle "the sky is jittering" bug, not a real twinkle).
  let state = seed;
  function next() {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  }

  return Array.from({ length: STAR_COUNT }, () => ({
    top: `${(next() * 100).toFixed(2)}%`,
    left: `${(next() * 100).toFixed(2)}%`,
    size: next() > 0.85 ? 2 : 1,
    delay: `${(next() * 4).toFixed(2)}s`,
  }));
}

export function NightSkyBackdrop() {
  const stars = useMemo(() => generateStars(42), []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_top,_hsl(222_30%_9%),_hsl(222_28%_4%))]"
    >
      {stars.map((star, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white/60 motion-safe:animate-ring-pulse motion-reduce:opacity-50"
          style={{
            top: star.top,
            left: star.left,
            width: star.size,
            height: star.size,
            animationDelay: star.delay,
          }}
        />
      ))}
    </div>
  );
}
