import { z } from 'zod';
import { PhaseSchema, PlayerStatusSchema, RoleSchema } from './enums';

// ---------------------------------------------------------------------------
// Primitive id brands — prevents e.g. passing a villageCode where a playerId
// is expected, since both are plain strings underneath.
// ---------------------------------------------------------------------------

export const PlayerIdSchema = z.string().uuid().brand<'PlayerId'>();
export type PlayerId = z.infer<typeof PlayerIdSchema>;

export const VillageCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{4}$/, 'Village code must be 4 uppercase alphanumeric characters')
  .brand<'VillageCode'>();
export type VillageCode = z.infer<typeof VillageCodeSchema>;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export const PlayerSchema = z.object({
  id: PlayerIdSchema,
  name: z.string().min(1).max(24),
  /** Present only where the schema/context allows role visibility. Always
   * absent for the host/moderator (`isHost: true`) — see that field's doc
   * comment; not merely "not yet assigned". */
  role: RoleSchema.optional(),
  status: PlayerStatusSchema,
  connected: z.boolean(),
  /** Whether this player is the village's moderator. Doubles as BOTH "has
   * moderator permissions" (can call startPhaseTimer/endPhaseNow/
   * kickPlayer/revealNarration/advanceNightSubPhase) AND "is excluded from
   * gameplay" (never receives a role, never acts/votes/nominates, never a
   * valid target, never counted in win-condition math — see
   * engine/assignRoles.ts, engine/winCondition.ts, and the targeting
   * checks in nightActions.ts/voting.ts/nominations.ts). These two
   * meanings are safe to fold into one flag ONLY because host transfer is
   * frozen once a game leaves LOBBY (see lobbyManagement.ts's
   * transferHostIfNeeded) — by the time role assignment ever runs,
   * whoever holds `isHost` is fixed for the rest of that game, so
   * "currently the host" and "was excluded from role assignment" can never
   * drift apart. If host transfer is ever allowed to happen mid-game in
   * the future, this single-flag design breaks and the two meanings would
   * need to split into separate fields again. */
  isHost: z.boolean(),
  isReady: z.boolean(),
  /** Set once the player's role is revealed to everyone (e.g. on death). */
  revealedRole: RoleSchema.optional(),
  joinedAt: z.number().int().nonnegative(),
});
export type Player = z.infer<typeof PlayerSchema>;

export const VillageSchema = z.object({
  code: VillageCodeSchema,
  hostId: PlayerIdSchema,
  createdAt: z.number().int().nonnegative(),
  maxPlayers: z.number().int().positive(),
  minPlayers: z.number().int().positive(),
});
export type Village = z.infer<typeof VillageSchema>;

export const PhaseTimerSchema = z.object({
  phase: PhaseSchema,
  /** Server epoch ms when this phase started. */
  startedAt: z.number().int().nonnegative(),
  /** Server epoch ms when this phase will auto-advance. Frozen (not
   * recomputed) while `pausedAt` is set — see `pausedAt`'s doc comment. */
  endsAt: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  /** Server epoch ms when the host paused this phase's timer, if it's
   * currently paused (see `pauseTimer`/`resumeTimer` in events.ts). While
   * set, `endsAt` is a stale value from before the pause — the client's
   * only correct response is to freeze its countdown display rather than
   * keep counting toward `endsAt`, since the server itself has stopped
   * counting down too (the deadline is un-scheduled, not just hidden).
   * Cleared on resume, when a fresh `endsAt` is computed from the
   * remaining time and scheduling resumes for real. */
  pausedAt: z.number().int().nonnegative().optional(),
});
export type PhaseTimer = z.infer<typeof PhaseTimerSchema>;

/** One player who died/was eliminated in the transition this event
 * describes, with the role that death just publicly revealed. Carried as
 * structured data — not just folded into the narration prose — so a
 * client can drive a real animated reveal (dawn/elimination screens) off
 * an actual (playerId, role) pair instead of parsing a sentence. */
export const PhaseOutcomePlayerSchema = z.object({
  playerId: PlayerIdSchema,
  role: RoleSchema,
});
export type PhaseOutcomePlayer = z.infer<typeof PhaseOutcomePlayerSchema>;

