// ---------------------------------------------------------------------------
// MongoDB-level JSON Schema validators. These are a SECOND line of defense
// behind the Zod validation that already runs in application code (see
// @mafia/shared and the socket handlers that parse payloads before they
// reach a repository). They exist to catch:
//   - a bug in application code that bypasses Zod and writes a malformed
//     document directly,
//   - a stray script/migration/manual `mongosh` write,
//   - drift between what the app believes it's writing and what's actually
//     persisted, across deploys.
// They intentionally mirror the shared enums/shapes but are NOT generated
// from the Zod schemas — Mongo's JSON Schema dialect (bsonType, no unions
// via discriminator, etc.) doesn't map 1:1, so keeping them hand-written and
// deliberately a little looser than Zod is the honest tradeoff. If you add a
// field in @mafia/shared that must be enforced here too, update it here by
// hand and note it in the same PR.
// ---------------------------------------------------------------------------

import type { Document } from 'mongodb';

const ROLE_ENUM = ['VILLAGER', 'MAFIA', 'DETECTIVE', 'DOCTOR', 'JESTER'];
const PHASE_ENUM = ['LOBBY', 'NIGHT', 'DAY_DISCUSSION', 'DAY_VOTE', 'GAME_OVER'];
const GAME_END_REASON_ENUM = ['TOWN_WIN', 'MAFIA_WIN', 'JESTER_WIN', 'DRAW', 'ABANDONED'];
const ROOM_CODE_PATTERN = '^[A-Z0-9]{4}$';

export const roomsValidator: Document = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'hostId', 'maxPlayers', 'minPlayers', 'playerIds', 'status', 'createdAt', 'lastActivityAt'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'string', pattern: ROOM_CODE_PATTERN, description: 'room code, 4 uppercase alphanumeric chars' },
      hostId: { bsonType: 'string' },
      maxPlayers: { bsonType: 'int', minimum: 1 },
      minPlayers: { bsonType: 'int', minimum: 1 },
      playerIds: { bsonType: 'array', items: { bsonType: 'string' } },
      status: { enum: ['LOBBY', 'IN_GAME', 'CLOSED'] },
      createdAt: { bsonType: 'date' },
      lastActivityAt: { bsonType: 'date' },
    },
  },
};

export const gamesValidator: Document = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      '_id',
      'roomCode',
      'hostId',
      'status',
      'currentPhase',
      'roundNumber',
      'players',
      'startedAt',
      'updatedAt',
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'string', description: 'generated game id (uuid)' },
      roomCode: { bsonType: 'string', pattern: ROOM_CODE_PATTERN },
      hostId: { bsonType: 'string' },
      status: { enum: ['IN_PROGRESS', 'COMPLETED', 'ABANDONED'] },
      currentPhase: { enum: PHASE_ENUM },
      roundNumber: { bsonType: 'int', minimum: 0 },
      players: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['id', 'name', 'role', 'status', 'connected', 'isHost', 'isReady', 'joinedAt'],
          properties: {
            id: { bsonType: 'string' },
            name: { bsonType: 'string' },
            role: { enum: ROLE_ENUM },
            status: { enum: ['ALIVE', 'DEAD'] },
            connected: { bsonType: 'bool' },
            isHost: { bsonType: 'bool' },
            isReady: { bsonType: 'bool' },
            revealedRole: { enum: ROLE_ENUM },
            // A JS `number` (epoch ms) round-trips through the driver as
            // whichever BSON numeric type fits — int32, double, or long —
            // depending on magnitude, so all three must be accepted here.
            joinedAt: { bsonType: ['int', 'long', 'double'] },
          },
        },
      },
      endReason: { enum: GAME_END_REASON_ENUM },
      winningTeam: { bsonType: 'string' },
      startedAt: { bsonType: 'date' },
      endedAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
    },
  },
};

/** The GameEvent validator is intentionally loose on `payload` — it's a
 * discriminated union in application code (see db/types.ts) and Mongo's
 * JSON Schema has no clean way to express "shape of payload depends on
 * `type`" without a large oneOf. Zod is the strict gate for event shape;
 * this validator's job is just to guarantee the append-only envelope
 * (gameId, sequence, type, createdAt) is never malformed. */
export const gameEventsValidator: Document = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'gameId', 'sequence', 'type', 'payload', 'createdAt'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'string' },
      gameId: { bsonType: 'string' },
      sequence: { bsonType: 'int', minimum: 0 },
      type: {
        enum: [
          'NIGHT_ACTION',
          'VOTE',
          'CHAT',
          'PHASE_CHANGED',
          'PLAYER_JOINED',
          'PLAYER_LEFT',
          'GAME_ENDED',
        ],
      },
      payload: { bsonType: 'object' },
      createdAt: { bsonType: 'date' },
    },
  },
};

export const playersValidator: Document = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'sessionToken', 'displayName', 'createdAt', 'lastSeenAt'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'string' },
      sessionToken: { bsonType: 'string', minLength: 16 },
      displayName: { bsonType: 'string', minLength: 1, maxLength: 24 },
      createdAt: { bsonType: 'date' },
      lastSeenAt: { bsonType: 'date' },
    },
  },
};
