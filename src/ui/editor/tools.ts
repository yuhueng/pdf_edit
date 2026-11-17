import { FabricImage, IText, Path } from 'fabric';
import { blobToDataUrl } from '../../lib/image.ts';

export type EditorTool =
  | 'select'
  /** Moves the page around (one-finger / mouse drag pans); objects cannot be picked. Shares a slot with Select. */
  | 'hand'
  | 'text'
  | 'draw'
  | 'highlight'
  | 'highlightText'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow';

export type FontFamilyKey = 'sans' | 'serif' | 'mono';
export type YhKind = 'text' | 'image' | 'highlight' | 'shape' | 'draw';

export const CUSTOM_PROPS = ['yhKind', 'yhFamily', 'yhMime'] as const;

export const FONT_STACKS: Record<FontFamilyKey, string> = {
  sans: 'Arial, Helvetica, sans-serif',
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
};

export type DrawStyle = {
  stroke: string;
  fill: string | null;
  strokeWidth: number;
  opacity: number;
  fontFamily: FontFamilyKey;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Colour of the Highlight text / Highlight area tools. */
  highlight: string;
  /** How see-through the highlights are (the guide's opacity control for the highlight tools). */
  hlOpacity: number;
};

export const DEFAULT_STYLE: DrawStyle = {
  stroke: '#111827',
  fill: null,
  strokeWidth: 2,
  opacity: 1,
  fontFamily: 'sans',
  fontSize: 14,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  highlight: '#ffeb3b',
  hlOpacity: 0.4,
};

export type TaggedObj = {
  yhKind?: YhKind;
  yhFamily?: FontFamilyKey;
  yhMime?: 'image/png' | 'image/jpeg';
};

export function rectPath(x: number, y: number, w: number, h: number): string {
  return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5522847498;
  const kx = rx * k;
  const ky = ry * k;
  return [
    `M ${cx} ${cy - ry}`,
    `C ${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry}`,
    `C ${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry} Z`,
  ].join(' ');
}

export function linePath(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

export function arrowPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeWidth: number,
): string {
  const headLen = Math.max(8, strokeWidth * 4);
  const theta = Math.atan2(y2 - y1, x2 - x1);
  const spread = (25 * Math.PI) / 180;
  const ax1 = x2 - headLen * Math.cos(theta - spread);
  const ay1 = y2 - headLen * Math.sin(theta - spread);
  const ax2 = x2 - headLen * Math.cos(theta + spread);
  const ay2 = y2 - headLen * Math.sin(theta + spread);
  return `M ${x1} ${y1} L ${x2} ${y2} M ${x2} ${y2} L ${ax1} ${ay1} M ${x2} ${y2} L ${ax2} ${ay2}`;
}

export function buildShapePath(
  tool: 'highlight' | 'rect' | 'ellipse' | 'line' | 'arrow',
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: DrawStyle,
): Path {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const w = Math.max(1, Math.abs(x2 - x1));
  const h = Math.max(1, Math.abs(y2 - y1));

  let d: string;
  if (tool === 'rect' || tool === 'highlight') {
    d = rectPath(left, top, w, h);
  } else if (tool === 'ellipse') {
    d = ellipsePath(left + w / 2, top + h / 2, w / 2, h / 2);
  } else if (tool === 'line') {
    d = linePath(x1, y1, x2, y2);
  } else {
    d = arrowPath(x1, y1, x2, y2, style.strokeWidth);
  }

  const isHl = tool === 'highlight';
  const isLinear = tool === 'line' || tool === 'arrow';
  const path = new Path(d, {
    fill: isHl ? style.highlight : isLinear ? null : style.fill,
    stroke: isHl ? null : style.stroke,
    strokeWidth: isHl ? 0 : style.strokeWidth,
    opacity: isHl ? style.hlOpacity : style.opacity,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  });
  Object.assign(path, { yhKind: isHl ? 'highlight' : 'shape' } satisfies TaggedObj);
  return path;
}

export function createTextObject(
  x: number,
  y: number,
  text = 'Text',
  style: DrawStyle = DEFAULT_STYLE,
): IText {
  const obj = new IText(text, {
    left: x,
    top: y,
    fontSize: style.fontSize,
    fill: style.stroke,
    fontFamily: FONT_STACKS[style.fontFamily],
    fontWeight: style.bold ? 'bold' : 'normal',
    fontStyle: style.italic ? 'italic' : 'normal',
    underline: style.underline,
    linethrough: style.strike,
    opacity: style.opacity,
    lockScalingX: true,
    lockScalingY: true,
  });
  Object.assign(obj, { yhKind: 'text', yhFamily: style.fontFamily } satisfies TaggedObj);
  return obj;
}

export function createDateStamp(x: number, y: number, style: DrawStyle = DEFAULT_STYLE): IText {
  return createTextObject(x, y, new Date().toLocaleDateString('en-CA'), style);
}

export async function createImageObject(
  dataUrl: string,
  mime: 'image/png' | 'image/jpeg',
  pageWidthPt: number,
  x = 40,
  y = 40,
): Promise<FabricImage> {
  const img = await FabricImage.fromURL(dataUrl);
  const targetW = Math.min(200, pageWidthPt * 0.4);
  const scale = img.width > 0 ? targetW / img.width : 1;
  img.set({
    left: x,
    top: y,
    scaleX: scale,
    scaleY: scale,
    lockSkewingX: true,
    lockSkewingY: true,
    lockScalingFlip: true,
  });
  Object.assign(img, { yhKind: 'image', yhMime: mime } satisfies TaggedObj);
  return img;
}

export async function imageFileToObject(
  file: File,
  pageWidthPt: number,
): Promise<FabricImage> {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    throw new Error('Only PNG and JPEG images are supported');
  }
  const url = await blobToDataUrl(file);
  return createImageObject(url, file.type, pageWidthPt);
}
