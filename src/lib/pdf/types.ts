export type Rot = 0 | 90 | 180 | 270;
export type PageRef = { id: string; fileId: string; srcIndex: number; rotation: Rot };
export type InputFile = { id: string; bytes: Uint8Array };
/** `stage` is an optional short label for what is being done now (shown next to the progress bar). */
export type Progress = (done: number, total: number, stage?: string) => void;

export type InspectResult =
  | { ok: true; pageCount: number }
  | { ok: false; reason: 'empty' | 'not-pdf' | 'encrypted' | 'corrupt' | 'no-pages'; message: string };

export type StdFont =
  | 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique' | 'Helvetica-BoldOblique'
  | 'Times-Roman' | 'Times-Bold' | 'Times-Italic' | 'Times-BoldItalic'
  | 'Courier' | 'Courier-Bold' | 'Courier-Oblique' | 'Courier-BoldOblique';

export type Rgb = [number, number, number];

// All coordinates are PDF user space (points, origin bottom-left, includes CropBox offset).
// Angles in degrees, counter-clockwise, already include the page /Rotate.
export type Edit =
  | {
      kind: 'text';
      page: number;
      x: number;
      y: number;
      lines: string[];
      lineStep: number;
      size: number;
      font: StdFont;
      color: Rgb;
      opacity: number;
      angle: number;
      underline: boolean;
      strike?: boolean;
    }
  | {
      kind: 'image';
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      angle: number;
      opacity: number;
      mime: 'image/png' | 'image/jpeg';
      bytes: Uint8Array;
    }
  | {
      kind: 'path';
      page: number;
      d: string;
      stroke: Rgb | null;
      strokeWidth: number;
      fill: Rgb | null;
      opacity: number;
      multiply: boolean;
    };

export type GenSpec = {
  tag: string;
  pages: number;
  targetBytes?: number;
  sizes?: Array<[number, number, Rot?]>;
  cropBox?: boolean;
  formField?: string;
  encrypted?: never;
};

import type { CompressResult } from './compress.ts';
import type { CryptAlgorithm, UnlockResult } from './crypt.ts';
import type { ConvertOpts, ConvertResult } from './convert.ts';
import type { FieldValues, FormField, PageSpec } from './pages.ts';
import type { TextReplacement } from './textEdit.ts';

export interface PdfApi {
  /** A `Blob` (picked `File`) is checked without reading it all: large ones are read in slices by MuPDF. */
  inspect(input: Uint8Array | Blob): Promise<InspectResult>;
  merge(inputs: InputFile[], pages: PageRef[], onProgress?: Progress): Promise<Uint8Array>;
  /** `merge` for the app: the worker reads the files itself and returns the PDF as a `Blob`, so the page never holds file bytes. */
  mergeFiles(inputs: Array<{ id: string; file: Blob }>, pages: PageRef[], onProgress?: Progress): Promise<Blob>;
  /** `unlock` / `encrypt` for the app: the worker reads the file and returns a `Blob`, so the page never holds file bytes. */
  unlockFile(file: Blob, password?: string): Promise<{ ok: true; file: Blob } | Exclude<UnlockResult, { ok: true }>>;
  encryptFile(file: Blob, password: string, algorithm?: CryptAlgorithm): Promise<Blob>;
  split(bytes: Uint8Array, groups: number[][], onProgress?: Progress): Promise<Uint8Array[]>;
  burst(bytes: Uint8Array, onProgress?: Progress): Promise<Uint8Array>;
  applyEdits(bytes: Uint8Array, edits: Edit[], rotateAll?: Rot): Promise<Uint8Array>;
  generate(spec: GenSpec): Promise<Uint8Array>;
  replaceText(bytes: Uint8Array, reps: TextReplacement[]): Promise<Uint8Array>;
  compress(bytes: Uint8Array, maxBytes: number, allowRaster: boolean, onProgress?: Progress): Promise<CompressResult>;
  unlock(bytes: Uint8Array, password?: string): Promise<UnlockResult>;
  encrypt(bytes: Uint8Array, password: string, algorithm?: CryptAlgorithm): Promise<Uint8Array>;
  formFields(bytes: Uint8Array): Promise<FormField[]>;
  fillForm(bytes: Uint8Array, values: FieldValues): Promise<Uint8Array>;
  reshape(bytes: Uint8Array, pages: PageSpec[]): Promise<Uint8Array>;
  convert(bytes: Uint8Array, opts: ConvertOpts, onProgress?: Progress): Promise<ConvertResult>;
}
