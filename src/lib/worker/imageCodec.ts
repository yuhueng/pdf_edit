import { encodeG4 } from '../pdf/ccitt.ts';
import type { ImageCodec, ImageSource } from '../pdf/compress.ts';

/** Probe width for the black-and-white check: enough detail that thin strokes stay dark, cheap to read back. */
const PROBE_W = 1024;
/** Luminance at or under this is ink, at or over WHITE is paper; anything between is a mid-tone. */
const BLACK = 70;
const WHITE = 215;
/**
 * A page counts as black and white (a text scan) when under 6% of probe pixels are mid-tones and under 0.5%
 * are coloured. Grey shading, photos, highlights and colour stamps all push a page over and keep it JPEG.
 */
const MAX_MID = 0.06;
const MAX_COLOUR = 0.005;
/** Threshold used when writing the 1-bit image. */
const INK = 140;

const lum = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114) / 1000;

function looksBilevel(bmp: ImageBitmap): boolean {
  const w = Math.min(PROBE_W, bmp.width);
  const h = Math.max(1, Math.round((bmp.height * w) / bmp.width));
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bmp, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  let mid = 0;
  let colour = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!;
    const g = d[i + 1]!;
    const b = d[i + 2]!;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 48) colour++;
    const y = lum(r, g, b);
    if (y > BLACK && y < WHITE) mid++;
  }
  const n = w * h;
  return colour / n < MAX_COLOUR && mid / n < MAX_MID;
}

/** Full-resolution 1-bit image as CCITT Group 4. Text keeps every pixel of its original resolution. */
function toG4(bmp: ImageBitmap): { bytes: Uint8Array; width: number; height: number; kind: 'g4' } | null {
  const { width: w, height: h } = bmp;
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data;
  const black = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < black.length; i += 4, p++) black[p] = lum(d[i]!, d[i + 1]!, d[i + 2]!) < INK ? 1 : 0;
  return { bytes: encodeG4(black, w, h), width: w, height: h, kind: 'g4' };
}

async function decode(src: ImageSource): Promise<ImageBitmap> {
  if (src.kind === 'jpeg') return createImageBitmap(new Blob([src.bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
  const rgba = new Uint8ClampedArray(src.width * src.height * 4);
  for (let i = 0, p = 0; i < src.width * src.height; i++, p += 4) {
    if (src.channels === 3) {
      rgba[p] = src.data[i * 3]!;
      rgba[p + 1] = src.data[i * 3 + 1]!;
      rgba[p + 2] = src.data[i * 3 + 2]!;
    } else {
      rgba[p] = rgba[p + 1] = rgba[p + 2] = src.data[i]!;
    }
    rgba[p + 3] = 255;
  }
  return createImageBitmap(new ImageData(rgba, src.width, src.height));
}

/**
 * Browser codec for the compressor (OffscreenCanvas, in the worker). Black-and-white pages become CCITT G4;
 * everything else becomes JPEG at `scale` and `quality`. Null where the browser lacks the APIs.
 */
export const browserCodec: ImageCodec | null =
  typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined'
    ? null
    : async (src, scale, quality) => {
        let bmp: ImageBitmap | null = null;
        try {
          bmp = await decode(src);
          if (looksBilevel(bmp)) {
            const g4 = toG4(bmp);
            if (g4) return g4;
          }
          const w = Math.max(1, Math.round(bmp.width * scale));
          const h = Math.max(1, Math.round(bmp.height * scale));
          const canvas = new OffscreenCanvas(w, h);
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(bmp, 0, 0, w, h);
          const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
          return { bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h, kind: 'jpeg' };
        } catch {
          return null;
        } finally {
          bmp?.close();
        }
      };
