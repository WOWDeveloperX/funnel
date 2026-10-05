/** Small DOM/motion hooks shared by the funnel step renderers. */
import { useAnimate, useReducedMotionConfig } from 'framer-motion';
import { useEffect, useRef } from 'react';

/** Focuses the element once on mount (screen readers land on the new step's title). */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}

/**
 * Returns a ref whose element shakes horizontally whenever the token sum increases (a decrease,
 * e.g. a token reset to 0, never shakes).
 * Two tokens so a step can combine the parent's "failed continue" with its own local triggers.
 */
export function useShake<T extends HTMLElement = HTMLDivElement>(token: number, localToken = 0) {
  const [scope, animate] = useAnimate<T>();
  const reduceMotion = useReducedMotionConfig();
  // Tokens seen at mount do not shake: only increases while mounted do.
  const seen = useRef(token + localToken);
  useEffect(() => {
    const sum = token + localToken;
    const increased = sum > seen.current;
    seen.current = sum;
    if (!increased) return;
    if (reduceMotion || !scope.current) return;
    void animate(scope.current, { x: [0, -8, 8, -6, 6, -3, 3, 0] }, { duration: 0.36, ease: 'easeInOut' });
  }, [token, localToken, reduceMotion, animate, scope]);
  return scope;
}
