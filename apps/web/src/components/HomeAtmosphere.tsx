'use client';

// ---------------------------------------------------------------------------
// HomeAtmosphere — Home-screen-only atmospheric layer stacked ON TOP of
// NightSkyBackdrop (see that component's header for why it stays generic
// and identical across every night screen — it must never gain
// screen-specific flair, since its whole point is being indistinguishable
// role-to-role). This is the opposite: a layer that exists ONLY to make
// the app's first screen feel like somewhere, not a night sky pattern
// reused elsewhere in the game.
//
// Three purely decorative layers, back to front:
//   1. A radial vignette — darkens the edges/corners so the wordmark and
//      buttons read as the clear center of attention, and the scene gains
//      a sense of depth instead of being flat black.
//   2. A warm lantern-glow low on the screen, in the same amber the
//      "mafia" theme's `primary` token uses (see tailwind.config.ts's own
//      commentary on that color's intent — "the warm light in a dark
//      room"). Hardcoded here as a literal HSL value rather than
//      referencing daisyUI's internal `--p` variable, which is in OKLCH
//      format in this daisyUI version, not the bare "H S% L%" triples this
//      app's own semantic tokens use — same "hardcode the exact color a
//      decorative gradient needs" approach NightSkyBackdrop/DaySkyBackdrop
//      already take for their own gradients. Animated with the slow `glow`
//      breathe, distinct from the sharper `ring-pulse` used for stars/
//      countdowns, so it reads as "a light source gently flickering", not
//      a UI element demanding attention.
//   3. Two slow-drifting fog wisps near the bottom third — soft, low-
//      opacity blurred ellipses animated with the `drift`/`drift-slow`
//      keyframes (see tailwind.config.ts) at different speeds, so they
//      don't read as one shape moving in lockstep, passing in front of
//      the glow.
//
// CSS-only, transform/opacity-only animations — free under
// prefers-reduced-motion via the same global rule every other animation in
// this app relies on (globals.css). Purely decorative: aria-hidden,
// absolutely positioned, non-interactive.
// ---------------------------------------------------------------------------

export function HomeAtmosphere() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_45%,_hsl(222_28%_4%/0.75)_100%)]" />

      {/* Lantern glow */}
      <div className="absolute left-1/2 bottom-[-15%] h-72 w-[140%] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(ellipse,_hsl(38_75%_58%/0.18),_transparent_70%)] motion-safe:animate-glow motion-reduce:opacity-70" />

      {/* Fog wisps */}
      <div className="absolute bottom-8 left-[-20%] h-48 w-[140%] rounded-[100%] bg-[radial-gradient(ellipse,_hsl(222_28%_42%/0.35),_transparent_68%)] blur-2xl motion-safe:animate-drift motion-reduce:animate-none" />
      <div className="absolute bottom-0 left-[-10%] h-40 w-[130%] rounded-[100%] bg-[radial-gradient(ellipse,_hsl(220_24%_48%/0.28),_transparent_68%)] blur-2xl motion-safe:animate-drift-slow motion-reduce:animate-none" />
    </div>
  );
}
