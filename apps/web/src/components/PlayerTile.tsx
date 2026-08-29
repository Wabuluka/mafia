'use client';

// ---------------------------------------------------------------------------
// PlayerTile — a single player's avatar/name/status, used everywhere the
// roster is shown (lobby, voting grid, night-action target picker). No game
// logic: this component only renders the props it's given and reports taps
// back up via `onSelect` — selection *meaning* (who can select whom, what
// happens on select) is entirely the caller's concern.
//
// MEMOIZED (React.memo, see the bottom of this file) — measured before
// fixing (Prompt 14's re-render audit): a single vote-cast event
// previously re-rendered EVERY tile in a 12-player grid (96 renders across
// an 8-vote burst — 1.00 renders/tile/event, i.e. 100% of tiles re-rendered
// on every single unrelated vote). memo() alone isn't sufficient, though —
// it only helps if the PROPS passed in are actually referentially stable
// across the parent's re-renders. See VotingPhase.tsx / TargetGrid.tsx for
// the other half of this fix: passing a stable `onSelect` callback (one
// per player id, memoized) instead of a fresh arrow function created
// inline on every parent render, which would otherwise make every tile's
// props "different" by reference on every render and defeat memo()
// entirely.
// ---------------------------------------------------------------------------

import { memo, useMemo } from 'react';

export interface PlayerTileProps {
  name: string;
  /** Rendered as the avatar's initial(s) and used to derive a stable
   * per-player accent hue, so the same player always gets the same color
   * across renders/reconnects without needing a real avatar image. */
  playerId: string;
  alive: boolean;
  /** Shows a small host badge. Purely cosmetic. */
  isHost?: boolean;
  /** Shows a "you" indicator distinguishing the local player's own tile. */
  isSelf?: boolean;
  /** Whether this tile is currently the selected target (e.g. of a vote or
   * a night action). Controlled entirely by the caller. */
  selected?: boolean;
  /** Omit to render a non-interactive tile (e.g. read-only roster view). */
  onSelect?: () => void;
  /** Disables interaction without hiding the tile — e.g. "can't target a
   * dead player" while still showing them in the grid. */
  disabled?: boolean;
  /** Small connectivity dot; distinct from `alive` (a disconnected player
   * is not the same as a dead one — see the realtime layer's disconnect
   * handling, which never conflates the two). */
  connected?: boolean;
  /** A colored ring + small corner marker for a caller-defined "this
   * player is special to you right now" signal — e.g. a mafia player's
   * own teammates during the night phase. Deliberately generic (not named
   * "isMafiaTeammate") so this component stays presentation-only and
   * doesn't need to know what the marking means; the caller decides. */
  accent?: 'mafia' | null;
  /** Small text badge in the tile's corner, distinct from the isHost/dead
   * badges — used for e.g. "protected" (doctor) or "investigated"
   * (detective) history markers. */
  cornerLabel?: string;
}

const AVATAR_HUES = [12, 28, 45, 96, 152, 176, 200, 224, 258, 292, 320, 344];

/** Deterministic hue from a player id, so avatar colors are stable across
 * re-renders and reconnects without any server-assigned color field. */
function hueForPlayerId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_HUES[hash % AVATAR_HUES.length]!;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function PlayerTileImpl({
  name,
  playerId,
  alive,
  isHost = false,
  isSelf = false,
  selected = false,
  onSelect,
  disabled = false,
  connected = true,
  accent = null,
  cornerLabel,
}: PlayerTileProps) {
  const hue = useMemo(() => hueForPlayerId(playerId), [playerId]);
  const interactive = Boolean(onSelect) && !disabled;

  const Tag = interactive ? 'button' : 'div';

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={interactive ? onSelect : undefined}
      disabled={interactive ? disabled : undefined}
      aria-pressed={interactive ? selected : undefined}
      className={[
        'group relative flex min-h-[4.5rem] flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition-[border-color,background-color,transform]',
        'motion-reduce:transition-none',
        selected
          ? 'border-primary bg-primary/10 shadow-[0_0_0_1px_theme(colors.primary)]'
          : accent === 'mafia'
            ? 'border-mafia-accent/40 bg-mafia-accent/5'
            : 'border-base-content/10 bg-elevated',
        interactive && !disabled ? 'active:scale-[0.97]' : '',
        disabled ? 'opacity-40' : '',
        !alive ? 'saturate-[0.35]' : '',
      ].join(' ')}
    >
      <div className="relative">
        <div
          className={[
            'flex h-12 w-12 items-center justify-center rounded-full text-base font-semibold',
            !alive ? 'grayscale' : '',
          ].join(' ')}
          style={{
            // Lightness comes from theme-scoped CSS custom properties (see
            // tailwind.config.ts's "--player-tile-bg-l"/"--player-tile-
            // text-l" on both themes), so the same inline style resolves
            // correctly whichever theme is active without this component
            // reading `data-theme` itself — avoids a runtime theme read in
            // a memo'd hot-path component (see this file's header on why
            // memoization matters here).
            backgroundColor: `hsl(${hue} 55% var(--player-tile-bg-l))`,
            color: `hsl(${hue} 70% var(--player-tile-text-l))`,
          }}
        >
          {initials(name)}
        </div>

        {/* Connectivity dot — bottom-right of the avatar, separate signal
         * from alive/dead (see the prop doc above). */}
        <span
          aria-hidden="true"
          className={[
            'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-elevated',
            connected ? 'bg-village-accent' : 'bg-base-content/25',
          ].join(' ')}
        />

        {!alive && (
          <div
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center rounded-full bg-surface/60"
          >
            <svg viewBox="0 0 20 20" className="h-6 w-6 text-danger" fill="currentColor">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        )}
      </div>

      <span className="line-clamp-1 max-w-full text-sm font-medium text-base-content">
        {name}
        {isSelf && <span className="text-secondary"> (you)</span>}
      </span>

      {isHost && (
        <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-1.5 py-0.5 text-[0.625rem] font-bold uppercase leading-none tracking-wide text-primary-content shadow-sm">
          Host
        </span>
      )}

      {!alive && (
        <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-danger px-1.5 py-0.5 text-[0.625rem] font-bold uppercase leading-none tracking-wide text-white shadow-sm">
          Dead
        </span>
      )}

      {cornerLabel && (
        <span className="rounded-full bg-base-content/10 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-base-content/70">
          {cornerLabel}
        </span>
      )}
    </Tag>
  );
}

/** `onSelect` is a function prop, which React.memo's default shallow
 * comparison DOES check by reference (not skipped) — so this memoization
 * only pays off if every call site passes a referentially stable callback
 * per player id, not a fresh closure created inline on every render. See
 * VotingPhase.tsx / TargetGrid.tsx for that half of the fix. */
export const PlayerTile = memo(PlayerTileImpl);
