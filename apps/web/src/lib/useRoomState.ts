'use client';

// ---------------------------------------------------------------------------
// useRoomState — joins a room over the socket and tracks the live
// PlayerView for it. This is the one hook every room-scoped screen
// (lobby now, in-game screens later) uses to get "what does the server
// say the current state is" — it never invents or guesses state locally;
// every field comes straight from the most recent `stateUpdate` /
// `phaseChanged` the server sent.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import type { PlayerView, RoomCode, RoomSettingsUpdatedPayload } from '@mafia/shared';
import { useSocket } from './socket-context';

export interface RoomStateResult {
  view: PlayerView | null;
  /** Set once joinRoom's ack comes back with an error (e.g. NOT_IN_GAME —
   * the socket tried to join a room it was never added to via the HTTP
   * join endpoint first). `null` once a successful join/state arrives. */
  joinError: string | null;
  roomSettings: RoomSettingsUpdatedPayload['phaseDurationsMs'] | null;
}

export function useRoomState(roomCode: RoomCode | null, playerName: string): RoomStateResult {
  const { socket, status, emit, connect, setActiveRoom } = useSocket();
  const [view, setView] = useState<PlayerView | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [roomSettings, setRoomSettings] = useState<RoomStateResult['roomSettings']>(null);
  const hasJoinedRef = useRef(false);

  // Open the connection the moment this hook is given a real room code to
  // work with. Callers only ever pass a non-null roomCode once they've
  // already confirmed (over HTTP) that a session exists — see the lobby
  // page's pre-flight check — so by this point the session cookie the
  // socket handshake needs is guaranteed to be set. See socket-context.tsx's
  // module header for why the socket must NOT connect any earlier than this.
  useEffect(() => {
    if (roomCode) connect();
  }, [roomCode, connect]);

  // Subscribe to state-carrying events for the lifetime of the socket —
  // independent of the join attempt below, since a resync (see
  // socket-context.tsx's reconnect handling) also arrives via
  // `stateUpdate` and must update this same view.
  useEffect(() => {
    if (!socket) return;

    function onStateUpdate(payload: { state: PlayerView }) {
      setView(payload.state);
    }
    function onPhaseChanged(payload: { state: PlayerView }) {
      setView(payload.state);
    }
    function onSettingsUpdated(payload: RoomSettingsUpdatedPayload) {
      setRoomSettings(payload.phaseDurationsMs);
    }

    socket.on('stateUpdate', onStateUpdate);
    socket.on('phaseChanged', onPhaseChanged);
    socket.on('roomSettingsUpdated', onSettingsUpdated);

    return () => {
      socket.off('stateUpdate', onStateUpdate);
      socket.off('phaseChanged', onPhaseChanged);
      socket.off('roomSettingsUpdated', onSettingsUpdated);
    };
  }, [socket]);

  // Join once the socket is actually connected. Re-attempts on every
  // (re)connect — status flipping to 'connected' after a drop means the
  // underlying transport reconnected, and while SocketProvider already
  // fires `requestResync` for us in that case (see socket-context.tsx),
  // that resync only works for a room the server still has this player
  // registered in; a genuinely fresh connect still needs an explicit join.
  useEffect(() => {
    if (!roomCode || status !== 'connected' || hasJoinedRef.current) return;

    hasJoinedRef.current = true;
    setActiveRoom(roomCode);

    emit
      .joinRoom({ roomCode, playerName })
      .then((result) => {
        if (!result.ok) {
          setJoinError(result.error.message);
          hasJoinedRef.current = false;
        }
      })
      .catch(() => {
        setJoinError('Could not join the room. Check your connection and try again.');
        hasJoinedRef.current = false;
      });
  }, [roomCode, status, playerName, emit, setActiveRoom]);

  // Reset the join-attempted flag on disconnect so a later reconnect
  // re-joins rather than assuming the earlier join still holds.
  useEffect(() => {
    if (status === 'disconnected' || status === 'reconnecting') {
      hasJoinedRef.current = false;
    }
  }, [status]);

  return { view, joinError, roomSettings };
}
