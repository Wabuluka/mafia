// ---------------------------------------------------------------------------
// requestToJoin — registers a PENDING player's socket on the live session
// so they can (a) actually receive the eventual `joinRequestResolved`
// notification and (b) be shown to the host as a live request. The HTTP
// POST /api/villages/:code/join call (see villages.routes.ts) is what
// actually persists the pending state in Mongo; this socket event is the
// realtime half — a pending player who never opens a socket (closed the
// tab before this fires) simply never shows up live to the host, and their
// Mongo-persisted pending entry is cleaned up passively (see
// removePendingPlayer call sites) rather than this handler needing to
// guess at their liveness.
//
// Deliberately NOT routed through requireGameSession/requirePlayerInSession
// — those assume `playerId` is (or should already be) a member of
// `session.state.players`, which is exactly what a pending requester is
// NOT yet. A pending player has no role, no vote, isn't in the roster
// anywhere the engine looks, and must stay invisible to every other
// player's PlayerView — see VillageManager.ts's `pendingRequests` doc
// comment.
// ---------------------------------------------------------------------------

import { RequestToJoinPayloadSchema } from '@mafia/shared';
import { villagesRepository } from '../../db';
import { playerChannel, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, type HandlerAck } from '../handlerContext';
import { broadcastJoinRequests } from '../joinRequests';
import { villageManager } from '../VillageManager';

export function registerRequestToJoinHandler(io: GameServer, socket: GameSocket): void {
  socket.on('requestToJoin', async (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(RequestToJoinPayloadSchema, payload, ack);
    if (!parsed) return;

    const player = socket.player;

    const villageDoc = await villagesRepository.findVillageByCode(parsed.villageCode);
    if (!villageDoc) {
      ackError(ack, { code: 'VILLAGE_NOT_FOUND', message: `no village found with code ${parsed.villageCode}.` });
      return;
    }
    if (!villageDoc.pendingPlayerIds.includes(player._id)) {
      // Either never requested (should have gone through the HTTP join
      // endpoint first), already accepted (belongs on joinVillage instead),
      // or already denied. Any of those means this event isn't the right
      // next step for this player right now.
      ackError(ack, {
        code: 'NOT_IN_GAME',
        message: 'No pending join request found — use POST /api/villages/:code/join first.',
      });
      return;
    }

    const session = villageManager.get(parsed.villageCode);
    if (!session) {
      // The host hasn't opened a socket yet (or the process restarted) —
      // there's no live session to register against. Rare in practice
      // (the host is normally already in the lobby by the time anyone
      // else has a code to join with), surfaced as a clear, retriable
      // error rather than silently bootstrapping a session with no host.
      ackError(ack, { code: 'VILLAGE_NOT_FOUND', message: 'The host is not currently connected. Try again shortly.' });
      return;
    }

    session.pendingRequests.set(player._id, {
      playerName: player.displayName,
      socketId: socket.id,
      requestedAt: Date.now(),
    });

    await socket.join(playerChannel(player._id));
    broadcastJoinRequests(io, session);
    ackOk(ack);
  });
}
