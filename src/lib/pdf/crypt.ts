import { PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFRef } from 'pdf-lib';
import { bufferToBytes, isWasmMemError, openMuPdf } from './mupdfStream.ts';
import './pdfLibFast.ts';

/** Unlock / encrypt with MuPDF (lazy-loaded). Passwords live only in the arguments, never stored. */

export type UnlockResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'needs-password' | 'wrong-password' | 'corrupt'; message: string };

const LARGE_FILE_BYTES = 500 * 1024 * 1024;
/**
 * The large-file paths take streams out (largest first) until at most this much stream data is left for
 * MuPDF to write. A fixed size cut-off is not enough: a 1.9 GB scan made of 512 KB page images has no
 * stream over 1 MB, which left the whole file for MuPDF and overflowed its 2 GiB heap.
 */
const KEEP_IN_MUPDF_BYTES = 64 * 1024 * 1024;

/** Ids of the streams to take out, largest first, so the rest add up to at most `keep` bytes. */
export function streamsToSplit(sizes: Array<[id: number, len: number]>, keep: number): Set<number> {
  let left = sizes.reduce((n, [, len]) => n + len, 0);
  const out = new Set<number>();
  for (const [id, len] of [...sizes].sort((a, b) => b[1] - a[1])) {
    if (left <= keep) break;
    out.add(id);
    left -= len;
  }
  return out;
}

/** Large-PDF unlock: the biggest streams are decrypted one by one into JS memory, so only a small rest goes through MuPDF's save. */
export async function unlockLarge(bytes: Uint8Array, password = '', keepInMuPdf = KEEP_IN_MUPDF_BYTES): Promise<UnlockResult> {
  let s;
  try {
    s = await openMuPdf(bytes);
  } catch {
    return { ok: false, reason: 'corrupt', message: 'PDF file is corrupted or unreadable.' };
  }
  const doc = s.doc.asPDF();
  if (!doc) {
    s.close();
    return { ok: false, reason: 'corrupt', message: 'PDF file is corrupted or unreadable.' };
  }
  const streams = new Map<number, Uint8Array>();
  let skelBytes: Uint8Array;
  try {
    if (doc.needsPassword()) {
      if (!password) return { ok: false, reason: 'needs-password', message: 'This PDF needs a password.' };
      if (doc.authenticatePassword(password) === 0) {
        return { ok: false, reason: 'wrong-password', message: 'That password is not correct.' };
      }
    }
    const count = doc.countObjects();
    const sizes: Array<[number, number]> = [];
    for (let n = 1; n < count; n++) {
      const o = doc.newIndirect(n);
      if (!o.isStream()) continue;
      const t = o.get('Type').asName();
      if (t === 'ObjStm' || t === 'XRef') continue;
      sizes.push([n, o.get('Length').asNumber()]);
    }
    for (const n of streamsToSplit(sizes, keepInMuPdf)) {
      const o = doc.newIndirect(n);
      streams.set(n, bufferToBytes(o.readRawStream()));
      o.put('YHSplit', n);
      o.writeRawStream('');
    }
    skelBytes = bufferToBytes(doc.saveToBuffer('encrypt=none'));
  } finally {
    s.close();
  }

  if (streams.size === 0) return { ok: true, bytes: skelBytes };

  const outDoc = await PDFDocument.load(skelBytes, { updateMetadata: false });
  const splitKey = PDFName.of('YHSplit');
  for (const [ref, obj] of outDoc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || !obj.dict.has(splitKey)) continue;
    const id = (obj.dict.get(splitKey) as PDFNumber).asNumber();
    obj.dict.delete(splitKey);
    const data = streams.get(id);
    if (data) outDoc.context.assign(ref, PDFRawStream.of(obj.dict, data));
  }
  return { ok: true, bytes: await outDoc.save({ useObjectStreams: false }) };
}

/**
 * Returns an unencrypted copy. Owner-password-only files (restricted, but openable) unlock with the empty
 * password, so callers try `''` first and only prompt when the result says `needs-password`.
 */
