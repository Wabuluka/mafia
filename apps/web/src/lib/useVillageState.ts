'use client';

// ---------------------------------------------------------------------------
// useVillageState — joins a village over the socket and tracks the live
// PlayerView for it. This is the one hook every village-scoped screen
// (lobby now, in-game screens later) uses to get "what does the server
// say the current state is" — it never invents or guesses state locally;
// every field comes straight from the most recent `stateUpdate` /
// `phaseChanged` the server sent.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import type { PlayerView, VillageCode, VillageSettingsUpdatedPayload } from '@mafia/shared';
import { useSocket } from './socket-context';

export interface VillageStateResult {
  view: PlayerView | null;
  /** Set once joinVillage's ack comes back with an error (e.g. NOT_IN_GAME —
   * the socket tried to join a village it was never added to via the HTTP
   * join endpoint first). `null` once a successful join/state arrives. */
  joinError: string | null;
  villageSettings: VillageSettingsUpdatedPayload['phaseDurationsMs'] | null;
}

export function useVillageState(villageCode: VillageCode | null, playerName: string): VillageStateResult {
  const { socket, status, emit, connect, setActiveVillage } = useSocket();
  const [view, setView] = useState<PlayerView | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [villageSettings, setVillageSettings] = useState<VillageStateResult['villageSettings']>(null);
  const hasJoinedRef = useRef(false);

  // Open the connection the moment this hook is given a real village code to
  // work with. Callers only ever pass a non-null villageCode once they've
  // already confirmed (over HTTP) that a session exists — see the lobby
  // page's pre-flight check — so by this point the session cookie the
  // socket handshake needs is guaranteed to be set. See socket-context.tsx's
  // module header for why the socket must NOT connect any earlier than this.
  useEffect(() => {
    if (villageCode) connect();
  }, [villageCode, connect]);

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
    function onSettingsUpdated(payload: VillageSettingsUpdatedPayload) {
      setVillageSettings(payload.phaseDurationsMs);
    }

    socket.on('stateUpdate', onStateUpdate);
    socket.on('phaseChanged', onPhaseChanged);
    socket.on('villageSettingsUpdated', onSettingsUpdated);

    return () => {
      socket.off('stateUpdate', onStateUpdate);
      socket.off('phaseChanged', onPhaseChanged);
      socket.off('villageSettingsUpdated', onSettingsUpdated);
    };
  }, [socket]);

  // Join once the socket is actually connected. Re-attempts on every
  // (re)connect — status flipping to 'connected' after a drop means the
  // underlying transport reconnected, and while SocketProvider already
  // fires `requestResync` for us in that case (see socket-context.tsx),
  // that resync only works for a village the server still has this player
  // registered in; a genuinely fresh connect still needs an explicit join.
  useEffect(() => {
    if (!villageCode || status !== 'connected' || hasJoinedRef.current) return;

    hasJoinedRef.current = true;
    setActiveVillage(villageCode);

    emit
      .joinVillage({ villageCode, playerName })
      .then((result) => {
        if (!result.ok) {
          setJoinError(result.error.message);
          hasJoinedRef.current = false;
        }
      })
      .catch(() => {
        setJoinError('Could not join the village. Check your connection and try again.');
        hasJoinedRef.current = false;
      });
  }, [villageCode, status, playerName, emit, setActiveVillage]);

  // Reset the join-attempted flag on disconnect so a later reconnect
  // re-joins rather than assuming the earlier join still holds.
  useEffect(() => {
    if (status === 'disconnected' || status === 'reconnecting') {
      hasJoinedRef.current = false;
    }
  }, [status]);

  return { view, joinError, villageSettings };
}
