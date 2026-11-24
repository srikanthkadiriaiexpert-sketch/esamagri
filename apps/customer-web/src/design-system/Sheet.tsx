import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * Mobile bottom sheet — used for things like "pickup or delivery",
 * filters, and confirmation prompts. Prefer this over a centered
 * desktop-style modal dialog on the customer app (mobile-first —
 * STEP 8 Section 3).
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-slate-900/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="app-shell relative w-full animate-slide-up rounded-t-2xl bg-white shadow-sheet safe-bottom"
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-slate-200" />
        {title ? (
          <div className="flex items-center justify-between px-5 pb-2 pt-3">
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-touch w-touch items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ) : null}
        {/* max-h-sheet is 75dvh where supported, 75vh elsewhere: on iOS
            Safari a 75vh panel is 75% of the TALLER toolbar-hidden viewport,
            so the bottom of a full sheet sat under the toolbar. */}
        <div className="max-h-sheet overflow-y-auto px-5 pb-6">{children}</div>
      </div>
    </div>,
    document.body
  );
}
