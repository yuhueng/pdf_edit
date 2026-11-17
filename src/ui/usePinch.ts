import { useEffect, useRef, type RefObject } from 'react';

/**
 * Two-finger pinch on a scroll area. While the fingers move, `target` is scaled with CSS (cheap, no redraw);
 * when they lift, `onCommit(factor)` gets the final factor so the caller can re-render at the new size.
 * One finger is left alone, so scrolling and drawing keep working. Give the area `touch-pan-x touch-pan-y`.
 */
export function usePinch(
  area: RefObject<HTMLElement | null>,
  target: () => HTMLElement | null | undefined,
  onCommit: (factor: number) => void,
) {
  const commit = useRef(onCommit);
  const pick = useRef(target);
  useEffect(() => {
    commit.current = onCommit;
    pick.current = target;
  });

  // The area may only appear later (after a PDF is opened), so check on every render and bind once per element.
  const bound = useRef<{ el: HTMLElement; off: () => void } | null>(null);
  useEffect(() => {
    const el = area.current;
    if (el === (bound.current?.el ?? null)) return;
    bound.current?.off();
    bound.current = null;
    if (!el) return;
    let d0 = 0;
    let f = 1;
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      d0 = dist(e.touches);
      f = 1;
      e.stopPropagation(); // the drawing layer must not see the second finger
    };
    const move = (e: TouchEvent) => {
      if (!d0 || e.touches.length !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      f = Math.min(4, Math.max(0.25, dist(e.touches) / d0));
      const t = pick.current();
      if (t) {
        t.style.transformOrigin = '50% 0';
        t.style.transform = `scale(${f})`;
      }
    };
    const end = (e: TouchEvent) => {
      if (!d0 || e.touches.length >= 2) return;
      d0 = 0;
      const t = pick.current();
      if (t) t.style.transform = '';
      if (Math.abs(f - 1) > 0.03) commit.current(f);
      f = 1;
    };
    const opts = { capture: true, passive: false } as const;
    el.addEventListener('touchstart', start, opts);
    el.addEventListener('touchmove', move, opts);
    el.addEventListener('touchend', end, opts);
    el.addEventListener('touchcancel', end, opts);
    bound.current = {
      el,
      off: () => {
        el.removeEventListener('touchstart', start, opts);
        el.removeEventListener('touchmove', move, opts);
        el.removeEventListener('touchend', end, opts);
        el.removeEventListener('touchcancel', end, opts);
      },
    };
  });
  useEffect(() => () => bound.current?.off(), []);
}
