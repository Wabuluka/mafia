'use client';

// ---------------------------------------------------------------------------
// MafiaTally — the live "who's targeting whom" readout mafia players see
// while deliberating a kill. Pure presentation over the exact
// `you.mafiaNightTargets` array the server sends (see redactStateFor's
// mafia-only NIGHT branch) — this component never guesses or infers a
// teammate's selection from anything else, since that array IS the only
// channel this information legitimately travels over.
// ---------------------------------------------------------------------------

import type { MafiaNightTarget, PublicPlayer } from '@mafia/shared';

export interface MafiaTallyProps {
  targets: MafiaNightTarget[];
  players: PublicPlayer[];
  selfPlayerId: string;
}

function nameFor(players: PublicPlayer[], id: string): string {
  return players.find((p) => p.id === id)?.name ?? 'Unknown';
}

export function MafiaTally({ targets, players, selfPlayerId }: MafiaTallyProps) {
  if (targets.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-elevated p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-mafia-accent">
        Your family&apos;s targets
      </h3>
      <ul className="flex flex-col gap-1.5">
        {targets.map((t) => (
          <li key={t.actorId} className="flex items-center justify-between text-sm">
            <span className="text-base-content/80">
              {t.actorId === selfPlayerId ? 'You' : nameFor(players, t.actorId)}
            </span>
            <span className={t.targetId ? 'font-semibold text-base-content' : 'text-base-content/40 italic'}>
              {t.targetId ? nameFor(players, t.targetId) : 'deciding…'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
