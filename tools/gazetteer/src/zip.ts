import { inflateRawSync } from 'node:zlib';

/**
 * Just enough ZIP to read one entry out of a GeoNames dump.
 *
 * A dependency was the obvious alternative and was not taken. This script is the
 * one thing in the repository that reaches out to the internet, so its supply
 * chain is the one that matters most; forty lines of well-specified format
 * parsing is a smaller risk than a package, and the format has not changed since
 * 1989. If it ever fails it fails loudly, at build time, on a developer's
 * machine — never in front of a user.
 *
 * Deliberately not supported: ZIP64, encryption, and anything other than store
 * and deflate. The GeoNames dumps are single-entry deflate archives well under
 * 4 GB, and an archive that is none of those things should stop the build rather
 * than be guessed at.
 */

const EOCD_SIGNATURE = 0x0605_4b50;
const CENTRAL_SIGNATURE = 0x0201_4b50;
const LOCAL_SIGNATURE = 0x0403_4b50;
const EOCD_MIN_SIZE = 22;
/** The ZIP comment may be up to 64 KB, and the EOCD sits just before it. */
const EOCD_SEARCH_WINDOW = 0xffff + EOCD_MIN_SIZE;

interface CentralEntry {
  readonly name: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - EOCD_SEARCH_WINDOW);
  for (let at = buffer.length - EOCD_MIN_SIZE; at >= start; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) {
      return at;
    }
  }
  throw new Error('Not a ZIP archive: no end-of-central-directory record');
}

/** Every entry in the archive's central directory. */
export function listEntries(buffer: Buffer): CentralEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);

  const entries: CentralEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new Error(`Corrupt ZIP: expected a central directory entry at ${String(at)}`);
    }
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    entries.push({
      name: buffer.toString('utf8', at + 46, at + 46 + nameLength),
      compressionMethod: buffer.readUInt16LE(at + 10),
      compressedSize: buffer.readUInt32LE(at + 20),
      uncompressedSize: buffer.readUInt32LE(at + 24),
      localHeaderOffset: buffer.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The decompressed bytes of one named entry. */
export function readEntry(buffer: Buffer, name: string): Buffer {
  const entry = listEntries(buffer).find((candidate) => candidate.name === name);
  if (entry === undefined) {
    throw new Error(`The archive has no entry named "${name}"`);
  }

  const local = entry.localHeaderOffset;
  if (buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) {
    throw new Error(`Corrupt ZIP: no local header for "${name}"`);
  }
  // The local header repeats the name and extra-field lengths, and they can
  // differ from the central directory's — the data offset must use these.
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(start, start + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return Buffer.from(compressed);
  }
  if (entry.compressionMethod === 8) {
    return inflateRawSync(compressed);
  }
  throw new Error(
    `"${name}" uses compression method ${String(entry.compressionMethod)}; only store and deflate are supported`,
  );
}
