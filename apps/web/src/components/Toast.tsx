'use client';

// ---------------------------------------------------------------------------
// Toast — a small top-of-screen notification stack, with a Context-based
// provider so any component can trigger one via `useToast().show(...)`
// without prop-drilling a callback down through the tree. Stacks (does not
// replace) multiple toasts, auto-dismisses after a duration, and is
// dismissible by tap.
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastTone = 'info' | 'success' | 'danger';

interface ToastRecord {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss. */
  durationMs?: number;
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 3500;

const TONE_CLASSES: Record<ToastTone, string> = {
  info: 'bg-elevated-2 text-base-content',
  success: 'bg-village-accent/20 text-village-accent',
  danger: 'bg-danger/20 text-danger',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = nextId.current++;
      const tone = options?.tone ?? 'info';
      setToasts((prev) => [...prev, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), options?.durationMs ?? DEFAULT_DURATION_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Stack sits below the safe-area top inset, above the app header's
       * z-index (see AppShell.tsx) so a toast is never hidden behind it. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-3"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className={[
              'pointer-events-auto w-full max-w-sm rounded-xl px-4 py-3 text-left text-sm font-medium shadow-lg',
              'animate-toast-in motion-reduce:animate-none',
              TONE_CLASSES[toast.tone],
            ].join(' ')}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be called within a <ToastProvider>.');
  }
  return ctx;
}
