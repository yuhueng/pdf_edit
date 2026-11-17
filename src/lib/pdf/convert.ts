import type { Color, ColorSpace, Matrix, Page } from 'mupdf';
import { openMuPdf } from './mupdfStream.ts';
import type { Progress } from './types.ts';

/** Convert a PDF to images, Markdown, plain text or HTML with MuPDF (lazy-loaded). */

export type ConvertFormat = 'png' | 'jpeg' | 'md' | 'txt' | 'html';
export type ConvertOpts = {
  format: ConvertFormat;
  /** 0-based page indexes, any order; duplicates are ignored. */
  pages: number[];
  /** Image formats only. */
  dpi: number;
  /** File name without extension. */
  baseName: string;
};
export type ConvertFile = { name: string; bytes: Uint8Array; mime: string };
export type ConvertResult = { files: ConvertFile[]; warnings: string[] };

export const MAX_IMAGE_SIDE = 8000;
const MIME: Record<ConvertFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  md: 'text/markdown',
  txt: 'text/plain',
  html: 'text/html',
};
const EXT: Record<ConvertFormat, string> = { png: 'png', jpeg: 'jpg', md: 'md', txt: 'txt', html: 'html' };

type FontFamily = 'sans' | 'serif' | 'mono';
type Span = { text: string; size: number; bold: boolean; italic: boolean; family: FontFamily; color: string };
type Rect = [x0: number, y0: number, x1: number, y1: number];
type Line = { text: string; size: number; bold: boolean; italic: boolean; spans: Span[]; bbox: Rect };
type BlockBox = { fill?: string; stroke?: string; strokeWidth?: number };
type Block = { kind: 'block'; lines: Line[]; bbox: Rect; align?: 'center' | 'right'; box?: BlockBox };
type PageImage = { kind: 'image'; bbox: Rect; dataUrl: string; width: number; height: number };
type PageData = {
  width: number;
  height: number;
  blocks: Block[];
  images: PageImage[];
  vectorsSvg: string | null;
};

