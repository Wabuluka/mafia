// ---------------------------------------------------------------------------
// requestResync — a reconnecting client's way to rebuild its view without a
// full page reload. Simply re-runs the exact same redaction+emit path every
// other state change already uses (emitStateToPlayer), guaranteeing the
// resynced view can never be more permissive than a normal update — there
// is no separate "resync" code path that could drift from the redaction
// logic and accidentally leak something a regular update wouldn't.
// ---------------------------------------------------------------------------

import { RequestResyncPayloadSchema } from '@mafia/shared';
import { emitStateToPlayer, type GameServer, type GameSocket } from '../emit';
import { ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';

export function registerRequestResyncHandler(io: GameServer, socket: GameSocket): void {
  socket.on('requestResync', (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(RequestResyncPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    emitStateToPlayer(io, session, socket.player._id);
    ackOk(ack);
  });
}
