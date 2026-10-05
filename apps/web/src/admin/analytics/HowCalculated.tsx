import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { useT } from '../i18n';
import { useDismiss } from './hooks';
import { focusRing } from './kit';

/** Aggregation rules in plain words (the same rules are described in the README); copy in t.analytics.rules. */
export function HowCalculated() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const id = useId();

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'inline-flex h-[34px] items-center gap-2 rounded-[10px] border px-3 text-[13px] font-medium text-signal-ink transition-colors',
          open ? 'border-signal/60 bg-signal/15' : 'border-signal/35 bg-signal/8 hover:bg-signal/12',
          focusRing,
        )}
      >
        <span aria-hidden className="font-mono">
          ?
        </span>
        {t.analytics.howCalculated}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            role="dialog"
            aria-label={t.analytics.howCalculated}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
            className="absolute top-full right-0 z-50 mt-2 flex w-[440px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[18px] border border-signal/25 bg-ad-modal/97 shadow-[0_30px_80px_#000000c0] backdrop-blur"
          >
            <div className="flex items-center justify-between border-b border-ad-line bg-[radial-gradient(80%_200%_at_0%_0%,rgb(200_245_74/0.08),transparent_60%)] px-[18px] py-3.5">
              <span className="font-mono text-[11px] font-medium tracking-[0.14em] text-signal-ink">
                {t.analytics.howCalculatedEyebrow}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.common.close}
                className={clsx('rounded-md p-0.5 text-ad-faint hover:text-ad-text', focusRing)}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <ol className="max-h-[min(70dvh,560px)] overflow-auto py-1.5">
              {t.analytics.rules.map((rule, i) => (
                <li key={i} className="flex gap-3 px-[18px] py-[9px] text-[13px] leading-[1.45] text-ad-text-2">
                  <span className="flex-none pt-0.5 font-mono text-[11px] font-medium text-ad-faint">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-pretty">{rule}</span>
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
