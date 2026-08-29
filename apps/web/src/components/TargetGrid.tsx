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
//
// MEMOIZED PER TILE (see the Prompt 14 re-render audit, and PlayerTile's
// own module header for the measured before/after numbers on the same
// pattern in VotingPhase.tsx): each tile is wrapped in a TargetTile that
// only re-renders when ITS OWN fields actually changed, using a CUSTOM
// comparator rather than memo()'s default shallow-props check — both
// `players` (built fresh by NightPhase.tsx's buildTargetGridPlayers on
// every render) and each individual player object within it are NOT
// referentially stable across renders, so a default shallow comparison
// would never actually skip a re-render here.
// ---------------------------------------------------------------------------

import { memo, useCallback, useRef } from 'react';
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
  // Mirrors stagedTargetId so the shared toggle callback below can read
  // the CURRENT value without needing it in a dependency array — see
  // VotingPhase.tsx's identical stagedRef pattern for the full rationale:
  // this is what lets ONE callback serve every tile without being rebuilt
  // (and handed to every tile as a new reference) on every selection
  // change.
  const stagedRef = useRef(stagedTargetId);
  stagedRef.current = stagedTargetId;

  const toggleTarget = useCallback(
    (playerId: PlayerId) => {
      onStage(stagedRef.current === playerId ? null : playerId);
    },
    [onStage],
  );

  return (
    <div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(5.5rem, 1fr))' }}>
        {players.map((p) => {
          const isTargetable = p.status === 'ALIVE' && !p.isSelf && !p.disabledReason;
          return (
            <div key={p.id} className="flex flex-col items-center gap-1">
              <TargetTile
                player={p}
                isTargetable={isTargetable}
                selected={stagedTargetId === p.id}
                disabled={disabled}
                onToggle={toggleTarget}
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

interface TargetTileProps {
  player: TargetGridPlayer;
  isTargetable: boolean;
  selected: boolean;
  disabled: boolean;
  onToggle: (playerId: PlayerId) => void;
}

function TargetTileImpl({ player, isTargetable, selected, disabled, onToggle }: TargetTileProps) {
  const handleSelect = useCallback(() => {
    onToggle(player.id);
  }, [onToggle, player.id]);

  return (
    <PlayerTile
      playerId={player.id}
      name={player.name}
      alive={player.status === 'ALIVE'}
      isSelf={player.isSelf}
      connected={player.connected}
      accent={player.accent}
      cornerLabel={player.cornerLabel}
      selected={selected}
      disabled={disabled || !isTargetable}
      onSelect={isTargetable ? handleSelect : undefined}
    />
  );
}

/** See TargetGrid's own module header on why a custom comparator, not
 * memo()'s default, is what actually makes this memoization real. */
const TargetTile = memo(TargetTileImpl, (prev, next) => {
  return (
    prev.player.id === next.player.id &&
    prev.player.name === next.player.name &&
    prev.player.status === next.player.status &&
    prev.player.connected === next.player.connected &&
    prev.player.isSelf === next.player.isSelf &&
    prev.player.accent === next.player.accent &&
    prev.player.cornerLabel === next.player.cornerLabel &&
    prev.isTargetable === next.isTargetable &&
    prev.selected === next.selected &&
    prev.disabled === next.disabled &&
    prev.onToggle === next.onToggle
  );
});
