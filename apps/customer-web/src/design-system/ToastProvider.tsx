import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AlertTone } from './Alert';

export interface ToastInput {
  tone?: AlertTone;
  title: string;
  description?: string;
  durationMs?: number;
}

interface ToastItem extends Required<Pick<ToastInput, 'tone' | 'title'>> {
  id: number;
  description?: string;
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Reusable toast/notification surface (STEP 8 Section 15). Screens
 * call `useToast().showToast(...)` for transient feedback (order
 * confirmed, item added, etc.); real push-style notifications (order
 * accepted, out for delivery, RIK/PIF announcements) will feed into
 * this same surface once the notification backend exists — no second
 * mechanism should be built for that later.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const showToast = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    const item: ToastItem = { id, tone: toast.tone ?? 'info', title: toast.title, description: toast.description };
    setToasts((prev) => [...prev, item]);
    const duration = toast.durationMs ?? 3500;
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-3 safe-top">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className="app-shell pointer-events-auto w-full animate-toast-in rounded-xl bg-slate-900 px-4 py-3 text-white shadow-sheet"
            >
              <p className="text-sm font-semibold">{t.title}</p>
              {t.description ? <p className="mt-0.5 text-xs text-slate-300">{t.description}</p> : null}
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
