/**
 * Minimal toast system local to the admin (see useToast in toast-context.ts). Toasts stack at the
 * bottom; the container is the single polite live region that announces them. It is portaled to
 * <body> like the modals, so toasts stay announced and dismissible while a modal makes #root inert.
 */
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import { type ToastApi, ToastContext, type ToastTone } from './toast-context';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

const DURATION_MS = 4500;

const toneStyles: Record<ToastTone, { icon: ReactNode; ring: string }> = {
  success: { icon: <CircleCheck className="size-4 text-ok" aria-hidden />, ring: 'border-ok-line' },
  error: { icon: <CircleAlert className="size-4 text-bad" aria-hidden />, ring: 'border-bad-line' },
  warning: { icon: <TriangleAlert className="size-4 text-amber-400" aria-hidden />, ring: 'border-amber-400/30' },
  info: { icon: <Info className="size-4 text-variant-a" aria-hidden />, ring: 'border-ad-line-3' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = nextId.current++;
      // Same message twice in a row (e.g. several 401s) → keep one.
      setItems((list) =>
        list.some((t) => t.title === title && t.description === description)
          ? list
          : [...list.slice(-3), { id, tone, title, description }],
      );
      setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (t, d) => show('success', t, d),
      error: (t, d) => show('error', t, d),
      warning: (t, d) => show('warning', t, d),
      info: (t, d) => show('info', t, d),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          lang={t.lang}
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end [&_:focus-visible]:outline-signal"
          aria-live="polite"
        >
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.2 }}
                className={clsx(
                  'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[14px] border bg-ad-modal px-4 py-3 shadow-[0_18px_50px_#000000b0]',
                  toneStyles[item.tone].ring,
                )}
              >
                <span className="mt-0.5">{toneStyles[item.tone].icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ad-text">{item.title}</p>
                  {item.description && <p className="mt-0.5 text-xs break-words text-ad-muted">{item.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  className="rounded p-0.5 text-ad-faint hover:text-ad-text"
                  aria-label={t.common.close}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
