// ---------------------------------------------------------------------------
// respondToJoinRequest — host-only, lobby-only. Accepts or denies one
// pending join request.
//
// ACCEPT DOES NOT ADMIT THE PLAYER INTO THE LIVE ROSTER DIRECTLY — it only
// promotes them in Mongo (pendingPlayerIds -> playerIds) and tells their
// socket to proceed. The requester's client then calls the NORMAL
// `joinVillage` event itself, same as any already-approved player — see
// joinVillage.ts's own roster-admission logic (append to
// `session.state.players`, handle the reconnect-vs-first-join branch,
// etc). Deliberately not duplicated here: that logic already has to stay
// correct for the ordinary join/reconnect path, and a second, easy-to-drift
// copy of "how a player gets added to the live roster" is exactly the kind
// of split-brain bug this design avoids. This handler's only job is
// resolving the REQUEST (pending -> accepted/denied); actually joining the
// live session is `joinVillage`'s job, unconditionally.
//
// Either way (accept or deny) this is the ONLY place a pending request's
// Mongo/in-memory state is resolved — accept/deny are two branches of the
// same handler rather than two separate events, so there's exactly one
// place enforcing "you can't respond to a request that isn't actually
// pending anymore" (a host double-tapping Accept, or two hosts somehow
// racing on a transfer, can't double-admit or resurrect a denied request).
// ---------------------------------------------------------------------------

import { RespondToJoinRequestPayloadSchema } from '@mafia/shared';
import { villagesRepository } from '../../db';
import { playerChannel, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { broadcastJoinRequests } from '../joinRequests';

export function registerRespondToJoinRequestHandler(io: GameServer, socket: GameSocket): void {
  socket.on('respondToJoinRequest', async (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(RespondToJoinRequestPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    if (session.state.phase !== 'LOBBY') {
      ackError(ack, { code: 'INVALID_PHASE', message: 'Join requests can only be answered while still in the lobby.' });
      return;
    }

    const caller = session.state.players.find((p) => p.id === socket.player._id);
    if (!caller?.isHost) {
      ackError(ack, { code: 'NOT_HOST', message: 'Only the host can respond to a join request.' });
      return;
    }

    const request = session.pendingRequests.get(parsed.targetPlayerId);
    if (!request) {
      ackError(ack, { code: 'NOT_IN_GAME', message: 'That join request no longer exists.' });
      return;
    }

    session.pendingRequests.delete(parsed.targetPlayerId);

    const requesterSocket = io.sockets.sockets.get(request.socketId);

    if (!parsed.accept) {
      await villagesRepository.removePendingPlayer(parsed.villageCode, parsed.targetPlayerId);
      requesterSocket?.emit('joinRequestResolved', {
        villageCode: parsed.villageCode,
        accepted: false,
        reason: 'DENIED',
      });
      void requesterSocket?.leave(playerChannel(parsed.targetPlayerId));
      broadcastJoinRequests(io, session);
      ackOk(ack);
      return;
    }

    // ACCEPT: capacity is re-checked here, not just at the original HTTP
    // request time — the lobby could have filled up with OTHER accepted
    // requests in the meantime (pending requests never reserved a slot,
    // by design — see villages.routes.ts's own doc comment on that
    // choice), so this is the actual point of truth for "is there still
    // room," not the moment the request was first made.
    const villageDoc = await villagesRepository.findVillageByCode(parsed.villageCode);
    if (!villageDoc) {
      ackError(ack, { code: 'VILLAGE_NOT_FOUND', message: `No village found with code ${parsed.villageCode}.` });
      return;
    }
    if (villageDoc.playerIds.length >= villageDoc.maxPlayers) {
      // Put the request back rather than silently dropping it — the host
      // gets a clear rejection reason and the requester stays queued
      // rather than needing to re-request from scratch.
      session.pendingRequests.set(parsed.targetPlayerId, request);
      ackError(ack, { code: 'VILLAGE_FULL', message: 'This village is already at capacity.' });
      return;
    }

    await villagesRepository.promotePendingPlayer(parsed.villageCode, parsed.targetPlayerId);

    // Tell the requester's socket it's clear to actually join — their
    // client is expected to call `joinVillage` next (see this file's own
    // module header on why admission itself lives there, not here).
    requesterSocket?.emit('joinRequestResolved', {
      villageCode: parsed.villageCode,
      accepted: true,
      reason: 'ACCEPTED',
    });
    void requesterSocket?.leave(playerChannel(parsed.targetPlayerId));

    broadcastJoinRequests(io, session);
    ackOk(ack);
  });
}
