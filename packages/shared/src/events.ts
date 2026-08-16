import { z } from 'zod';
import { PhaseSchema, RoleSchema } from './enums';
import { PlayerIdSchema, VillageCodeSchema } from './entities';
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

// --- Server -> Client payloads ----------------------------------------------

/** Full state snapshot, already projected to this recipient's PlayerView. */
export const StateUpdatePayloadSchema = z.object({
  state: PlayerViewSchema,
});
export type StateUpdatePayload = z.infer<typeof StateUpdatePayloadSchema>;

export const PhaseChangedPayloadSchema = z.object({
  state: PlayerViewSchema,
  previousPhase: PhaseSchema,
  /** Flavor text describing what happened during the phase that just
   * ended (e.g. who died, or that the night passed quietly). Carried
   * directly on this event — rather than relying purely on a separate
   * `narration` emit — so a client can never end up phase-advanced without
   * ever having seen why, regardless of event delivery order. */
  narration: z.string(),
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
  submitNightAction: (
    payload: SubmitNightActionPayload,
    ack?: (result: AckResult) => void,
  ) => void;
  castVote: (payload: CastVotePayload, ack?: (result: AckResult) => void) => void;
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
