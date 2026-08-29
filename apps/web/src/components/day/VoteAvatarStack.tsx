'use client';

// ---------------------------------------------------------------------------
// VoteAvatarStack — small overlapping avatars showing who's currently
// voting for a given target, rendered under that target's PlayerTile in
// the voting grid. Pure presentation over `PlayerView.votes`, which the
// server already keeps public and current-round-only (see redactStateFor) —
// this component doesn't compute a tally itself, only lays out whichever
// voter list it's handed.
// ---------------------------------------------------------------------------

import type { PublicPlayer } from '@mafia/shared';

export interface VoteAvatarStackProps {
  voterIds: string[];
  players: PublicPlayer[];
}

const MAX_SHOWN = 4;

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 2).toUpperCase();
}

export function VoteAvatarStack({ voterIds, players }: VoteAvatarStackProps) {
  if (voterIds.length === 0) return null;

  const shown = voterIds.slice(0, MAX_SHOWN);
  const overflow = voterIds.length - shown.length;

  return (
    <div className="flex items-center justify-center" aria-label={`${voterIds.length} vote${voterIds.length === 1 ? '' : 's'}`}>
      <div className="flex -space-x-2">
        {shown.map((id) => {
          const voter = players.find((p) => p.id === id);
          return (
            <div
              key={id}
              className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-primary text-[0.625rem] font-bold text-primary-content"
              title={voter?.name}
            >
              {voter ? initials(voter.name) : '?'}
            </div>
          );
        })}
        {overflow > 0 && (
          <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-base-content/10 text-[0.625rem] font-bold text-base-content">
            +{overflow}
          </div>
        )}
      </div>
    </div>
  );
}
