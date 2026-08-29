// ---------------------------------------------------------------------------
// advanceNightSubPhase — host-only, moderator-driven night flow. Steps
// NIGHT's internal sequence (MAFIA -> DETECTIVE -> DOCTOR -> COMPLETE, see
// @mafia/shared's NightSubPhaseSchema) to the next role that has a living
// holder, silently skipping any role no one alive holds. Mirrors
// endPhaseNow's "host forces the next thing to happen" shape, but scoped to
// NIGHT's internal sequence rather than the top-level phase machine.
//
// Reaching COMPLETE this way is what actually triggers NIGHT's resolution
// (the same `advancePhase` a normal deadline/`endPhaseNow` would run) —
// see phaseLoop.ts's advancePhase, which now only computes resolveNight
// once `nightSubPhase === 'COMPLETE'` (or is forced via the deadline/
// endPhaseNow escape hatch, which snaps it to COMPLETE itself).
// ---------------------------------------------------------------------------

import { AdvanceNightSubPhasePayloadSchema, nextApplicableNightSubPhase } from '@mafia/shared';
import { broadcastStateToVillage, type GameServer, type GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { advancePhase } from '../phaseLoop';
import { villageManager } from '../VillageManager';

export function registerAdvanceNightSubPhaseHandler(io: GameServer, socket: GameSocket): void {
  socket.on('advanceNightSubPhase', async (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(AdvanceNightSubPhasePayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    const caller = session.state.players.find((p) => p.id === socket.player._id);
    if (!caller?.isHost) {
      ackError(ack, { code: 'NOT_HOST', message: 'Only the host can advance the night sequence.' });
      return;
    }

    if (session.state.phase !== 'NIGHT') {
      ackError(ack, { code: 'INVALID_PHASE', message: 'The night sequence can only be advanced during NIGHT.' });
      return;
    }

    if (session.state.nightSubPhase === 'COMPLETE' || session.state.nightSubPhase === undefined) {
      ackError(ack, {
        code: 'WRONG_SUB_PHASE',
        message: 'The night sequence has already reached its end — nothing left to advance.',
      });
      return;
    }

    const next = nextApplicableNightSubPhase(session.state.players, session.state.nightSubPhase);
    session.state = { ...session.state, nightSubPhase: next };
    villageManager.setState(session.villageCode, session.state);

    if (next === 'COMPLETE') {
      // Resolves NIGHT immediately, same path as a normal deadline/
      // endPhaseNow — advancePhase broadcasts the refreshed state itself.
      ackOk(ack);
      await advancePhase(io, session);
      return;
    }

    broadcastStateToVillage(io, session);
    ackOk(ack);
  });
}
