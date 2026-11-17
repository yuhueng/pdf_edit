import { PDFDocument, PDFName, PDFPage, PDFString, StandardFonts, degrees } from 'pdf-lib';
import type { GenSpec } from './types.ts';

export const TAG_KEY = 'YHTag';

export function setTag(page: PDFPage, tag: string): void {
  page.node.set(PDFName.of(TAG_KEY), PDFString.of(tag));
}

export function getTag(page: PDFPage): string | undefined {
  const val = page.node.lookupMaybe(PDFName.of(TAG_KEY), PDFString);
  return val ? val.decodeText() : undefined;
}

export async function readTags(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((p) => getTag(p) ?? '');
}

function hashSeed(tag: string): number {
  let h = 2166136261;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 0x9e3779b9;
}

function fillNoise(len: number, seedTag: string): Uint8Array {
  const bytes = new Uint8Array(len);
  const words = new Uint32Array(bytes.buffer, 0, Math.floor(len / 4));
  let s = hashSeed(seedTag);
  for (let i = 0; i < words.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    words[i] = s >>> 0;
  }
  const remStart = words.length * 4;
  for (let i = remStart; i < len; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    bytes[i] = s & 0xff;
  }
  return bytes;
}

export async function generate(spec: GenSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sizes = spec.sizes && spec.sizes.length > 0 ? spec.sizes : [[595, 842] as [number, number]];

  const baseEstimate = 1400 + spec.pages * 450;
  const padNeeded =
    spec.targetBytes !== undefined && spec.targetBytes > baseEstimate
      ? spec.targetBytes - baseEstimate
      : 0;
  const paddedPages =
    padNeeded > 0 ? Math.min(spec.pages, Math.max(1, Math.ceil(padNeeded / 750_000))) : 0;
  const bytesPerPad = paddedPages > 0 ? Math.floor(padNeeded / paddedPages) : 0;
  const padW = bytesPerPad > 0 ? Math.max(1, Math.floor(Math.sqrt(bytesPerPad))) : 0;
  const padH = padW > 0 ? Math.max(1, Math.round(bytesPerPad / padW)) : 0;

  for (let i = 0; i < spec.pages; i++) {
    const [w, h, rot] = sizes[i % sizes.length]!;
    const page = doc.addPage([w, h]);
    if (rot !== undefined && rot !== 0) {
      page.setRotation(degrees(rot));
    }
    const tag = `${spec.tag}P${i + 1}`;
    setTag(page, tag);

    page.drawText(tag, {
      x: 12,
      y: Math.max(12, h - 22),
      size: 10,
      font,
    });

    if (spec.cropBox && i % 2 === 0 && w > 20 && h > 20) {
      page.setCropBox(10, 10, w - 20, h - 20);
    }

    if (i === 0 && spec.formField) {
      const form = doc.getForm();
      const tf = form.createTextField(spec.formField);
      tf.addToPage(page, { x: 50, y: Math.min(700, Math.max(20, h - 40)), width: 200, height: 20 });
      tf.setText(`value of ${tag}`);
    }

    if (i < paddedPages && padW > 0 && padH > 0) {
      const noise = fillNoise(padW * padH, tag);
      const stream = doc.context.stream(noise, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: padW,
        Height: padH,
        ColorSpace: 'DeviceGray',
        BitsPerComponent: 8,
      });
      const ref = doc.context.register(stream);
      page.node.setXObject(PDFName.of('Pad'), ref);
    }
  }

  return doc.save();
}

function buildRawPdf(objs: string[], extraTrailer = ''): Uint8Array {
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objs) {
    offsets.push(body.length);
    body += obj;
  }
  const xrefPos = body.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer << /Size ${objs.length + 1} /Root 1 0 R${extraTrailer} >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return new TextEncoder().encode(body + xref + trailer);
}

export function makeEncryptedPdf(): Uint8Array {
  return buildRawPdf(
    [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj\n',
      '4 0 obj << /Filter /Standard /V 1 /R 2 /O (0123456789abcdef0123456789abcdef) /U (0123456789abcdef0123456789abcdef) /P -4 >> endobj\n',
    ],
    ' /Encrypt 4 0 R',
  );
}

export function makeZeroPagePdf(): Uint8Array {
  return buildRawPdf([
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n',
  ]);
}

/** A 2-page form: text, multiline text, checkbox, dropdown and a radio group on page 1. Test fixture. */
export async function makeFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const form = doc.getForm();
  form.createTextField('name').addToPage(page, { x: 20, y: 240, width: 200, height: 24 });
  const notes = form.createTextField('notes');
  notes.enableMultiline();
  notes.addToPage(page, { x: 20, y: 160, width: 200, height: 60 });
  form.createCheckBox('agree').addToPage(page, { x: 20, y: 120, width: 18, height: 18 });
  const country = form.createDropdown('country');
  country.addOptions(['UK', 'US', 'MY']);
  country.addToPage(page, { x: 20, y: 80, width: 120, height: 24 });
  const size = form.createRadioGroup('size');
  size.addOptionToPage('S', page, { x: 20, y: 40, width: 16, height: 16 });
  size.addOptionToPage('L', page, { x: 60, y: 40, width: 16, height: 16 });
  const p2 = doc.addPage([400, 300]);
  p2.drawText('Page two', { x: 20, y: 200, size: 14 });
  return doc.save();
}
