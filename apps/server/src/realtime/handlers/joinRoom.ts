// ---------------------------------------------------------------------------
// joinRoom — attaches this socket to a room's Socket.IO room + the caller's
// private player channel. Capacity/in-progress checks were already enforced
// by the HTTP POST /api/rooms/:code/join the client calls before ever
// opening a socket (see http/routes/rooms.routes.ts) — this handler's job
// is purely to wire up the realtime side for a player already recorded as
// a room member in Mongo, or to bootstrap a fresh in-memory GameSession the
// first time anyone in the room connects a socket.
// ---------------------------------------------------------------------------

import { brandFullGameState, JoinRoomPayloadSchema, type PlayerId, type RoomCode } from '@mafia/shared';
import { roomsRepository } from '../../db';
import { gameRoom, playerChannel, broadcastStateToRoom, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, type HandlerAck } from '../handlerContext';
import { roomManager, type GameSession } from '../RoomManager';

export function registerJoinRoomHandler(io: GameServer, socket: GameSocket): void {
  socket.on('joinRoom', async (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(JoinRoomPayloadSchema, payload, ack);
    if (!parsed) return;

    // The socket's authenticated identity (from the handshake cookie) is
    // always the actor — a client cannot join a room "as" another player
    // by putting a different id in the payload, because the payload
    // doesn't even carry one. `playerName` here is cosmetic-only (already
    // set at session creation); it's accepted for schema compatibility but
    // never used to re-derive identity.
    const player = socket.player;

    const roomDoc = await roomsRepository.findRoomByCode(parsed.roomCode);
    if (!roomDoc) {
      ackError(ack, { code: 'ROOM_NOT_FOUND', message: `No room found with code ${parsed.roomCode}.` });
      return;
    }
    if (!roomDoc.playerIds.includes(player._id)) {
      // The HTTP join endpoint is the only path that adds a player to a
      // room's roster — a socket cannot join a room it was never granted
      // membership in via that door, even with a resolvable room code.
      ackError(ack, { code: 'NOT_IN_GAME', message: 'Join this room via POST /api/rooms/:code/join first.' });
      return;
    }

    let session = roomManager.get(parsed.roomCode);
    if (!session) {
      session = bootstrapLobbySession(parsed.roomCode, roomDoc.hostId);
      roomManager.create(session);
    }

    // Idempotent: reconnecting (or double-emitting joinRoom) just re-adds
    // the same player, which is a no-op past the first time.
    if (!session.state.players.some((p) => p.id === player._id)) {
      session.state = {
        ...session.state,
        players: [
          ...session.state.players,
          {
            id: player._id,
            name: player.displayName,
            status: 'ALIVE',
            connected: true,
            isHost: player._id === roomDoc.hostId,
            isReady: false,
            joinedAt: Date.now(),
          },
        ],
      };
    } else {
      // Reconnecting player: flip back to connected (see disconnect.ts,
      // which only ever flips this to false, never removes the player).
      session.state = {
        ...session.state,
        players: session.state.players.map((p) => (p.id === player._id ? { ...p, connected: true } : p)),
      };
    }

    session.sockets.set(player._id, socket.id);
    await socket.join([gameRoom(parsed.roomCode), playerChannel(player._id)]);

    io.to(gameRoom(parsed.roomCode)).emit('playerJoined', { playerId: player._id, playerName: player.displayName });
    broadcastStateToRoom(io, session.state);
    ackOk(ack);
  });
}

/** Mints a fresh, empty LOBBY-phase GameSession for a room that has no
 * in-memory session yet — the first socket to join after room creation
 * bootstraps it. `hostId` isn't needed here (each player's `isHost` flag
 * is computed per-player at the join call site above), kept as a parameter
 * anyway so the function signature documents which room this session
 * belongs to at a glance. */
export function bootstrapLobbySession(roomCode: RoomCode, _hostId: PlayerId): GameSession {
  return {
    roomCode,
    state: brandFullGameState({
      roomCode,
      phase: 'LOBBY',
      roundNumber: 0,
      players: [],
      nightActions: [],
      votes: [],
      chatLog: [],
    }),
    sockets: new Map(),
    seenActionIds: new Set(),
    roleSeed: Date.now() ^ Math.floor(Math.random() * 0xffffffff),
    pendingEvents: [],
    phaseDurationOverridesMs: {},
  };
}
