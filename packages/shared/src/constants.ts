import type { Phase, Role, Team } from './enums';

// ---------------------------------------------------------------------------
// Player count limits
// ---------------------------------------------------------------------------

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 15;

// ---------------------------------------------------------------------------
// Room code format — 4 uppercase alphanumeric characters, matching
// RoomCodeSchema's regex in entities.ts. Kept here as the single source for
// generating codes; entities.ts is the single source for validating them.
// Excludes 0/O and 1/I so a code is never ambiguous when read aloud or
// handwritten.
// ---------------------------------------------------------------------------

export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

// ---------------------------------------------------------------------------
// Role -> team mapping. The single source of truth for win-condition checks.
// ---------------------------------------------------------------------------

export const ROLE_TEAM: Readonly<Record<Role, Team>> = {
  VILLAGER: 'TOWN',
  DETECTIVE: 'TOWN',
  DOCTOR: 'TOWN',
  MAFIA: 'MAFIA',
  JESTER: 'NEUTRAL',
};

// ---------------------------------------------------------------------------
// Role distribution table — for a given player count, how many of each
// special role are included. Any players not accounted for fill in as
// VILLAGER. Player counts not listed fall back to the nearest lower entry.
// ---------------------------------------------------------------------------

export type RoleDistribution = Readonly<Partial<Record<Role, number>>>;

export const DEFAULT_ROLE_DISTRIBUTION: Readonly<Record<number, RoleDistribution>> = {
  5: { MAFIA: 1, DETECTIVE: 1, DOCTOR: 1 },
  6: { MAFIA: 1, DETECTIVE: 1, DOCTOR: 1 },
  7: { MAFIA: 2, DETECTIVE: 1, DOCTOR: 1 },
  8: { MAFIA: 2, DETECTIVE: 1, DOCTOR: 1, JESTER: 1 },
  9: { MAFIA: 2, DETECTIVE: 1, DOCTOR: 1, JESTER: 1 },
  10: { MAFIA: 3, DETECTIVE: 1, DOCTOR: 1, JESTER: 1 },
  11: { MAFIA: 3, DETECTIVE: 1, DOCTOR: 1, JESTER: 1 },
  12: { MAFIA: 3, DETECTIVE: 1, DOCTOR: 1, JESTER: 1 },
  13: { MAFIA: 4, DETECTIVE: 1, DOCTOR: 1, JESTER: 1 },
  14: { MAFIA: 4, DETECTIVE: 1, DOCTOR: 1, JESTER: 1 },
  15: { MAFIA: 4, DETECTIVE: 1, DOCTOR: 1, JESTER: 1 },
};

/** Resolves the distribution table for a player count not listed exactly. */
export function resolveRoleDistribution(playerCount: number): RoleDistribution {
  const keys = Object.keys(DEFAULT_ROLE_DISTRIBUTION)
    .map(Number)
    .sort((a, b) => a - b);

  let chosen: number | undefined;
  for (const key of keys) {
    if (key <= playerCount) chosen = key;
  }
  chosen ??= keys[0];

  const distribution = chosen === undefined ? undefined : DEFAULT_ROLE_DISTRIBUTION[chosen];
  if (!distribution) {
    throw new Error('DEFAULT_ROLE_DISTRIBUTION must not be empty');
  }
  return distribution;
}

// ---------------------------------------------------------------------------
// Default phase durations (milliseconds)
// ---------------------------------------------------------------------------

export const DEFAULT_PHASE_DURATIONS_MS: Readonly<Record<Phase, number>> = {
  LOBBY: 0, // advanced manually by host, not on a timer
  NIGHT: 45_000,
  DAY_DISCUSSION: 90_000,
  DAY_VOTE: 45_000,
  GAME_OVER: 0,
};
