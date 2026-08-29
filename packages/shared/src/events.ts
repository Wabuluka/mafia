import { z } from 'zod';
import { PhaseSchema, RoleSchema } from './enums';
import { NominationSchema, PhaseOutcomeSchema, PlayerIdSchema, VillageCodeSchema, VoteSchema } from './entities';
import { PlayerViewSchema } from './game-state';

// Phase durations a host can configure — LOBBY and GAME_OVER are never
// timer-driven (see @mafia/shared's DEFAULT_PHASE_DURATIONS_MS), so they're
// excluded from what's configurable rather than accepted and silently
// ignored.

// ---------------------------------------------------------------------------
// Naming note (room -> village rename): event names that spelled out "room"
// (joinRoom, leaveRoom, updateRoomSettings, roomSettingsUpdated) were
// renamed to their village equivalents, not just the payload fields inside
// them. Event names are part of the same public wire vocabulary as the
// payload field names and error codes (ROOM_NOT_FOUND, etc.) — leaving them
// mismatched (e.g. a `joinRoom` event carrying a `villageCode` field) would
// be a worse, permanently-confusing outcome than the one-time churn of
// renaming both client and server call sites together. The VILLAGER role
// enum value was NOT renamed for the same "wire contract" reason but in the
// opposite direction: it's a data value stored in MongoDB documents, not a
// call site, so renaming it would require a DB migration rather than a
// find-and-replace across in-repo call sites — see constants.ts/enums.ts
// for the display-label mapping that covers the user-facing "Resident"
// rename instead.
// ---------------------------------------------------------------------------
const CONFIGURABLE_PHASE_DURATION_KEYS = ['NIGHT', 'DAY_DISCUSSION', 'DAY_VOTE'] as const;

// ---------------------------------------------------------------------------
// Every socket payload gets a Zod schema; the TS type is inferred from it so
// the wire contract and the compile-time type can never drift apart. Server
// and client both call `Schema.parse(...)` on inbound data before trusting it.
// ---------------------------------------------------------------------------

// --- Client -> Server payloads ---------------------------------------------

export const JoinVillagePayloadSchema = z.object({
  villageCode: VillageCodeSchema,
  playerName: z.string().min(1).max(24),
});
export type JoinVillagePayload = z.infer<typeof JoinVillagePayloadSchema>;

export const LeaveVillagePayloadSchema = z.object({
  villageCode: VillageCodeSchema,
});
export type LeaveVillagePayload = z.infer<typeof LeaveVillagePayloadSchema>;

export const SetReadyPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
  isReady: z.boolean(),
});
export type SetReadyPayload = z.infer<typeof SetReadyPayloadSchema>;

export const StartGamePayloadSchema = z.object({
  villageCode: VillageCodeSchema,
});
export type StartGamePayload = z.infer<typeof StartGamePayloadSchema>;

/** Host-only, GAME_OVER-only: starts a brand-new game in the SAME village,
 * for the SAME roster of players currently in it, with roles reshuffled
 * from scratch — the "Play again" flow. No one re-enters a village code;
 * everyone's existing socket connection/membership carries over. See
 * handlers/playAgain.ts. */
export const PlayAgainPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
});
export type PlayAgainPayload = z.infer<typeof PlayAgainPayloadSchema>;

export const SubmitNightActionPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
  /** Omitted to represent an explicit no-target / skip action. */
  targetId: PlayerIdSchema.optional(),
});
export type SubmitNightActionPayload = z.infer<typeof SubmitNightActionPayloadSchema>;

export const CastVotePayloadSchema = z.object({
  villageCode: VillageCodeSchema,
  /** Omitted to represent an explicit abstain. */
  targetId: PlayerIdSchema.optional(),
});
export type CastVotePayload = z.infer<typeof CastVotePayloadSchema>;

/** Submits (or changes) the sender's public suspect nomination for the
 * current DAY_DISCUSSION round — see engine/nominations.ts. Revocable, same
 * as a vote: a second call replaces the sender's earlier nomination for
 * this round rather than being rejected. Omitted `targetId` represents an
 * explicit decline to nominate anyone. */
export const SubmitNominationPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
  targetId: PlayerIdSchema.optional(),
});
export type SubmitNominationPayload = z.infer<typeof SubmitNominationPayloadSchema>;

