'use client';

// ---------------------------------------------------------------------------
// useJoinRequests — the live "who's waiting on my approval" list for the
// host's own lobby screen. The server only ever sends `joinRequestsUpdated`
// to whoever currently holds `isHost` (see realtime/joinRequests.ts) — a
// non-host mounting this hook simply never receives anything and stays at
// the empty default, so this is safe to call unconditionally from the
// lobby page rather than needing to gate it on `isHost` itself.
//
// Purely in-memory, unlike useGameLog — a join request is inherently
// ephemeral (it only makes sense while its requester is actively waiting)
// and the server re-sends the full current list on every change anyway
// (not a diff), so there's nothing worth persisting across a reload: a
// host who refreshes mid-lobby just sees an empty list until the next
// change, which is a fine, low-stakes gap for something this transient.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import type { JoinRequest } from '@mafia/shared';
import { useSocket } from './socket-context';

export function useJoinRequests(): JoinRequest[] {
  const { socket } = useSocket();
  const [requests, setRequests] = useState<JoinRequest[]>([]);

  useEffect(() => {
    if (!socket) return;

    function onUpdated(payload: { requests: JoinRequest[] }) {
      setRequests(payload.requests);
    }

    socket.on('joinRequestsUpdated', onUpdated);
    return () => {
      socket.off('joinRequestsUpdated', onUpdated);
    };
  }, [socket]);

  return requests;
}
