'use client';

// ---------------------------------------------------------------------------
// Sensory feedback — sound + haptics for the app's suspense/confirmation
// moments (reveal stings, action-confirmed pulses). Plain functions, not a
// hook: neither needs component state, and calling them from an event
// handler or a `useEffect` should feel exactly like calling any other
// fire-and-forget browser API (`navigator.vibrate`, `new Audio().play()`
// already are one).
//
// NOT GATED ON prefers-reduced-motion: that media query is specifically
// about VESTIBULAR-triggering motion (parallax, spins, staged reveals — see
// globals.css's blanket animation-neutralizing rule and DawnReveal/
// EliminationReveal's own `usePrefersReducedMotion` checks). A short
// confirmation vibration or a soft sting isn't a motion concern, so this
// deliberately does NOT read that preference — callers that skip a staged
// animation under reduced motion still fire the SAME sound/haptic at the
// equivalent moment (see DawnReveal.tsx's call site), just without the
// build-up.
//
// BOTH FUNCTIONS ARE SILENT NO-OPS ON FAILURE, ALWAYS — never let a sensory
// nicety throw into a click handler or a phase-transition effect:
//   - `playSound`: browsers routinely reject `Audio.play()` before any user
//     gesture has been registered on the page (autoplay policy) — this is
//     an expected, frequent rejection, not an error condition worth
//     surfacing.
//   - `vibrate`: the Vibration API doesn't exist on iOS Safari at all (no
//     `navigator.vibrate`) — must be a no-op there, not a thrown
//     TypeError.
// ---------------------------------------------------------------------------

export type SoundName = 'confirm' | 'reveal';

/** Public path for each sound, under apps/web/public/sounds/ — see that
 * directory's own README for the asset requirements (short, soft, mono/
 * stereo mp3, no licensing encumbrance) if/when real audio is added. No
 * asset ships with this change; `playSound` degrades silently if the file
 * is missing, same as any other failure path here. */
const SOUND_SRC: Record<SoundName, string> = {
  confirm: '/sounds/confirm.mp3',
  reveal: '/sounds/reveal.mp3',
};

/** Plays a short UI sound. Fire-and-forget: never awaited, never throws. */
export function playSound(name: SoundName): void {
  try {
    const audio = new Audio(SOUND_SRC[name]);
    audio.volume = 0.6;
    void audio.play().catch(() => {
      // Autoplay-policy rejection or missing asset — both routine, both
      // silent. See module header.
    });
  } catch {
    // Audio construction itself can throw in exotic environments (e.g. no
    // media support) — same silent-no-op posture as above.
  }
}

/** Triggers a short haptic pulse where supported. `pattern` is milliseconds
 * (single pulse) or an on/off sequence, per the Vibration API's own shape. */
export function vibrate(pattern: number | number[] = 15): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // See module header — never let this throw.
  }
}
