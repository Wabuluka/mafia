import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: 'Mafia',
  description: 'Real-time multiplayer Mafia (Werewolf) party game.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  // iOS ignores the web manifest for standalone-mode chrome and instead
  // reads these Apple-specific meta tags directly — `apple-mobile-web-
  // app-capable` is what makes "Add to Home Screen" launch chromeless
  // (no Safari URL bar) instead of as a bookmarked tab.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Mafia',
  },
};

// Portrait-only, no zoom: the whole UI is tap-target driven, so pinch-zoom
// would break layout assumptions on the game screens. `themeColor` matches
// the "mafia" daisyUI theme's --color-surface (see tailwind.config.ts) so
// the OS chrome (Android's status bar, iOS's PWA splash background) reads
// as a continuation of the app rather than a jarring seam.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0b0d12',
};

// The socket origin (see lib/socket-context.tsx) is a DIFFERENT host from
// this app's own origin in every real deployment (a separate Express/
// Socket.IO server) — the WebSocket handshake to it is a fresh DNS
// lookup + TCP + TLS negotiation the browser has no other reason to have
// started yet. `<link rel="preconnect">` in the document head tells the
// browser to do that negotiation speculatively, in parallel with the
// rest of the page's own load, so by the time a lobby/game screen
// actually calls connect() (see socket-context.tsx's dynamic import of
// socket.io-client), the connection setup cost is already paid down
// instead of adding to the time-to-first-message. Placed at the ROOT
// layout (not scoped to the (realtime) route group the socket code
// itself lives under) because a `<link>` preconnect hint is negligible
// cost even on routes that never open a socket — unlike shipping actual
// JS (see (realtime)/layout.tsx's module header for why THAT is scoped
// tightly), a resource hint the browser doesn't end up using is
// essentially free, so there's no reason to withhold it from Home/
// join/name just because they don't personally need it.
const SOCKET_ORIGIN = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="mafia">
      <head>
        <link rel="preconnect" href={SOCKET_ORIGIN} />
        <link rel="dns-prefetch" href={SOCKET_ORIGIN} />
      </head>
      <body className="h-dvh overflow-hidden bg-surface text-base-content antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
