import { inflateRawSync } from 'node:zlib';

/**
 * Just enough ZIP to read an `.xlsx` (WP-17, owner decision of 2 Oct 2026).
 *
 * exceljs was the planned reader and failed the dependency audit (`uuid <11.1.1`
 * through it, a moderate advisory with no fixed release), so the owner took the
 * worker's recommendation: read the format directly. An `.xlsx` is a ZIP of XML
 * parts; this file is the ZIP half, adapted from `tools/gazetteer/src/zip.ts`
 * and hardened for a file a user picked rather than one GeoNames publishes:
 *
 * - every offset is bounds-checked, so a truncated or hostile file is an error,
 *   never a read past the end of the buffer;
 * - decompression is capped (`MAX_ENTRY_BYTES` per part), so a 700 KB "zip bomb"
 *   cannot become gigabytes in memory;
 * - only store and deflate are read; ZIP64 and encryption are refused, because
 *   no spreadsheet application writes them for a 700 KB workbook.
 */

const EOCD_SIGNATURE = 0x0605_4b50;
const CENTRAL_SIGNATURE = 0x0201_4b50;
const LOCAL_SIGNATURE = 0x0403_4b50;
const EOCD_MIN_SIZE = 22;
const EOCD_SEARCH_WINDOW = 0xffff + EOCD_MIN_SIZE;

/** Largest decompressed part read: a 5 000-row sheet is a few MB of XML. */
export const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

/** Thrown for anything that is not a readable ZIP. The import turns it into FILE_INVALID. */
export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function u16(buffer: Buffer, at: number): number {
  if (at < 0 || at + 2 > buffer.length) throw new ZipFormatError('The ZIP is truncated.');
  return buffer.readUInt16LE(at);
}

function u32(buffer: Buffer, at: number): number {
  if (at < 0 || at + 4 > buffer.length) throw new ZipFormatError('The ZIP is truncated.');
  return buffer.readUInt32LE(at);
}

function endOfCentralDirectory(buffer: Buffer): number {
  if (buffer.length < EOCD_MIN_SIZE) throw new ZipFormatError('Not a ZIP archive.');
  const start = Math.max(0, buffer.length - EOCD_SEARCH_WINDOW);
  for (let at = buffer.length - EOCD_MIN_SIZE; at >= start; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  throw new ZipFormatError('Not a ZIP archive: no end-of-central-directory record.');
}

/** Every entry in the central directory. */
export function listEntries(buffer: Buffer): ZipEntry[] {
  const eocd = endOfCentralDirectory(buffer);
  const count = u16(buffer, eocd + 10);
  let at = u32(buffer, eocd + 16);
  if (count === 0xffff || at === 0xffff_ffff) {
    throw new ZipFormatError('ZIP64 archives are not read.');
  }
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (u32(buffer, at) !== CENTRAL_SIGNATURE) {
      throw new ZipFormatError('The ZIP central directory is corrupt.');
    }
    const nameLength = u16(buffer, at + 28);
    const extraLength = u16(buffer, at + 30);
    const commentLength = u16(buffer, at + 32);
    if (at + 46 + nameLength > buffer.length) throw new ZipFormatError('The ZIP is truncated.');
    entries.push({
      name: buffer.toString('utf8', at + 46, at + 46 + nameLength),
      flags: u16(buffer, at + 8),
      method: u16(buffer, at + 10),
      compressedSize: u32(buffer, at + 20),
      uncompressedSize: u32(buffer, at + 24),
      localHeaderOffset: u32(buffer, at + 42),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The decompressed bytes of one entry, within `MAX_ENTRY_BYTES`. */
export function readEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  if ((entry.flags & 0x1) !== 0) throw new ZipFormatError('Encrypted workbooks are not read.');
  const local = entry.localHeaderOffset;
  if (u32(buffer, local) !== LOCAL_SIGNATURE) {
    throw new ZipFormatError(`The ZIP has no local header for ${entry.name}.`);
  }
  // The local header's own name and extra lengths decide where the data starts.
  const start = local + 30 + u16(buffer, local + 26) + u16(buffer, local + 28);
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw new ZipFormatError('The ZIP is truncated.');
  const data = buffer.subarray(start, end);
  if (entry.method === 0) {
    if (data.length > MAX_ENTRY_BYTES) throw new ZipFormatError('A workbook part is too large.');
    return Buffer.from(data);
  }
  if (entry.method === 8) {
    try {
      return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch {
      throw new ZipFormatError(`${entry.name} could not be decompressed (or is too large).`);
    }
  }
  throw new ZipFormatError(`${entry.name} uses a compression method that is not read.`);
}
