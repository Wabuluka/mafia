// ---------------------------------------------------------------------------
// Deterministic role assignment. Given the same players (in the same order)
// and the same seed, always produces the same assignment — this is what
// makes the engine's most consequential random step testable and, if ever
// needed, auditable/replayable from a stored seed.
// ---------------------------------------------------------------------------

import {
  resolveRoleDistribution,
  type Player,
  type Role,
  type RoleDistribution,
} from '@mafia/shared';
import { createRng, shuffle } from './rng';

export interface AssignRolesConfig {
  /** Any integer; the same seed always yields the same assignment. */
  seed: number;
  /** Overrides the shared default distribution table for this player count.
   * Falls back to `resolveRoleDistribution` when omitted. */
  distribution?: RoleDistribution;
}

/** A lobby-stage player: everything `Player` has except a role, since roles
 * don't exist until this function assigns them. */
export type UnassignedPlayer = Omit<Player, 'role' | 'revealedRole' | 'status'>;

/** A `Player` with `role` narrowed from optional to required — precisely
 * what `assignRoles` always produces, since it sets every player's role
 * unconditionally. Avoids callers/tests having to re-check `role` for
 * definedness on a value this function guarantees. */
export type AssignedPlayer = UnassignedPlayer & { role: Role; status: 'ALIVE' };

/**
 * Expands a distribution table entry (counts per special role) into a flat
 * role list matching `playerCount`, filling any remainder with VILLAGER.
 */
function expandDistribution(distribution: RoleDistribution, playerCount: number): Role[] {
  const roles: Role[] = [];
  for (const [role, count] of Object.entries(distribution) as Array<[Role, number]>) {
    for (let i = 0; i < count; i += 1) {
      roles.push(role);
    }
  }
  if (roles.length > playerCount) {
    throw new Error(
      `assignRoles: distribution requires ${roles.length} special roles but only ${playerCount} players were supplied`,
    );
  }
  while (roles.length < playerCount) {
    roles.push('VILLAGER');
  }
  return roles;
}

/**
 * Assigns one role to each player, deterministically shuffled by `seed`.
 * Pure: same input + same seed => byte-identical output, every time. All
 * non-role fields (name, isHost, joinedAt, ...) pass through unchanged from
 * the lobby roster; every player starts the game ALIVE.
 */
export function assignRoles(
  players: readonly UnassignedPlayer[],
  config: AssignRolesConfig,
): AssignedPlayer[] {
  if (players.length === 0) {
    throw new Error('assignRoles: players must not be empty');
  }

  const distribution = config.distribution ?? resolveRoleDistribution(players.length);
  const roles = expandDistribution(distribution, players.length);

  const rng = createRng(config.seed);
  const shuffledRoles = shuffle(roles, rng);

  return players.map((player, index) => {
    const role = shuffledRoles.at(index);
    if (!role) {
      throw new Error('assignRoles: role list shorter than player list — unreachable, both are length N');
    }
    return { ...player, role, status: 'ALIVE' as const };
  });
}
