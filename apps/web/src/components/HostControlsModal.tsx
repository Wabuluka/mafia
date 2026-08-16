'use client';

// ---------------------------------------------------------------------------
// HostControlsModal — the host-only bottom sheet for adjusting phase
// durations and removing a player. All of it is a thin UI over the
// updateRoomSettings / kickPlayer socket events; server-side authorization
// (host-only, lobby-only) is the actual enforcement — this modal simply
// isn't rendered/reachable for a non-host, and every action still goes
// through the normal ack/error path if it somehow were.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { DEFAULT_PHASE_DURATIONS_MS, type PlayerId, type PublicPlayer, type RoomCode } from '@mafia/shared';
import { ActionButton } from '@/components/ActionBar';
import { Modal } from '@/components/Modal';
import { useSocket } from '@/lib/socket-context';
import { useToast } from '@/components/Toast';

export interface HostControlsModalProps {
  open: boolean;
  onClose: () => void;
  roomCode: RoomCode;
  players: PublicPlayer[];
  selfPlayerId: PlayerId;
  currentDurationsMs: { NIGHT: number; DAY_DISCUSSION: number; DAY_VOTE: number };
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
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-lg active:bg-white/10"
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
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-lg active:bg-white/10"
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
  roomCode,
  players,
  selfPlayerId,
  currentDurationsMs,
}: HostControlsModalProps) {
  const { emit } = useSocket();
  const toast = useToast();
  const [durations, setDurations] = useState(currentDurationsMs);
  const [kickingId, setKickingId] = useState<PlayerId | null>(null);

  async function applyDurations() {
    const result = await emit.updateRoomSettings({ roomCode, phaseDurationsMs: durations });
    if (result.ok) {
      toast.show('Phase durations updated.', { tone: 'success' });
    } else {
      toast.show(result.error.message, { tone: 'danger' });
      setDurations(currentDurationsMs); // roll back the optimistic local edit
    }
  }

  async function handleKick(playerId: PlayerId, name: string) {
    setKickingId(playerId);
    const result = await emit.kickPlayer({ roomCode, targetPlayerId: playerId });
    setKickingId(null);
    if (result.ok) {
      toast.show(`${name} was removed from the room.`);
    } else {
      toast.show(result.error.message, { tone: 'danger' });
    }
  }

  const kickablePlayers = players.filter((p) => p.id !== selfPlayerId);

  return (
    <Modal open={open} onClose={onClose} title="Host controls">
      <div className="flex flex-col gap-6">
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
            <ul className="flex flex-col divide-y divide-white/5">
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
