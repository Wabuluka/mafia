import { z } from 'zod';
import { GameEndReasonSchema, NightSubPhaseSchema, PhaseSchema, RoleSchema } from './enums';
import {
  ChatMessageSchema,
  NightActionSchema,
  NominationSchema,
  PendingNarrationSchema,
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
  /** Set once a phase has resolved but its narration hasn't been revealed
   * to players yet (see PendingNarrationSchema) — the human-moderator gate
   * every phase transition now passes through. `phase` above has ALREADY
   * advanced to the next phase by the time this is set; `phaseTimer` is
   * absent for that next phase until the host calls `startPhaseTimer`,
   * which only happens after `revealNarration` clears this field. */
  pendingNarration: PendingNarrationSchema.optional(),
  /** Which role is currently being prompted within an in-progress NIGHT —
   * see NightSubPhaseSchema. Absent outside NIGHT (cleared once NIGHT
   * resolves and `phase` moves to DAY_DISCUSSION), and always set the
   * instant `phase` becomes NIGHT (see realtime/handlers/startGame.ts and
   * phaseLoop.ts's advancePhase). Optional here (rather than required) so
   * old persisted/in-flight state predating this field still validates. Not
   * masked per-viewer in PlayerView below — see redact.ts's doc comment on
   * why a role NAME (not tied to a player id) isn't sensitive here. */
  nightSubPhase: NightSubPhaseSchema.optional(),
  nightActions: z.array(NightActionSchema),
  votes: z.array(VoteSchema),
  /** This round's public suspect nominations — see NominationSchema and
   * engine/nominations.ts. Submitted only during DAY_DISCUSSION, which no
   * longer has free-text chat at all (see sendChat.ts's DAY-channel
   * rejection) — nominating is the whole of that phase's interaction. */
  nominations: z.array(NominationSchema),
  /** The set of player ids who received at least one nomination this
   * round, computed once by engine/nominations.ts's resolveNominations
   * when DAY_DISCUSSION resolves — the ONLY valid DAY_VOTE targets for
   * the day (see engine/voting.ts's castVote). Guaranteed non-empty
   * whenever DAY_VOTE is reachable: resolveNominations falls back to
   * every living player if nobody nominated anyone, so an empty array
   * here means "no round has resolved yet this game" (pre-game/mid-
   * discussion), not "nobody is a valid target." Reset to `[]` at the
   * start of each new day (see phaseLoop.ts's NIGHT -> DAY_DISCUSSION
   * entry), so a stale prior day's shortlist can never leak into a new
   * round's DAY_VOTE. */
  shortlistedIds: z.array(PlayerIdSchema),
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
  /** Absent while the village is still in the LOBBY (roles aren't assigned
   * until the host starts the game) — and PERMANENTLY absent for the
   * moderator (`isModerator: true` below), who never receives a role at
   * all. Use `isModerator`, not `role === undefined`, to distinguish "I am
   * the moderator" from "roles haven't been assigned yet" — the two cases
   * look identical if you only check for a missing role. */
  role: RoleSchema.optional(),
  /** True for the village's moderator/host — a pure spectator/moderator
   * who never receives a role, acts, votes, nominates, or is targetable/
   * counted in win math (see Player.participatesInGame in entities.ts).
   * The explicit signal the frontend should key off of, instead of
   * inferring "am I the moderator" from `role` being absent. */
  isModerator: z.boolean(),
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
  /** Populated only for a DEAD viewer, only during NIGHT — a count-only
   * "is anything actually happening" signal so a dead spectator isn't
   * staring at a screen that looks frozen for the whole phase. Contains NO
   * actor or target identities and never will: exposing WHO is acting on
   * WHOM to a dead player (who may be sitting at the same physical table
   * as living players) would let them relay that out-of-band, which no
   * other viewer — living or dead — can currently do either (see
   * engine/redact.ts's `buildYou`, where even a living non-participant
   * gets zero night-action data). This is deliberately the one exception
   * that widens visibility for the dead, and deliberately still narrow. */
  deadNightProgress: z
    .object({
      actedCount: z.number().int().nonnegative(),
      totalActingRoles: z.number().int().nonnegative(),
    })
    .optional(),
});
export type You = z.infer<typeof YouSchema>;

export const PlayerViewSchema = z.object({
  villageCode: VillageCodeSchema,
  /** The DB-side `games` document id for the CURRENT (or just-completed)
   * game — absent in LOBBY, before `startGame` has created that document.
   * Once GAME_OVER, this is what the client uses to fetch the full
   * role-reveal summary (`GET /api/games/:id/summary`) and the event
   * timeline (`GET /api/games/:id/events`) — see games.routes.ts. Not
   * sensitive on its own (an opaque id, not a role), so it's safe to
   * include for every viewer identically, unlike everything else this
   * function is careful to redact per-player. */
  gameId: z.string().optional(),
  phase: PhaseSchema,
  roundNumber: z.number().int().nonnegative(),
  /** Other players, with roles hidden unless revealed. */
  players: z.array(PublicPlayerSchema),
  phaseTimer: PhaseTimerSchema.optional(),
  /** Identical for every viewer — nothing in a pending narration is
   * per-player private information (it's the same text about to be shown
   * to everyone), so it passes through PlayerView unfiltered, same as
   * `phaseTimer`. See FullGameStateSchema's field for the full contract. */
  pendingNarration: PendingNarrationSchema.optional(),
  /** See FullGameStateSchema's field of the same name — sent unredacted to
   * every viewer, host and non-host alike (a role name isn't tied to a
   * player id, so it doesn't reveal who holds which role). */
  nightSubPhase: NightSubPhaseSchema.optional(),
  /** Only the chat channels this recipient is entitled to see. */
  chatLog: z.array(ChatMessageSchema),
  /** Public vote tally for the current day, if in a voting phase. */
  votes: z.array(VoteSchema.omit({ voterId: true }).extend({ voterId: PlayerIdSchema })),
  /** Public nomination tally for the current day's DAY_DISCUSSION — sent
   * unconditionally to every viewer, living or dead, unlike the mafia's
   * private night tally (`you.mafiaNightTargets`): nominating is a public
   * act the instant it's cast, same as a vote already is, so there is no
   * per-viewer redaction to apply here. See FullGameStateSchema's field
   * of the same name. */
  nominations: z.array(NominationSchema.omit({ nominatorId: true }).extend({ nominatorId: PlayerIdSchema })),
  /** See FullGameStateSchema's field of the same name — the shortlist of
   * valid DAY_VOTE targets, passed through unredacted for every viewer
   * (a set of player ids, not per-viewer-sensitive). */
  shortlistedIds: z.array(PlayerIdSchema),
  endReason: GameEndReasonSchema.optional(),
  winningTeam: z.string().optional(),
  you: YouSchema,
});
export type PlayerView = z.infer<typeof PlayerViewSchema>;
