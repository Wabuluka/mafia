'use client';

// ---------------------------------------------------------------------------
// TargetGrid — the shared "pick one living player" grid used by every
// night-acting role (mafia, detective, doctor). Tap-to-select only stages a
// choice locally; nothing is sent to the server until the caller's confirm
// button (in the bottom ActionBar) is pressed — this is the mechanism that
// makes a one-tap accidental commit impossible: tapping a tile can only
// ever change which tile is highlighted, never submit anything by itself.
//
// This component has no idea what "confirm" does (submit a kill, an
// investigation, a protection) — it only reports which target is currently
// staged via `onStagedChange` and lets the caller decide what a confirm
// button does with that value. Optimistic UI / rollback also lives with
// the caller (see NightPhase.tsx), since only the caller knows what
// "rejected" means for its specific action.
// ---------------------------------------------------------------------------

import type { PlayerId, PublicPlayer } from '@mafia/shared';
import { PlayerTile } from './PlayerTile';

export interface TargetGridPlayer extends PublicPlayer {
  /** True for the local player's own tile — shown but never selectable as
   * a target (no role in this game targets itself). */
  isSelf?: boolean;
  /** Marks this player with the shared "your teammate" ring — mafia only. */
  accent?: 'mafia' | null;
  /** Small text badge — e.g. "Protected last night" (doctor lockout). */
  cornerLabel?: string;
  /** Disables this tile independent of `alive` — e.g. the doctor's
   * no-repeat-protection lockout on a specific living player. */
  disabledReason?: string;
}

export interface TargetGridProps {
  players: TargetGridPlayer[];
  stagedTargetId: PlayerId | null;
  onStage: (playerId: PlayerId | null) => void;
  disabled?: boolean;
}

export function TargetGrid({ players, stagedTargetId, onStage, disabled = false }: TargetGridProps) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {players.map((p) => {
          const isTargetable = p.status === 'ALIVE' && !p.isSelf && !p.disabledReason;
          return (
            <div key={p.id} className="flex flex-col items-center gap-1">
              <PlayerTile
                playerId={p.id}
                name={p.name}
                alive={p.status === 'ALIVE'}
                isSelf={p.isSelf}
                connected={p.connected}
                accent={p.accent}
                cornerLabel={p.cornerLabel}
                selected={stagedTargetId === p.id}
                disabled={disabled || !isTargetable}
                onSelect={
                  isTargetable ? () => onStage(stagedTargetId === p.id ? null : p.id) : undefined
                }
              />
              {p.disabledReason && (
                <span className="text-center text-[0.6875rem] leading-tight text-base-content/40">
                  {p.disabledReason}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
