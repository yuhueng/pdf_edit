import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Rgb, StdFont } from '../../lib/pdf/types.ts';

export type FamilyKey = 'sans' | 'serif' | 'mono';

/** One existing text run on a page, in PDF user space plus scale-1 viewport pixels (for the overlay). */
export type TextHit = {
  key: string;
  str: string;
  page: number;
  /** Baseline origin, PDF user space. */
  x: number;
  y: number;
  /** Box, PDF user space: [x0, y0, x1, y1]. */
  box: [number, number, number, number];
  /** Box in scale-1 viewport pixels (top-left origin). */
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  size: number;
  family: FamilyKey;
  bold: boolean;
  italic: boolean;
};

const STD: Record<FamilyKey, [StdFont, StdFont, StdFont, StdFont]> = {
  sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  mono: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
};

export function stdFont(family: FamilyKey, bold: boolean, italic: boolean): StdFont {
  return STD[family][(bold ? 1 : 0) + (italic ? 2 : 0)]!;
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function guessFamily(realName: string, cssFamily: string): FamilyKey {
  if (/mono|courier|consolas/i.test(realName) || /monospace/i.test(cssFamily)) return 'mono';
  if (/times|serif|georgia|garamond|minion/i.test(realName) && !/sans/i.test(realName)) return 'serif';
  if (/(^|\W)serif/i.test(cssFamily) && !/sans/i.test(cssFamily)) return 'serif';
  return 'sans';
}

/** Text runs of one page. Pages with /Rotate are skipped (returns null) because box mapping would differ. */
export async function loadTextHits(proxy: PDFDocumentProxy, pageIndex: number): Promise<TextHit[] | null> {
  const page = await proxy.getPage(pageIndex + 1);
  if (page.rotate % 360 !== 0) return null;
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const hits: TextHit[] = [];
  tc.items.forEach((it, idx) => {
    if (!('str' in it) || !it.str.trim()) return;
    const [, b, c, d, e, f] = it.transform as number[];
    if (Math.abs(b!) > 0.01 || Math.abs(c!) > 0.01) return; // skip rotated/skewed runs
    const size = Math.hypot(c!, d!) || Math.abs(d!) || 12;
    const x0 = e!;
    const x1 = e! + it.width;
    const y0 = f! - 0.25 * size;
    const y1 = f! + 0.85 * size;
    const [px0, py0] = vp.convertToViewportPoint(x0, y1) as [number, number];
    const [px1, py1] = vp.convertToViewportPoint(x1, y0) as [number, number];

    let realName = '';
    try {
      realName = (page.commonObjs.get(it.fontName) as { name?: string } | undefined)?.name ?? '';
    } catch {
      /* font object not resolved yet */
    }
    const css = tc.styles[it.fontName]?.fontFamily ?? '';
    hits.push({
      key: `${pageIndex}:${idx}`,
      str: it.str,
      page: pageIndex,
      x: e!,
      y: f!,
      box: [x0, y0, x1, y1],
      vx: Math.min(px0, px1),
      vy: Math.min(py0, py1),
      vw: Math.abs(px1 - px0),
      vh: Math.abs(py1 - py0),
      size: Math.round(size * 10) / 10,
      family: guessFamily(realName, css),
      bold: /bold|black|heavy/i.test(realName),
      italic: /italic|oblique/i.test(realName),
    });
  });
  return hits;
}

/** Darkest pixel inside the run on the already-rendered page canvas, as #rrggbb (defaults to black). */
export function sampleColor(canvas: HTMLCanvasElement, hit: TextHit, zoom: number): string {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.clientWidth) return '#000000';
    const s = (canvas.width * zoom) / canvas.clientWidth; // canvas px per scale-1 viewport px
    const w = Math.max(1, Math.round(hit.vw * s));
    const h = Math.max(1, Math.round(hit.vh * s));
    const img = ctx.getImageData(Math.max(0, Math.round(hit.vx * s)), Math.max(0, Math.round(hit.vy * s)), w, h).data;
    let best = 255 * 3 + 1;
    let hex = '#000000';
    for (let i = 0; i < img.length; i += 4) {
      const sum = img[i]! + img[i + 1]! + img[i + 2]!;
      if (img[i + 3]! > 0 && sum < best) {
        best = sum;
        hex = `#${[img[i]!, img[i + 1]!, img[i + 2]!].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      }
    }
    return hex;
  } catch {
    return '#000000';
  }
}

export type Box = { x1: number; y1: number; x2: number; y2: number };
export type Rect = { x: number; y: number; w: number; h: number };
type Run = Pick<TextHit, 'str' | 'vx' | 'vy' | 'vw' | 'vh'>;

/**
 * Rectangles (scale-1 viewport units) to highlight for a drag box, like a text selection:
 * a one-line drag marks the characters under it; a multi-line drag marks the first line from the drag start,
 * every line between in full, and the last line up to the drag end. Character positions are proportional.
 */
export function highlightRects(runs: Run[], box: Box): Rect[] {
  const l = Math.min(box.x1, box.x2);
  const r = Math.max(box.x1, box.x2);
  const t = Math.min(box.y1, box.y2);
  const b = Math.max(box.y1, box.y2);
  // Multi-line: the selection starts where the upper end of the drag is and ends at the lower end.
  const upperFirst = box.y1 <= box.y2;
  const startX = upperFirst ? box.x1 : box.x2;
  const endX = upperFirst ? box.x2 : box.x1;
  const hit = runs.filter((u) => {
    const overlap = Math.min(b, u.vy + u.vh) - Math.max(t, u.vy);
    const inside = t >= u.vy && b <= u.vy + u.vh; // a flat drag along one line
    return (overlap >= 0.4 * u.vh || inside) && u.str.length > 0;
  });
  if (hit.length === 0) return [];
  // Lines by vertical centre.
  const centres = [...new Set(hit.map((u) => Math.round((u.vy + u.vh / 2) / 3) * 3))].sort((a, c) => a - c);
  const lineOf = (u: Run) => centres.indexOf(Math.round((u.vy + u.vh / 2) / 3) * 3);
  const last = centres.length - 1;
  const out: Rect[] = [];
  for (const u of hit) {
    const li = lineOf(u);
    const from = last === 0 ? l : li === 0 ? startX : -Infinity;
    const to = last === 0 ? r : li === last ? endX : Infinity;
    const cw = u.vw / u.str.length;
    const s = Math.max(0, Math.floor((Math.max(from, u.vx) - u.vx) / cw));
    const e = Math.min(u.str.length, Math.ceil((Math.min(to, u.vx + u.vw) - u.vx) / cw));
    if (e <= s) continue;
    out.push({ x: u.vx + s * cw, y: u.vy, w: (e - s) * cw, h: u.vh });
  }
  return out;
}
