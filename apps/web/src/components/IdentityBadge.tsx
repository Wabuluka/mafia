'use client';

// ---------------------------------------------------------------------------
// IdentityBadge — a small, always-visible "who am I right now" pill: the
// player's own name plus their role (or "Moderator" for the host, who
// never has one). Lives in the header row alongside HowToPlayButton/
// GameLogButton (see NightPhase.tsx/DiscussionPhase.tsx/VotingPhase.tsx) so
// a player can glance at their own identity at any point during play
// without opening a menu — a long game with many players can make it easy
// to lose track of "wait, which one am I, and what am I again?"
//
// SHOWS THE SAME THING WHETHER ALIVE OR DEAD, DELIBERATELY: a dead
// player's role is already public knowledge (see redact.ts's
// `revealedRole`), so hiding it here after death would just be
// inconsistent with what everyone else can already see, not a real secret
// kept. This badge always reflects "what you currently are," not "what's
// still hidden."
//
// TONE MATCHES PhaseBanner's mafia/village-accent convention (see that
// component) so the badge reads as team-coded at a glance, not just plain
// chrome — mafia-accent for the mafia role, village-accent for every other
// role/the moderator, same as the rest of the app's color language.
// ---------------------------------------------------------------------------

import { ROLE_LABEL } from '@/lib/roleLabels';

export interface IdentityBadgeProps {
  name: string;
  /** Undefined while roles aren't assigned yet, or permanently for the
   * moderator — see `isModerator` below to tell those apart. */
  role?: string;
  isModerator: boolean;
}

export function IdentityBadge({ name, role, isModerator }: IdentityBadgeProps) {
  const roleLabel = isModerator ? 'Moderator' : role ? (ROLE_LABEL[role] ?? role) : null;
  const tone = !isModerator && role === 'MAFIA' ? 'text-mafia-accent' : 'text-village-accent';

  return (
    <div
      className="flex max-w-[9.5rem] flex-col items-end leading-tight"
      aria-label={roleLabel ? `You are ${name}, ${roleLabel}` : `You are ${name}`}
    >
      <span className="line-clamp-1 max-w-full text-sm font-semibold text-base-content">{name}</span>
      {roleLabel && <span className={`line-clamp-1 max-w-full text-xs font-medium ${tone}`}>{roleLabel}</span>}
    </div>
  );
}
