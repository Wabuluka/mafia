'use client';

// ---------------------------------------------------------------------------
// DetectiveResultCard — the detective's private investigation history,
// straight from `you.detectiveResults` (see @mafia/shared's YouSchema and
// redactStateFor's DETECTIVE branch). Every entry there is real, already-
// resolved server truth — this component never computes or guesses an
// isMafia verdict itself, only formats what the server already decided.
// The most recent result gets the large "MAFIA" / "NOT MAFIA" framing this
// prompt calls for; older ones collapse into a compact history list below it.
// ---------------------------------------------------------------------------

import type { DetectiveResult, PublicPlayer } from '@mafia/shared';

export interface DetectiveResultCardProps {
  results: DetectiveResult[];
  players: PublicPlayer[];
}

function nameFor(players: PublicPlayer[], id: string): string {
  return players.find((p) => p.id === id)?.name ?? 'Unknown';
}

export function DetectiveResultCard({ results, players }: DetectiveResultCardProps) {
  if (results.length === 0) {
    return (
      <div className="rounded-2xl bg-elevated p-4 text-sm text-base-content/50">
        Your investigation results will appear here once the night resolves.
      </div>
    );
  }

  const sorted = [...results].sort((a, b) => b.nightNumber - a.nightNumber);
  const [latest, ...history] = sorted;

  return (
    <div className="flex flex-col gap-3">
      {latest && (
        <div
          className={[
            'flex flex-col items-center gap-1 rounded-2xl p-5 text-center',
            latest.isMafia ? 'bg-mafia-accent/15' : 'bg-village-accent/15',
          ].join(' ')}
          role="status"
          aria-live="polite"
        >
          <span className="text-sm text-base-content/60">{nameFor(players, latest.targetId)} is…</span>
          <span
            className={[
              'text-3xl font-black tracking-wide',
              latest.isMafia ? 'text-mafia-accent' : 'text-village-accent',
            ].join(' ')}
          >
            {latest.isMafia ? 'MAFIA' : 'NOT MAFIA'}
          </span>
        </div>
      )}

      {history.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/50">
            Investigation history
          </h3>
          <ul className="flex flex-col divide-y divide-base-content/10 rounded-2xl bg-elevated px-4">
            {history.map((r) => (
              <li key={`${r.targetId}-${r.nightNumber}`} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-base-content/70">
                  Night {r.nightNumber} · {nameFor(players, r.targetId)}
                </span>
                <span className={r.isMafia ? 'font-semibold text-mafia-accent' : 'font-semibold text-village-accent'}>
                  {r.isMafia ? 'Mafia' : 'Not mafia'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
