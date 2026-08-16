import { z } from 'zod';
import { GameEndReasonSchema, PhaseSchema, RoleSchema } from './enums';
import {
  ChatMessageSchema,
  NightActionSchema,
  PhaseTimerSchema,
  PlayerIdSchema,
  PlayerSchema,
  VillageCodeSchema,
  VoteSchema,
} from './entities';

// ---------------------------------------------------------------------------
// FullGameState — the server's private truth. Contains every player's real
// role and the full night-action/vote history. MUST NEVER be sent to a
// client directly; use `toPlayerView` (server-side) to project it.
//
// It's branded with a non-exported symbol so a `PlayerView` can never be
// passed where a `FullGameState` is expected and vice versa — the two are
// structurally different anyway (PlayerView has no bare `role` field on
// other players), but the brand also blocks a `FullGameState`-shaped object
// built by hand (e.g. `as FullGameState`) from being handed to a socket
// `emit` typed to accept only `PlayerView`, unless it actually went through
// server-only construction code that stamps the brand.
// ---------------------------------------------------------------------------

declare const FULL_GAME_STATE_BRAND: unique symbol;

export const FullGameStateSchema = z.object({
  villageCode: VillageCodeSchema,
  phase: PhaseSchema,
  /** Incremented once per full night+day cycle. Starts at 0 in the lobby. */
  roundNumber: z.number().int().nonnegative(),
  players: z.array(PlayerSchema), // every player's `role` is always populated here
  phaseTimer: PhaseTimerSchema.optional(),
  nightActions: z.array(NightActionSchema),
  votes: z.array(VoteSchema),
  chatLog: z.array(ChatMessageSchema),
  endReason: GameEndReasonSchema.optional(),
  winningTeam: z.string().optional(),
});

/**
 * Runtime-branded FullGameState. `brand()` below is the only way to produce
 * one, so server code can't accidentally widen a plain object literal into
 * this type without going through the constructor.
 */
export type FullGameState = z.infer<typeof FullGameStateSchema> & {
  readonly [FULL_GAME_STATE_BRAND]: true;
};

/** The only sanctioned way to construct a `FullGameState`. Server-side only. */
export function brandFullGameState(
  state: z.infer<typeof FullGameStateSchema>,
): FullGameState {
  return state as FullGameState;
}

// ---------------------------------------------------------------------------
// PlayerView — what a single client receives over the wire. Other players'
// roles are omitted unless publicly revealed (death, etc). The recipient's
// own private knowledge lives under `you`.
// ---------------------------------------------------------------------------

/** A player as seen by *other* clients: no hidden role field. */
export const PublicPlayerSchema = PlayerSchema.omit({ role: true });
export type PublicPlayer = z.infer<typeof PublicPlayerSchema>;

/** Private knowledge the recipient has accumulated (detective results, etc). */
export const DetectiveResultSchema = z.object({
  targetId: PlayerIdSchema,
  /** Detectives learn team alignment, not the exact role, in this ruleset. */
  isMafia: z.boolean(),
  nightNumber: z.number().int().positive(),
});
export type DetectiveResult = z.infer<typeof DetectiveResultSchema>;

/** One mafia teammate's current-round night target, for the live tally
 * mafia players see while deliberating. `targetId` absent means that
 * teammate hasn't submitted a night action yet this round (not "chose no
 * target" — a night action always carries a target for MAFIA in the base
 * ruleset; absence here is purely "hasn't acted yet"). */
export const MafiaNightTargetSchema = z.object({
  actorId: PlayerIdSchema,
  targetId: PlayerIdSchema.optional(),
});
export type MafiaNightTarget = z.infer<typeof MafiaNightTargetSchema>;

export const YouSchema = z.object({
  playerId: PlayerIdSchema,
  /** Absent while the village is still in the LOBBY — roles aren't assigned
   * until the host starts the game, so there's nothing to report yet. */
  role: RoleSchema.optional(),
  /** Populated only for the MAFIA role — teammate ids for the mafia chat. */
  mafiaTeammateIds: z.array(PlayerIdSchema).optional(),
  /** Populated only for the MAFIA role, only during NIGHT — the live tally
   * of which teammates (including the viewer) have selected which target
   * so far this round. */
  mafiaNightTargets: z.array(MafiaNightTargetSchema).optional(),
  /** Populated only for the DETECTIVE role — accumulated investigation log. */
  detectiveResults: z.array(DetectiveResultSchema).optional(),
  /** Populated only for the DOCTOR role, only when they protected someone
   * on the IMMEDIATELY PRECEDING night — the engine's no-repeat-protection
   * rule (see engine/nightActions.ts's `wasProtectedLastNight`) blocks
   * protecting that exact player again this round. Absent means no
   * lockout is in effect (first night, or last night's protection went to
   * someone the doctor is now free to protect again). */
  lastProtectedPlayerId: PlayerIdSchema.optional(),
  /** Whether this player has already submitted an action/vote this phase. */
  hasActedThisPhase: z.boolean(),
});
export type You = z.infer<typeof YouSchema>;

export const PlayerViewSchema = z.object({
  villageCode: VillageCodeSchema,
  phase: PhaseSchema,
  roundNumber: z.number().int().nonnegative(),
  /** Other players, with roles hidden unless revealed. */
  players: z.array(PublicPlayerSchema),
  phaseTimer: PhaseTimerSchema.optional(),
  /** Only the chat channels this recipient is entitled to see. */
  chatLog: z.array(ChatMessageSchema),
  /** Public vote tally for the current day, if in a voting phase. */
  votes: z.array(VoteSchema.omit({ voterId: true }).extend({ voterId: PlayerIdSchema })),
  endReason: GameEndReasonSchema.optional(),
  winningTeam: z.string().optional(),
  you: YouSchema,
});
export type PlayerView = z.infer<typeof PlayerViewSchema>;