export const SendChatPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
  body: z.string().min(1).max(500),
});
export type SendChatPayload = z.infer<typeof SendChatPayloadSchema>;

export const RequestResyncPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
});
export type RequestResyncPayload = z.infer<typeof RequestResyncPayloadSchema>;

export const KickPlayerPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
  targetPlayerId: PlayerIdSchema,
});
export type KickPlayerPayload = z.infer<typeof KickPlayerPayloadSchema>;

/**
 * Sent by a socket that has just been placed in `pendingPlayerIds` by
 * `POST /api/villages/:code/join` (see villages.routes.ts — a NEW player
 * joining a LOBBY-phase village is held pending rather than admitted
 * outright, so the host can approve/deny them). This is what actually
 * registers that socket to RECEIVE the eventual `joinRequestResolved`
 * notification and to be shown to the host as a live request — the HTTP
 * join call alone only persists the pending state in Mongo, it doesn't
 * wire up anything on the realtime session.
 */
export const RequestToJoinPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
});
export type RequestToJoinPayload = z.infer<typeof RequestToJoinPayloadSchema>;

/** Host-only, lobby-only: accepts or denies one pending join request. */
export const RespondToJoinRequestPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
  targetPlayerId: PlayerIdSchema,
  accept: z.boolean(),
});
export type RespondToJoinRequestPayload = z.infer<typeof RespondToJoinRequestPayloadSchema>;

/** Sent by the WAITING PLAYER themselves to withdraw their own pending
 * request (the waiting screen's "Cancel" button) — distinct from the
 * host's `respondToJoinRequest`, which only the host may call. Always
 * succeeds even if the request was already resolved/gone by the time this
 * arrives (a host's accept/deny racing a cancel), same "ack success,
 * nothing left to do" idempotency as clearSession. */
export const CancelJoinRequestPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
});
export type CancelJoinRequestPayload = z.infer<typeof CancelJoinRequestPayloadSchema>;

/** Host-only, lobby-only. Every key is optional so a host can tweak a
 * single phase's duration without having to resend all three; omitted
 * keys keep whatever the village already has (defaulting to
 * DEFAULT_PHASE_DURATIONS_MS the first time). Bounds are generous but
 * finite — floor stops an accidental 0-length phase that could never be
 * acted in, ceiling stops an unbounded stall. */
export const UpdateVillageSettingsPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
  phaseDurationsMs: z
    .object({
      NIGHT: z.number().int().min(10_000).max(300_000).optional(),
      DAY_DISCUSSION: z.number().int().min(10_000).max(300_000).optional(),
      DAY_VOTE: z.number().int().min(10_000).max(300_000).optional(),
    })
    .partial(),
});
export type UpdateVillageSettingsPayload = z.infer<typeof UpdateVillageSettingsPayloadSchema>;
export type ConfigurablePhaseDurationKey = (typeof CONFIGURABLE_PHASE_DURATION_KEYS)[number];

/** Host-only. Freezes the current phase's countdown — see
 * `PhaseTimerSchema.pausedAt`. Rejected outside NIGHT/DAY_DISCUSSION/
 * DAY_VOTE (no timer to pause) or if already paused. The host is the
 * designated moderator/narrator (see the module header in realtime/
 * index.ts's cheat-vector list, item 20) — this is their tool to hold the
 * game while they talk, adjudicate a dispute, or handle a real-world
 * interruption, without the timer running out from under the table. */
export const PauseTimerPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
});
export type PauseTimerPayload = z.infer<typeof PauseTimerPayloadSchema>;

/** Host-only. Resumes a paused phase timer, granting exactly the time that
 * remained at the moment it was paused (never a fresh full duration) —
 * see realtime/handlers/resumeTimer.ts. */
export const ResumeTimerPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
});
export type ResumeTimerPayload = z.infer<typeof ResumeTimerPayloadSchema>;

