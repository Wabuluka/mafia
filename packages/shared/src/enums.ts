import { z } from 'zod';

// ---------------------------------------------------------------------------
// Core enums / unions. These are the vocabulary every other file builds on.
// ---------------------------------------------------------------------------

/** Which faction a role belongs to. Drives win-condition checks. */
export const TeamSchema = z.enum(['TOWN', 'MAFIA', 'NEUTRAL']);
export type Team = z.infer<typeof TeamSchema>;

/**
 * All roles playable in the base game. Adding a role means also updating
 * `ROLE_TEAM` and `DEFAULT_ROLE_DISTRIBUTION` in constants.ts.
 */
export const RoleSchema = z.enum([
  'VILLAGER',
  'MAFIA',
  'DETECTIVE',
  'DOCTOR',
  'JESTER',
]);
export type Role = z.infer<typeof RoleSchema>;

/** The game's top-level phase machine. */
export const PhaseSchema = z.enum([
  'LOBBY',
  'NIGHT',
  'DAY_DISCUSSION',
  'DAY_VOTE',
  'GAME_OVER',
]);
export type Phase = z.infer<typeof PhaseSchema>;

/**
 * A player's life status within a game. Connection state is tracked
 * separately on `Player.connected` since the two are orthogonal — a
 * disconnected player can still be alive and rejoin.
 */
export const PlayerStatusSchema = z.enum(['ALIVE', 'DEAD']);
export type PlayerStatus = z.infer<typeof PlayerStatusSchema>;

/** Why a game ended, used to drive the end-game summary screen. */
export const GameEndReasonSchema = z.enum([
  'TOWN_WIN',
  'MAFIA_WIN',
  'JESTER_WIN',
  'DRAW',
  'ABANDONED',
]);
export type GameEndReason = z.infer<typeof GameEndReasonSchema>;
