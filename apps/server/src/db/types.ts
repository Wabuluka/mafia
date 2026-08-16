// ---------------------------------------------------------------------------
// MongoDB document shapes. These extend/reuse the shared Zod-validated
// entities from @mafia/shared but add storage-only fields (_id, timestamps,
// TTL markers) that never travel over the wire. Keep them structurally close
// to the shared types so repository code doesn't need a hand-rolled mapper
// for every field — see each repository's `toXDocument`/`fromXDocument`.
// ---------------------------------------------------------------------------

import type {
  ChatMessage,
  GameEndReason,
  NightAction,
  Phase,
  PlayerId,
  PublicPlayer,
  Role,
  VillageCode,
  Vote,
} from '@mafia/shared';

/** Lobby metadata for a village. Deleted automatically by the TTL index once
 * abandoned (see `indexes.ts`), or promoted into a `GameDocument` on start. */
export interface VillageDocument {
  _id: VillageCode; // the village code itself is the primary key — see indexes.ts
  hostId: PlayerId;
  maxPlayers: number;
  minPlayers: number;
  playerIds: PlayerId[];
  status: 'LOBBY' | 'IN_GAME' | 'CLOSED';
  createdAt: Date;
  /** Bumped on any lobby activity; TTL index expires on this field. */
  lastActivityAt: Date;
}

/** A full game record. Written at phase boundaries and on game end — never
 * on every player action. See the module-level comment in `index.ts`. */
export interface GameDocument {
  _id: string; // generated game id (uuid), independent of the village code
  villageCode: VillageCode;
  hostId: PlayerId;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
  currentPhase: Phase;
  roundNumber: number;
  /** Player roster with roles, captured at game start (roles are fixed once
   * assigned) so a completed game can be reviewed without replaying events. */
  players: Array<PublicPlayer & { role: Role }>;
  endReason?: GameEndReason;
  winningTeam?: string;
  startedAt: Date;
  endedAt?: Date;
  /** Bumped every time this document is written; used for optimistic checks. */
  updatedAt: Date;
}

/**
 * Append-only log of every meaningful action in a game — night actions,
 * votes, chat, phase transitions. Never updated or deleted, only inserted,
 * so it can reconstruct a full replay or settle a dispute about what
 * happened. `sequence` gives a strict per-game total order independent of
 * clock skew between application instances.
 */
export type GameEventDocument =
  | GameEventBase<'NIGHT_ACTION', { action: NightAction }>
  | GameEventBase<'VOTE', { vote: Vote }>
  | GameEventBase<'CHAT', { message: ChatMessage }>
  | GameEventBase<'PHASE_CHANGED', { fromPhase: Phase; toPhase: Phase; roundNumber: number }>
  | GameEventBase<'PLAYER_JOINED', { playerId: PlayerId }>
  | GameEventBase<'PLAYER_LEFT', { playerId: PlayerId; reason: string }>
  | GameEventBase<'GAME_ENDED', { endReason: GameEndReason; winningTeam?: string }>;

interface GameEventBase<Type extends string, Payload> {
  _id: string; // uuid
  gameId: string;
  /** Strictly increasing per gameId, assigned at insert time. */
  sequence: number;
  type: Type;
  payload: Payload;
  createdAt: Date;
}

/**
 * An anonymous player identity keyed by an opaque session token (not a user
 * account — no email/password, nothing PII-bearing). The token is what a
 * reconnecting browser presents to resume a village/game.
 */
export interface PlayerDocument {
  _id: PlayerId;
  sessionToken: string;
  displayName: string;
  createdAt: Date;
  lastSeenAt: Date;
}
