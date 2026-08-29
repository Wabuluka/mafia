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
 * Sequential sub-steps within a single NIGHT phase, under the
 * moderator-driven night flow: mafia discuss and lock in a kill target,
 * then the moderator (host) explicitly prompts the detective, then the
 * doctor — see realtime/handlers/advanceNightSubPhase.ts. `COMPLETE` is a
 * terminal marker meaning every applicable role has had its turn and NIGHT
 * is ready to actually resolve (see engine/nightActions.ts's `resolveNight`
 * and phaseLoop.ts's `advancePhase`). The order here is also the fixed
 * moderator-prompt order — NOT necessarily the same as
 * `NIGHT_ACTING_ROLES`'s resolution order in nightActions.ts, which governs
 * how the doctor's save is applied against the mafia's kill, not who's
 * prompted first.
 */
export const NightSubPhaseSchema = z.enum(['MAFIA', 'DETECTIVE', 'DOCTOR', 'COMPLETE']);
export type NightSubPhase = z.infer<typeof NightSubPhaseSchema>;

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
