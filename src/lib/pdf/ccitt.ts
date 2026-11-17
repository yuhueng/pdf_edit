/**
 * CCITT Group 4 (ITU-T T.6) encoder for 1-bit images, the fax codec PDFs decode with /CCITTFaxDecode
 * and /K -1. Pure TypeScript; verified by round-tripping through MuPDF's decoder.
 *
 * Input: `black[y * width + x]` is 1 for a black pixel. The stream is written for /BlackIs1 false (the
 * default), so the decoded samples are 0 = black, 1 = white, matching /ColorSpace /DeviceGray /BitsPerComponent 1.
 */

type Code = [bits: number, len: number];
const c = (s: string): Code => [parseInt(s, 2), s.length];

const WHITE_TERM = [
  '00110101', '000111', '0111', '1000', '1011', '1100', '1110', '1111', '10011', '10100', '00111', '01000',
  '001000', '000011', '110100', '110101', '101010', '101011', '0100111', '0001100', '0001000', '0010111',
  '0000011', '0000100', '0101000', '0101011', '0010011', '0100100', '0011000', '00000010', '00000011',
  '00011010', '00011011', '00010010', '00010011', '00010100', '00010101', '00010110', '00010111', '00101000',
  '00101001', '00101010', '00101011', '00101100', '00101101', '00000100', '00000101', '00001010', '00001011',
  '01010010', '01010011', '01010100', '01010101', '00100100', '00100101', '01011000', '01011001', '01011010',
  '01011011', '01001010', '01001011', '00110010', '00110011', '00110100',
].map(c);
const BLACK_TERM = [
  '0000110111', '010', '11', '10', '011', '0011', '0010', '00011', '000101', '000100', '0000100', '0000101',
  '0000111', '00000100', '00000111', '000011000', '0000010111', '0000011000', '0000001000', '00001100111',
  '00001101000', '00001101100', '00000110111', '00000101000', '00000010111', '00000011000', '000011001010',
  '000011001011', '000011001100', '000011001101', '000001101000', '000001101001', '000001101010',
  '000001101011', '000011010010', '000011010011', '000011010100', '000011010101', '000011010110',
  '000011010111', '000001101100', '000001101101', '000011011010', '000011011011', '000001010100',
  '000001010101', '000001010110', '000001010111', '000001100100', '000001100101', '000001010010',
  '000001010011', '000000100100', '000000110111', '000000111000', '000000100111', '000000101000',
  '000001011000', '000001011001', '000000101011', '000000101100', '000001011010', '000001100110',
  '000001100111',
].map(c);
/** Make-up codes for 64, 128, ..., 1728. */
const WHITE_MAKEUP = [
  '11011', '10010', '010111', '0110111', '00110110', '00110111', '01100100', '01100101', '01101000',
  '01100111', '011001100', '011001101', '011010010', '011010011', '011010100', '011010101', '011010110',
  '011010111', '011011000', '011011001', '011011010', '011011011', '010011000', '010011001', '010011010',
  '011000', '010011011',
].map(c);
const BLACK_MAKEUP = [
  '0000001111', '000011001000', '000011001001', '000001011011', '000000110011', '000000110100',
  '000000110101', '0000001101100', '0000001101101', '0000001001010', '0000001001011', '0000001001100',
  '0000001001101', '0000001110010', '0000001110011', '0000001110100', '0000001110101', '0000001110110',
  '0000001110111', '0000001010010', '0000001010011', '0000001010100', '0000001010101', '0000001011010',
  '0000001011011', '0000001100100', '0000001100101',
].map(c);
/** Extended make-up codes for 1792, 1856, ..., 2560 (both colours). */
const EXT_MAKEUP = [
  '00000001000', '00000001100', '00000001101', '000000010010', '000000010011', '000000010100',
  '000000010101', '000000010110', '000000010111', '000000011100', '000000011101', '000000011110',
  '000000011111',
].map(c);
const PASS = c('0001');
const HORIZ = c('001');
/** Vertical mode by a1 - b1, from -3 to +3. */
const VERT: Record<number, Code> = {
  [-3]: c('0000010'),
  [-2]: c('000010'),
  [-1]: c('010'),
  0: c('1'),
  1: c('011'),
  2: c('000011'),
  3: c('0000011'),
};

