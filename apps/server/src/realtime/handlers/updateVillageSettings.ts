// ---------------------------------------------------------------------------
// updateVillageSettings — host-only, lobby-only. Sets per-session phase
// duration overrides (see VillageManager.ts's `phaseDurationOverridesMs` and
// phaseLoop.ts's `durationFor`) that take effect once the game starts.
// Purely an in-memory setting — nothing is persisted to Mongo, since it
// only ever matters for a game that hasn't started yet and is meaningless
// once one has (see the VillageManager field's doc comment for why it's
// locked in at game start rather than adjustable mid-game).
// ---------------------------------------------------------------------------

import { UpdateVillageSettingsPayloadSchema, DEFAULT_PHASE_DURATIONS_MS } from '@mafia/shared';
import type { GameServer, GameSocket } from '../emit';
import { ackError, ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';

export function registerUpdateVillageSettingsHandler(io: GameServer, socket: GameSocket): void {
  socket.on('updateVillageSettings', (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(UpdateVillageSettingsPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    if (session.state.phase !== 'LOBBY') {
      ackError(ack, { code: 'INVALID_PHASE', message: 'Phase durations can only be changed while still in the lobby.' });
      return;
    }

    const caller = session.state.players.find((p) => p.id === socket.player._id);
    if (!caller?.isHost) {
      ackError(ack, { code: 'NOT_HOST', message: 'Only the host can change village settings.' });
      return;
    }

    session.phaseDurationOverridesMs = {
      ...session.phaseDurationOverridesMs,
      ...parsed.phaseDurationsMs,
    };

    io.to(`game:${parsed.villageCode}`).emit('villageSettingsUpdated', {
      phaseDurationsMs: {
        NIGHT: session.phaseDurationOverridesMs.NIGHT ?? DEFAULT_PHASE_DURATIONS_MS.NIGHT,
        DAY_DISCUSSION: session.phaseDurationOverridesMs.DAY_DISCUSSION ?? DEFAULT_PHASE_DURATIONS_MS.DAY_DISCUSSION,
        DAY_VOTE: session.phaseDurationOverridesMs.DAY_VOTE ?? DEFAULT_PHASE_DURATIONS_MS.DAY_VOTE,
      },
    });

    ackOk(ack);
  });
}
