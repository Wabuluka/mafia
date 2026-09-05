'use client';

// ---------------------------------------------------------------------------
// ModeratorNightHistory — the host-only scrollback log of every resolved
// night: mafia's target, doctor's save (and whether it landed), the
// resulting death, and the detective's investigation result. Data comes
// from `view.you.moderatorNightView.history` (see redact.ts's
// `buildModeratorNightView`), which is populated ONLY for the host — a
// non-host PlayerView never carries this, so this component is only ever
// mounted behind an `isModerator` check by its caller (NightPhase.tsx).
// ---------------------------------------------------------------------------

import type { ModeratorNightHistoryEntry } from '@mafia/shared';
import { Modal } from '@/components/Modal';
import { ModeratorNightRecap } from '@/components/HostPhaseControls';

export interface ModeratorNightHistoryProps {
  open: boolean;
  onClose: () => void;
  entries: ModeratorNightHistoryEntry[];
}

export function ModeratorNightHistory({ open, onClose, entries }: ModeratorNightHistoryProps) {
  return (
    <Modal open={open} onClose={onClose} title="Night history">
      {entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-base-content/50">No night has resolved yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {[...entries].reverse().map((entry) => (
            <li key={entry.nightNumber} className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-base-content/40">Night {entry.nightNumber}</span>
              <ModeratorNightRecap entry={entry} />
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

export function ModeratorNightHistoryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open night history"
      className="relative flex h-9 w-9 items-center justify-center rounded-full bg-base-content/5 text-base active:bg-base-content/10"
    >
      <span aria-hidden="true">🗂️</span>
    </button>
  );
}