export async function unlock(bytes: Uint8Array, password = ''): Promise<UnlockResult> {
  if (bytes.byteLength > LARGE_FILE_BYTES) return unlockLarge(bytes, password);
  let s;
  try {
    s = await openMuPdf(bytes);
  } catch {
    return { ok: false, reason: 'corrupt', message: 'PDF file is corrupted or unreadable.' };
  }
  const doc = s.doc.asPDF();
  if (!doc) {
    s.close();
    return { ok: false, reason: 'corrupt', message: 'PDF file is corrupted or unreadable.' };
  }
  try {
    if (doc.needsPassword()) {
      if (!password) return { ok: false, reason: 'needs-password', message: 'This PDF needs a password.' };
      if (doc.authenticatePassword(password) === 0) {
        return { ok: false, reason: 'wrong-password', message: 'That password is not correct.' };
      }
    }
    try {
      return { ok: true, bytes: bufferToBytes(doc.saveToBuffer('encrypt=none')) };
    } catch (err) {
      if (!isWasmMemError(err)) throw err;
    }
  } finally {
    s.close();
  }
  return unlockLarge(bytes, password);
}

/** ISO 32000-2 Algorithm 2.B key derivation for R=6 (AES-256) user key. */
async function hash2B(pwBytes: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const sha = async (alg: 'SHA-256' | 'SHA-384' | 'SHA-512', d: BufferSource) =>
    new Uint8Array(await subtle.digest(alg, d));
  const init = new Uint8Array(pwBytes.length + salt.length);
  init.set(pwBytes);
  init.set(salt, pwBytes.length);
  let K = await sha('SHA-256', init);
  for (let r = 0; ; r++) {
    const unit = pwBytes.length + K.length;
    const K1 = new Uint8Array(unit * 64);
    for (let i = 0; i < 64; i++) {
      K1.set(pwBytes, i * unit);
      K1.set(K, i * unit + pwBytes.length);
    }
    const key = await subtle.importKey('raw', K.subarray(0, 16) as Uint8Array<ArrayBuffer>, 'AES-CBC', false, ['encrypt']);
    const enc = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: K.subarray(16, 32) as Uint8Array<ArrayBuffer> }, key, K1));
    const E = enc.subarray(0, K1.length);
    let mod = 0;
    for (let i = 0; i < 16; i++) mod = (mod * 256 + E[i]!) % 3;
    K = await sha(mod === 0 ? 'SHA-256' : mod === 1 ? 'SHA-384' : 'SHA-512', E);
    if (r >= 63 && E[E.length - 1]! <= r - 31) break;
  }
  return K.subarray(0, 32);
}

async function aesCbcNoPadDecZero(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const ck = await subtle.importKey('raw', key as Uint8Array<ArrayBuffer>, 'AES-CBC', false, ['encrypt', 'decrypt']);
  const padBlock = new Uint8Array(
    await subtle.encrypt({ name: 'AES-CBC', iv: data.subarray(data.length - 16) as Uint8Array<ArrayBuffer> }, ck, new Uint8Array(0)),
  );
  const padded = new Uint8Array(data.length + 16);
  padded.set(data);
  padded.set(padBlock.subarray(0, 16), data.length);
  const full = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, ck, padded));
  return full.subarray(0, data.length);
}

