// ---------------------------------------------------------------------------
// kickPlayer — host-only, lobby-only. Removes the target from the roster
// (Mongo roster + in-memory session) and forces their socket out of the
// room's channels so a kicked player can't keep receiving state updates
// for a room they're no longer part of.
// ---------------------------------------------------------------------------

import { KickPlayerPayloadSchema } from '@mafia/shared';
import { roomsRepository } from '../../db';
import { gameRoom, playerChannel, broadcastStateToRoom, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';

export function registerKickPlayerHandler(io: GameServer, socket: GameSocket): void {
  socket.on('kickPlayer', async (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(KickPlayerPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.roomCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    if (session.state.phase !== 'LOBBY') {
      ackError(ack, { code: 'INVALID_PHASE', message: 'Players can only be removed while still in the lobby.' });
      return;
    }

    const caller = session.state.players.find((p) => p.id === socket.player._id);
    if (!caller?.isHost) {
      ackError(ack, { code: 'NOT_HOST', message: 'Only the host can remove a player.' });
      return;
    }

    if (parsed.targetPlayerId === socket.player._id) {
      ackError(ack, { code: 'VALIDATION_ERROR', message: 'The host cannot kick themselves — use leaveRoom instead.' });
      return;
    }

    const target = session.state.players.find((p) => p.id === parsed.targetPlayerId);
    if (!target) {
      ackError(ack, { code: 'NOT_IN_GAME', message: 'That player is not in this room.' });
      return;
    }

    session.state = {
      ...session.state,
      players: session.state.players.filter((p) => p.id !== parsed.targetPlayerId),
    };

    const targetSocketId = session.sockets.get(parsed.targetPlayerId);
    session.sockets.delete(parsed.targetPlayerId);

    await roomsRepository.removePlayerFromRoom(parsed.roomCode, parsed.targetPlayerId);

    // Evict the kicked player's socket from the room's channels so they
    // stop receiving broadcasts for a room they're no longer in — kicking
    // is meaningless if the kicked player's client keeps silently getting
    // stateUpdate events regardless.
    if (targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      void targetSocket?.leave(gameRoom(parsed.roomCode));
      void targetSocket?.leave(playerChannel(parsed.targetPlayerId));
    }

    io.to(gameRoom(parsed.roomCode)).emit('playerLeft', {
      playerId: parsed.targetPlayerId,
      playerName: target.name,
      reason: 'KICKED',
    });

    broadcastStateToRoom(io, session.state);
    ackOk(ack);
  });
}
