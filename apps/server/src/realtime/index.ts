// ---------------------------------------------------------------------------
// realtime/ — the Socket.IO layer connecting clients to the pure engine.
// Call `attachRealtime(io)` once, after the Socket.IO server is constructed
// (see index.ts at the app root), to wire up authentication and every
// event handler.
//
// ===========================================================================
// CHEAT VECTORS — every way a malicious client could try to cheat, and how
// each is blocked. Read this before adding a new handler; a new socket
// event is a new attack surface, and it should be added to this list.
// ===========================================================================
//
// 1. Connecting without a valid session to impersonate a fake/arbitrary
//    player.
//    -> Blocked at the transport level: socketAuth.ts's `io.use(...)`
//       middleware verifies the signed session cookie (same HMAC secret
//       and cookie the HTTP layer uses) BEFORE the `connection` event ever
//       fires. An invalid/missing/tampered cookie gets `next(new Error(...))`
//       and the handshake never completes — no unauthenticated socket ever
//       reaches a handler.
//
// 2. Claiming to be a different player than the one the session cookie
//    resolves to (e.g. putting someone else's playerId in a payload).
//    -> Every ClientToServerEvents payload schema in @mafia/shared
//       deliberately has NO playerId/actorId/voterId field. The actor is
//       always `socket.player._id`, taken from the authenticated
//       handshake, never from anything the client sends. There's no field
///      to lie in.
//
// 3. Acting in a game/room the player was never actually added to (e.g.
//    guessing another room's 4-character code and emitting events at it).
//    -> `requirePlayerInSession` (handlerContext.ts) checks the caller's
//       id against the session's live player roster before every mutating
//       handler does anything. `joinRoom` itself additionally checks the
//       player is on the room's Mongo-persisted `playerIds` list — a
//       socket can't even attach to a room's channels without having gone
//       through the HTTP join endpoint first (see joinRoom.ts).
//
// 4. Submitting a night action as a role you don't have, or acting for a
//    role that doesn't act at night (e.g. a VILLAGER submitting a "kill").
//    -> `applyNightAction` (engine/nightActions.ts) reads the actor's role
//       from the SERVER's FullGameState, never from the client payload
//       (there is no role field in SubmitNightActionPayload), and rejects
//       WRONG_ROLE if that role isn't in NIGHT_ACTING_ROLES.
//
// 5. Acting as a dead player (a corpse submitting a night action or vote).
//    -> Both `applyNightAction` and `castVote` check `actor.status ===
//       'DEAD'` against server state and reject PLAYER_DEAD. Death is only
//       ever set by `resolveNight`/`resolveVote` inside the engine itself.
//
// 6. Acting outside the phase that action belongs to (voting during NIGHT,
//    submitting a night action during DAY_VOTE), e.g. to bypass a UI that
//    would normally prevent it.
//    -> Both engine functions check `state.phase` first and reject
//       WRONG_PHASE. The phase is server-authoritative (RoomManager's
//       in-memory FullGameState), never trusted from the client.
//
// 7. Submitting multiple night actions in the same round to influence the
//    outcome more than once (e.g. mafia spamming kill targets hoping one
//    sticks after a save).
//    -> `applyNightAction` rejects ALREADY_ACTED once one action from that
//       actor exists for the current `roundNumber`. (Votes are the
//       deliberate exception — `castVote` allows changing your mind before
//       the phase resolves, which is a real game mechanic, not a cheat;
//       see engine/voting.ts.)
//
// 8. Replaying/duplicating a submission via a flaky connection or a
//    scripted double-emit, hoping a retried action applies twice.
//    -> submitNightAction.ts and castVote.ts key an idempotency cache
//       (idempotency.ts) on (actor, phase, round[, target]) — a retry with
//       identical semantics collapses to a no-op re-send of current state
//       rather than re-invoking the engine. Combined with #7's
//       ALREADY_ACTED check, a genuine duplicate can never double-apply.
//
// 9. Targeting a player who isn't in the game, or who is already dead, to
//    probe for information or break an invariant.
//    -> Both engine functions validate the target exists in
//       `state.players` and is ALIVE, rejecting INVALID_TARGET/TARGET_DEAD
//       otherwise.
//
// 10. Reading another player's role, or anyone's role before it's publicly
//     revealed, by inspecting the state payload.
//     -> `redactStateFor` (engine/redact.ts) is the only function allowed
//        to produce a PlayerView, and it's built field-by-field from named
//        sources — it never copies FullGameState and deletes fields, so a
//        newly added private field can't accidentally leak by omission of
//        a delete. `emit.ts`'s `emitStateToPlayer`/`broadcastStateToRoom`
//        are the ONLY functions in this codebase allowed to call
//        `redactStateFor` and hand the result to `.emit(...)` — see that
//        module's header. A 200-run property test (engine/__tests__/
//        redact.test.ts) asserts no serialized PlayerView ever contains
//        another player's role string.
//
// 11. Receiving a shared/broadcast payload that happens to contain
//     everyone's private data because it was easier to send one message to
//     the room.
//     -> There is no such broadcast. Every state emission redacts once per
//        recipient and sends it to that player's own private Socket.IO
//        channel (`player:<playerId>`), never the shared game room. See
//        emit.ts's module header for why a single shared payload is
//        structurally incapable of doing this safely.
//
// 12. Listening in on the mafia coordination channel, or the dead-chat
//     channel, without being a living mafia member / dead player.
//     -> sendChat.ts computes the channel SERVER-SIDE from the sender's
//        live role/status (there is no client-supplied channel field to
//        spoof), and MAFIA/DEAD channel messages are emitted directly to
//        each eligible recipient's private channel — never broadcast to
//        the shared game room a merely-connected socket could snoop on.
//
// 13. Forging a detective result, or reading someone else's detective
//     results.
//     -> Detective results are produced only inside `resolveNight`
//        (engine/nightActions.ts) from the server's real role data, never
//        client input, and are emitted only to `player:<detectiveId>`'s
//        private channel (phaseLoop.ts). `redactStateFor`'s `you` block
//        only ever populates `detectiveResults` for the viewer's own id.
//
// 14. Forcing a phase to advance early, or stalling it forever, by not
//     acting (e.g. never voting so DAY_VOTE never resolves).
//     -> Phase advancement is driven entirely by a server-side `setTimeout`
//        (phaseLoop.ts's `scheduleNextPhase`) using durations from
//        @mafia/shared's DEFAULT_PHASE_DURATIONS_MS, never by client
//        signal ("everyone voted, advance now" is a possible future
//        optimization but isn't required for correctness — the timer
//        always fires regardless of participation).
//
// 15. Disconnecting deliberately during a phase where your absence would
//     be informative (e.g. a mafia member going quiet exactly when they'd
//     need to submit a kill) to avoid suspicion, or conversely being
//     unfairly outed by a disconnect.
//     -> disconnect.ts only ever flips `connected: false`; it never
//        removes the player, reveals their role, or otherwise treats a
//        disconnect as distinguishable game information beyond the
//        `connected` flag every player already sees for everyone (a UI
//        detail, not a role signal).
//
// 16. Tampering with the payload's shape/types entirely (wrong types,
//     extra fields, malformed room codes) to trigger a server crash or
//     bypass a check via a type-confusion bug.
//     -> Every handler's first step is `parseOrAck` against the exact Zod
//        schema @mafia/shared defines for that event — the same schema
//        the typed ClientToServerEvents interface promises, so client and
//        server can never structurally disagree. A parse failure acks
//        VALIDATION_ERROR and the handler returns before touching any
//        state.
//
// 17. Sending a room code / target id that's syntactically valid but
//     doesn't correspond to anything (id/code enumeration, guessing).
//     -> Every lookup (`requireGameSession`, engine target validation)
//        fails closed with a typed rejection (ROOM_NOT_FOUND,
//        INVALID_TARGET) rather than throwing or falling through to
//        undefined behavior.
//
// 18. Claiming a phase's countdown has already expired (or hasn't started,
//     or reports a different end time) to trick the UI/server into
//     advancing early or late, e.g. by sending a fabricated timestamp.
//     -> There is no client -> server event that carries a timestamp or a
//        "my timer expired" signal at all (see @mafia/shared's
//        ClientToServerEvents — none of the 8 events has a time field).
//        The deadline is entirely server-computed and server-enforced by
//        `scheduler.ts`'s `setTimeout` against `session.state.phaseTimer`,
//        an absolute epoch-ms value the client only ever RECEIVES, never
//        sends back. A client rendering a fast/slow/frozen local countdown
//        affects nothing but its own display.
//
// 19. Abusing early phase resolution (earlyResolution.ts) — e.g. a solo
//     living mafia member deliberately stalling their own kill submission
//     to deny the town extra deliberation time, or spamming actions hoping
//     to trigger a resolution mid-legitimate-deliberation.
//     -> Early resolution only fires when EVERY required actor has
//        submitted (`isNightResolutionReady`/`isVoteResolutionReady`) — a
//        single holdout can only ever cause the phase to fall back to its
//        full timer, never shorten anyone else's time, and can never
//        FORCE an early resolution alone. Submitting repeatedly doesn't
//        help either: `applyNightAction` rejects a second submission
//        (ALREADY_ACTED) and `castVote` merely replaces the same voter's
//        prior vote, so spamming can't fabricate "everyone's in" sooner
//        than it genuinely is.
//
// 20. A non-host player calling kickPlayer or updateRoomSettings to remove
//     another player or change phase durations without authority to.
//     -> Both handlers check `caller.isHost` read from server state
//        before doing anything, identical to startGame's own check —
//        NOT_HOST otherwise. There is also no way to forge host status:
//        `isHost` is set only by joinRoom (the room creator) or by the
//        server's own host-transfer logic (lobbyManagement.ts), never by
//        anything a client sends.
//
// 21. A host trying to kick themselves (to trigger some edge case in host
//     transfer or room teardown) instead of using leaveRoom.
//     -> kickPlayer explicitly rejects `targetPlayerId === caller.id` with
//        VALIDATION_ERROR, forcing the one already-correct path
//        (leaveRoom, which runs the real host-transfer logic) instead of
//        a second one that would have to reimplement the same rule.
//
// 22. Kicking a player (or changing settings) after the game has already
//     started, e.g. to eject an inconvenient opponent mid-vote.
//     -> Both handlers check `session.state.phase !== 'LOBBY'` and reject
//        INVALID_PHASE — kicking and duration changes are lobby-only,
//        full stop, matching setReady/startGame's own phase gate.
// ===========================================================================

