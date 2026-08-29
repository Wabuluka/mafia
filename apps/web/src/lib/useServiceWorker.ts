'use client';

// ---------------------------------------------------------------------------
// useServiceWorker — registers public/sw.js once, client-side only. Fire-
// and-forget by design: the SW's own install/activate lifecycle (see its
// module header) handles cache population and cleanup, so this hook has
// nothing to track beyond kicking off registration. Guarded on
// `navigator.serviceWorker` support so it degrades silently on browsers
// without it (older Safari versions, some in-app webviews) rather than
// throwing during hydration.
// ---------------------------------------------------------------------------

import { useEffect } from 'react';

export function useServiceWorker() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration can fail in private-browsing modes or when served
      // over plain HTTP in dev on some browsers — non-fatal, the app
      // works fine without offline support in that case.
    });
  }, []);
}
