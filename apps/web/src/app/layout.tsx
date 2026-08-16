import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: 'Mafia',
  description: 'Real-time multiplayer Mafia (Werewolf) party game.',
};

// Portrait-only, no zoom: the whole UI is tap-target driven, so pinch-zoom
// would break layout assumptions on the game screens.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="mafia">
      <body className="h-dvh overflow-hidden bg-surface text-base-content antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
