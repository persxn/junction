import { listEntries, readEntry, ZipFormatError, type ZipEntry } from './zip.js';

/**
 * The first worksheet of an `.xlsx`, as rows of text (ruling R93, WP-17).
 *
 * Office Open XML (ECMA-376) keeps a workbook as XML parts in a ZIP:
 * `xl/workbook.xml` lists the sheets in order, `xl/_rels/workbook.xml.rels` says
 * which part each one is, `xl/sharedStrings.xml` holds the text cells point at,
 * and the sheet part holds `<row>`s of `<c>` cells. R93 asks for the first
 * worksheet with formulas as their cached values, which is exactly what a cell's
 * `<v>` holds — a formula itself is never evaluated.
 *
 * The parts are machine-written and regular, so a handful of patterns read them;
 * the one thing done carefully is entity decoding, because a name with an
 * ampersand in it must arrive as typed. Anything that is not a workbook is a
 * `ZipFormatError`, which the import reports as an unreadable file.
 */

export interface SheetRows {
  readonly sheetName: string;
  readonly rows: string[][];
}

export interface SheetLimits {
  /** Stop reading after this many rows; the caller decides what too many means. */
  readonly maxRows: number;
  readonly maxColumns: number;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** XML text → string: the five named entities and numeric character references. */
export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

/** `name="value"` pairs of one tag's attribute text. */
function attributes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of text.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    out.set(match[1] ?? '', decodeXml(match[2] ?? ''));
  }
  return out;
}

/** The concatenated text of every `<t>` run, phonetic hints (`<rPh>`) left out. */
function runText(xml: string): string {
  const withoutPhonetics = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const match of withoutPhonetics.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    out += decodeXml(match[1] ?? '');
  }
  return out;
}

/** "A" → 0, "Z" → 25, "AA" → 26: the column of a cell reference such as `AB12`. */
export function columnIndex(reference: string): number | undefined {
  const letters = /^([A-Z]+)\d*$/.exec(reference.toUpperCase())?.[1];
  if (letters === undefined) return undefined;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function part(buffer: Buffer, entries: readonly ZipEntry[], name: string): string | undefined {
  const entry = entries.find((candidate) => candidate.name === name);
  return entry === undefined ? undefined : readEntry(buffer, entry).toString('utf8');
}

/** The path of the first sheet's part, resolved through the workbook's relationships. */
function firstSheetPart(
  buffer: Buffer,
  entries: readonly ZipEntry[],
): { name: string; path: string } {
  const workbook = part(buffer, entries, 'xl/workbook.xml');
  if (workbook === undefined) throw new ZipFormatError('This ZIP is not an Excel workbook.');
  const sheet = /<sheet\b([^>]*)\/?>/.exec(workbook);
  if (sheet === null) throw new ZipFormatError('The workbook has no worksheet.');
  const attrs = attributes(sheet[1] ?? '');
  const name = attrs.get('name') ?? 'Sheet1';
  const relationId = [...attrs.entries()].find(([key]) => key.endsWith(':id'))?.[1];
  const rels = part(buffer, entries, 'xl/_rels/workbook.xml.rels');
  if (relationId !== undefined && rels !== undefined) {
    for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const rel = attributes(match[1] ?? '');
      if (rel.get('Id') === relationId) {
        const target = rel.get('Target') ?? '';
        const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
        return { name, path };
      }
    }
  }
  return { name, path: 'xl/worksheets/sheet1.xml' };
}

function sharedStrings(buffer: Buffer, entries: readonly ZipEntry[]): string[] {
  const xml = part(buffer, entries, 'xl/sharedStrings.xml');
  if (xml === undefined) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((match) => runText(match[1] ?? ''));
}

/** One cell's displayed text. */
function cellText(type: string | undefined, inner: string, strings: readonly string[]): string {
  if (type === 'inlineStr') return runText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '');
  const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
  if (value === undefined) return '';
  const text = decodeXml(value);
  if (type === 's') return strings[Number.parseInt(text, 10)] ?? '';
  if (type === 'b') return text === '1' ? 'TRUE' : 'FALSE';
  // `n` (or no type), `str` (a formula's cached text) and `e` (an error such as
  // #N/A) are all shown as stored.
  return text;
}

/** Reads the first worksheet, at most `limits.maxRows` rows of `limits.maxColumns` cells. */
export function readFirstSheet(
  bytes: Uint8Array,
  limits: SheetLimits,
): SheetRows & { truncated: boolean; tooWide: boolean } {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = listEntries(buffer);
  if (!entries.some((entry) => entry.name === '[Content_Types].xml')) {
    throw new ZipFormatError('This ZIP is not an Office document.');
  }
  const sheet = firstSheetPart(buffer, entries);
  const xml = part(buffer, entries, sheet.path);
  if (xml === undefined) throw new ZipFormatError('The workbook is missing its first worksheet.');
  const strings = sharedStrings(buffer, entries);

  const rows: string[][] = [];
  let truncated = false;
  let tooWide = false;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    if (rows.length >= limits.maxRows) {
      truncated = true;
      break;
    }
    const rowNumber = Number.parseInt(attributes(rowMatch[1] ?? '').get('r') ?? '', 10);
    const index = Number.isInteger(rowNumber) ? rowNumber - 1 : rows.length;
    // A sheet may skip empty rows; keep spreadsheet row numbers true.
    while (rows.length < index && rows.length < limits.maxRows) rows.push([]);
    const cells: string[] = [];
    let next = 0;
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = attributes(cellMatch[1] ?? '');
      const column = columnIndex(attrs.get('r') ?? '') ?? next;
      next = column + 1;
      if (column >= limits.maxColumns) {
        tooWide = true;
        continue;
      }
      cells[column] = cellText(attrs.get('t'), cellMatch[2] ?? '', strings);
    }
    rows.push(Array.from(cells, (cell) => cell ?? ''));
  }
  return { sheetName: sheet.name, rows, truncated, tooWide };
}
