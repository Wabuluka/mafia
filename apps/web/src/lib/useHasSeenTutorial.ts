'use client';

// ---------------------------------------------------------------------------
// useHasSeenTutorial — a one-time flag remembering whether this browser has
// ever seen the How-to-Play explainer, so the lobby can auto-open it once
// for a brand-new player without nagging on every return visit. Same
// synchronous-lazy-init + try/catch convention as useStoredName.ts — see
// that file's header for why the read must be synchronous (an effect-based
// read would race a sibling mount effect that wants the real value on the
// very first render), and why localStorage failures degrade silently
// rather than breaking the flow.
// ---------------------------------------------------------------------------

import { useCallback, useState } from 'react';

const STORAGE_KEY = 'mafia:hasSeenTutorial';

function readHasSeenTutorial(): boolean {
  if (typeof window === 'undefined') return false; // SSR: resolved client-side on hydration, same as useStoredName
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Private-browsing/quota-exceeded — treat identically to "never seen
    // it", same posture as every other localStorage read in this app.
    return false;
  }
}

export function useHasSeenTutorial(): [boolean, () => void] {
  const [seen, setSeenState] = useState(readHasSeenTutorial);

  const markSeen = useCallback(() => {
    setSeenState(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // A failed write just means the nudge might reappear next visit —
      // not a reason to break the current one.
    }
  }, []);

  return [seen, markSeen];
}