/**
 * Host-only, human-moderator model: phases no longer auto-start a timer the
 * instant the previous one resolves (see phaseLoop.ts's advancePhase and
 * FullGameState.pendingNarration) — the host must explicitly kick off the
 * NEXT phase's countdown once they're ready (after narrating, or whenever
 * they choose to start the story beat). Rejected if the current phase
 * already has a running or paused timer, or if the phase isn't one of
 * NIGHT/DAY_DISCUSSION/DAY_VOTE (LOBBY/GAME_OVER are never timer-driven),
 * or while a `pendingNarration` is still awaiting `revealNarration` (the
 * players haven't even been told what happened yet — starting a new
 * countdown before that would race the narration itself).
 */
export const StartPhaseTimerPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
});
export type StartPhaseTimerPayload = z.infer<typeof StartPhaseTimerPayloadSchema>;

/**
 * Host-only, moderator override: force the current phase to resolve right
 * now, regardless of whether every required action is in or the timer has
 * elapsed — the same underlying resolution `advancePhase` already runs on
 * a normal deadline/early-resolution, just triggered directly by the host
 * (e.g. "everyone's actually done talking, let's move on" during
 * DAY_DISCUSSION, which has no early-resolution path of its own since
 * there's nothing to submit). Works whether or not the timer is currently
 * paused. Rejected outside a timer-bearing phase.
 */
export const EndPhaseNowPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
});
export type EndPhaseNowPayload = z.infer<typeof EndPhaseNowPayloadSchema>;

/**
 * Host-only: submits the FINAL narration text for the phase that just
 * resolved (see FullGameState.pendingNarration) and broadcasts it —
 * together with the outcome that was already computed at resolution time —
 * to every player as a `phaseChanged` event, exactly as if the engine's
 * own narration had been sent directly (see the old auto-narrated flow
 * this replaces). `text` may be the engine's own suggested wording
 * untouched, or a full rewrite — whatever the host submits here is exactly
 * what players see; there's no separate "as-computed" version retained
 * once this fires. Rejected if there's no `pendingNarration` to reveal.
 */
export const RevealNarrationPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
  text: z.string().min(1).max(1000),
});
export type RevealNarrationPayload = z.infer<typeof RevealNarrationPayloadSchema>;

/**
 * Host-only, moderator-driven night flow: advances NIGHT's internal
 * sub-sequence (MAFIA -> DETECTIVE -> DOCTOR -> COMPLETE, see
 * NightSubPhaseSchema) to the next APPLICABLE role, silently skipping any
 * role with no living holder. No target/role is specified — it always
 * advances from wherever `state.nightSubPhase` currently sits. Reaching
 * COMPLETE this way triggers NIGHT's actual resolution immediately (same
 * `advancePhase` as a normal deadline/early-resolution), same as
 * `endPhaseNow` triggers resolution for other phases. Rejected outside
 * NIGHT, or once `nightSubPhase` is already COMPLETE (nothing left to
 * advance to).
 */
export const AdvanceNightSubPhasePayloadSchema = z.object({
  villageCode: VillageCodeSchema,
});
export type AdvanceNightSubPhasePayload = z.infer<typeof AdvanceNightSubPhasePayloadSchema>;

// --- Server -> Client payloads ----------------------------------------------

/** Full state snapshot, already projected to this recipient's PlayerView. */
export const StateUpdatePayloadSchema = z.object({
  state: PlayerViewSchema,
});
export type StateUpdatePayload = z.infer<typeof StateUpdatePayloadSchema>;

/**
 * A DIFF, not a full state — sent instead of a full `stateUpdate` for
 * every vote cast/changed during DAY_VOTE (see realtime/handlers/
 * castVote.ts). Measured (Prompt 14's payload-size audit): a full
 * PlayerView with a realistic mid-game chat log (chat dominates the
 * payload, not the roster or votes — ~78% of bytes in the measured
 * scenario) runs ~13.6KB; this diff for the same scenario is ~170 bytes,
 * a >98% reduction PER RECIPIENT, and votes fire far more often than any
 * other event type during a vote phase (every player can change their
 * mind repeatedly before the phase ends — see engine/voting.ts's
 * revocable-vote semantics).
 *
 * Carries the FULL current-round vote array (not just the one that
 * changed) — still tiny relative to the state it replaces, and simpler
 * for the client to apply as a wholesale replacement of `view.votes`
 * rather than a true field-level patch, while still being correct even
 * if a client somehow missed an earlier voteChanged (the array is always
 * complete for the round, never an incremental delta of deltas).
 *
 * NOT a substitute for `stateUpdate` — every phase change still sends a
 * full `stateUpdate`/`phaseChanged` as an explicit resync point (see
 * phaseLoop.ts), so a client that missed some voteChanged events (a
 * dropped connection mid-phase, say) is guaranteed a fully consistent
 * view again at the next phase boundary rather than silently drifting.
 */
