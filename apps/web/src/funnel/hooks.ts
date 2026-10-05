/** Small DOM/motion hooks shared by the funnel step renderers. */
import { useAnimate, useReducedMotionConfig } from 'framer-motion';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

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

/** Tailwind's `lg` breakpoint: the desktop compositions of the funnel card. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Live `matchMedia` match. Only for structure that CSS cannot switch (which element animates);
 * plain styling uses Tailwind's responsive variants.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
