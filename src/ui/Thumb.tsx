import { useEffect, useRef, useState } from 'react';
import type { PageRef } from '../lib/pdf/types.ts';
import { renderThumb } from '../lib/render.ts';

/** Lazy thumbnail: renders only once scrolled into view, so 400-page lists stay cheap. */
export function Thumb({ page, width = 120, className = '' }: { page: PageRef; width?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), {
      rootMargin: '200px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const ac = new AbortController();
    void renderThumb(page.fileId, page.srcIndex, width, ac.signal)
      .then((bmp) => {
        const c = ref.current;
        if (!bmp || !c || ac.signal.aborted) return;
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d')?.drawImage(bmp, 0, 0);
        setLoaded(true);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [visible, page.fileId, page.srcIndex, width]);

  return (
    <canvas
      ref={ref}
      style={{ transform: `rotate(${page.rotation}deg)` }}
      className={`max-h-full max-w-full object-contain transition-transform duration-150 ${
        loaded ? '' : 'bg-gray-200 animate-pulse min-h-16 min-w-12'
      } ${className}`}
    />
  );
}
