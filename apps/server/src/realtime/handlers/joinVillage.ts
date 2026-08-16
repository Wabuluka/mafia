// ---------------------------------------------------------------------------
// joinVillage — attaches this socket to a village's Socket.IO room + the caller's
// private player channel. Capacity/in-progress checks were already enforced
// by the HTTP POST /api/villages/:code/join the client calls before ever
// opening a socket (see http/routes/villages.routes.ts) — this handler's job
// is purely to wire up the realtime side for a player already recorded as
// a village member in Mongo, or to bootstrap a fresh in-memory GameSession the
// first time anyone in the village connects a socket.
// ---------------------------------------------------------------------------

import { brandFullGameState, JoinVillagePayloadSchema, type PlayerId, type VillageCode } from '@mafia/shared';
import { villagesRepository } from '../../db';
import { gameVillage, playerChannel, broadcastStateToVillage, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, type HandlerAck } from '../handlerContext';
import { villageManager, type GameSession } from '../VillageManager';

export function registerJoinVillageHandler(io: GameServer, socket: GameSocket): void {
  socket.on('joinVillage', async (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(JoinVillagePayloadSchema, payload, ack);
    if (!parsed) return;

    // The socket's authenticated identity (from the handshake cookie) is
    // always the actor — a client cannot join a village "as" another player
    // by putting a different id in the payload, because the payload
    // doesn't even carry one. `playerName` here is cosmetic-only (already
    // set at session creation); it's accepted for schema compatibility but
    // never used to re-derive identity.
    const player = socket.player;

    const villageDoc = await villagesRepository.findVillageByCode(parsed.villageCode);
    if (!villageDoc) {
      ackError(ack, { code: 'VILLAGE_NOT_FOUND', message: `no village found with code ${parsed.villageCode}.` });
      return;
    }
    if (!villageDoc.playerIds.includes(player._id)) {
      // The HTTP join endpoint is the only path that adds a player to a
      // village's roster — a socket cannot join a village it was never granted
      // membership in via that door, even with a resolvable village code.
      ackError(ack, { code: 'NOT_IN_GAME', message: 'Join this village via POST /api/villages/:code/join first.' });
      return;
    }

    let session = villageManager.get(parsed.villageCode);
    if (!session) {
      session = bootstrapLobbySession(parsed.villageCode, villageDoc.hostId);
      villageManager.create(session);
    }

    // Idempotent: reconnecting (or double-emitting joinVillage) just re-adds
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
            isHost: player._id === villageDoc.hostId,
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
    await socket.join([gameVillage(parsed.villageCode), playerChannel(player._id)]);

    io.to(gameVillage(parsed.villageCode)).emit('playerJoined', { playerId: player._id, playerName: player.displayName });
    broadcastStateToVillage(io, session.state);
    ackOk(ack);
  });
}

/** Mints a fresh, empty LOBBY-phase GameSession for a village that has no
 * in-memory session yet — the first socket to join after village creation
 * bootstraps it. `hostId` isn't needed here (each player's `isHost` flag
 * is computed per-player at the join call site above), kept as a parameter
 * anyway so the function signature documents which village this session
 * belongs to at a glance. */
export function bootstrapLobbySession(villageCode: VillageCode, _hostId: PlayerId): GameSession {
  return {
    villageCode,
    state: brandFullGameState({
      villageCode,
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
