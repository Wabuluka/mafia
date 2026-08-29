// ---------------------------------------------------------------------------
// cancelJoinRequest — the WAITING PLAYER'S own way to withdraw a pending
// join request (the /join screen's "Cancel" button). Distinct from
// respondToJoinRequest.ts's deny branch: that's the HOST denying someone
// else; this is a requester withdrawing themselves, so there's no host-only
// authorization check here — anyone can cancel their OWN request (and only
// their own, since `socket.player._id` is always the actor, never a
// payload-supplied id — same rule every other handler in this codebase
// follows).
//
// Always acks success, even if there was nothing to cancel (already
// accepted/denied by the host, or never requested) — same "idempotent,
// nothing left to do" contract as clearSession over HTTP. A client racing
// its own cancel against the host's response doesn't need to distinguish
// those cases; either way, this player is not pending afterward.
// ---------------------------------------------------------------------------

import { CancelJoinRequestPayloadSchema } from '@mafia/shared';
import { villagesRepository } from '../../db';
import type { GameServer, GameSocket } from '../emit';
import { ackOk, parseOrAck, type HandlerAck } from '../handlerContext';
import { broadcastJoinRequests } from '../joinRequests';
import { villageManager } from '../VillageManager';

export function registerCancelJoinRequestHandler(io: GameServer, socket: GameSocket): void {
  socket.on('cancelJoinRequest', async (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(CancelJoinRequestPayloadSchema, payload, ack);
    if (!parsed) return;

    const player = socket.player;
    const session = villageManager.get(parsed.villageCode);

    if (session?.pendingRequests.has(player._id)) {
      session.pendingRequests.delete(player._id);
      broadcastJoinRequests(io, session);
    }

    await villagesRepository.removePendingPlayer(parsed.villageCode, player._id);
    ackOk(ack);
  });
}
