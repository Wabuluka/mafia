import { z } from 'zod';
import { PhaseSchema, PlayerStatusSchema, RoleSchema } from './enums';

// ---------------------------------------------------------------------------
// Primitive id brands — prevents e.g. passing a roomCode where a playerId
// is expected, since both are plain strings underneath.
// ---------------------------------------------------------------------------

export const PlayerIdSchema = z.string().uuid().brand<'PlayerId'>();
export type PlayerId = z.infer<typeof PlayerIdSchema>;

export const RoomCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{4}$/, 'Room code must be 4 uppercase alphanumeric characters')
  .brand<'RoomCode'>();
export type RoomCode = z.infer<typeof RoomCodeSchema>;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export const PlayerSchema = z.object({
  id: PlayerIdSchema,
  name: z.string().min(1).max(24),
  /** Present only where the schema/context allows role visibility. */
  role: RoleSchema.optional(),
  status: PlayerStatusSchema,
  connected: z.boolean(),
  isHost: z.boolean(),
  isReady: z.boolean(),
  /** Set once the player's role is revealed to everyone (e.g. on death). */
  revealedRole: RoleSchema.optional(),
  joinedAt: z.number().int().nonnegative(),
});
export type Player = z.infer<typeof PlayerSchema>;

export const RoomSchema = z.object({
  code: RoomCodeSchema,
  hostId: PlayerIdSchema,
  createdAt: z.number().int().nonnegative(),
  maxPlayers: z.number().int().positive(),
  minPlayers: z.number().int().positive(),
});
export type Room = z.infer<typeof RoomSchema>;

export const PhaseTimerSchema = z.object({
  phase: PhaseSchema,
  /** Server epoch ms when this phase started. */
  startedAt: z.number().int().nonnegative(),
  /** Server epoch ms when this phase will auto-advance. */
  endsAt: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
});
export type PhaseTimer = z.infer<typeof PhaseTimerSchema>;

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
