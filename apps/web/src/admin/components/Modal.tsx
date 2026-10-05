import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import { Button } from './ui';

/** Focus ring colour for content portaled outside the admin root. */
export const ADMIN_FOCUS = '[&_:focus-visible]:outline-signal';

/** Open modals; the app root stays `inert` while there is at least one. */
let openModals = 0;

/** Makes the app root (#root) inert while a modal is open, so focus and AT stay in the dialog. */
function lockAppRoot(): () => void {
  const root = document.getElementById('root');
  openModals += 1;
  root?.setAttribute('inert', '');
  return () => {
    openModals -= 1;
    if (openModals === 0) root?.removeAttribute('inert');
  };
}

/**
 * Accessible modal dialog: Escape / backdrop click close it, focus moves into the panel and returns
 * to the previously focused element on close. The dialog is portaled to <body>; the app behind it
 * is inert while it is open. `hero` renders a custom top block instead of the title row (the title
 * is then still used as the accessible name and shown under the hero).
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  hero,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  hero?: ReactNode;
}) {
  const t = useT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Parents pass a fresh onClose on every render (e.g. each poll tick); it must not re-run the
  // effect below, or focus would jump back to the panel.
  const close = useEffectEvent(onClose);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const unlock = lockAppRoot();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    // Focus the panel (not a button) so Enter doesn't accidentally confirm.
    const t = setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      unlock(); // before restoring focus: elements inside an inert root cannot take it
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={clsx('fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6', ADMIN_FOCUS)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-ad-root/75 backdrop-blur-[2px]" onClick={onClose} aria-hidden>
            <div className="absolute inset-0 bg-ad-grid opacity-50" />
          </div>
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={clsx(
              'relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-[20px] border border-ad-line-3 bg-ad-modal text-ad-text shadow-[0_30px_80px_#000000c0] outline-none sm:rounded-[20px]',
              size === 'sm' && 'sm:max-w-[470px]',
              size === 'md' && 'sm:max-w-lg',
              size === 'lg' && 'sm:max-w-2xl',
              size === 'xl' && 'sm:max-w-4xl',
            )}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {hero ? (
              <>
                {hero}
                <h2
                  id={titleId}
                  className="px-6 pt-[22px] font-display text-2xl font-bold tracking-[-0.02em] text-ad-text"
                >
                  {title}
                </h2>
              </>
            ) : (
              <div className="flex items-center justify-between gap-4 border-b border-ad-line px-5 py-4">
                <h2 id={titleId} className="font-display text-[17px] font-semibold text-ad-text">
                  {title}
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md p-1 text-ad-faint hover:bg-ad-chip hover:text-ad-text"
                  aria-label={t.common.close}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            )}
            <div
              className={clsx(
                'min-h-0 flex-1 overflow-auto text-sm text-ad-text-2',
                hero ? 'px-6 pt-3 pb-[22px]' : 'px-5 py-4',
              )}
            >
              {children}
            </div>
            {footer && (
              <div
                className={clsx(
                  'flex flex-wrap justify-end gap-2.5',
                  hero ? 'px-6 pb-[22px]' : 'border-t border-ad-line px-5 py-3',
                )}
              >
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Two-button confirmation dialog. `onConfirm` may be async; the button shows a spinner meanwhile. */
export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  busy,
  onConfirm,
  onCancel,
  hero,
}: {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  hero?: ReactNode;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onCancel}
      title={title}
      size={hero ? 'sm' : 'md'}
      hero={hero}
      footer={
        <>
          <Button tone="secondary" onClick={onCancel} disabled={busy} className="h-[42px] rounded-xl px-4 text-sm">
            {cancelLabel ?? t.common.cancel}
          </Button>
          <Button
            tone={tone}
            onClick={onConfirm}
            loading={busy}
            className="h-[42px] rounded-xl px-4 text-sm font-semibold"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
