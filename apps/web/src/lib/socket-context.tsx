'use client';

// ---------------------------------------------------------------------------
// SocketProvider — the one place this app owns a Socket.IO connection.
// Responsibilities, and only these (no game logic lives here — see the
// module header in components/showcase and every game-screen component for
// where actual gameplay state is handled):
//
//   1. Connect ONLY once explicitly asked to, via `connect()` — NOT
//      automatically on mount. The socket handshake is authenticated by
//      the signed session cookie (see server/realtime/socketAuth.ts), and
//      that cookie doesn't exist until POST /api/session has completed
//      (see lib/api.ts's createOrResumeSession). A socket that dialed
//      immediately on mount — e.g. from a provider mounted at the root
//      layout, which runs on every page including a fresh visitor's very
//      first Home-screen paint — would race that session call and, on the
//      very first connection attempt, get rejected with UNAUTHENTICATED
//      before the cookie was ever set. `connect()` is idempotent and safe
//      to call from any screen once it knows a session exists (every
//      screen in this app that needs the socket already awaits
//      createOrResumeSession() first — see useVillageState.ts / the lobby
//      page), so the ordering is enforced by the caller, not guessed at
//      here.
//   2. Reconnect with exponential backoff + jitter on an unexpected
//      disconnect (Socket.IO's own client has a built-in reconnection
//      manager; this wraps it to also drive the `status` exposed to the
//      UI and to layer resync-on-reconnect on top — see (3)).
//   3. Resync on reconnect: the moment the socket comes back up after
//      having been connected before, emit `requestResync` for the village the
//      caller most recently joined, so a reconnecting client rebuilds its
//      view from the server's current truth rather than trusting whatever
//      stale state it had cached across the gap.
//   4. Expose typed emit functions (`emit.joinVillage(...)`, etc.) instead of
//      a raw untyped `.emit(event, payload)` call, so a call-site typo or
//      payload-shape mistake is a compile error.
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Socket } from 'socket.io-client';
import type {
  AckResult,
  AdvanceNightSubPhasePayload,
  CancelJoinRequestPayload,
  CastVotePayload,
  ClientToServerEvents,
  EndPhaseNowPayload,
  JoinVillagePayload,
  KickPlayerPayload,
  LeaveVillagePayload,
  VillageCode,
  PauseTimerPayload,
  PlayAgainPayload,
  RequestToJoinPayload,
  RespondToJoinRequestPayload,
  ResumeTimerPayload,
  RevealNarrationPayload,
  ServerToClientEvents,
  SendChatPayload,
  SetReadyPayload,
  StartGamePayload,
  StartPhaseTimerPayload,
  SubmitNightActionPayload,
  SubmitNominationPayload,
  UpdateVillageSettingsPayload,
} from '@mafia/shared';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'superseded'
  | 'shuttingDown';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

type Ack = (result: AckResult) => void;

/** Typed wrappers around `socket.emit` — one function per
 * ClientToServerEvents member, each returning a Promise of the ack rather
 * than taking a callback, since every call site in this app awaits the
 * result rather than juggling a callback. */
export interface TypedEmit {
  joinVillage: (payload: JoinVillagePayload) => Promise<AckResult>;
  leaveVillage: (payload: LeaveVillagePayload) => Promise<AckResult>;
  setReady: (payload: SetReadyPayload) => Promise<AckResult>;
  startGame: (payload: StartGamePayload) => Promise<AckResult>;
  playAgain: (payload: PlayAgainPayload) => Promise<AckResult>;
  submitNightAction: (payload: SubmitNightActionPayload) => Promise<AckResult>;
  castVote: (payload: CastVotePayload) => Promise<AckResult>;
  submitNomination: (payload: SubmitNominationPayload) => Promise<AckResult>;
  sendChat: (payload: SendChatPayload) => Promise<AckResult>;
  kickPlayer: (payload: KickPlayerPayload) => Promise<AckResult>;
  updateVillageSettings: (payload: UpdateVillageSettingsPayload) => Promise<AckResult>;
  requestToJoin: (payload: RequestToJoinPayload) => Promise<AckResult>;
  respondToJoinRequest: (payload: RespondToJoinRequestPayload) => Promise<AckResult>;
  cancelJoinRequest: (payload: CancelJoinRequestPayload) => Promise<AckResult>;
  pauseTimer: (payload: PauseTimerPayload) => Promise<AckResult>;
  resumeTimer: (payload: ResumeTimerPayload) => Promise<AckResult>;
  startPhaseTimer: (payload: StartPhaseTimerPayload) => Promise<AckResult>;
  endPhaseNow: (payload: EndPhaseNowPayload) => Promise<AckResult>;
  revealNarration: (payload: RevealNarrationPayload) => Promise<AckResult>;
  advanceNightSubPhase: (payload: AdvanceNightSubPhasePayload) => Promise<AckResult>;
}

