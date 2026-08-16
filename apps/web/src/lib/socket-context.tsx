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
import { io, type Socket } from 'socket.io-client';
import type {
  AckResult,
  CastVotePayload,
  ClientToServerEvents,
  JoinVillagePayload,
  KickPlayerPayload,
  LeaveVillagePayload,
  VillageCode,
  ServerToClientEvents,
  SendChatPayload,
  SetReadyPayload,
  StartGamePayload,
  SubmitNightActionPayload,
  UpdateVillageSettingsPayload,
} from '@mafia/shared';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

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
  submitNightAction: (payload: SubmitNightActionPayload) => Promise<AckResult>;
  castVote: (payload: CastVotePayload) => Promise<AckResult>;
  sendChat: (payload: SendChatPayload) => Promise<AckResult>;
  kickPlayer: (payload: KickPlayerPayload) => Promise<AckResult>;
  updateVillageSettings: (payload: UpdateVillageSettingsPayload) => Promise<AckResult>;
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
  // Force a re-render when the socket instance itself changes (on the
  // first `connect()` call, in practice) so consumers reading `socket`
  // from context see it.
  const [, forceRender] = useState(0);

  // The socket instance is created once, lazily, the first time
  // `connect()` is called — NOT eagerly here — but its event listeners
  // only need wiring once too, so they're attached inside `connect()`
  // itself rather than a separate effect keyed on a socket that doesn't
  // exist yet at mount time.
  const connect = useCallback(() => {
    if (socketRef.current) {
      // Already created — if it's mid-disconnect for some reason, nudge
      // it to reconnect now rather than waiting for the backoff timer;
      // otherwise this is just a harmless repeat call.
      if (!socketRef.current.connected) socketRef.current.connect();
      return;
    }

    const url = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

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

    socket.on('disconnect', (reason) => {
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
      setStatus((prev) => (prev === 'connected' ? 'reconnecting' : prev));
    });

    socketRef.current = socket;
    setStatus('connecting');
    forceRender((n) => n + 1);
  }, []);

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
      submitNightAction: (payload) => emitWithAck(socketRef.current, 'submitNightAction', payload),
      castVote: (payload) => emitWithAck(socketRef.current, 'castVote', payload),
      sendChat: (payload) => emitWithAck(socketRef.current, 'sendChat', payload),
      kickPlayer: (payload) => emitWithAck(socketRef.current, 'kickPlayer', payload),
      updateVillageSettings: (payload) => emitWithAck(socketRef.current, 'updateVillageSettings', payload),
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
