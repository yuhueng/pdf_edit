import { PDFParser, PDFRawStream, PDFStream } from 'pdf-lib';

/**
 * pdf-lib patches for multi-GB files. Imported for its side effects by every module that uses pdf-lib.
 *
 * 1. Parsing: stream contents are views into the input bytes instead of copies, so loading a 2 GB file
 *    keeps one 2 GB buffer, not two. Nothing in the app writes into parsed stream contents.
 * 2. Copying a stream (merge / split) shares its contents instead of cloning them.
 * 3. Saving copies stream bytes with one native memcpy instead of a byte-by-byte loop.
 */

const byteStream = (PDFParser.forBytesWithOptions(new Uint8Array(1)) as unknown as { bytes: object }).bytes;
const ByteStreamProto = Object.getPrototypeOf(byteStream) as { slice(start: number, end: number): Uint8Array };
ByteStreamProto.slice = function sliceView(this: { bytes: Uint8Array }, start: number, end: number): Uint8Array {
  return this.bytes.subarray(start, end);
};

PDFRawStream.prototype.clone = function cloneShared(context) {
  return PDFRawStream.of(this.dict.clone(context), this.contents);
};

PDFStream.prototype.copyBytesInto = function copyBytesIntoFast(buffer: Uint8Array, offset: number): number {
  this.updateDict();
  const init = offset;
  offset += this.dict.copyBytesInto(buffer, offset);
  buffer.set([10, 115, 116, 114, 101, 97, 109, 10], offset); // \nstream\n
  offset += 8;
  const contents = this.getContents();
  buffer.set(contents, offset);
  offset += contents.length;
  buffer.set([10, 101, 110, 100, 115, 116, 114, 101, 97, 109], offset); // \nendstream
  offset += 10;
  return offset - init;
};
