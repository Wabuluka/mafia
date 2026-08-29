'use client';

// ---------------------------------------------------------------------------
// ConnectionIndicator — a small header-row pill surfacing connection trouble
// during live play. Mounted in the same header slot as IdentityBadge (see
// that component's header) in NightPhase/DiscussionPhase/VotingPhase — the
// three live screens that, until this component, gave a player NO signal at
// all if their connection dropped mid-phase (only the lobby showed
// "Connected"/"Reconnecting…" inline text; see lobby/[code]/page.tsx).
//
// RENDERS NOTHING WHEN CONNECTED, DELIBERATELY: this is a trouble indicator,
// not a status readout — the common case (connected) should add zero visual
// noise to an already-busy header row. It only appears once there's
// something worth telling the player.
//
// `superseded`/`shuttingDown` are NOT handled here — both already have
// dedicated full-screen overlays elsewhere (SessionSupersededOverlay,
// ServerShuttingDownOverlay) that take over the whole screen, so a small
// header pill would be redundant chrome underneath a modal the player can't
// interact past anyway.
// ---------------------------------------------------------------------------

import type { ConnectionStatus } from '@/lib/socket-context';

export interface ConnectionIndicatorProps {
  status: ConnectionStatus;
}

const LABEL: Partial<Record<ConnectionStatus, string>> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  disconnected: 'Offline',
};

export function ConnectionIndicator({ status }: ConnectionIndicatorProps) {
  const label = LABEL[status];
  if (!label) return null;

  return (
    <div
      className="flex items-center gap-1.5 rounded-full bg-danger/15 px-2.5 py-1 text-xs font-semibold text-danger"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-danger motion-safe:animate-ring-pulse" />
      {label}
    </div>
  );
}
