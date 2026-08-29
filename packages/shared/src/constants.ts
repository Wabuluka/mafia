import type { Phase, Role, Team } from './enums';

// ---------------------------------------------------------------------------
// Player count limits — count NON-MODERATOR participants only (players
// with `participatesInGame: true`, see entities.ts's Player schema). The
// moderator/host never receives a role and is not counted here, so the
// practical minimum village size is MIN_PLAYERS + 1 humans (participants
// plus the moderator). Lowered from 5 to 4 specifically to keep that total
// at 5 — the same practical minimum as before the moderator became a pure
// non-playing role, rather than silently requiring a 6th person to start.
// ---------------------------------------------------------------------------

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 15;

// ---------------------------------------------------------------------------
// Village code format — 4 uppercase alphanumeric characters, matching
// VillageCodeSchema's regex in entities.ts. Kept here as the single source for
// generating codes; entities.ts is the single source for validating them.
// Excludes 0/O and 1/I so a code is never ambiguous when read aloud or
// handwritten.
// ---------------------------------------------------------------------------

export const VILLAGE_CODE_LENGTH = 4;
export const VILLAGE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

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
// Role -> user-facing display label. The VILLAGER role's wire/enum value is
// intentionally left unchanged (see the room->village rename note in
// events.ts) to avoid a breaking change to the `Role` enum stored in
// MongoDB documents (games.repository, game-events) and sent over the wire
// — renaming the enum value would require a data migration for any
// persisted game/event documents. Only the copy shown to players changes:
// every UI surface that renders a role name to a human MUST go through this
// map (or `roleLabel` below) rather than rendering the raw enum value, so
// "Villager" never leaks into the UI.
// ---------------------------------------------------------------------------

export const ROLE_DISPLAY_LABEL: Readonly<Record<Role, string>> = {
  VILLAGER: 'Resident',
  DETECTIVE: 'Detective',
  DOCTOR: 'Doctor',
  MAFIA: 'Mafia',
  JESTER: 'Jester',
};

/** Convenience accessor for `ROLE_DISPLAY_LABEL` — prefer this in UI code
 * over indexing the map directly, so a future non-enum-keyed lookup (e.g.
 * custom roles) has one call site to change. */
export function roleLabel(role: Role): string {
  return ROLE_DISPLAY_LABEL[role];
}

// ---------------------------------------------------------------------------
// Role distribution table — for a given player count, how many of each
// special role are included. Any players not accounted for fill in as
// VILLAGER. Player counts not listed fall back to the nearest lower entry.
// ---------------------------------------------------------------------------

export type RoleDistribution = Readonly<Partial<Record<Role, number>>>;

export const DEFAULT_ROLE_DISTRIBUTION: Readonly<Record<number, RoleDistribution>> = {
  4: { MAFIA: 1, DETECTIVE: 1, DOCTOR: 1 },
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
