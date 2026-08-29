'use client';

// ---------------------------------------------------------------------------
// useUnreadGameLog — flags the game log button once there's a persisted
// entry the player hasn't actually looked at yet. Exists specifically to
// close the loop for the resilience pass's "refresh during the death
// reveal" scenario: `useGameLog` now restores its full history from
// localStorage on mount (see its module header), so the FACTS survive a
// refresh — but a player who refreshed mid-reveal still needs a visible
// signal that something happened while they were gone, not just a log
// that's silently already populated behind an unmarked button they have
// no reason to tap.
//
// Deliberately simple: unread starts true whenever this hook mounts with
// at least one entry already in the log (i.e. either restored from
// storage, or a phase transition landed while this screen wasn't open to
// begin with — same signal either way: "something is in the log the
// player hasn't opened it to see"), and clears the moment the log is
// opened. It does not track per-entry read state — this is a single
// "there's new stuff" flag, matching GameLogButton's existing `hasUnread`
// prop shape, not a granular unread count.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';

export function useUnreadGameLog(entryCount: number): [boolean, () => void] {
  const [unread, setUnread] = useState(entryCount > 0);
  const [seenCount, setSeenCount] = useState(entryCount);

  useEffect(() => {
    if (entryCount > seenCount) {
      setUnread(true);
    }
  }, [entryCount, seenCount]);

  function markRead() {
    setUnread(false);
    setSeenCount(entryCount);
  }

  return [unread, markRead];
}
