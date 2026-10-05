import { animate, useReducedMotion } from 'framer-motion';
import { type ReactNode, useEffect, useState } from 'react';

/**
 * Number that "counts" from its previous value to the new one (≤300ms). Instant with reduced motion.
 */
export function CountUp({ value, format }: { value: number; format: (n: number) => ReactNode }) {
  const reduce = useReducedMotion();
  // The running tween (previous target → current target), restarted whenever `value` changes.
  const [tween, setTween] = useState({ from: value, to: value });
  if (tween.to !== value) setTween({ from: tween.to, to: value });
  const [frame, setFrame] = useState(value);

  const animating = !reduce && tween.from !== tween.to;
  useEffect(() => {
    if (!animating) return;
    const controls = animate(tween.from, tween.to, { duration: 0.3, ease: 'easeOut', onUpdate: setFrame });
    return () => controls.stop();
  }, [animating, tween]);

  return <span className="tabular-nums">{format(animating ? frame : value)}</span>;
}
