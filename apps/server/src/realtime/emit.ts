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
  InterServerEvents,
  Phase,
  PhaseOutcome,
  PlayerId,
  ServerToClientEvents,
  SocketData,
} from '@mafia/shared';
import { redactStateFor } from '../engine';
import type { GameSession } from './VillageManager';

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

/** Redacts `session.state` for exactly one player and emits it to that
 * player's private channel. This is the only function in the codebase
 * that is allowed to call `redactStateFor` and hand the result to
 * `.emit(...)` — every other call site should go through this or
 * `broadcastStateToVillage`. Takes the whole `session` (not just `state`)
 * so `session.gameId` can ride along on `PlayerView.gameId` — see that
 * field's doc comment in game-state.ts. */
export function emitStateToPlayer(io: GameServer, session: GameSession, playerId: PlayerId): void {
  const view = redactStateFor(session.state, playerId, session.gameId);
  io.to(playerChannel(playerId)).emit('stateUpdate', { state: view });
}

/** Redacts `session.state` once per player currently in the game and emits
 * each result to that player's own private channel — never a single
 * shared broadcast to the shared village room. Use this after any state
 * mutation that every player needs to see reflected (a join, a death, a
 * vote tally update). */
export function broadcastStateToVillage(io: GameServer, session: GameSession): void {
  for (const player of session.state.players) {
    emitStateToPlayer(io, session, player.id);
  }
}

/** Same per-player redaction discipline as `broadcastStateToVillage`, but for
 * the `phaseChanged` event, which additionally carries the phase that just
 * ended, the narration text describing what happened during it (see
 * phaseLoop.ts's `narrationFor`), and the structured `outcome` (see
 * phaseLoop.ts's `outcomeFor`). `outcome` is identical for every recipient
 * — unlike `state`, it carries nothing that isn't already public (a death's
 * `revealedRole` is, by definition, revealed to everyone) — but is still
 * computed once per player alongside the redacted view for a single,
 * consistent emit call per recipient. */
export function broadcastPhaseChange(
  io: GameServer,
  session: GameSession,
  previousPhase: Phase,
  narration: string,
  outcome: PhaseOutcome,
): void {
  for (const player of session.state.players) {
    const view = redactStateFor(session.state, player.id, session.gameId);
    io.to(playerChannel(player.id)).emit('phaseChanged', { state: view, previousPhase, narration, outcome });
  }
}

/**
 * The high-frequency diff path for vote changes (see castVote.ts and
 * VoteChangedPayloadSchema's doc comment in @mafia/shared/events.ts for
 * the measured payload-size numbers this exists to fix). Deliberately
 * NOT per-player-redacted like the two functions above: `votes` is
 * computed IDENTICALLY for every viewer inside `redactStateFor` (see
 * engine/redact.ts — the current round's votes are public information
 * during DAY_VOTE, filtered only by round number, never by viewer
 * identity), so there is nothing here that differs per recipient. That's
 * what makes a single shared `io.to(gameVillage(...)).emit(...)` safe for
 * this one payload specifically — the module header's warning about
 * shared payloads leaking a `you` block doesn't apply, because this
 * payload never carries one.
 *
 * Callers must still call `broadcastStateToVillage` at the actual phase
 * boundary (see phaseLoop.ts) so every client's full `you` block — in
 * particular `hasActedThisPhase` — catches up; this function only keeps
 * `view.votes` current in between those checkpoints.
 */
export function broadcastVoteChange(io: GameServer, session: GameSession): void {
  const currentRoundVotes = session.state.votes
    .filter((v) => v.dayNumber === session.state.roundNumber)
    .map((v) => ({ voterId: v.voterId, targetId: v.targetId, dayNumber: v.dayNumber, submittedAt: v.submittedAt }));
  io.to(gameVillage(session.villageCode)).emit('voteChanged', { votes: currentRoundVotes });
}

/** The same diff path as broadcastVoteChange above, for nominations during
 * DAY_DISCUSSION — see submitNomination.ts and NominationChangedPayloadSchema's
 * doc comment. Also viewer-identical for the same reason: nominations are
 * public the instant they're cast (see engine/redact.ts), so one shared
 * emit is safe here too. */
export function broadcastNominationChange(io: GameServer, session: GameSession): void {
  const currentRoundNominations = session.state.nominations
    .filter((n) => n.dayNumber === session.state.roundNumber)
    .map((n) => ({ nominatorId: n.nominatorId, targetId: n.targetId, dayNumber: n.dayNumber, submittedAt: n.submittedAt }));
  io.to(gameVillage(session.villageCode)).emit('nominationChanged', { nominations: currentRoundNominations });
}