const toHexByte = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0');
const rgbHex = (r: number, g: number, b: number) => `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;

function deviceColorHex(cs: ColorSpace, c: number[]): string {
  if (cs.isRGB() && c.length >= 3) return rgbHex(c[0]!, c[1]!, c[2]!);
  if (cs.isGray() && c.length >= 1) return rgbHex(c[0]!, c[0]!, c[0]!);
  if (cs.isCMYK() && c.length >= 4) {
    const k = c[3]!;
    return rgbHex(1 - Math.min(1, c[0]! + k), 1 - Math.min(1, c[1]! + k), 1 - Math.min(1, c[2]! + k));
  }
  return c.length >= 3 ? rgbHex(c[0]!, c[1]!, c[2]!) : c.length === 1 ? rgbHex(c[0]!, c[0]!, c[0]!) : '#000000';
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function readPage(page: Page, mupdf: typeof import('mupdf'), wantRich: boolean): PageData {
  const [px0, py0, px1, py1] = page.getBounds();
  const pageW = px1 - px0;
  const pageH = py1 - py0;
  const st = page.toStructuredText(
    wantRich ? 'preserve-ligatures,preserve-whitespace,preserve-spans,preserve-images' : 'preserve-ligatures,preserve-whitespace,preserve-spans',
  );
  const blocks: Block[] = [];
  const images: PageImage[] = [];

  try {
    let curBlockBbox: Rect = [0, 0, 0, 0];
    let curLines: Line[] = [];
    let curLineBbox: Rect = [0, 0, 0, 0];
    let curSpans: Span[] = [];

    const pushSpanChar = (c: string, span: Omit<Span, 'text'>) => {
      const prev = curSpans[curSpans.length - 1];
      if (
        prev &&
        prev.size === span.size &&
        prev.bold === span.bold &&
        prev.italic === span.italic &&
        prev.family === span.family &&
        prev.color === span.color
      ) {
        prev.text += c;
      } else {
        curSpans.push({ text: c, ...span });
      }
    };

    st.walk({
      beginTextBlock(bbox) {
        curBlockBbox = bbox;
        curLines = [];
      },
      beginLine(bbox) {
        curLineBbox = bbox;
        curSpans = [];
      },
      onChar(c, _origin, font, size, _quad, color) {
        const roundedSize = Math.round(size * 10) / 10;
        const family: FontFamily = font.isMono() ? 'mono' : font.isSerif() ? 'serif' : 'sans';
        const hex = color.length >= 3 ? rgbHex(color[0]!, color[1]!, color[2]!) : '#000000';
        pushSpanChar(c, {
          size: roundedSize,
          bold: font.isBold(),
          italic: font.isItalic(),
          family,
          color: hex,
        });
      },
      endLine() {
        while (curSpans.length > 0 && curSpans[curSpans.length - 1]!.text.trim() === '') {
          curSpans.pop();
        }
        if (curSpans.length > 0) {
          const last = curSpans[curSpans.length - 1]!;
          last.text = last.text.replace(/\s+$/g, '');
        }
        const text = curSpans.map((s) => s.text).join('');
        if (text.trim() !== '') {
          const first = curSpans[0]!;
          curLines.push({
            text,
            size: first.size,
            bold: curSpans.every((s) => s.bold || s.text.trim() === ''),
            italic: curSpans.every((s) => s.italic || s.text.trim() === ''),
            spans: curSpans,
            bbox: curLineBbox,
          });
        }
      },
      endTextBlock() {
        if (curLines.length > 0) {
          const bw = curBlockBbox[2] - curBlockBbox[0];
          const midX = (curBlockBbox[0] + curBlockBbox[2]) / 2;
          let align: 'center' | 'right' | undefined;
          if (bw < pageW * 0.72) {
            if (Math.abs(midX - pageW / 2) <= 22 && curBlockBbox[0] > pageW * 0.14) align = 'center';
            else if (curBlockBbox[0] > pageW * 0.55 && curBlockBbox[2] > pageW * 0.75) align = 'right';
          }
          blocks.push({ kind: 'block', lines: curLines, bbox: curBlockBbox, align });
        }
      },
      onImageBlock(bbox, _mat, image) {
        if (!wantRich) return;
        const w = Math.round(bbox[2] - bbox[0]);
        const h = Math.round(bbox[3] - bbox[1]);
        if (w < 4 || h < 4) return;
        // One undecodable image (odd colour space, broken data) is skipped instead of failing the whole page.
        let pix: import('mupdf').Pixmap | null = null;
        try {
          pix = image.toPixmap();
          const cs = pix.getColorSpace();
          if (cs && !cs.isRGB() && !cs.isGray()) {
            const rgb = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, !!pix.getAlpha());
            pix.destroy();
            pix = rgb;
          }
          const png = new Uint8Array(pix.asPNG());
          images.push({
            kind: 'image',
            bbox,
            dataUrl: `data:image/png;base64,${toBase64(png)}`,
            width: w,
            height: h,
          });
        } catch {
          // keep going without this image
        } finally {
          pix?.destroy();
        }
      },
    });
  } finally {
    st.destroy();
  }

  let vectorsSvg: string | null = null;
  if (wantRich) {
    const rects: Array<{ rect: Rect; fill?: string; stroke?: string; strokeWidth?: number }> = [];
    const svgBuf = new mupdf.Buffer();
    const writer = new mupdf.DocumentWriter(svgBuf, 'svg', '');
    const svgDev = writer.beginPage([px0, py0, px1, py1]);
    let complexVectors = 0;

    const extractAxisRect = (path: import('mupdf').Path, ctm: Matrix): Rect | null => {
      const pts: Array<[number, number]> = [];
      let curved = false;
      path.walk({
        moveTo(x, y) {
          pts.push([x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]]);
        },
        lineTo(x, y) {
          pts.push([x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]]);
        },
        curveTo() {
          curved = true;
        },
      });
      if (curved || pts.length < 4 || pts.length > 5) return null;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      const ok = pts.every(
        ([px, py]) => (Math.abs(px - x0) < 1 || Math.abs(px - x1) < 1) && (Math.abs(py - y0) < 1 || Math.abs(py - y1) < 1),
      );
      return ok && x1 - x0 > 4 && y1 - y0 > 4 ? [x0, y0, x1, y1] : null;
    };

    const enclosesAnyBlock = (r: Rect): boolean => {
      if (r[3] - r[1] >= pageH * 0.55) return false;
      let matched = false;
      for (const b of blocks) {
        if (r[0] <= b.bbox[0] + 6 && r[2] >= b.bbox[2] - 6 && r[1] <= b.bbox[1] + 6 && r[3] >= b.bbox[3] - 6) {
          matched = true;
        }
      }
      return matched;
    };

    const filterDev = new mupdf.Device({
      fillPath(path, eo, ctm, cs, color, alpha) {
        const hex = deviceColorHex(cs, color);
        const r = extractAxisRect(path, ctm);
        if (r) {
          const area = (r[2] - r[0]) * (r[3] - r[1]);
          if (hex === '#ffffff' && area > pageW * pageH * 0.85) return; // page canvas white fill
          if (alpha > 0.05 && enclosesAnyBlock(r)) {
            rects.push({ rect: r, fill: hex });
            return;
          }
        }
        complexVectors++;
        svgDev.fillPath(path, eo, ctm, cs, color as Color, alpha);
      },
      strokePath(path, stroke, ctm, cs, color, alpha) {
        const hex = deviceColorHex(cs, color);
        const r = extractAxisRect(path, ctm);
        if (r && alpha > 0.05 && enclosesAnyBlock(r)) {
          rects.push({ rect: r, stroke: hex, strokeWidth: Math.max(0.5, stroke.getLineWidth()) });
          return;
        }
        complexVectors++;
        svgDev.strokePath(path, stroke, ctm, cs, color as Color, alpha);
      },
      fillShade(sh, ctm, alpha) {
        complexVectors++;
        svgDev.fillShade(sh, ctm, alpha);
      },
    });
    try {
      page.run(filterDev, mupdf.Matrix.identity);
      filterDev.close();
    } finally {
      filterDev.destroy();
      writer.endPage();
      writer.close();
      writer.destroy();
    }

    for (const r of rects) {
      for (const b of blocks) {
        if (
          r.rect[0] <= b.bbox[0] + 6 &&
          r.rect[2] >= b.bbox[2] - 6 &&
          r.rect[1] <= b.bbox[1] + 6 &&
          r.rect[3] >= b.bbox[3] - 6 &&
          r.rect[3] - r.rect[1] < pageH * 0.55
        ) {
          b.box = { ...b.box, ...(r.fill ? { fill: r.fill } : {}), ...(r.stroke ? { stroke: r.stroke, strokeWidth: r.strokeWidth } : {}) };
        }
      }
    }

    try {
      if (complexVectors > 0) {
        const rawSvg = svgBuf.asString().trim();
        if (rawSvg.includes('<path') || rawSvg.includes('<image')) {
          vectorsSvg = rawSvg.replace(/<svg\b/, '<svg class="yh-vectors"');
        }
      }
    } finally {
      svgBuf.destroy();
    }
  }

  return { width: pageW, height: pageH, blocks, images, vectorsSvg };
}

/** The most common font size by amount of text: what counts as "body". */
function bodySize(pages: PageData[]): number {
  const w = new Map<number, number>();
  for (const p of pages)
    for (const b of p.blocks)
      for (const l of b.lines) w.set(Math.round(l.size * 2) / 2, (w.get(Math.round(l.size * 2) / 2) ?? 0) + l.text.length);
  let best = 12;
  let bestW = -1;
  for (const [s, n] of w) if (n > bestW) [best, bestW] = [s, n];
  return best;
}

const BULLET = /^\s*([•●▪◦·–—*-]|\d{1,3}[.)])\s+/;

type Node =
  | { kind: 'h'; level: 1 | 2 | 3; text: string; spans: Span[]; block: Block }
  | { kind: 'p'; text: string; bold: boolean; italic: boolean; spans: Span[]; block: Block }
  | { kind: 'ul'; items: Array<{ text: string; spans: Span[] }>; block: Block }
  | { kind: 'img'; image: PageImage };

/** Joins plain strings across wrapped lines; a trailing hyphen before lowercase is de-hyphenated. */
function joinLines(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const t = raw.trim();
    if (out === '') out = t;
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(t)) out = out.slice(0, -1) + t;
    else out += ' ' + t;
  }
  return out;
}

/** Joins styled span lists across wrapped lines while preserving each span's typography & color. */
function joinSpanLines(lines: Line[]): Span[] {
  const merged: Span[] = [];
  const pushSpan = (s: Span) => {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.size === s.size &&
      prev.bold === s.bold &&
      prev.italic === s.italic &&
      prev.family === s.family &&
      prev.color === s.color
    ) {
      prev.text += s.text;
    } else {
      merged.push({ ...s });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const spans = line.spans.map((s) => ({ ...s }));
    if (i > 0 && spans.length > 0 && merged.length > 0) {
      const prev = merged[merged.length - 1]!;
      const next = spans[0]!;
      const prevTrim = prev.text.trimEnd();
      const nextTrim = next.text.trimStart();
      if (/[A-Za-z]-$/.test(prevTrim) && /^[a-z]/.test(nextTrim)) {
        prev.text = prevTrim.slice(0, -1);
        next.text = nextTrim;
      } else if (!/\s$/.test(prev.text) && !/^\s/.test(next.text)) {
        prev.text += ' ';
      }
    }
    for (const s of spans) pushSpan(s);
  }
  return merged;
}

function classify(blocks: Block[], body: number): Node[] {
  const nodes: Node[] = [];
  for (const b of blocks) {
    const first = b.lines[0]!;
    const text = joinLines(b.lines.map((l) => l.text));
    const spans = joinSpanLines(b.lines);
    const ratio = first.size / body;
    if (ratio >= 1.15 && b.lines.length <= 3 && text.length <= 200) {
      nodes.push({ kind: 'h', level: ratio >= 1.8 ? 1 : ratio >= 1.4 ? 2 : 3, text, spans, block: b });
      continue;
    }
    if (BULLET.test(first.text)) {
      const items: Array<{ text: string; spans: Span[] }> = [];
      let curItemLines: Line[] = [];
      const flushItem = () => {
        if (curItemLines.length === 0) return;
        const t = joinLines(curItemLines.map((l, idx) => (idx === 0 ? l.text.replace(BULLET, '').trim() : l.text)));
        const firstCopy: Line = {
          ...curItemLines[0]!,
          spans: stripBulletFromSpans(curItemLines[0]!.spans),
        };
        items.push({ text: t, spans: joinSpanLines([firstCopy, ...curItemLines.slice(1)]) });
        curItemLines = [];
      };
      for (const l of b.lines) {
        if (BULLET.test(l.text) && curItemLines.length > 0) flushItem();
        curItemLines.push(l);
      }
      flushItem();
      nodes.push({ kind: 'ul', items, block: b });
      continue;
    }
    nodes.push({
      kind: 'p',
      text,
      bold: b.lines.every((l) => l.bold),
      italic: b.lines.every((l) => l.italic),
      spans,
      block: b,
    });
  }
  return nodes;
}

function stripBulletFromSpans(spans: Span[]): Span[] {
  const full = spans.map((s) => s.text).join('');
  const m = BULLET.exec(full);
  if (!m) return spans;
  let drop = m[0].length;
  const out: Span[] = [];
  for (const s of spans) {
    if (drop >= s.text.length) {
      drop -= s.text.length;
    } else if (drop > 0) {
      out.push({ ...s, text: s.text.slice(drop) });
      drop = 0;
    } else {
      out.push(s);
    }
  }
  return out;
}

const mdEscape = (s: string) => s.replace(/([\\`*_[\]<>])/g, '\\$1').replace(/^(\s*)([#>+-]|\d+\.)(\s)/, '$1\\$2$3');
const htmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toMarkdown(nodes: Node[]): string {
  return nodes
    .map((n) => {
      if (n.kind === 'img') return '';
      if (n.kind === 'h') return `${'#'.repeat(n.level)} ${mdEscape(n.text)}`;
      if (n.kind === 'ul') return n.items.map((i) => `- ${mdEscape(i.text)}`).join('\n');
      const t = mdEscape(n.text);
      return n.bold && n.italic ? `***${t}***` : n.bold ? `**${t}**` : n.italic ? `*${t}*` : t;
    })
    .filter(Boolean)
    .join('\n\n');
}

const FONT_CSS: Record<FontFamily, string> = {
  sans: 'system-ui,-apple-system,sans-serif',
  serif: "Georgia,'Times New Roman',serif",
  mono: "ui-monospace,'Courier New',monospace",
};

function renderStyledSpans(spans: Span[], opts: { skipBold?: boolean; skipItalic?: boolean; baseSize?: number }): string {
  return spans
    .map((s) => {
      let inner = htmlEscape(s.text);
      if (s.italic && !opts.skipItalic && s.text.trim()) inner = `<em>${inner}</em>`;
      if (s.bold && !opts.skipBold && s.text.trim()) inner = `<strong>${inner}</strong>`;
      const css: string[] = [];
      if (s.color !== '#000000') css.push(`color:${s.color}`);
      if (s.family !== 'sans') css.push(`font-family:${FONT_CSS[s.family]}`);
      if (opts.baseSize !== undefined && Math.abs(s.size - opts.baseSize) >= 1.5) css.push(`font-size:${s.size}pt`);
      return css.length > 0 ? `<span style="${css.join(';')}">${inner}</span>` : inner;
    })
    .join('');
}

function blockStyleAttr(block: Block, body: number, isParagraph: boolean): string {
  const css: string[] = [];
  if (block.align) css.push(`text-align:${block.align}`);
  if (block.box?.fill) {
    css.push(`background:${block.box.fill}`, 'padding:8pt 12pt', 'border-radius:4px');
  }
  if (block.box?.stroke) {
    css.push(`border:${(block.box.strokeWidth ?? 1).toFixed(1)}pt solid ${block.box.stroke}`);
    if (!block.box.fill) css.push('padding:8pt 12pt', 'border-radius:4px');
  }
  if (isParagraph) {
    const sizes = block.lines.flatMap((l) => l.spans.map((s) => s.size));
    const maxS = sizes.length > 0 ? Math.max(...sizes) : body;
    const minS = sizes.length > 0 ? Math.min(...sizes) : body;
    if (Math.abs(maxS - minS) < 0.5 && Math.abs(maxS - body) >= 1.5) {
      css.push(`font-size:${maxS}pt`);
    }
  }
  return css.length > 0 ? ` style="${css.join(';')}"` : '';
}

function toHtmlBody(page: PageData, body: number): string {
  const classified = classify(page.blocks, body);
  type Item = { y: number; html: string };
  const items: Item[] = [];

  for (const n of classified) {
    const y = n.kind === 'img' ? n.image.bbox[1] : n.block.bbox[1];
    if (n.kind === 'h') {
      const attrs = blockStyleAttr(n.block, body, false);
      const inner = renderStyledSpans(n.spans, { skipBold: true });
      items.push({ y, html: `<h${n.level}${attrs}>${inner}</h${n.level}>` });
    } else if (n.kind === 'ul') {
      const attrs = blockStyleAttr(n.block, body, false);
      const lis = n.items.map((it) => `<li>${renderStyledSpans(it.spans, {})}</li>`).join('');
      items.push({ y, html: `<ul${attrs}>${lis}</ul>` });
    } else if (n.kind === 'p') {
      const attrs = blockStyleAttr(n.block, body, true);
      const uniformBold = n.bold;
      const uniformItalic = n.italic;
      let inner = renderStyledSpans(n.spans, { skipBold: uniformBold, skipItalic: uniformItalic, baseSize: n.spans[0]?.size });
      if (uniformItalic) inner = `<em>${inner}</em>`;
      if (uniformBold) inner = `<strong>${inner}</strong>`;
      items.push({ y, html: `<p${attrs}>${inner}</p>` });
    }
  }

  for (const im of page.images) {
    items.push({
      y: im.bbox[1],
      html: `<figure class="yh-img"><img src="${im.dataUrl}" width="${im.width}" height="${im.height}" alt=""></figure>`,
    });
  }

  items.sort((a, b) => a.y - b.y);
  if (page.vectorsSvg) {
    items.push({ y: Infinity, html: `<div class="yh-vector-wrap">${page.vectorsSvg}</div>` });
  }
  return items.map((i) => i.html).join('\n');
}

function plainText(blocks: Block[]): string {
  return blocks.map((b) => b.lines.map((l) => l.text).join('\n')).join('\n\n');
}

const pageList = (ps: number[]) => ps.map((p) => p + 1).join(', ');

export async function convert(
  bytes: Uint8Array,
  opts: ConvertOpts,
  onProgress?: Progress,
): Promise<ConvertResult> {
  const s = await openMuPdf(bytes);
  try {
    const { mupdf, doc } = s;
    if (doc.needsPassword()) throw new Error('This PDF needs a password. Open it through the password prompt first.');
    const total = doc.countPages();
    const pages = [...new Set(opts.pages)].sort((a, b) => a - b);
    if (pages.length === 0) throw new Error('Choose at least one page.');
    if (pages.some((p) => !Number.isInteger(p) || p < 0 || p >= total)) {
      throw new Error(`Pages must be between 1 and ${total}.`);
    }
    const warnings: string[] = [];
    const base = opts.baseName || 'document';
    const files: ConvertFile[] = [];

    if (opts.format === 'png' || opts.format === 'jpeg') {
      if (!Number.isFinite(opts.dpi) || opts.dpi < 36 || opts.dpi > 600) throw new Error('DPI must be between 36 and 600.');
      const clamped: number[] = [];
      for (let i = 0; i < pages.length; i++) {
        const page = doc.loadPage(pages[i]!);
        const [x0, y0, x1, y1] = page.getBounds();
        let k = opts.dpi / 72;
        const side = Math.max(x1 - x0, y1 - y0) * k;
        if (side > MAX_IMAGE_SIDE) {
          k = (MAX_IMAGE_SIDE / Math.max(x1 - x0, y1 - y0)) * 0.999;
          clamped.push(pages[i]!);
        }
        const pix = page.toPixmap(mupdf.Matrix.scale(k, k), mupdf.ColorSpace.DeviceRGB, false, true);
        const data = opts.format === 'png' ? pix.asPNG() : pix.asJPEG(85, false);
        pix.destroy();
        page.destroy();
        mupdf.emptyStore();
        const num = String(pages[i]! + 1).padStart(String(total).length, '0');
        files.push({
          name: pages.length === 1 ? `${base}.${EXT[opts.format]}` : `${base}-page-${num}.${EXT[opts.format]}`,
          bytes: new Uint8Array(data),
          mime: MIME[opts.format],
        });
        onProgress?.(i + 1, pages.length);
      }
      if (clamped.length > 0) {
        warnings.push(`Page${clamped.length === 1 ? '' : 's'} ${pageList(clamped)} would be larger than ${MAX_IMAGE_SIDE} px, so ${clamped.length === 1 ? 'it was' : 'they were'} scaled down.`);
      }
      return { files, warnings };
    }

    const wantRich = opts.format === 'html';
    const perPage: PageData[] = [];
    for (let i = 0; i < pages.length; i++) {
      const page = doc.loadPage(pages[i]!);
      perPage.push(readPage(page, mupdf, wantRich));
      page.destroy();
      mupdf.emptyStore();
      onProgress?.(i + 1, pages.length);
    }
    const blank = pages.filter((_, i) => perPage[i]!.blocks.length === 0);
    if (blank.length === pages.length) {
      warnings.push('No selectable text was found. This PDF may be scanned: use an Image format instead.');
    } else if (blank.length > 0) {
      warnings.push(`No selectable text on page${blank.length === 1 ? '' : 's'} ${pageList(blank)} (scanned or blank). Use an Image format to keep ${blank.length === 1 ? 'it' : 'them'}.`);
    }

    const body = bodySize(perPage);
    let out: string;
    if (opts.format === 'txt') {
      out = perPage
        .map((p, i) => (pages.length > 1 ? `----- Page ${pages[i]! + 1} -----\n\n` : '') + plainText(p.blocks))
        .join('\n\n')
        .trimEnd();
    } else if (opts.format === 'md') {
      out = perPage
        .map((p, i) => `${pages.length > 1 ? `<!-- Page ${pages[i]! + 1} -->\n\n` : ''}${toMarkdown(classify(p.blocks, body))}`.trimEnd())
        .join('\n\n---\n\n');
    } else {
      const sections = perPage
        .map(
          (p, i) =>
            `<section data-page="${pages[i]! + 1}">\n${[p.blocks.length === 0 ? '<p><em>(no text on this page)</em></p>' : '', toHtmlBody(p, body)].filter(Boolean).join('\n')}\n</section>`,
        )
        .join('\n<hr>\n');
      const styles = [
        'body{font-family:system-ui,-apple-system,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#111;background:#f7f7f5}',
        'section{background:#fff;padding:1.5rem 2rem;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08)}',
        'hr{border:0;margin:1.5rem 0}',
        '.yh-img{margin:1rem 0}.yh-img img,.yh-vectors{max-width:100%;height:auto;display:block}',
      ].join('');
      out = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${htmlEscape(base)}</title>\n<style>${styles}</style>\n</head>\n<body>\n${sections}\n</body>\n</html>\n`;
    }
    files.push({ name: `${base}.${EXT[opts.format]}`, bytes: new TextEncoder().encode(out + (opts.format === 'html' ? '' : '\n')), mime: MIME[opts.format] });
    return { files, warnings };
  } finally {
    s.close();
  }
}
