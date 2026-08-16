'use client';

// ---------------------------------------------------------------------------
// PhaseBanner — the top-of-screen "what's happening right now" chrome. Pure
// presentation: takes a phase label + narration string as props, has no
// knowledge of the actual Phase union from @mafia/shared (kept generic so
// this component compiles and renders standalone in the showcase without a
// game running).
// ---------------------------------------------------------------------------

export type PhaseTone = 'night' | 'day' | 'vote' | 'neutral';

export interface PhaseBannerProps {
  /** Short label, e.g. "Night falls" / "Discussion" / "Vote". */
  label: string;
  /** One line of flavor/narration text shown under the label. */
  narration?: string;
  tone?: PhaseTone;
}

const TONE_STYLES: Record<PhaseTone, { bg: string; text: string; icon: string }> = {
  night: { bg: 'bg-mafia-accent/15', text: 'text-mafia-accent', icon: '🌙' },
  day: { bg: 'bg-village-accent/15', text: 'text-village-accent', icon: '☀️' },
  vote: { bg: 'bg-primary/15', text: 'text-primary', icon: '🗳️' },
  neutral: { bg: 'bg-white/5', text: 'text-base-content', icon: '•' },
};

export function PhaseBanner({ label, narration, tone = 'neutral' }: PhaseBannerProps) {
  const styles = TONE_STYLES[tone];

  return (
    <div
      className={`flex flex-col gap-0.5 rounded-2xl px-4 py-3 ${styles.bg}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-lg leading-none">
          {styles.icon}
        </span>
        <span className={`text-xl font-bold ${styles.text}`}>{label}</span>
      </div>
      {narration && <p className="text-sm text-base-content/70">{narration}</p>}
    </div>
  );
}
