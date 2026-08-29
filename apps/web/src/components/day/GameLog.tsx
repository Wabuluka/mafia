'use client';

// ---------------------------------------------------------------------------
// GameLog — the persistent, one-tap-reachable recap of everything that's
// happened: phase transitions, deaths, eliminations. Reachable from a small
// header button (GameLogButton) present across every game screen — see
// DayPhase.tsx / NightPhase.tsx headers — since a player who glanced away
// for ten seconds on their phone has no other way to reconstruct what they
// missed.
// ---------------------------------------------------------------------------

import type { PublicPlayer } from '@mafia/shared';
import { Modal } from '@/components/Modal';
import { nameForOutcomePlayer, type GameLogEntry } from '@/lib/useGameLog';
import { PHASE_LABEL, ROLE_LABEL } from '@/lib/roleLabels';

export interface GameLogProps {
  open: boolean;
  onClose: () => void;
  entries: GameLogEntry[];
  players: PublicPlayer[];
}

function EntryIcon({ died, wasTie }: { died: boolean; wasTie: boolean }) {
  if (died) return <span aria-hidden="true">💀</span>;
  if (wasTie) return <span aria-hidden="true">🤝</span>;
  return <span aria-hidden="true">🌙</span>;
}

export function GameLog({ open, onClose, entries, players }: GameLogProps) {
  return (
    <Modal open={open} onClose={onClose} title="Game log">
      {entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-base-content/50">Nothing has happened yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {[...entries].reverse().map((entry) => (
            <li key={entry.id} className="flex gap-3 rounded-xl bg-elevated p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-content/5 text-lg">
                <EntryIcon died={entry.outcome.died.length > 0} wasTie={entry.outcome.wasTie} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs uppercase tracking-wide text-base-content/40">
                  Round {entry.roundNumber} · {PHASE_LABEL[entry.previousPhase] ?? entry.previousPhase}
                </span>
                <p className="text-sm text-base-content/80">{entry.narration}</p>
                {entry.outcome.died.map((d) => (
                  <p key={d.playerId} className="text-xs text-base-content/50">
                    {nameForOutcomePlayer(players, d.playerId)} was {ROLE_LABEL[d.role] ?? d.role}.
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

export function GameLogButton({ onClick, hasUnread = false }: { onClick: () => void; hasUnread?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open game log"
      className="relative flex h-9 w-9 items-center justify-center rounded-full bg-base-content/5 text-base active:bg-base-content/10"
    >
      <span aria-hidden="true">📜</span>
      {hasUnread && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger"
        />
      )}
    </button>
  );
}
