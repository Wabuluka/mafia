// ---------------------------------------------------------------------------
// sendChat — the shared event payload (see @mafia/shared) doesn't carry a
// channel; this handler derives it server-side from the sender's current
// role/status/phase, which is the whole point: a client cannot claim to be
// posting in the MAFIA channel by lying in the payload, because there is no
// such field to lie in. See the module header in index.ts, "cheat vector"
// list, item on chat channel spoofing.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { SendChatPayloadSchema, type ChatChannel } from '@mafia/shared';
import { broadcastStateToVillage, gameVillage, playerChannel, type GameServer, type GameSocket } from '../emit';
import { ackOk, parseOrAck, requireGameSession, requirePlayerInSession, type HandlerAck } from '../handlerContext';
import { villageManager, type GameSession } from '../VillageManager';

/** Determines which channel a message from `senderId` actually belongs to,
 * from server-known state alone. Dead players talk in DEAD; living mafia
 * (only during an active game, i.e. outside LOBBY) talk in MAFIA; everyone
 * else talks in LOBBY (pre-game) or DAY (once a game has started). */
function resolveChannelFor(session: GameSession, senderId: string): ChatChannel {
  const sender = session.state.players.find((p) => p.id === senderId);
  if (sender?.status === 'DEAD') return 'DEAD';
  if (session.state.phase === 'LOBBY') return 'LOBBY';
  if (sender?.role === 'MAFIA') return 'MAFIA';
  return 'DAY';
}

export function registerSendChatHandler(io: GameServer, socket: GameSocket): void {
  socket.on('sendChat', (payload, ack?: HandlerAck) => {
    const parsed = parseOrAck(SendChatPayloadSchema, payload, ack);
    if (!parsed) return;

    const session = requireGameSession(parsed.villageCode, ack);
    if (!session) return;
    if (!requirePlayerInSession(session, socket.player._id, ack)) return;

    const channel = resolveChannelFor(session, socket.player._id);

    const message = {
      id: randomUUID(),
      channel,
      senderId: socket.player._id,
      senderName: socket.player.displayName,
      body: parsed.body,
      sentAt: Date.now(),
    };

    session.state = { ...session.state, chatLog: [...session.state.chatLog, message] };
    villageManager.setState(session.villageCode, session.state);

    if (session.gameId) {
      session.pendingEvents.push({ gameId: session.gameId, type: 'CHAT', payload: { message } });
    }

    if (channel === 'MAFIA' || channel === 'DEAD') {
      // Restricted channels: emit directly to each eligible recipient's
      // private channel rather than the shared village room, so a socket
      // that only ever joined the village room (never proven eligible for
      // this channel) has no way to receive it even if it tried to listen
      // for the raw event name.
      const eligiblePlayerIds = session.state.players
        .filter((p) => (channel === 'MAFIA' ? p.role === 'MAFIA' && p.status === 'ALIVE' : p.status === 'DEAD'))
        .map((p) => p.id);
      for (const playerId of eligiblePlayerIds) {
        io.to(playerChannel(playerId)).emit('chatMessage', message);
      }
    } else {
      io.to(gameVillage(parsed.villageCode)).emit('chatMessage', message);
    }

    // Also refresh full state so a late-joining client's chatLog (already
    // filtered per-recipient by redactStateFor) picks up the new message
    // even if they missed the direct chatMessage emit above.
    broadcastStateToVillage(io, session.state);
    ackOk(ack);
  });
}