export const VoteChangedPayloadSchema = z.object({
  votes: z.array(VoteSchema.omit({ voterId: true }).extend({ voterId: PlayerIdSchema })),
});
export type VoteChangedPayload = z.infer<typeof VoteChangedPayloadSchema>;

/** The same diff-not-full-state pattern as VoteChangedPayload, for
 * nominations during DAY_DISCUSSION — see that schema's doc comment for
 * the full size-reduction rationale, which applies identically here
 * (nominations can change many times per round, same as votes). */
export const NominationChangedPayloadSchema = z.object({
  nominations: z.array(NominationSchema.omit({ nominatorId: true }).extend({ nominatorId: PlayerIdSchema })),
});
export type NominationChangedPayload = z.infer<typeof NominationChangedPayloadSchema>;

// PhaseOutcomeSchema/PhaseOutcomePlayerSchema moved to entities.ts (Prompt:
// human moderator) so game-state.ts's PendingNarration can reference them
// without an entities -> events -> game-state import cycle; re-exported here
// (alongside the normal import above, used below in PhaseChangedPayloadSchema)
// since this is where every other module already imports them from.
export { PhaseOutcomePlayerSchema, PhaseOutcomeSchema, type PhaseOutcome, type PhaseOutcomePlayer } from './entities';

export const PhaseChangedPayloadSchema = z.object({
  state: PlayerViewSchema,
  previousPhase: PhaseSchema,
  /** Flavor text describing what happened during the phase that just
   * ended (e.g. who died, or that the night passed quietly). Carried
   * directly on this event — rather than relying purely on a separate
   * `narration` emit — so a client can never end up phase-advanced without
   * ever having seen why, regardless of event delivery order. */
  narration: z.string(),
  /** Structured version of the same resolution — see PhaseOutcomeSchema.
   * `narration` is for display as prose; `outcome` is for driving UI
   * logic (whose role to reveal, whether to show the tie narration
   * variant) without re-parsing `narration`'s text. */
  outcome: PhaseOutcomeSchema,
});
export type PhaseChangedPayload = z.infer<typeof PhaseChangedPayloadSchema>;

/** A flavor-text / event announcement broadcast to some or all players. */
export const NarrationPayloadSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  sentAt: z.number().int().nonnegative(),
});
export type NarrationPayload = z.infer<typeof NarrationPayloadSchema>;

/** A private-only reveal, e.g. a detective's investigation result. */
export const PrivateInfoPayloadSchema = z.object({
  kind: z.enum(['DETECTIVE_RESULT', 'ROLE_ASSIGNED', 'MAFIA_TEAM_REVEALED']),
  message: z.string(),
  role: RoleSchema.optional(),
  relatedPlayerId: PlayerIdSchema.optional(),
});
export type PrivateInfoPayload = z.infer<typeof PrivateInfoPayloadSchema>;

export const ChatMessagePayloadSchema = z.object({
  id: z.string().uuid(),
  channel: z.enum(['LOBBY', 'DAY', 'MAFIA', 'DEAD']),
  senderId: PlayerIdSchema,
  senderName: z.string(),
  body: z.string(),
  sentAt: z.number().int().nonnegative(),
});
export type ChatMessagePayload = z.infer<typeof ChatMessagePayloadSchema>;

export const PlayerJoinedPayloadSchema = z.object({
  playerId: PlayerIdSchema,
  playerName: z.string(),
});
export type PlayerJoinedPayload = z.infer<typeof PlayerJoinedPayloadSchema>;

/** One player currently waiting on host approval. */
export const JoinRequestSchema = z.object({
  playerId: PlayerIdSchema,
  playerName: z.string(),
  requestedAt: z.number().int().nonnegative(),
});
export type JoinRequest = z.infer<typeof JoinRequestSchema>;

