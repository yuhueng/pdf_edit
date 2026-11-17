import { useDraggable } from '@dnd-kit/core';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { PageRef } from '../lib/pdf/types.ts';
import { renderThumb } from '../lib/render.ts';
import { Icon, IconButton, Skeleton } from './kit.tsx';

type Props = {
  page: PageRef;
  /** Display label under the frame: "Page 3" (or "F2 · Page 1" in mixed views). */
  label: string;
  /** Accessible name for the checkbox: "Page 3 of Cert.pdf". */
  checkLabel: string;
  /** Width of the frame in CSS px, so the render is 2x what is shown. */
  width: number;
  selected: boolean;
  onToggle: (shift: boolean) => void;
  onZoom: () => void;
  /** Names of new files this page was already added to. */
  usedBy?: string[];
  readOnly?: boolean;
};

/** A page: 3:4 frame, round check top right, label below, zoom button on hover, "In <file>" pill when already used. */
export function PageThumb({ page, label, checkLabel, width, selected, onToggle, onZoom, usedBy, readOnly }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: page.id, disabled: readOnly });
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ac = new AbortController();
    let alive = true;
    void renderThumb(page.fileId, page.srcIndex, width, ac.signal)
      .then((bmp) => {
        if (!alive || !bmp || ac.signal.aborted || !canvas.current) return;
        const el = canvas.current;
        el.width = bmp.width;
        el.height = bmp.height;
        el.getContext('2d')?.drawImage(bmp, 0, 0);
        setReady(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
      ac.abort();
    };
  }, [page.fileId, page.srcIndex, width]);

  const used = usedBy && usedBy.length > 0 ? usedBy : null;

  return (
    <div
      ref={setNodeRef}
      {...(readOnly ? {} : attributes)}
      {...(readOnly ? {} : listeners)}
      role="listitem"
      tabIndex={-1}
      data-testid={`page-tile-${page.id}`}
      className={`group relative touch-manipulation select-none ${isDragging ? 'opacity-40' : ''}`}
    >
      <div
        className={`relative aspect-[3/4] overflow-hidden rounded-md bg-surface-muted transition-[border-color,box-shadow] duration-150 ${
          selected
            ? 'border-2 border-accent shadow-[0_0_0_4px_var(--color-accent-tint)] p-[5px]'
            : 'border border-border group-hover:border-border-hover p-1.5'
        }`}
      >
        {!ready && <Skeleton className="absolute inset-1.5" />}
        <div className="flex h-full w-full items-center justify-center">
          <canvas ref={canvas} className={`max-h-full max-w-full bg-surface object-contain transition-opacity duration-200 ${ready ? 'opacity-100' : 'opacity-0'}`} />
        </div>

        {!readOnly && (
          <>
            {/* The real checkbox covers the frame: a click anywhere ticks the page; Space works from the keyboard. */}
            <input
              type="checkbox"
              checked={selected}
              onChange={() => {}}
              onClick={(e: MouseEvent<HTMLInputElement>) => onToggle(e.shiftKey)}
              aria-label={checkLabel}
              className="peer absolute inset-0 z-[1] h-full w-full cursor-pointer appearance-none rounded-md opacity-0"
            />
            {/* The focus ring goes on the whole thumbnail. */}
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-md peer-focus-visible:shadow-focus" />
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full ${
                selected ? 'yh-pop bg-accent text-white' : 'border-[1.5px] border-border-strong bg-white'
              }`}
            >
              {selected && <Icon name="check" size={12} />}
            </span>
          </>
        )}

        <span className="absolute bottom-2 right-2 z-[2] opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          <IconButton icon="zoomIn" label={`Zoom ${checkLabel}`} tip="Preview" size="sm" onClick={onZoom} className="bg-surface shadow-1" />
        </span>
      </div>

      <p className="mt-1.5 text-xs text-text-muted tabular-nums">{label}</p>
      {used && (
        <p
          title={`Already in ${used.join(', ')}`}
          className="mt-1 inline-block max-w-full truncate rounded-pill bg-accent-tint px-2 py-0.5 text-xs text-accent"
        >
          In {used[0]}
          {used.length > 1 ? ` +${used.length - 1}` : ''}
        </p>
      )}
    </div>
  );
}