/** Structured summary of what a phase resolved to. Fields are populated
 * only where meaningful for the phase that just ended:
 *   - NIGHT      -> `died` has 0 or 1 entries (the mafia's kill, if it
 *                    landed; empty if saved or no kill was submitted).
 *   - DAY_VOTE   -> `died` has 0 or 1 entries (the eliminated player, if
 *                    any); `wasTie` is true when elimination was withheld
 *                    specifically because of a tied plurality (distinct
 *                    from simply no votes being cast — see
 *                    engine/voting.ts's resolveVote and its VOTE_TIED
 *                    effect, the source of this flag).
 *   - DAY_DISCUSSION -> `died`/`wasTie` stay empty/false (nothing dies from
 *                        a nomination round); `wasOpenNomination` is true
 *                        when nobody nominated anyone, so the following
 *                        DAY_VOTE fell back to an open vote across every
 *                        living player rather than a real shortlist — see
 *                        engine/nominations.ts's resolveNominations.
 */
export const PhaseOutcomeSchema = z.object({
  died: z.array(PhaseOutcomePlayerSchema),
  wasTie: z.boolean(),
  /** Only meaningful for a DAY_DISCUSSION resolution — see the field-by-
   * field doc above. Absent (not merely false) for every other phase, so
   * a client can distinguish "this phase doesn't have this concept" from
   * "nominations happened normally." */
  wasOpenNomination: z.boolean().optional(),
});
export type PhaseOutcome = z.infer<typeof PhaseOutcomeSchema>;

/**
 * A phase that has resolved (deaths/votes already computed and applied to
 * `FullGameState.players`/etc.) but whose narration hasn't been revealed
 * to players yet — the human-moderator gate between "the engine knows what
 * happened" and "the players find out". `text` starts as the engine's own
 * suggested narration (see phaseLoop.ts's `narrationFor`) and the host may
 * edit it freely before calling `revealNarration`; whatever `text` holds
 * at that moment is exactly what every player receives — there is no
 * separate "original" the host's edit is diffed against. `forPhase` is the
 * phase that just ended (mirrors `PhaseChangedPayload.previousPhase`);
 * `FullGameState.phase` has already moved on to the next phase by the time
 * this is set (see phaseLoop.ts's advancePhase), so `forPhase` is the only
 * record of what's actually being narrated. While this is set, the next
 * phase has no running timer — see PhaseTimerSchema and
 * `startPhaseTimer`/`revealNarration` in events.ts.
 */
export const PendingNarrationSchema = z.object({
  forPhase: PhaseSchema,
  text: z.string(),
  outcome: PhaseOutcomeSchema,
});
export type PendingNarration = z.infer<typeof PendingNarrationSchema>;

/**
 * A single night action submission. `targetId` is optional to support
 * no-target actions (e.g. a role that may choose to skip).
 */
export const NightActionSchema = z.object({
  id: z.string().uuid(),
  actorId: PlayerIdSchema,
  actorRole: RoleSchema,
  targetId: PlayerIdSchema.optional(),
  /** The night number this action belongs to, starting at 1. */
  nightNumber: z.number().int().positive(),
  submittedAt: z.number().int().nonnegative(),
});
export type NightAction = z.infer<typeof NightActionSchema>;

export const VoteSchema = z.object({
  voterId: PlayerIdSchema,
  /** Absent target represents an explicit abstain. */
  targetId: PlayerIdSchema.optional(),
  /** The day number this vote belongs to, starting at 1. */
  dayNumber: z.number().int().positive(),
  submittedAt: z.number().int().nonnegative(),
});
export type Vote = z.infer<typeof VoteSchema>;

/**
 * One player's public suspect nomination during DAY_DISCUSSION — replaces
 * free-text DAY chat entirely (see engine/nominations.ts). Structurally a
 * near-twin of VoteSchema (same "one live submission per living player per
 * round, revocable, absent target = decline" shape), but kept as its own
 * type/module rather than reusing Vote — nomination's RESOLUTION semantics
 * are genuinely different (produces a shortlist SET, not a plurality
 * winner), matching how this codebase already keeps NightAction and Vote
 * as separate entities despite a similar submit-then-resolve shape.
 * Self-nomination is allowed, same as self-voting is allowed today.
 */
export const NominationSchema = z.object({
  nominatorId: PlayerIdSchema,
  /** Absent target represents an explicit decline to nominate anyone. */
  targetId: PlayerIdSchema.optional(),
  /** The day number this nomination belongs to, starting at 1 — same
   * numbering as Vote's `dayNumber`, since a nomination round and its
   * following vote round share one day's `roundNumber`. */
  dayNumber: z.number().int().positive(),
  submittedAt: z.number().int().nonnegative(),
});
export type Nomination = z.infer<typeof NominationSchema>;

export const ChatChannelSchema = z.enum(['LOBBY', 'DAY', 'MAFIA', 'DEAD']);
export type ChatChannel = z.infer<typeof ChatChannelSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  channel: ChatChannelSchema,
  senderId: PlayerIdSchema,
  senderName: z.string(),
  body: z.string().min(1).max(500),
  sentAt: z.number().int().nonnegative(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
