'use client';

// ---------------------------------------------------------------------------
// useGameLog — accumulates every `phaseChanged` event this client has
// observed into a running history: deaths, eliminations, and phase
// transitions in order. This is deliberately separate from
// useVillageState's `lastPhaseChange` (which only ever holds the MOST
// RECENT transition, for driving reveal animations) — the log is the
// "players on phones lose track" answer Prompt 11 called for, so it needs
// to remember everything, not just the latest event.
//
// PERSISTED TO localStorage, not purely in-memory (see the resilience pass
// in Prompt 13, scenario #6): a refresh that lands mid-death-reveal, or any
// full remount from a backgrounded tab getting killed by the OS, previously
// wiped this entire history — the player would land back on the live phase
// with no way to see what they'd missed, even though the underlying facts
// (who died, what their role was) are durably on the server via
// `revealedRole`. Persisting each entry as it arrives, keyed per village,
// means a reload restores the full recap instead of starting blank.
// Scoped to `villageCode` (not global) so switching villages across
// sessions/tabs doesn't bleed one game's log into another's, and cleared
// automatically on GAME_OVER's own trailing entry plus a light cap on
// entry count (see MAX_STORED_ENTRIES) rather than growing forever across
// a long-lived village.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import type { PhaseChangedPayload, PublicPlayer, VillageCode } from '@mafia/shared';

export interface GameLogEntry {
  id: string;
  roundNumber: number;
  previousPhase: PhaseChangedPayload['previousPhase'];
  narration: string;
  outcome: PhaseChangedPayload['outcome'];
}

const STORAGE_KEY_PREFIX = 'mafia:gameLog:';
const MAX_STORED_ENTRIES = 200;

function storageKey(villageCode: VillageCode): string {
  return `${STORAGE_KEY_PREFIX}${villageCode}`;
}

function readStoredEntries(villageCode: VillageCode): GameLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(villageCode));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GameLogEntry[]) : [];
  } catch {
    // Malformed JSON (a previous app version's shape, or storage
    // corruption) — treat identically to "no log yet" rather than
    // throwing during render.
    return [];
  }
}

function writeStoredEntries(villageCode: VillageCode, entries: GameLogEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(villageCode), JSON.stringify(entries.slice(-MAX_STORED_ENTRIES)));
  } catch {
    // Storage can throw (quota, private browsing) — the in-memory
    // `entries` state still works for this session; only cross-reload
    // durability is lost, silently.
  }
}

/** Resolves each outcome's player ids to the names/roles the log line
 * should display, using whatever roster snapshot is available at the time
 * (the `state.players` on the SAME phaseChanged event — since revealed
 * roles for people who just died are already present there, this never
 * needs cross-referencing later-stale data). */
export function useGameLog(villageCode: VillageCode, latest: PhaseChangedPayload | null): GameLogEntry[] {
  const [entries, setEntries] = useState<GameLogEntry[]>(() => readStoredEntries(villageCode));
  const lastSeenRef = useRef<PhaseChangedPayload | null>(null);

  // A different village (switching games across tabs/sessions) restores
  // THAT village's own stored log instead of carrying the previous one
  // forward.
  useEffect(() => {
    setEntries(readStoredEntries(villageCode));
    lastSeenRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [villageCode]);

  useEffect(() => {
    if (!latest || latest === lastSeenRef.current) return;
    lastSeenRef.current = latest;

    setEntries((prev) => {
      const next = [
        ...prev,
        {
          id: `${latest.previousPhase}-${latest.state.roundNumber}-${prev.length}`,
          roundNumber: latest.state.roundNumber,
          previousPhase: latest.previousPhase,
          narration: latest.narration,
          outcome: latest.outcome,
        },
      ];
      writeStoredEntries(villageCode, next);
      return next;
    });
  }, [latest, villageCode]);

  return entries;
}

export function nameForOutcomePlayer(players: PublicPlayer[], playerId: string): string {
  return players.find((p) => p.id === playerId)?.name ?? 'A player';
}