class BitWriter {
  private buf: Uint8Array;
  private pos = 0;
  private acc = 0;
  private n = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(Math.max(64, size));
  }
  put([bits, len]: Code): void {
    this.acc = (this.acc << len) | bits;
    this.n += len;
    while (this.n >= 8) {
      this.n -= 8;
      if (this.pos === this.buf.length) {
        const next = new Uint8Array(this.buf.length * 2);
        next.set(this.buf);
        this.buf = next;
      }
      this.buf[this.pos++] = (this.acc >>> this.n) & 0xff;
    }
    this.acc &= (1 << this.n) - 1;
  }
  finish(): Uint8Array {
    if (this.n > 0) this.put([0, 8 - this.n]);
    return this.buf.slice(0, this.pos);
  }
}

function putRun(w: BitWriter, run: number, black: boolean): void {
  while (run >= 2560) {
    w.put(EXT_MAKEUP[12]!);
    run -= 2560;
  }
  if (run >= 64) {
    const m = Math.floor(run / 64);
    w.put(m <= 27 ? (black ? BLACK_MAKEUP : WHITE_MAKEUP)[m - 1]! : EXT_MAKEUP[m - 28]!);
    run -= m * 64;
  }
  w.put((black ? BLACK_TERM : WHITE_TERM)[run]!);
}

/** Positions where the colour changes (pixel differs from the one to its left; left of 0 counts as white), ending with `width` twice. */
function changes(line: Uint8Array, width: number, out: Int32Array): number {
  let n = 0;
  let prev = 0;
  for (let x = 0; x < width; x++) {
    const v = line[x]!;
    if (v !== prev) {
      out[n++] = x;
      prev = v;
    }
  }
  out[n] = width;
  out[n + 1] = width;
  return n;
}

/** Encodes a 1-bit image as a CCITT Group 4 stream (with the end-of-block code). */
export function encodeG4(black: Uint8Array, width: number, height: number): Uint8Array {
  const w = new BitWriter(Math.ceil((width * height) / 32));
  let ref = new Int32Array(width + 2);
  let refN = changes(new Uint8Array(width), width, ref); // imaginary all-white line above the first
  let cur = new Int32Array(width + 2);
  for (let y = 0; y < height; y++) {
    const line = black.subarray(y * width, (y + 1) * width);
    const curN = changes(line, width, cur);
    let a0 = -1;
    let color = 0; // colour of the run that starts at a0 (0 white, 1 black)
    let ai = 0; // index into cur of the first change after a0
    let p = 0; // index into ref of the first change after a0, whatever its colour
    while (a0 < width) {
      while (ai < curN && cur[ai]! <= a0) ai++;
      const a1 = cur[ai]!;
      const a2 = cur[ai + 1]!;
      // Changes alternate: an even index turns black, an odd index turns white. b1 is the first change right of
      // a0 that turns to the opposite of `color`, so its index has parity `color`.
      while (p < refN && ref[p]! <= a0) p++;
      const bi = (p & 1) === color ? p : p + 1;
      const b1 = bi < refN ? ref[bi]! : width;
      const b2 = bi + 1 < refN ? ref[bi + 1]! : width;
      if (b2 < a1) {
        w.put(PASS);
        a0 = b2;
        continue;
      }
      const d = a1 - b1;
      if (d >= -3 && d <= 3) {
        w.put(VERT[d]!);
        a0 = a1;
        color ^= 1;
        continue;
      }
      w.put(HORIZ);
      putRun(w, a1 - Math.max(a0, 0), color === 1);
      putRun(w, a2 - a1, color === 0);
      a0 = a2;
    }
    [ref, cur] = [cur, ref];
    refN = curN;
  }
  // EOFB: two EOL codes.
  w.put([1, 12]);
  w.put([1, 12]);
  return w.finish();
}
