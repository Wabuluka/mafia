// ---------------------------------------------------------------------------
// (realtime) route group layout — the ONLY place SocketProvider mounts.
//
// PERFORMANCE: socket.io-client (~40KB of JS on top of React/Next's own
// runtime) was previously pulled in by the ROOT layout via Providers,
// which meant every route — including Home, /name, /showcase, none of
// which ever open a socket — paid for it in their initial JS. Next.js
// does NOT tree-shake a root layout's imports per-route the way it does
// for leaf pages, so nesting SocketProvider here, under a route group that
// covers exactly the routes that actually call useSocket() (lobby, the
// live game screen, and /join — which opens a socket while a join request
// is pending host approval, see (realtime)/join/page.tsx), is what
// actually keeps it out of every other route's bundle. See RootLayout
// (app/layout.tsx) for what's left there (ToastProvider only — cheap, no
// socket, used more broadly including /showcase).
//
// SessionSupersededOverlay and ServerShuttingDownOverlay live here too, not
// at the root: both are only ever triggerable if a socket was opened in
// the first place (see each one's own module header), so neither has a
// reason to mount anywhere a socket never exists.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { SocketProvider } from '@/lib/socket-context';
import { SessionSupersededOverlay } from '@/components/SessionSupersededOverlay';
import { ServerShuttingDownOverlay } from '@/components/ServerShuttingDownOverlay';

export default function RealtimeLayout({ children }: { children: ReactNode }) {
  return (
    <SocketProvider>
      {children}
      <SessionSupersededOverlay />
      <ServerShuttingDownOverlay />
    </SocketProvider>
  );
}
