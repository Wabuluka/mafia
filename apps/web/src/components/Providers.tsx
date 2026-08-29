'use client';

// ---------------------------------------------------------------------------
// Providers — the app-wide client-boundary wrapper mounted once in the root
// layout. Deliberately minimal: ToastProvider, plus the service-worker
// registration (see lib/useServiceWorker.ts). SocketProvider (and the
// socket.io-client bundle that comes with it) lives one level down, in
// app/(realtime)/layout.tsx, scoped to just the lobby/game routes that
// actually use it — see that file's module header for why this split
// matters for bundle size. Keeping layout.tsx itself a server component
// while still giving every route the toast stack (and offline/install
// support) is this component's job.
//
// The service worker registers here, at the root, rather than scoped to
// (realtime) like the socket: app-shell caching (icons, manifest, the
// offline fallback) benefits every route, including Home/join/name, not
// just the live game screens — unlike socket.io-client's bundle weight,
// `navigator.serviceWorker.register(...)` itself is a few bytes and async,
// so there's no bundle-size reason to withhold it from routes that never
// touch a socket.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/Toast';
import { useServiceWorker } from '@/lib/useServiceWorker';

export function Providers({ children }: { children: ReactNode }) {
  useServiceWorker();
  return <ToastProvider>{children}</ToastProvider>;
}