/** Large-PDF AES-256 encryption: the biggest streams are encrypted with WebCrypto in JS memory; MuPDF encrypts only a small rest. */
export async function encryptAes256Large(
  bytes: Uint8Array,
  password: string,
  keepInMuPdf = KEEP_IN_MUPDF_BYTES,
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  const splitKey = PDFName.of('YHSplit');
  const streams = new Map<number, Uint8Array>();
  const raw = srcDoc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream) as Array<[PDFRef, PDFRawStream]>;
  const split = streamsToSplit(raw.map(([ref, o]) => [ref.objectNumber, o.contents.length]), keepInMuPdf);
  for (const [ref, obj] of raw) {
    if (!split.has(ref.objectNumber)) continue;
    streams.set(ref.objectNumber, obj.contents);
    obj.dict.set(splitKey, PDFNumber.of(ref.objectNumber));
    srcDoc.context.assign(ref, PDFRawStream.of(obj.dict, new Uint8Array(0)));
  }
  const skel = await srcDoc.save({ useObjectStreams: false });

  const s = await openMuPdf(skel);
  const doc = s.doc.asPDF();
  if (!doc) {
    s.close();
    throw new Error('Not a PDF');
  }
  let encSkel: Uint8Array;
  try {
    encSkel = bufferToBytes(doc.saveToBuffer(`encrypt=aes-256,user-password=${password},owner-password=${password}`));
  } finally {
    s.close();
  }

  if (streams.size === 0) return encSkel;

  const sEnc = await openMuPdf(encSkel);
  const encPdf = sEnc.doc.asPDF();
  if (!encPdf) {
    sEnc.close();
    throw new Error('Encrypted skeleton is not a PDF');
  }
  let U: Uint8Array;
  let UE: Uint8Array;
  try {
    encPdf.authenticatePassword(password);
    const encDict = encPdf.getTrailer().get('Encrypt');
    U = encDict.get('U').asByteString();
    UE = encDict.get('UE').asByteString();
  } finally {
    sEnc.close();
  }

  const pwBytes = new TextEncoder().encode(password).subarray(0, 127);
  const ku = await hash2B(pwBytes, U.subarray(40, 48));
  const fek = await aesCbcNoPadDecZero(ku, UE);
  const fekKey = await globalThis.crypto.subtle.importKey('raw', fek as Uint8Array<ArrayBuffer>, 'AES-CBC', false, ['encrypt']);

  const outDoc = await PDFDocument.load(encSkel, { ignoreEncryption: true, updateMetadata: false });
  for (const [ref, obj] of outDoc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || !obj.dict.has(splitKey)) continue;
    const id = (obj.dict.get(splitKey) as PDFNumber).asNumber();
    obj.dict.delete(splitKey);
    const plain = streams.get(id);
    if (!plain) continue;
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-CBC', iv }, fekKey, plain as Uint8Array<ArrayBuffer>));
    const combined = new Uint8Array(16 + ct.length);
    combined.set(iv, 0);
    combined.set(ct, 16);
    outDoc.context.assign(ref, PDFRawStream.of(obj.dict, combined));
  }
  return outDoc.save({ useObjectStreams: false });
}

export type CryptAlgorithm = 'aes-256' | 'aes-128' | 'rc4-128' | 'rc4-40';
export const ALGORITHMS: Array<{ id: CryptAlgorithm; label: string; note: string; weak?: boolean }> = [
  { id: 'aes-256', label: 'AES-256 (recommended)', note: 'Strongest. Opens in current PDF readers (PDF 2.0).' },
  { id: 'aes-128', label: 'AES-128', note: 'Strong and works in older readers (PDF 1.6 and later).' },
  { id: 'rc4-128', label: 'RC4-128 (legacy)', note: 'Weak, for very old readers only.', weak: true },
  { id: 'rc4-40', label: 'RC4-40 (legacy)', note: 'Very weak, kept only for compatibility.', weak: true },
];

/** The same password is the user and owner password. MuPDF's option string has no escaping for `,`. */
export async function encrypt(bytes: Uint8Array, password: string, algorithm: CryptAlgorithm = 'aes-256'): Promise<Uint8Array> {
  if (!ALGORITHMS.some((a) => a.id === algorithm)) throw new Error('Unknown encryption algorithm.');
  if (!password) throw new Error('Enter a password.');
  if (password.includes(',')) throw new Error("The password can't contain a comma.");
  if (algorithm === 'aes-256' && bytes.byteLength > LARGE_FILE_BYTES) {
    return encryptAes256Large(bytes, password);
  }
  const s = await openMuPdf(bytes);
  const doc = s.doc.asPDF();
  if (!doc) {
    s.close();
    throw new Error('Not a PDF');
  }
  try {
    try {
      return bufferToBytes(doc.saveToBuffer(`encrypt=${algorithm},user-password=${password},owner-password=${password}`));
    } catch (err) {
      if (!isWasmMemError(err)) throw err;
      if (algorithm !== 'aes-256') {
        throw new Error('This file is too large for legacy encryption. Choose AES-256.', { cause: err });
      }
    }
  } finally {
    s.close();
  }
  return encryptAes256Large(bytes, password);
}
