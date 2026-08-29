'use client';

// ---------------------------------------------------------------------------
// HostControlsModal — the host-only bottom sheet for adjusting phase
// durations and removing a player. All of it is a thin UI over the
// updateVillageSettings / kickPlayer socket events; server-side authorization
// (host-only, lobby-only) is the actual enforcement — this modal simply
// isn't rendered/reachable for a non-host, and every action still goes
// through the normal ack/error path if it somehow were.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import {
  DEFAULT_PHASE_DURATIONS_MS,
  type JoinRequest,
  type PlayerId,
  type PublicPlayer,
  type VillageCode,
} from '@mafia/shared';
import { ActionButton } from '@/components/ActionBar';
import { Modal } from '@/components/Modal';
import { useSocket } from '@/lib/socket-context';
import { useToast } from '@/components/Toast';

export interface HostControlsModalProps {
  open: boolean;
  onClose: () => void;
  villageCode: VillageCode;
  players: PublicPlayer[];
  selfPlayerId: PlayerId;
  currentDurationsMs: { NIGHT: number; DAY_DISCUSSION: number; DAY_VOTE: number };
  /** Players currently waiting on approval — see useJoinRequests.ts. Empty
   * for the entire life of a lobby that never used a shared code (e.g.
   * still possible via a stale prop during a fast unmount), which just
   * renders as "no pending requests" rather than needing its own loading
   * state — the list is always either accurate or empty, never partial. */
  joinRequests: JoinRequest[];
}

const DURATION_STEPS_S = [15, 30, 45, 60, 90, 120, 150, 180];

function DurationRow({
  label,
  valueMs,
  onChange,
}: {
  label: string;
  valueMs: number;
  onChange: (nextMs: number) => void;
}) {
  const valueS = Math.round(valueMs / 1000);
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-base-content/80">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label} duration`}
          onClick={() => {
            const idx = DURATION_STEPS_S.indexOf(valueS);
            const prev = DURATION_STEPS_S[Math.max(0, (idx === -1 ? 0 : idx) - 1)]!;
            onChange(prev * 1000);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-base-content/5 text-lg active:bg-base-content/10"
        >
          −
        </button>
        <span className="w-14 text-center tabular-nums">{valueS}s</span>
        <button
          type="button"
          aria-label={`Increase ${label} duration`}
          onClick={() => {
            const idx = DURATION_STEPS_S.indexOf(valueS);
            const next = DURATION_STEPS_S[Math.min(DURATION_STEPS_S.length - 1, (idx === -1 ? 0 : idx) + 1)]!;
            onChange(next * 1000);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-base-content/5 text-lg active:bg-base-content/10"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function HostControlsModal({
  open,
  onClose,
  villageCode,
  players,
  selfPlayerId,
  currentDurationsMs,
  joinRequests,
}: HostControlsModalProps) {
  const { emit } = useSocket();
  const toast = useToast();
  const [durations, setDurations] = useState(currentDurationsMs);
  const [kickingId, setKickingId] = useState<PlayerId | null>(null);
  const [respondingId, setRespondingId] = useState<PlayerId | null>(null);

  async function handleRespond(playerId: PlayerId, name: string, accept: boolean) {
    setRespondingId(playerId);
    const result = await emit.respondToJoinRequest({ villageCode, targetPlayerId: playerId, accept });
    setRespondingId(null);
    if (!result.ok) {
      toast.show(result.error.message, { tone: 'danger' });
    } else if (accept) {
      toast.show(`${name} was let in.`, { tone: 'success' });
    } else {
      toast.show(`${name}'s request was denied.`);
    }
  }

  async function applyDurations() {
    const result = await emit.updateVillageSettings({ villageCode, phaseDurationsMs: durations });
    if (result.ok) {
      toast.show('Phase durations updated.', { tone: 'success' });
    } else {
      toast.show(result.error.message, { tone: 'danger' });
      setDurations(currentDurationsMs); // roll back the optimistic local edit
    }
  }

  async function handleKick(playerId: PlayerId, name: string) {
    setKickingId(playerId);
    const result = await emit.kickPlayer({ villageCode, targetPlayerId: playerId });
    setKickingId(null);
    if (result.ok) {
      toast.show(`${name} was removed from the village.`);
    } else {
      toast.show(result.error.message, { tone: 'danger' });
    }
  }

  const kickablePlayers = players.filter((p) => p.id !== selfPlayerId);

  return (
    <Modal open={open} onClose={onClose} title="Host controls">
      <div className="flex flex-col gap-6">
        {joinRequests.length > 0 && (
          <section>
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-base-content/50">
              Requesting to join
            </h3>
            <ul className="flex flex-col divide-y divide-base-content/10">
              {joinRequests.map((r) => (
                <li key={r.playerId} className="flex items-center justify-between gap-2 py-2.5">
                  <span className="truncate">{r.playerName}</span>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => handleRespond(r.playerId, r.playerName, false)}
                      disabled={respondingId === r.playerId}
                      className="min-h-9 rounded-lg bg-base-content/5 px-3 text-sm font-semibold active:bg-base-content/10 disabled:opacity-40"
                    >
                      Deny
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRespond(r.playerId, r.playerName, true)}
                      disabled={respondingId === r.playerId}
                      className="min-h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-content active:opacity-90 disabled:opacity-40"
                    >
                      Accept
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-base-content/50">
            Phase durations
          </h3>
          <DurationRow
            label="Night"
            valueMs={durations.NIGHT}
            onChange={(ms) => setDurations((d) => ({ ...d, NIGHT: ms }))}
          />
          <DurationRow
            label="Discussion"
            valueMs={durations.DAY_DISCUSSION}
            onChange={(ms) => setDurations((d) => ({ ...d, DAY_DISCUSSION: ms }))}
          />
          <DurationRow
            label="Voting"
            valueMs={durations.DAY_VOTE}
            onChange={(ms) => setDurations((d) => ({ ...d, DAY_VOTE: ms }))}
          />
          <ActionButton
            variant="neutral"
            onClick={applyDurations}
            disabled={
              durations.NIGHT === currentDurationsMs.NIGHT &&
              durations.DAY_DISCUSSION === currentDurationsMs.DAY_DISCUSSION &&
              durations.DAY_VOTE === currentDurationsMs.DAY_VOTE
            }
          >
            Save durations
          </ActionButton>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-base-content/50">
            Players
          </h3>
          {kickablePlayers.length === 0 ? (
            <p className="text-sm text-base-content/50">No other players yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-base-content/10">
              {kickablePlayers.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2.5">
                  <span>{p.name}</span>
                  <button
                    type="button"
                    onClick={() => handleKick(p.id, p.name)}
                    disabled={kickingId === p.id}
                    className="min-h-9 rounded-lg bg-danger/15 px-3 text-sm font-semibold text-danger active:bg-danger/25 disabled:opacity-40"
                  >
                    {kickingId === p.id ? 'Removing…' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

// Exposed so the lobby page can seed HostControlsModal's initial duration
// state without importing DEFAULT_PHASE_DURATIONS_MS directly everywhere.
export const DEFAULT_LOBBY_DURATIONS_MS = {
  NIGHT: DEFAULT_PHASE_DURATIONS_MS.NIGHT,
  DAY_DISCUSSION: DEFAULT_PHASE_DURATIONS_MS.DAY_DISCUSSION,
  DAY_VOTE: DEFAULT_PHASE_DURATIONS_MS.DAY_VOTE,
};
