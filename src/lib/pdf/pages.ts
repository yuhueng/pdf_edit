import type { PDFPage, PDFWidget } from 'mupdf';
import { bufferToBytes, isWasmMemError, openMuPdf } from './mupdfStream.ts';
import './pdfLibFast.ts';

/** Form fields and page reshaping with MuPDF (lazy-loaded). Both keep the PDF's form intact. */

export type FieldType = 'text' | 'checkbox' | 'radio' | 'choice' | 'button' | 'signature';

export type FormField = {
  /** `${page}:${n}`: stable for one set of bytes. Used to address a field when filling. */
  key: string;
  page: number;
  name: string;
  type: FieldType;
  /** Text / selected option. For checkbox and radio use `checked`. */
  value: string;
  checked: boolean;
  options: string[];
  readOnly: boolean;
  multiline: boolean;
  /** Page space (points, y down, rotation applied): x, y, width, height. */
  rect: [number, number, number, number];
};

export type FieldValues = Record<string, string | boolean>;

const TYPE: Record<string, FieldType> = {
  text: 'text',
  checkbox: 'checkbox',
  radiobutton: 'radio',
  combobox: 'choice',
  listbox: 'choice',
  button: 'button',
  signature: 'signature',
};

async function open(bytes: Uint8Array) {
  const s = await openMuPdf(bytes);
  const doc = s.doc.asPDF();
  if (!doc) {
    s.close();
    throw new Error('Not a PDF');
  }
  return { doc, close: s.close };
}

function describe(w: PDFWidget, page: number, n: number, radioIndex: number): FormField | null {
  const type = TYPE[w.getFieldType()];
  if (!type) return null;
  const [x0, y0, x1, y1] = w.getBounds();
  const value = w.getValue();
  const options = type === 'choice' || type === 'radio' ? w.getOptions() : [];
  const on = value !== '' && value !== 'Off';
  const checked =
    type === 'checkbox' ? on : type === 'radio' ? on && (value === String(radioIndex) || value === options[radioIndex]) : false;
  return {
    key: `${page}:${n}`,
    page,
    name: w.getName(),
    type,
    value: type === 'checkbox' || type === 'radio' ? '' : value,
    checked,
    options,
    readOnly: w.isReadOnly(),
    multiline: type === 'text' && w.isMultiline(),
    rect: [x0, y0, x1 - x0, y1 - y0],
  };
}

/** Every fillable field with where it sits and whether it already has a value. */
export async function formFields(bytes: Uint8Array): Promise<FormField[]> {
  const { doc, close } = await open(bytes);
  try {
    const out: FormField[] = [];
    for (let p = 0; p < doc.countPages(); p++) {
      const page = doc.loadPage(p) as PDFPage;
      const seen = new Map<string, number>();
      page.getWidgets().forEach((w, n) => {
        const idx = seen.get(w.getName()) ?? 0;
        seen.set(w.getName(), idx + 1);
        const f = describe(w, p, n, idx);
        if (f) out.push(f);
      });
      page.destroy();
    }
    return out;
  } finally {
    close();
  }
}

/** Writes values into the form fields. Fields stay fillable. Unknown keys are ignored. */
export async function fillForm(bytes: Uint8Array, values: FieldValues): Promise<Uint8Array> {
  const { doc, close } = await open(bytes);
  try {
    for (let p = 0; p < doc.countPages(); p++) {
      const page = doc.loadPage(p) as PDFPage;
      const seen = new Map<string, number>();
      page.getWidgets().forEach((w, n) => {
        const idx = seen.get(w.getName()) ?? 0;
        seen.set(w.getName(), idx + 1);
        const want = values[`${p}:${n}`];
        if (want === undefined || w.isReadOnly()) return;
        const f = describe(w, p, n, idx);
        if (!f) return;
        if (f.type === 'text' && typeof want === 'string') w.setTextValue(want);
        else if (f.type === 'choice' && typeof want === 'string') w.setChoiceValue(want);
        else if ((f.type === 'checkbox' || f.type === 'radio') && typeof want === 'boolean' && want !== f.checked) {
          // A radio can only be switched on (another one switches it off), so only toggle toward "checked".
          if (f.type === 'checkbox' || want) w.toggle();
        }
      });
      page.destroy();
    }
    return bufferToBytes(doc.saveToBuffer('garbage=no'));
  } finally {
    close();
  }
}

export type PageSpec = { srcIndex: number; rotation: number };

const LARGE_WASM_THRESHOLD = 500 * 1024 * 1024;

/**
 * 64-bit pdf-lib path for inputs too large for MuPDF's WASM heap. Pages are reordered inside the same
 * document (not copied into a new one), so the form, outlines and metadata stay, as with the MuPDF path.
 */
export async function reshapeJs(bytes: Uint8Array, pages: PageSpec[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('A PDF needs at least one page.');
  const { PDFDocument, degrees } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const orig = doc.getPages();
  const used = new Set<number>();
  const next: Array<{ page: (typeof orig)[number]; rotation: number }> = [];
  for (const p of pages) {
    let page = orig[p.srcIndex];
    if (!page) throw new Error(`Page ${p.srcIndex + 1} does not exist.`);
    if (used.has(p.srcIndex)) [page] = await doc.copyPages(doc, [p.srcIndex]); // a repeated page needs its own object
    used.add(p.srcIndex);
    next.push({ page: page!, rotation: p.rotation });
  }
  for (let i = orig.length - 1; i >= 0; i--) doc.removePage(i);
  for (const { page, rotation } of next) {
    if (rotation % 360 !== 0) {
      const cur = page.getRotation().angle;
      page.setRotation(degrees((((cur + rotation) % 360) + 360) % 360));
    }
    doc.addPage(page);
  }
  return doc.save();
}

/** New page list: each entry is a source page plus extra rotation (degrees, multiple of 90). Omitted pages are deleted. */
export async function reshape(bytes: Uint8Array, pages: PageSpec[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('A PDF needs at least one page.');
  if (bytes.byteLength > LARGE_WASM_THRESHOLD) return reshapeJs(bytes, pages);
  const { doc, close } = await open(bytes);
  try {
    const before = pages.map((p) => {
      const o = (doc.loadPage(p.srcIndex) as PDFPage).getObject();
      const cur = o.get('Rotate');
      return cur && cur.isNumber() ? cur.asNumber() : 0;
    });
    doc.rearrangePages(pages.map((p) => p.srcIndex));
    pages.forEach((p, i) => {
      if (p.rotation % 360 === 0) return;
      const obj = (doc.loadPage(i) as PDFPage).getObject();
      obj.put('Rotate', (((before[i]! + p.rotation) % 360) + 360) % 360);
    });
    try {
      return bufferToBytes(doc.saveToBuffer('garbage=no'));
    } catch (err) {
      if (!isWasmMemError(err)) throw err;
    }
  } finally {
    close();
  }
  return reshapeJs(bytes, pages);
}
