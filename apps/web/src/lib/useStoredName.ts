'use client';

// ---------------------------------------------------------------------------
// useStoredName — remembers the player's chosen display name in
// localStorage across visits, per the name-entry screen's requirement.
// Note this is purely a UX convenience (pre-filling the name field /
// skipping it on return visits); it is NOT the player's identity — that's
// the signed session cookie (see lib/api.ts's createOrResumeSession), which
// persists independently and is what the server actually trusts.
//
// Reads synchronously via a lazy useState initializer rather than an
// effect-after-mount: any caller (e.g. /lobby/create's own mount effect,
// which calls createOrResumeSession(storedName || undefined)) that reads
// the returned name in ITS OWN mount-time effect must see the real stored
// value on the very first render, not an empty string that only gets
// corrected a tick later. React doesn't guarantee this hook's old
// effect-based read would resolve before a sibling/parent effect reading
// its result — it's a real ordering race, not just a cosmetic flash of
// empty state, and reading synchronously up front avoids it structurally.
// ---------------------------------------------------------------------------

import { useCallback, useState } from 'react';

const STORAGE_KEY = 'mafia:displayName';

function readStoredName(): string {
  if (typeof window === 'undefined') return ''; // SSR: no localStorage, resolved client-side on hydration
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    // localStorage can throw in private-browsing/quota-exceeded
    // scenarios — treat identically to "no stored name".
    return '';
  }
}

export function useStoredName(): [string, (name: string) => void] {
  const [name, setNameState] = useState(readStoredName);

  const setName = useCallback((next: string) => {
    setNameState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A failed write just means the name isn't remembered for next
      // time, not a reason to break the current flow.
    }
  }, []);

  return [name, setName];
}
