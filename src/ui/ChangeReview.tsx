import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PageRef } from '../lib/pdf/types.ts';
import { PagePreview } from './PagePreview.tsx';
import { Thumb } from './Thumb.tsx';
import { Button, Icon } from './kit.tsx';

export type ReviewTile = {
  key: string;
  page: PageRef;
  /** git-style flags */
  removed?: boolean;
  added?: boolean;
  moved?: boolean;
  rotated?: boolean;
  edited?: boolean;
  skipped?: boolean;
};
export type ReviewSection = { title: string; hint?: string; tiles: ReviewTile[] };

type Props = {
  open: boolean;
  title: string;
  summary: ReactNode;
  sections: ReviewSection[];
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  caption?: (p: PageRef) => string;
  /** Rendered above the page sections, e.g. a text diff. */
  extra?: ReactNode;
  /** There is nothing to review: show that plainly and keep Confirm off. */
  nothing?: boolean;
};

type Kind = 'removed' | 'added' | 'moved' | 'changed' | 'skipped';
const KIND: Record<Kind, { label: string; box: string; badge: string; chip: string; dot: string }> = {
  removed: { label: 'Removed', box: 'border-danger bg-danger-tint', badge: 'bg-danger text-white', chip: 'bg-danger-tint text-danger', dot: 'bg-danger' },
  added: { label: 'Added', box: 'border-success bg-success-tint', badge: 'bg-success text-white', chip: 'bg-success-tint text-success', dot: 'bg-success' },
  moved: { label: 'Moved', box: 'border-warning bg-warning-tint', badge: 'bg-warning text-white', chip: 'bg-warning-tint text-warning', dot: 'bg-warning' },
  changed: { label: 'Edited or rotated', box: 'border-info bg-info-tint', badge: 'bg-info text-white', chip: 'bg-info-tint text-info', dot: 'bg-info' },
  skipped: { label: 'Not exported', box: 'border-border bg-surface-sunken opacity-70', badge: 'bg-text-muted text-white', chip: 'bg-surface-sunken text-text-secondary', dot: 'bg-text-muted' },
};

function tileKind(t: ReviewTile): { kind: Kind | null; badge: string | null } {
  if (t.removed) return { kind: 'removed', badge: 'Removed' };
  if (t.added) return { kind: 'added', badge: 'Added' };
  if (t.moved) return { kind: 'moved', badge: 'Moved' };
  if (t.edited) return { kind: 'changed', badge: 'Edited' };
  if (t.rotated) return { kind: 'changed', badge: `Rotated ${t.page.rotation}°` };
  if (t.skipped) return { kind: 'skipped', badge: 'Not exported' };
  return { kind: null, badge: null };
}

/** Required before Merge / Split / Save: every page is outlined by what happens to it, with a legend of what is present. */
export function ChangeReview({
  open,
  title,
  summary,
  sections,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
  caption,
  extra,
  nothing = false,
}: Props) {
  const dlg = useRef<HTMLDialogElement | null>(null);
  const [preview, setPreview] = useState<{ section: number; index: number } | null>(null);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const previewPages = preview ? (sections[preview.section]?.tiles.map((t) => t.page) ?? []) : [];
  const present = new Set<Kind>();
  for (const sec of sections)
    for (const t of sec.tiles) {
      const k = tileKind(t).kind;
      if (k) present.add(k);
    }

  return (
    <dialog ref={dlg} aria-label="Review changes" onClose={onCancel} className="yh-dialog yh-dialog-wide">
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="space-y-2 border-b border-divider p-5">
            <h2 className="text-xl leading-7 font-semibold">{title}</h2>
            <div className="text-sm text-text-muted" data-testid="review-summary">
              {nothing ? 'Nothing is waiting to be saved.' : summary}
            </div>
            {!nothing && present.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1" aria-label="What the outlines mean" role="group">
                {([...present] as Kind[]).map((k) => (
                  <span key={k} className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium ${KIND[k].chip}`}>
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${KIND[k].dot}`} />
                    {KIND[k].label}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto p-5">
            {nothing ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center" data-testid="review-empty">
                <span className="text-text-muted">
                  <Icon name="check" size={32} />
                </span>
                <p className="text-[17px] leading-6 font-semibold">Nothing to be reviewed</p>
                <p className="max-w-[44ch] text-sm text-text-muted">There are no changes yet. Make an edit, then come back to review and save it.</p>
              </div>
            ) : (
              <>
                {extra}
                {sections.map((sec, si) => (
                  <section key={sec.title}>
                    <h3 className="text-[15px] leading-[22px] font-semibold">
                      {sec.title} <span className="font-normal text-text-muted tabular-nums">({sec.tiles.length})</span>
                    </h3>
                    {sec.hint && <p className="text-xs text-text-muted">{sec.hint}</p>}
                    {sec.tiles.length === 0 ? (
                      <p className="py-2 text-xs text-text-muted">Nothing here.</p>
                    ) : (
                      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-3">
                        {sec.tiles.map((t, ti) => {
                          const { kind, badge } = tileKind(t);
                          return (
                            <button
                              key={t.key}
                              type="button"
                              onClick={() => setPreview({ section: si, index: ti })}
                              aria-label={`Preview page ${t.page.srcIndex + 1}${badge ? ` (${badge.toLowerCase()})` : ''}`}
                              className={`relative flex h-36 items-center justify-center overflow-hidden rounded-md border-2 p-1.5 pb-6 transition-shadow duration-150 hover:shadow-2 ${
                                kind ? KIND[kind].box : 'border-border bg-surface'
                              }`}
                            >
                              <Thumb page={t.page} width={96} />
                              <span className="absolute inset-x-0 bottom-0 flex items-center justify-between px-1.5 py-1 text-[11px] leading-4">
                                <span className="text-text-muted tabular-nums">p.{t.page.srcIndex + 1}</span>
                                {badge && kind && <span className={`rounded-pill px-1.5 font-semibold ${KIND[kind].badge}`}>{badge}</span>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ))}
              </>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-divider p-4 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={onCancel}>
              {nothing ? 'Close' : 'Cancel'}
            </Button>
            {!nothing && (
              <Button variant="primary" disabled={busy} onClick={onConfirm} className="px-5">
                {confirmLabel}
              </Button>
            )}
          </div>
        </div>
      )}

      <PagePreview
        pages={previewPages}
        index={preview?.index ?? null}
        onIndex={(i) => setPreview(i === null || !preview ? null : { section: preview.section, index: i })}
        caption={caption}
      />
    </dialog>
  );
}
