import { Color, FabricImage, IText, Path, Point, util, type FabricObject } from 'fabric';
import type { PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Edit, Rgb, StdFont } from '../../lib/pdf/types.ts';
import type { FontFamilyKey, TaggedObj } from './tools.ts';

export const TEXT_BASELINE_RATIO = 0.8;

function parseColorRgb(val: unknown): Rgb | null {
  if (!val || val === 'transparent' || val === 'none') return null;
  const c = new Color(String(val));
  if (c.isUnrecognised) return null;
  const [r, g, b] = c.getSource();
  return [r / 255, g / 255, b / 255];
}

function mapStdFont(family: FontFamilyKey | undefined, bold: boolean, italic: boolean): StdFont {
  const fam = family ?? 'sans';
  if (fam === 'serif') {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  if (fam === 'mono') {
    if (bold && italic) return 'Courier-BoldOblique';
    if (bold) return 'Courier-Bold';
    if (italic) return 'Courier-Oblique';
    return 'Courier';
  }
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

function dataUrlToBytes(url: string): { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array } {
  const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/i.exec(url);
  if (!match) {
    throw new Error(`Unsupported image data URL`);
  }
  const mime = match[1]!.toLowerCase() as 'image/png' | 'image/jpeg';
  const bin = atob(match[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return { mime, bytes };
}

export function toEdits(
  objects: FabricObject[],
  pageIndex: number,
  viewport: PageViewport,
  pageRotate: number,
): Edit[] {
  const edits: Edit[] = [];

  for (const obj of objects) {
    const tagged = obj as FabricObject & TaggedObj;
    const objAngle = obj.angle ?? 0;
    const angle = (((pageRotate - objAngle) % 360) + 360) % 360;

    if (obj instanceof IText || obj.type === 'i-text') {
      const textObj = obj as IText & TaggedObj;
      if (!textObj.textLines || textObj.textLines.length === 0) {
        textObj.initDimensions();
      }
      const lines = textObj.textLines.length > 0 ? textObj.textLines : (textObj.text ?? '').split('\n');
      const ly = TEXT_BASELINE_RATIO * (textObj.fontSize ?? 14);
      const dispPt = new Point(0 - textObj.width / 2, ly - textObj.height / 2).transform(
        textObj.calcTransformMatrix(),
      );
      const [x, y] = viewport.convertToPdfPoint(dispPt.x, dispPt.y);
      const lineStep = textObj.getHeightOfLine(0);
      const bold =
        textObj.fontWeight === 'bold' ||
        (typeof textObj.fontWeight === 'number' && textObj.fontWeight >= 600);
      const italic = textObj.fontStyle === 'italic' || textObj.fontStyle === 'oblique';
      const color = parseColorRgb(textObj.fill) ?? [0, 0, 0];

      edits.push({
        kind: 'text',
        page: pageIndex,
        x,
        y,
        lines,
        lineStep,
        size: textObj.fontSize ?? 14,
        font: mapStdFont(textObj.yhFamily, bold, italic),
        color,
        opacity: textObj.opacity ?? 1,
        angle,
        underline: Boolean(textObj.underline),
        strike: Boolean(textObj.linethrough),
      });
    } else if (obj instanceof FabricImage || obj.type === 'image') {
      const imgObj = obj as FabricImage & TaggedObj;
      const w = imgObj.getScaledWidth();
      const h = imgObj.getScaledHeight();
      // calcTransformMatrix already includes scale, so use the unscaled local bottom-left corner.
      const unscaledW = imgObj.width || w;
      const unscaledH = imgObj.height || h;
      const blPt = new Point(-unscaledW / 2, unscaledH / 2).transform(imgObj.calcTransformMatrix());
      const [x, y] = viewport.convertToPdfPoint(blPt.x, blPt.y);
      const src = imgObj.getSrc();
      const decoded = dataUrlToBytes(src);

      edits.push({
        kind: 'image',
        page: pageIndex,
        x,
        y,
        width: w,
        height: h,
        angle,
        opacity: imgObj.opacity ?? 1,
        mime: tagged.yhMime ?? decoded.mime,
        bytes: decoded.bytes,
      });
    } else if (obj instanceof Path || obj.type === 'path') {
      const pathObj = obj as Path & TaggedObj;
      const transformed = util.transformPath(
        pathObj.path,
        pathObj.calcTransformMatrix(),
        pathObj.pathOffset,
      );
      const parts: string[] = [];
      for (const seg of transformed) {
        const cmd = seg[0];
        if (cmd === 'Z') {
          parts.push('Z');
          continue;
        }
        const nums: number[] = [];
        for (let k = 1; k < seg.length; k += 2) {
          const px = seg[k] as number;
          const py = seg[k + 1] as number;
          const [X, Y] = viewport.convertToPdfPoint(px, py);
          nums.push(Number(X.toFixed(3)), Number((-Y).toFixed(3)));
        }
        parts.push(`${cmd} ${nums.join(' ')}`);
      }
      const strokeScale = (Math.abs(pathObj.scaleX ?? 1) + Math.abs(pathObj.scaleY ?? 1)) / 2;
      edits.push({
        kind: 'path',
        page: pageIndex,
        d: parts.join(' '),
        stroke: parseColorRgb(pathObj.stroke),
        strokeWidth: (pathObj.strokeWidth ?? 1) * strokeScale,
        fill: parseColorRgb(pathObj.fill),
        opacity: pathObj.opacity ?? 1,
        multiply: tagged.yhKind === 'highlight',
      });
    } else {
      console.warn('Skipping unsupported Fabric object in toEdits:', obj.type);
    }
  }

  return edits;
}
