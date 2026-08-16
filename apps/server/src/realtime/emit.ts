// ---------------------------------------------------------------------------
// The single safe way to send game state to clients. Every `stateUpdate` /
// `phaseChanged` emission in this codebase MUST go through one of these two
// functions — nothing else in realtime/ is allowed to call `.emit(...)`
// with a raw FullGameState or a hand-built PlayerView. That's enforced by
// convention + code review here (there's no private-channel-per-player
// primitive in Socket.IO itself that would make bypassing this a type
// error), so keep this module as the only import site for "send state".
//
// Per-player private channel: on connect, every authenticated socket joins
// a Socket.IO room named `player:<playerId>` (see index.ts) in addition to
// the shared village room `game:<villageCode>` (see `gameVillage` below —
// "room" here is Socket.IO's own primitive/terminology, distinct from our
// "village" domain concept). Broadcasting state never uses
// `io.to(gameVillage(...)).emit(...)` with a single shared payload — that would
// send the SAME object to every player, which is exactly the leak this
// whole layer exists to prevent (a shared payload can only be redacted to
// the lowest common denominator, i.e. it can't contain anyone's private
// `you` block at all, or it leaks everyone's). Instead, `broadcastStateToVillage`
// below redacts once per player and emits to that player's private channel
// individually.
// ---------------------------------------------------------------------------

import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  FullGameState,
  InterServerEvents,
  Phase,
  PlayerId,
  ServerToClientEvents,
  SocketData,
} from '@mafia/shared';
import { redactStateFor } from '../engine';

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** The fully-typed per-connection socket: `socket.on('joinVillage', ...)` etc.
 * are checked against ClientToServerEvents' exact payload/ack signatures.
 * Every handler module should import this instead of the bare `Socket`
 * type from 'socket.io', so a payload-shape mistake is a compile error
 * rather than only caught at runtime by Zod. */
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function playerChannel(playerId: PlayerId): string {
  return `player:${playerId}`;
}

export function gameVillage(villageCode: string): string {
  return `game:${villageCode}`;
}

/** Redacts `state` for exactly one player and emits it to that player's
 * private channel. This is the only function in the codebase that is
 * allowed to call `redactStateFor` and hand the result to `.emit(...)` —
 * every other call site should go through this or `broadcastStateToVillage`. */
export function emitStateToPlayer(io: GameServer, state: FullGameState, playerId: PlayerId): void {
  const view = redactStateFor(state, playerId);
  io.to(playerChannel(playerId)).emit('stateUpdate', { state: view });
}

/** Redacts `state` once per player currently in the game and emits each
 * result to that player's own private channel — never a single shared
 * broadcast to the shared village room. Use this after any state mutation that every
 * player needs to see reflected (a join, a death, a vote tally update). */
export function broadcastStateToVillage(io: GameServer, state: FullGameState): void {
  for (const player of state.players) {
    emitStateToPlayer(io, state, player.id);
  }
}

/** Same per-player redaction discipline as `broadcastStateToVillage`, but for
 * the `phaseChanged` event, which additionally carries the phase that just
 * ended and the narration text describing what happened during it — see
 * phaseLoop.ts's `narrationFor`. */
export function broadcastPhaseChange(io: GameServer, state: FullGameState, previousPhase: Phase, narration: string): void {
  for (const player of state.players) {
    const view = redactStateFor(state, player.id);
    io.to(playerChannel(player.id)).emit('phaseChanged', { state: view, previousPhase, narration });
  }
}