/**
 * Sent ONLY to the host's own private channel, every time the pending list
 * changes (a new request arrives, one is accepted/denied, or the requester
 * disconnects before the host responds). Not part of PlayerView/`you` —
 * kept as its own event rather than a `stateUpdate` field so a non-host's
 * `stateUpdate` never has to reason about a field it should never see; see
 * realtime/handlers/requestToJoin.ts and respondToJoinRequest.ts.
 */
export const JoinRequestsUpdatedPayloadSchema = z.object({
  requests: z.array(JoinRequestSchema),
});
export type JoinRequestsUpdatedPayload = z.infer<typeof JoinRequestsUpdatedPayloadSchema>;

/** Sent to the WAITING PLAYER's own private channel once the host has
 * responded. `accepted: false` covers both an explicit deny and the
 * request being invalidated (e.g. the village closed while they waited) —
 * `reason` distinguishes the two for display. */
export const JoinRequestResolvedPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
  accepted: z.boolean(),
  reason: z.enum(['ACCEPTED', 'DENIED', 'VILLAGE_UNAVAILABLE']),
});
export type JoinRequestResolvedPayload = z.infer<typeof JoinRequestResolvedPayloadSchema>;

export const PlayerLeftPayloadSchema = z.object({
  playerId: PlayerIdSchema,
  playerName: z.string(),
  reason: z.enum(['LEFT', 'DISCONNECTED', 'KICKED']),
});
export type PlayerLeftPayload = z.infer<typeof PlayerLeftPayloadSchema>;

/** Broadcast whenever the host's chosen phase durations change, so every
 * lobby member's settings display stays in sync without needing to poll
 * or infer it from the next `stateUpdate` alone. */
export const VillageSettingsUpdatedPayloadSchema = z.object({
  phaseDurationsMs: z.object({
    NIGHT: z.number().int().positive(),
    DAY_DISCUSSION: z.number().int().positive(),
    DAY_VOTE: z.number().int().positive(),
  }),
});
export type VillageSettingsUpdatedPayload = z.infer<typeof VillageSettingsUpdatedPayloadSchema>;

/**
 * Sent to a socket that is being forcibly disconnected because the same
 * player just joined this village from ANOTHER socket (a second tab/device
 * signed into the same session). Unlike ErrorPayload, this isn't a
 * response to anything the losing socket did — it's an unprompted
 * notification the client should treat as terminal: show a clear "opened
 * elsewhere" message and stop trying to reconnect/act, rather than
 * retrying like a normal transient disconnect. See
 * realtime/handlers/joinVillage.ts's eviction logic.
 */
export const SessionSupersededPayloadSchema = z.object({
  villageCode: VillageCodeSchema,
});
export type SessionSupersededPayload = z.infer<typeof SessionSupersededPayloadSchema>;

/**
 * Sent to every socket in an active game (not the lobby — see
 * server/realtime/shutdown.ts) the moment a graceful shutdown (SIGTERM)
 * begins, BEFORE the server stops accepting new connections and BEFORE the
 * game's state is persisted as ABANDONED. Purely informational — there is
 * no reconnect-and-resume path for the player once this fires (a resumed
 * game restarts its current phase from scratch on the next boot, per
 * restart.ts's module header, so nothing is salvageable client-side); the
 * client's only reasonable response is to show a clear "the server is
 * restarting" message, same terminal treatment as `sessionSuperseded`.
 */
export const ServerShuttingDownPayloadSchema = z.object({
  message: z.string(),
});
export type ServerShuttingDownPayload = z.infer<typeof ServerShuttingDownPayloadSchema>;

export const ErrorPayloadSchema = z.object({
  code: z.enum([
    'VILLAGE_NOT_FOUND',
    'VILLAGE_FULL',
    'NAME_TAKEN',
    'NOT_HOST',
    'NOT_IN_GAME',
    'INVALID_PHASE',
    'INVALID_TARGET',
    'NOT_ENOUGH_PLAYERS',
    'ALREADY_ACTED',
    'ALREADY_PAUSED',
    'NOT_PAUSED',
    'TIMER_ALREADY_RUNNING',
    'NARRATION_NOT_REVEALED',
    'NO_PENDING_NARRATION',
    'WRONG_SUB_PHASE',
    'VALIDATION_ERROR',
    'UNAUTHENTICATED',
    'INTERNAL_ERROR',
  ]),
  message: z.string(),
});
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

