export function removeWhiteBackground(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const origA = rgba[i + 3]!;
    if (origA === 0) continue;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const alpha = lum >= 235 ? 0 : lum <= 150 ? 255 : Math.round(((235 - lum) / 85) * 255);
    rgba[i + 3] = Math.min(origA, alpha);
  }
}

export async function trimToBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx || w === 0 || h === 0) {
    throw new Error('Canvas 2D context unavailable');
  }
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  let sx = 0;
  let sy = 0;
  let sw = 1;
  let sh = 1;
  if (maxX >= minX && maxY >= minY) {
    sx = Math.max(0, minX - 4);
    sy = Math.max(0, minY - 4);
    sw = Math.min(w, maxX + 5) - sx;
    sh = Math.min(h, maxY + 5) - sy;
  }

  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('2D context unavailable');
  if (maxX >= minX) {
    octx.drawImage(canvas as CanvasImageSource, sx, sy, sw, sh, 0, 0, sw, sh);
  }

  return new Promise<Blob>((resolve, reject) => {
    out.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode PNG blob'));
    }, 'image/png');
  });
}

export async function typedSignatureBlob(
  text: string,
  fontFamily: string,
  color: string,
): Promise<Blob> {
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      await document.fonts.load(`64px "${fontFamily}"`);
    } catch {
      // Proceed even if font loading reports unsupported in test environments.
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.font = `64px "${fontFamily}", cursive`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 24, canvas.height / 2);
  return trimToBlob(canvas);
}

export const blobToDataUrl = (b: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(b);
  });