import type { GameServer, GameSocket } from './emit';
import { socketAuthMiddleware } from './socketAuth';
import { registerJoinRoomHandler } from './handlers/joinRoom';
import { registerLeaveRoomHandler } from './handlers/leaveRoom';
import { registerSetReadyHandler } from './handlers/setReady';
import { registerStartGameHandler } from './handlers/startGame';
import { registerSubmitNightActionHandler } from './handlers/submitNightAction';
import { registerCastVoteHandler } from './handlers/castVote';
import { registerSendChatHandler } from './handlers/sendChat';
import { registerRequestResyncHandler } from './handlers/requestResync';
import { registerDisconnectHandler } from './handlers/disconnect';
import { registerKickPlayerHandler } from './handlers/kickPlayer';
import { registerUpdateRoomSettingsHandler } from './handlers/updateRoomSettings';

export { roomManager, type GameSession } from './RoomManager';
export { emitStateToPlayer, broadcastStateToRoom, type GameServer, type GameSocket } from './emit';

/** Wires authentication and every ClientToServerEvents handler onto `io`.
 * Call exactly once at server boot. */
export function attachRealtime(io: GameServer): void {
  io.use(socketAuthMiddleware);

  io.on('connection', (socket: GameSocket) => {
    registerJoinRoomHandler(io, socket);
    registerLeaveRoomHandler(io, socket);
    registerSetReadyHandler(io, socket);
    registerStartGameHandler(io, socket);
    registerSubmitNightActionHandler(io, socket);
    registerCastVoteHandler(io, socket);
    registerSendChatHandler(io, socket);
    registerRequestResyncHandler(io, socket);
    registerKickPlayerHandler(io, socket);
    registerUpdateRoomSettingsHandler(io, socket);
    registerDisconnectHandler(io, socket);
  });
}
