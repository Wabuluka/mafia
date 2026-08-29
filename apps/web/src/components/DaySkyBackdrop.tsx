'use client';

// ---------------------------------------------------------------------------
// DaySkyBackdrop — the ambient "full daylight" visual, sibling to
// NightSkyBackdrop.tsx (see that file's header for the shared design
// principles this one follows too: purely decorative, aria-hidden,
// absolutely positioned behind content, and identical for EVERY role —
// nothing about the ambient chrome can leak who's who).
//
// A soft warm gradient with a single large diffuse "sun glow" near the top
// — deliberately not a plain flat light background (too sterile against
// NightSkyBackdrop's starfield) and not literal cartoon sun/cloud
// iconography (too cute for a game about lying to your friends). CSS-only,
// no JS — the glow's gentle pulse is the same `ring-pulse` keyframe
// NightSkyBackdrop's stars use, so it's free to disable under
// prefers-reduced-motion via the same global rule (see globals.css).
// ---------------------------------------------------------------------------

export function DaySkyBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_top,_hsl(42_60%_92%),_hsl(42_38%_95%))]"
    >
      <div
        className="absolute left-1/2 top-[-10%] h-[60vw] w-[60vw] max-h-80 max-w-80 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,_hsl(42_90%_88%/0.9),_transparent_70%)] motion-safe:animate-ring-pulse motion-reduce:opacity-90"
      />
    </div>
  );
}
