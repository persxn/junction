import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A minimal `.xlsx` writer, for tests only (WP-17).
 *
 * The prompt asked for the CSV fixture's XLSX twin to be "written with exceljs
 * at test time"; exceljs failed the dependency audit, so the twin is written
 * here instead — a real Office Open XML package (content types, workbook,
 * relationships, shared strings, one sheet) that Excel and LibreOffice open.
 * Text cells go through the shared-string table and numbers are stored as
 * numbers, which is how spreadsheet applications write them and therefore what
 * the reader has to handle.
 */

export interface WorkbookOptions {
  readonly sheetName?: string;
  /** Deflate each part, as Excel does. Off: stored, as some tools do. */
  readonly deflate?: boolean;
  /** Cells whose value is written as a formula with this cached value. */
  readonly formulas?: ReadonlyMap<string, string>;
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function columnName(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** The workbook's XML parts. */
function parts(
  rows: readonly (readonly string[])[],
  options: WorkbookOptions,
): Map<string, string> {
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const ref = `${columnName(c)}${String(r + 1)}`;
      const formula = options.formulas?.get(ref);
      if (formula !== undefined) {
        return `<c r="${ref}" t="str"><f>${escape(formula)}</f><v>${escape(value)}</v></c>`;
      }
      if (value === '') return '';
      if (/^-?\d+(\.\d+)?$/.test(value)) return `<c r="${ref}"><v>${value}</v></c>`;
      let index = stringIndex.get(value);
      if (index === undefined) {
        index = strings.length;
        strings.push(value);
        stringIndex.set(value, index);
      }
      return `<c r="${ref}" t="s"><v>${String(index)}</v></c>`;
    });
    return `<row r="${String(r + 1)}">${cells.join('')}</row>`;
  });
  const ns = 'http://schemas.openxmlformats.org';
  return new Map([
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets><sheet name="${escape(options.sheetName ?? 'Students')}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${ns}/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ],
    [
      'xl/sharedStrings.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${ns}/spreadsheetml/2006/main" count="${String(strings.length)}" uniqueCount="${String(strings.length)}">${strings.map((text) => `<si><t xml:space="preserve">${escape(text)}</t></si>`).join('')}</sst>`,
    ],
    [
      'xl/worksheets/sheet1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}/spreadsheetml/2006/main"><sheetData>${sheetRows.join('')}</sheetData></worksheet>`,
    ],
  ]);
}

/** A ZIP of named parts (store or deflate), as an `.xlsx` needs. */
export function zip(files: ReadonlyMap<string, string | Buffer>, deflate: boolean): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const stored = deflate ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x0403_4b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x0201_4b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, stored);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + stored.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x0605_4b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** An `.xlsx` whose first sheet holds `rows` (the first row is the header). */
export function writeWorkbook(
  rows: readonly (readonly string[])[],
  options: WorkbookOptions = {},
): Buffer {
  return zip(parts(rows, options), options.deflate ?? true);
}