// ---------------------------------------------------------------------------
// Socket.IO event maps
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  joinVillage: (payload: JoinVillagePayload, ack?: (result: AckResult) => void) => void;
  leaveVillage: (payload: LeaveVillagePayload, ack?: (result: AckResult) => void) => void;
  setReady: (payload: SetReadyPayload, ack?: (result: AckResult) => void) => void;
  startGame: (payload: StartGamePayload, ack?: (result: AckResult) => void) => void;
  playAgain: (payload: PlayAgainPayload, ack?: (result: AckResult) => void) => void;
  submitNightAction: (
    payload: SubmitNightActionPayload,
    ack?: (result: AckResult) => void,
  ) => void;
  castVote: (payload: CastVotePayload, ack?: (result: AckResult) => void) => void;
  submitNomination: (payload: SubmitNominationPayload, ack?: (result: AckResult) => void) => void;
  sendChat: (payload: SendChatPayload, ack?: (result: AckResult) => void) => void;
  requestResync: (
    payload: RequestResyncPayload,
    ack?: (result: AckResult) => void,
  ) => void;
  kickPlayer: (payload: KickPlayerPayload, ack?: (result: AckResult) => void) => void;
  updateVillageSettings: (
    payload: UpdateVillageSettingsPayload,
    ack?: (result: AckResult) => void,
  ) => void;
  requestToJoin: (payload: RequestToJoinPayload, ack?: (result: AckResult) => void) => void;
  respondToJoinRequest: (
    payload: RespondToJoinRequestPayload,
    ack?: (result: AckResult) => void,
  ) => void;
  cancelJoinRequest: (payload: CancelJoinRequestPayload, ack?: (result: AckResult) => void) => void;
  pauseTimer: (payload: PauseTimerPayload, ack?: (result: AckResult) => void) => void;
  resumeTimer: (payload: ResumeTimerPayload, ack?: (result: AckResult) => void) => void;
  startPhaseTimer: (payload: StartPhaseTimerPayload, ack?: (result: AckResult) => void) => void;
  endPhaseNow: (payload: EndPhaseNowPayload, ack?: (result: AckResult) => void) => void;
  revealNarration: (payload: RevealNarrationPayload, ack?: (result: AckResult) => void) => void;
  advanceNightSubPhase: (payload: AdvanceNightSubPhasePayload, ack?: (result: AckResult) => void) => void;
}

export interface ServerToClientEvents {
  stateUpdate: (payload: StateUpdatePayload) => void;
  phaseChanged: (payload: PhaseChangedPayload) => void;
  narration: (payload: NarrationPayload) => void;
  privateInfo: (payload: PrivateInfoPayload) => void;
  chatMessage: (payload: ChatMessagePayload) => void;
  playerJoined: (payload: PlayerJoinedPayload) => void;
  playerLeft: (payload: PlayerLeftPayload) => void;
  villageSettingsUpdated: (payload: VillageSettingsUpdatedPayload) => void;
  error: (payload: ErrorPayload) => void;
  sessionSuperseded: (payload: SessionSupersededPayload) => void;
  serverShuttingDown: (payload: ServerShuttingDownPayload) => void;
  /** See VoteChangedPayloadSchema's doc comment — a diff, not a full
   * state, sent for every vote cast/changed during DAY_VOTE. */
  voteChanged: (payload: VoteChangedPayload) => void;
  /** See VoteChangedPayloadSchema/NominationChangedPayloadSchema's doc
   * comments — a diff, not a full state, sent for every nomination
   * cast/changed during DAY_DISCUSSION. */
  nominationChanged: (payload: NominationChangedPayload) => void;
  joinRequestsUpdated: (payload: JoinRequestsUpdatedPayload) => void;
  joinRequestResolved: (payload: JoinRequestResolvedPayload) => void;
}

/** Generic client-side ack result for events that accept one. */
export const AckResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: ErrorPayloadSchema }),
]);
export type AckResult = z.infer<typeof AckResultSchema>;

/** No inter-server events used; declared for Socket.IO's generic signature. */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface InterServerEvents {}

export interface SocketData {
  playerId: string;
  villageCode?: string;
}
