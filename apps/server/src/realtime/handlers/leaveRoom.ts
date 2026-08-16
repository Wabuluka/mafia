// ---------------------------------------------------------------------------
// leaveRoom — an explicit, voluntary departure (as opposed to disconnect.ts,
// which handles an involuntary drop and never removes the player). Only
// valid in the LOBBY: once a game has started, a player who wants to stop
// participating simply disconnects/backgrounds — see the module header in
// index.ts for why an in-progress game never removes a roster entry.
//
// Host handling: if the departing player was host, host transfers to the
// longest-connected remaining player — see lobbyManagement.ts's
// `transferHostIfNeeded` for the exact rule.
// ---------------------------------------------------------------------------

import { LeaveRoomPayloadSchema } from '@mafia/shared';
import { roomsRepository } from '../../db';
import { gameRoom, broadcastStateToRoom, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, type HandlerAck } from '../handlerContext';
import { transferHostIfNeeded } from '../lobbyManagement';
import { roomManager } from '../RoomManager';

export function registerLeaveRoomHandler(io: GameServer, socket: GameSocket): void {
  socket.on('leaveRoom', async (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(LeaveRoomPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.roomCode, ack);
    if (!session) return;

    if (session.state.phase !== 'LOBBY') {
      ackError(ack, { code: 'INVALID_PHASE', message: 'Cannot leave a room once a game is in progress — disconnect instead.' });
      return;
    }

    const player = socket.player;

    // Transfer host BEFORE removing the departing player from the roster —
    // transferHostIfNeeded needs to see the full player list (including
    // the outgoing host) to know who currently holds it, then we drop
    // them from the roster in the same step.
    const withHostTransferred = transferHostIfNeeded(session.state, player._id);
    session.state = {
      ...withHostTransferred,
      players: withHostTransferred.players.filter((p) => p.id !== player._id),
    };
    session.sockets.delete(player._id);

    await roomsRepository.removePlayerFromRoom(parsed.roomCode, player._id);
    await socket.leave(gameRoom(parsed.roomCode));

    io.to(gameRoom(parsed.roomCode)).emit('playerLeft', { playerId: player._id, playerName: player.displayName, reason: 'LEFT' });

    if (session.state.players.length === 0) {
      roomManager.delete(parsed.roomCode);
    } else {
      const newHost = session.state.players.find((p) => p.isHost);
      if (newHost) {
        await roomsRepository.setHost(parsed.roomCode, newHost.id);
      }
      broadcastStateToRoom(io, session.state);
    }

    ackOk(ack);
  });
}
