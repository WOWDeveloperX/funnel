import { useReducedMotion } from 'framer-motion';
import { useEffect, useEffectEvent, useRef } from 'react';

/** Bar-growth transition: 300ms ease-out, instant when the user prefers reduced motion. */
export function useTween() {
  const reduce = useReducedMotion();
  return { duration: reduce ? 0 : 0.3, ease: 'easeOut' } as const;
}

/** Closes an open overlay on outside pointer-down and on Escape. Attach the ref to the overlay root. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useEffectEvent(close);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return ref;
}