export interface SocketContextValue {
  status: ConnectionStatus;
  socket: GameSocket | null;
  emit: TypedEmit;
  /** Opens the connection. Safe to call multiple times — a no-op if
   * already connected or already connecting. Callers should only invoke
   * this once a session cookie is known to exist (see the module header). */
  connect: () => void;
  /** Tells the provider which village to resync on the next reconnect. Call
   * this once a client has successfully joined a village; the provider has no
   * other way to know which village's `requestResync` to fire. */
  setActiveVillage: (villageCode: VillageCode | null) => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 10_000;

function emitWithAck<Payload>(
  socket: GameSocket | null,
  event: keyof ClientToServerEvents,
  payload: Payload,
): Promise<AckResult> {
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error(`Cannot emit "${event}": socket is not connected.`));
      return;
    }
    // Every ClientToServerEvents member has the identical (payload, ack?)
    // shape (see @mafia/shared/events.ts) — this generic helper relies on
    // that uniformity so TypedEmit below doesn't need to hand-write the
    // same emit/promise wiring eight times.
    (socket.emit as (ev: string, payload: Payload, ack: Ack) => void)(event, payload, resolve);
  });
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const socketRef = useRef<GameSocket | null>(null);
  const activeVillageRef = useRef<VillageCode | null>(null);
  const hasConnectedBeforeRef = useRef(false);
  /** Set once, permanently, on `sessionSuperseded` — this tab lost its
   * session to a newer one (see the eviction logic in
   * realtime/handlers/joinVillage.ts). Distinct from every other
   * disconnect state in that it is NEVER retried: `connect()` below
   * refuses to redial once this is set, matching the "clear message,
   * locked out, full stop" contract this state exists for. */
  const supersededRef = useRef(false);
  /** Set once, permanently, on `serverShuttingDown` (see index.ts's
   * graceful-shutdown sequence and realtime/shutdown.ts) — the process is
   * about to exit and this socket's imminent 'disconnect' isn't something
   * to retry into. Same terminal treatment as `supersededRef`: `connect()`
   * below refuses to redial once set. A fresh page load once the new
   * instance is up (behind whatever the deployment platform's restart
   * delay is) is the intended recovery path, not an automatic reconnect
   * racing the old process's teardown. */
  const shuttingDownRef = useRef(false);
  // Force a re-render when the socket instance itself changes (on the
  // first `connect()` call, in practice) so consumers reading `socket`
  // from context see it.
  const [, forceRender] = useState(0);

  // The socket instance is created once, lazily, the first time
  // `connect()` is called — NOT eagerly here — but its event listeners
  // only need wiring once too, so they're attached inside `createSocket`
  // (called from `connect()`, once its dynamic import of socket.io-client
  // resolves — see that function below) rather than a separate effect
  // keyed on a socket that doesn't exist yet at mount time.
  //
  // Guards against two overlapping connect() calls both winning the race to
  // dynamic-import socket.io-client and each constructing their own socket
  // — see the dynamicImportInFlightRef check below. Not a concern with the
  // static top-level import this replaces (module init only ever runs
  // once), so it's new surface area specifically introduced by deferring
  // the import — worth calling out explicitly rather than assuming away.
  const dynamicImportInFlightRef = useRef(false);

  const createSocket = useCallback((io: typeof import('socket.io-client').io) => {
    // Same-origin by default: connect to this page's origin and let the
    // Next.js rewrite for /socket.io/* (see next.config.mjs) proxy the
    // handshake + WS upgrade to the real backend, keeping the session
    // cookie first-party. NEXT_PUBLIC_SOCKET_URL overrides this only for
    // local dev (server on :4000) or a deployment that skips the proxy.
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;

    const socket: GameSocket = io(url, {
      transports: ['websocket'],
      withCredentials: true, // send the signed session cookie on the handshake
      reconnection: true,
      reconnectionDelay: RECONNECT_BASE_DELAY_MS,
      reconnectionDelayMax: RECONNECT_MAX_DELAY_MS,
      // Socket.IO's own backoff already randomizes jitter internally
      // between reconnectionDelay and reconnectionDelayMax with an
      // exponential curve — no need to hand-roll a second backoff layer
      // on top; this provider's job is reacting to the resulting
      // connect/reconnect/disconnect events, not re-implementing them.
      reconnectionAttempts: Infinity,
    });

    socket.on('connect', () => {
      setStatus('connected');

      // Resync-on-reconnect: only fires when this is a RECONNECT (we were
      // connected before and dropped), not the very first connect — a
      // fresh connect has no prior state to reconcile against, and the
      // village-join flow itself is what populates state the first time.
      if (hasConnectedBeforeRef.current && activeVillageRef.current) {
        socket.emit('requestResync', { villageCode: activeVillageRef.current });
      }
      hasConnectedBeforeRef.current = true;
    });

    // Fires just before the server-initiated `disconnect` that follows a
    // second tab/device joining the same session (see
    // realtime/handlers/joinVillage.ts's eviction logic). Setting status
    // here, ahead of the 'disconnect' handler below, is what lets that
    // handler tell "we were superseded" apart from an ordinary server
    // disconnect (auth failure, etc) — both arrive as reason ===
    // 'io server disconnect', so the distinction has to come from this
    // separate, more specific event, not from the disconnect reason alone.
    socket.on('sessionSuperseded', () => {
      supersededRef.current = true;
      setStatus('superseded');
    });

    // Sent by the server as the first step of its own graceful shutdown
    // (see realtime/shutdown.ts) — only to sockets in an active game, so
    // this never fires for a lobby-only connection.
    socket.on('serverShuttingDown', () => {
      shuttingDownRef.current = true;
      setStatus('shuttingDown');
    });

    socket.on('disconnect', (reason) => {
      if (supersededRef.current || shuttingDownRef.current) {
        // Already reported as 'superseded'/'shuttingDown' above; don't
        // downgrade back to a retriable 'disconnected'/'reconnecting'
        // status, and don't let the reconnection manager keep trying —
        // see connect_error below and the module header's "terminal, not
        // retrying" contract for these states.
        socket.disconnect();
        return;
      }
      // 'io server disconnect' means the server explicitly kicked us
      // (e.g. an auth failure) — the client-side reconnection manager
      // does NOT automatically retry that case, so it's reported as a
      // terminal disconnect rather than "reconnecting". Every other
      // reason (transport drop, ping timeout, ...) is something the
      // socket.io client will keep retrying, so it's reported as
      // "reconnecting" rather than a flat "disconnected" — the UI should
      // show a retrying spinner, not a dead end.
      setStatus(reason === 'io server disconnect' ? 'disconnected' : 'reconnecting');
    });

    socket.on('connect_error', () => {
      if (supersededRef.current || shuttingDownRef.current) return;
      setStatus((prev) => (prev === 'connected' ? 'reconnecting' : prev));
    });

    socketRef.current = socket;
    // Already set to 'connecting' by connect() before the dynamic import
    // kicked off — not repeated here, just forcing the re-render needed
    // now that socketRef.current actually holds a real socket instance.
    forceRender((n) => n + 1);
  }, []);

  const connect = useCallback(() => {
    if (supersededRef.current || shuttingDownRef.current) return; // terminal — see the refs' doc comments
    if (socketRef.current) {
      // Already created — if it's mid-disconnect for some reason, nudge
      // it to reconnect now rather than waiting for the backoff timer;
      // otherwise this is just a harmless repeat call.
      if (!socketRef.current.connected) socketRef.current.connect();
      return;
    }
    if (dynamicImportInFlightRef.current) return; // already loading, see below

    dynamicImportInFlightRef.current = true;
    setStatus('connecting');

    // Dynamically imported, not a top-level `import { io } from
    // 'socket.io-client'`: this module (socket-context.tsx) is imported by
    // (realtime)/layout.tsx, which wraps BOTH the lobby and the live game
    // screen — but only the game screen's useVillageState actually calls
    // connect() eagerly; the lobby screen also needs it, just slightly
    // later in its own flow. Either way, a static import would force
    // socket.io-client's ~40KB (its polling-transport code is NOT
    // tree-shakeable even with `transports: ['websocket']` set at the
    // call site below — that option is read at runtime, but the polling
    // transport module is still statically imported by engine.io-client's
    // own Socket class, see the Prompt 14 bundle-analysis notes) to be
    // parsed and evaluated as part of the layout's initial JS, before
    // React has even painted anything. Deferring it to the moment
    // connect() is actually called moves that cost off the critical
    // rendering path without changing WHEN a socket is opened (still only
    // on an explicit connect() call, never eagerly — see the module
    // header's point 1).
    void import('socket.io-client').then(({ io }) => {
      dynamicImportInFlightRef.current = false;
      // A supersede or an unmount could have happened while the import
      // was in flight; re-check both rather than blindly constructing a
      // socket nobody wants anymore.
      if (supersededRef.current || shuttingDownRef.current || socketRef.current) return;
      createSocket(io);
    });
  }, [createSocket]);

  // Teardown on unmount only — the provider lives for the app's lifetime
  // (mounted once at the root layout), so in practice this only runs on a
  // full page unload, not on route changes.
  useEffect(() => {
    return () => {
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  const setActiveVillage = useCallback((villageCode: VillageCode | null) => {
    activeVillageRef.current = villageCode;
  }, []);

  const emit = useMemo<TypedEmit>(
    () => ({
      joinVillage: (payload) => emitWithAck(socketRef.current, 'joinVillage', payload),
      leaveVillage: (payload) => emitWithAck(socketRef.current, 'leaveVillage', payload),
      setReady: (payload) => emitWithAck(socketRef.current, 'setReady', payload),
      startGame: (payload) => emitWithAck(socketRef.current, 'startGame', payload),
      playAgain: (payload) => emitWithAck(socketRef.current, 'playAgain', payload),
      submitNightAction: (payload) => emitWithAck(socketRef.current, 'submitNightAction', payload),
      castVote: (payload) => emitWithAck(socketRef.current, 'castVote', payload),
      submitNomination: (payload) => emitWithAck(socketRef.current, 'submitNomination', payload),
      sendChat: (payload) => emitWithAck(socketRef.current, 'sendChat', payload),
      kickPlayer: (payload) => emitWithAck(socketRef.current, 'kickPlayer', payload),
      updateVillageSettings: (payload) => emitWithAck(socketRef.current, 'updateVillageSettings', payload),
      requestToJoin: (payload) => emitWithAck(socketRef.current, 'requestToJoin', payload),
      respondToJoinRequest: (payload) => emitWithAck(socketRef.current, 'respondToJoinRequest', payload),
      cancelJoinRequest: (payload) => emitWithAck(socketRef.current, 'cancelJoinRequest', payload),
      pauseTimer: (payload) => emitWithAck(socketRef.current, 'pauseTimer', payload),
      resumeTimer: (payload) => emitWithAck(socketRef.current, 'resumeTimer', payload),
      startPhaseTimer: (payload) => emitWithAck(socketRef.current, 'startPhaseTimer', payload),
      endPhaseNow: (payload) => emitWithAck(socketRef.current, 'endPhaseNow', payload),
      revealNarration: (payload) => emitWithAck(socketRef.current, 'revealNarration', payload),
      advanceNightSubPhase: (payload) => emitWithAck(socketRef.current, 'advanceNightSubPhase', payload),
    }),
    // socketRef is a ref (stable identity) but its .current changes on
    // (re)connect; emit reads it lazily at call time, so this memo never
    // actually needs to recompute — the empty-ish dep array is correct.
    [],
  );

  const value = useMemo<SocketContextValue>(
    () => ({ status, socket: socketRef.current, emit, connect, setActiveVillage }),
    [status, emit, connect, setActiveVillage],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) {
    throw new Error('useSocket must be called within a <SocketProvider>.');
  }
  return ctx;
}
