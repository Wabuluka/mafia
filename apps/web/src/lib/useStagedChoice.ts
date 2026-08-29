'use client';

// ---------------------------------------------------------------------------
// useStagedChoice — persists a tapped-but-not-yet-confirmed (or
// confirmed-but-ack-never-returned) target choice to localStorage, keyed to
// the exact round/phase it was made in. Plain React state alone loses this
// the moment the tab is killed — a force-quit between tapping a target and
// tapping Confirm, or a force-quit in the gap between tapping Confirm and
// the server's ack coming back, previously left no trace: on relaunch the
// player had no way to tell whether their night action/vote had landed,
// and had to re-derive their intent from memory.
//
// This does NOT replace the server's own idempotency (see
// realtime/idempotency.ts) or the "confirmed vote" reflected in
// `view.votes` / `view.you.hasActedThisPhase` — those remain the sole
// source of truth for whether an action actually landed. This hook only
// restores the player's LOCAL INTENT (what they had selected) so a relaunch
// mid-decision drops them back where they left off instead of a blank
// grid, and so a relaunch after a Confirm tap that never got an ack can
// immediately retry with the exact same choice rather than guessing again.
// Scoped per (villageCode, phase, roundNumber): a stale entry from a
// PREVIOUS round/phase is never restored — see `isStale` below — since a
// choice that belonged to a round that has already ended is not "still my
// intent", it's just leftover storage.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import type { Phase, VillageCode } from '@mafia/shared';

const STORAGE_KEY_PREFIX = 'mafia:stagedChoice:';

interface StoredChoice<T> {
  villageCode: VillageCode;
  phase: Phase;
  roundNumber: number;
  targetId: T;
}

function storageKey(villageCode: VillageCode): string {
  return `${STORAGE_KEY_PREFIX}${villageCode}`;
}

function readStoredChoice<T>(villageCode: VillageCode): StoredChoice<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(villageCode));
    if (!raw) return null;
    return JSON.parse(raw) as StoredChoice<T>;
  } catch {
    // Malformed JSON (a previous app version's shape, or storage
    // corruption) — treat identically to "nothing staged" rather than
    // throwing during render.
    return null;
  }
}

function isStale<T>(stored: StoredChoice<T> | null, phase: Phase, roundNumber: number): boolean {
  if (!stored) return true;
  return stored.phase !== phase || stored.roundNumber !== roundNumber;
}

/**
 * Mirrors a locally-staged target choice to localStorage, scoped to the
 * current (phase, roundNumber). Returns the restored value on first mount
 * (or `null` if nothing valid was stored for this exact phase/round) plus
 * a setter that keeps localStorage in sync on every change, and a
 * `clear()` for once the server has confirmed the choice landed (see the
 * module header — callers should clear once `hasActedThisPhase`/a
 * matching `view.votes` entry appears, not merely once a submit ack
 * returns ok, since only the SERVER's record is the actual source of truth).
 */
export function useStagedChoice<T extends string = string>(
  villageCode: VillageCode,
  phase: Phase,
  roundNumber: number,
): [T | null, (targetId: T | null) => void, () => void] {
  const [staged, setStaged] = useState<T | null>(() => {
    const stored = readStoredChoice<T>(villageCode);
    return isStale(stored, phase, roundNumber) ? null : stored?.targetId ?? null;
  });

  // A round/phase change invalidates whatever was staged for the PREVIOUS
  // one — re-read (and it'll come back null, since the stored entry no
  // longer matches) rather than carrying the old value forward.
  useEffect(() => {
    const stored = readStoredChoice<T>(villageCode);
    setStaged(isStale(stored, phase, roundNumber) ? null : stored?.targetId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [villageCode, phase, roundNumber]);

  const stage = useCallback(
    (targetId: T | null) => {
      setStaged(targetId);
      if (typeof window === 'undefined') return;
      try {
        if (targetId === null) {
          window.localStorage.removeItem(storageKey(villageCode));
        } else {
          const entry: StoredChoice<T> = { villageCode, phase, roundNumber, targetId };
          window.localStorage.setItem(storageKey(villageCode), JSON.stringify(entry));
        }
      } catch {
        // Storage can throw (quota, private browsing) — the in-memory
        // `staged` state above still works for this session; only
        // cross-reload durability is lost, silently.
      }
    },
    [villageCode, phase, roundNumber],
  );

  const clear = useCallback(() => {
    setStaged(null);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(storageKey(villageCode));
    } catch {
      // See stage()'s catch above.
    }
  }, [villageCode]);

  return [staged, stage, clear];
}
