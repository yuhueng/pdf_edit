import type { Edit, Rgb, StdFont } from './types.ts';
import { bufferToBytes, openMuPdf } from './mupdfStream.ts';
import { applyEdits } from './ops.ts';

/** One existing-text replacement. Box is in PDF user space (points, origin bottom-left). */
export type TextReplacement = {
  page: number;
  box: [x0: number, y0: number, x1: number, y1: number];
  /** Baseline origin of the new text. */
  x: number;
  y: number;
  text: string;
  font: StdFont;
  size: number;
  color: Rgb;
};

/**
 * Removes the original text under each box (true removal, images and graphics untouched),
 * then draws the replacement text at the same baseline.
 * MuPDF.js is AGPL-3.0; it is loaded lazily so it only costs bytes when this feature is used.
 */
export async function replaceText(bytes: Uint8Array, reps: TextReplacement[]): Promise<Uint8Array> {
  if (reps.length === 0) return bytes;
  const s = await openMuPdf(bytes);
  const doc = s.doc.asPDF();
  if (!doc) {
    s.close();
    throw new Error('Not a PDF');
  }
  let saved: Uint8Array;
  try {
    const byPage = new Map<number, TextReplacement[]>();
    for (const r of reps) byPage.set(r.page, [...(byPage.get(r.page) ?? []), r]);
    for (const [pageNo, list] of byPage) {
      const page = doc.loadPage(pageNo) as import('mupdf').PDFPage;
      const m = page.getTransform();
      for (const r of list) {
        const annot = page.createAnnotation('Redact');
        // Shrink 0.5 pt per side so neighbouring lines are not caught.
        const [x0, y0, x1, y1] = r.box;
        const [rx0, ry0, rx1, ry1] = s.mupdf.Rect.transform([x0 + 0.5, y0 + 0.5, x1 - 0.5, y1 - 0.5], m);
        annot.setRect([rx0, ry0, rx1, ry1]);
      }
      page.applyRedactions(false, s.mupdf.PDFPage.REDACT_IMAGE_NONE);
      page.destroy();
    }
    saved = bufferToBytes(doc.saveToBuffer('garbage'));
  } finally {
    s.close();
  }
  const edits: Edit[] = reps.map((r) => ({
    kind: 'text',
    page: r.page,
    x: r.x,
    y: r.y,
    lines: [r.text],
    lineStep: r.size * 1.2,
    size: r.size,
    font: r.font,
    color: r.color,
    opacity: 1,
    angle: 0,
    underline: false,
  }));
  return await applyEdits(saved, edits);
}
