'use client';

// ---------------------------------------------------------------------------
// useVillageState — joins a village over the socket and tracks the live
// PlayerView for it. This is the one hook every village-scoped screen
// (lobby now, in-game screens later) uses to get "what does the server
// say the current state is" — it never invents or guesses state locally;
// every field comes straight from the most recent `stateUpdate` /
// `phaseChanged` the server sent.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  NominationChangedPayload,
  PhaseChangedPayload,
  PlayerView,
  VillageCode,
  VillageSettingsUpdatedPayload,
  VoteChangedPayload,
} from '@mafia/shared';
import { useSocket } from './socket-context';

export interface VillageStateResult {
  view: PlayerView | null;
  /** Set once joinVillage's ack comes back with an error (e.g. NOT_IN_GAME —
   * the socket tried to join a village it was never added to via the HTTP
   * join endpoint first). `null` once a successful join/state arrives. */
  joinError: string | null;
  villageSettings: VillageSettingsUpdatedPayload['phaseDurationsMs'] | null;
  /** The most recent `phaseChanged` event in full, including its
   * `previousPhase`/`narration`/`outcome` — the game log (useGameLog)
   * needs the STRUCTURED transition data this carries, which plain `view`
   * (a snapshot of current state) doesn't have. `null` until the first
   * phase transition this client observes. Every new phaseChanged
   * replaces the previous one here — for a screen that needs to react to
   * EVERY transition in order without ever dropping one (e.g. a reveal
   * screen that must not be skipped just because the server moved on to
   * the next phase before the player dismissed it), use
   * `phaseChangeQueue` instead. */
  lastPhaseChange: PhaseChangedPayload | null;
  /** Every `phaseChanged` event received, in arrival order, since this
   * hook mounted — an append-only queue, not a "most recent" snapshot.
   * The server's phase timer keeps running regardless of whether a client
   * has acknowledged a reveal (see DayPhase.tsx), so two transitions can
   * legitimately arrive before a player dismisses the first one's reveal
   * — losing the second one to a plain "latest wins" field would silently
   * skip an elimination or dawn reveal the player never got to see.
   * Consumers should call `dequeuePhaseChange()` once they're done
   * displaying the front entry, which removes exactly that entry. */
  phaseChangeQueue: PhaseChangedPayload[];
  dequeuePhaseChange: () => void;
  /** The new host's display name the moment a host-transfer is DETECTED
   * client-side (diffed locally — see the module header note on
   * `onStateUpdate` below; there is no dedicated server event for this).
   * `null` once nothing new to report. Mirrors `joinError`'s pattern:
   * this hook only surfaces the fact, a consuming page decides whether/how
   * to toast it (see lobby/[code]/page.tsx). */
  hostTransferredTo: string | null;
}

export function useVillageState(villageCode: VillageCode | null, playerName: string): VillageStateResult {
  const { socket, status, emit, connect, setActiveVillage } = useSocket();
  const [view, setView] = useState<PlayerView | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [villageSettings, setVillageSettings] = useState<VillageStateResult['villageSettings']>(null);
  const [lastPhaseChange, setLastPhaseChange] = useState<PhaseChangedPayload | null>(null);
  const [phaseChangeQueue, setPhaseChangeQueue] = useState<PhaseChangedPayload[]>([]);
  const [hostTransferredTo, setHostTransferredTo] = useState<string | null>(null);
  const hasJoinedRef = useRef(false);
  // Mirrors `view` synchronously, purely so `onStateUpdate` (registered
  // once per socket, not re-subscribed on every state change — see that
  // effect's own dependency array) can compare the INCOMING roster against
  // the PREVIOUS one without needing `view` in its closure. A ref read
  // doesn't require re-running the effect the way adding `view` to its
  // dependency array would.
  const viewRef = useRef<PlayerView | null>(null);
  viewRef.current = view;

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

    // No dedicated server event exists for a host transfer (see
    // realtime/lobbyManagement.ts server-side — transferHostIfNeeded/
    // ensureLobbyHasHost mutate the roster silently and the change simply
    // rides along in whatever stateUpdate follows). Detected here by
    // diffing which player has `isHost: true` between the previous and
    // incoming roster. Deliberately requires a PREVIOUS host to have
    // existed and the new one to be a DIFFERENT player — the very first
    // stateUpdate a client ever receives (no prior `view` to compare
    // against) is never treated as a "transfer", just the initial
    // assignment.
    function onStateUpdate(payload: { state: PlayerView }) {
      const previousHost = viewRef.current?.players.find((p) => p.isHost);
      const nextHost = payload.state.players.find((p) => p.isHost);
      if (previousHost && nextHost && previousHost.id !== nextHost.id) {
        setHostTransferredTo(nextHost.name);
      }
      setView(payload.state);
    }
    function onPhaseChanged(payload: PhaseChangedPayload) {
      setView(payload.state);
      setLastPhaseChange(payload);
      setPhaseChangeQueue((prev) => [...prev, payload]);
    }
    function onSettingsUpdated(payload: VillageSettingsUpdatedPayload) {
      setVillageSettings(payload.phaseDurationsMs);
    }
    // The high-frequency diff path for vote changes (see
    // VoteChangedPayloadSchema's doc comment in @mafia/shared/events.ts
    // and broadcastVoteChange's in realtime/emit.ts for the measured
    // payload-size numbers this exists to avoid). Merges into the
    // existing `view` rather than replacing it wholesale — everything
    // else about `view` (chat log, roster, phase timer, `you`) is
    // untouched by a vote and stays exactly as it was; only `votes` is
    // swapped for the fresh array the server sent. If `view` is somehow
    // null when this arrives (shouldn't happen — a voteChanged only ever
    // follows a stateUpdate that already populated it), it's silently
    // ignored rather than constructing a partial/fake PlayerView.
    function onVoteChanged(payload: VoteChangedPayload) {
      setView((prev) => (prev ? { ...prev, votes: payload.votes } : prev));
    }
    // The same diff-not-full-state pattern as onVoteChanged above, for
    // nominations during DAY_DISCUSSION — see NominationChangedPayloadSchema's
    // doc comment in @mafia/shared/events.ts.
    function onNominationChanged(payload: NominationChangedPayload) {
      setView((prev) => (prev ? { ...prev, nominations: payload.nominations } : prev));
    }

    socket.on('stateUpdate', onStateUpdate);
    socket.on('phaseChanged', onPhaseChanged);
    socket.on('villageSettingsUpdated', onSettingsUpdated);
    socket.on('voteChanged', onVoteChanged);
    socket.on('nominationChanged', onNominationChanged);

    return () => {
      socket.off('stateUpdate', onStateUpdate);
      socket.off('phaseChanged', onPhaseChanged);
      socket.off('villageSettingsUpdated', onSettingsUpdated);
      socket.off('voteChanged', onVoteChanged);
      socket.off('nominationChanged', onNominationChanged);
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

  const dequeuePhaseChange = useCallback(() => {
    setPhaseChangeQueue((prev) => prev.slice(1));
  }, []);

  return {
    view,
    joinError,
    villageSettings,
    lastPhaseChange,
    phaseChangeQueue,
    dequeuePhaseChange,
    hostTransferredTo,
  };
}
