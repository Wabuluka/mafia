'use client';

// ---------------------------------------------------------------------------
// Providers — the single client-boundary wrapper mounted once in the root
// layout. Keeps layout.tsx itself a server component while still giving
// every route access to the socket connection and the toast stack.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { SocketProvider } from '@/lib/socket-context';
import { ToastProvider } from '@/components/Toast';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SocketProvider>
      <ToastProvider>{children}</ToastProvider>
    </SocketProvider>
  );
}
