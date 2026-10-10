import {
  STUDENT_IMPORT_MAX_COLUMNS,
  STUDENT_IMPORT_MAX_FILE_BYTES,
  STUDENT_IMPORT_MAX_ROWS,
} from '@compintel/contracts';
import Papa from 'papaparse';

import { readFirstSheet } from '../../../platform/xlsx/sheet.js';
import { ZipFormatError } from '../../../platform/xlsx/zip.js';
import { importFileInvalid, importTooLarge } from '../errors.js';

/**
 * A picked file, as a header row and data rows of text (ruling R93).
 *
 * The format is decided by the extension the professor's file has, and then the
 * bytes have to agree: a `.xlsx` that is not a workbook is refused, never read as
 * text. CSV is UTF-8 with or without a BOM, comma or semicolon separated (Excel
 * in an Indian or European locale writes semicolons), with quoted fields that may
 * span lines. XLSX is the first worksheet, formulas as their cached values.
 */

export interface ParsedFile {
  readonly format: 'CSV' | 'XLSX';
  readonly headers: readonly string[];
  /** Data rows in sheet order; a blank row stays, so row numbers stay true. */
  readonly rows: readonly (readonly string[])[];
  /** The spreadsheet row number of `rows[0]` (the header is the row before it). */
  readonly firstRowNumber: number;
}

const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
};

/** Drops rows with nothing in them, which spreadsheets leave at the bottom. */
const isBlank = (row: readonly string[]): boolean => row.every((cell) => cell.trim().length === 0);

function readCsv(bytes: Buffer): string[][] {
  if (bytes.includes(0)) {
    throw importFileInvalid('That file holds binary data, so it is not a CSV file.');
  }
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  const parsed = Papa.parse<string[]>(text, {
    delimitersToGuess: [',', ';', '\t'],
    skipEmptyLines: false,
  });
  return parsed.data.map((row) => row.map((cell) => String(cell)));
}

function readXlsx(bytes: Buffer): string[][] {
  try {
    const sheet = readFirstSheet(bytes, {
      maxRows: STUDENT_IMPORT_MAX_ROWS + 1,
      maxColumns: STUDENT_IMPORT_MAX_COLUMNS,
    });
    if (sheet.truncated) {
      // One more row than allowed was there to be read, so there are too many.
      throw importTooLarge('rows');
    }
    if (sheet.tooWide) throw importTooLarge('columns');
    return sheet.rows;
  } catch (error) {
    if (error instanceof ZipFormatError) {
      throw importFileInvalid(
        `That file is named .xlsx but is not an Excel workbook (${error.message})`,
      );
    }
    throw error;
  }
}

/** Reads one picked file; throws a `STUDENT_IMPORT_*` problem when it cannot. */
export function parseImportFile(fileName: string, base64: string): ParsedFile {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) throw importFileInvalid('That file is empty.');
  if (bytes.length > STUDENT_IMPORT_MAX_FILE_BYTES) throw importTooLarge('bytes');

  const extension = extensionOf(fileName);
  let rows: string[][];
  let format: ParsedFile['format'];
  if (extension === '.xlsx') {
    format = 'XLSX';
    rows = readXlsx(bytes);
  } else if (extension === '.csv' || extension === '.txt') {
    format = 'CSV';
    rows = readCsv(bytes);
  } else {
    throw importFileInvalid(
      `Junction imports .csv and .xlsx files; “${fileName}” is neither. (An old .xls file can be saved as .xlsx from Excel.)`,
    );
  }

  const headerIndex = rows.findIndex((row) => !isBlank(row));
  const headers = headerIndex === -1 ? undefined : rows[headerIndex];
  if (headers === undefined) throw importFileInvalid('That file has no rows at all.');
  let end = rows.length;
  while (end > headerIndex + 1 && isBlank(rows[end - 1] ?? [])) end -= 1;
  const data = rows.slice(headerIndex + 1, end);
  if (headers.length > STUDENT_IMPORT_MAX_COLUMNS) throw importTooLarge('columns');
  if (data.filter((row) => !isBlank(row)).length > STUDENT_IMPORT_MAX_ROWS) {
    throw importTooLarge('rows');
  }
  if (data.length === 0) {
    throw importFileInvalid('That file has a header row but no students under it.');
  }
  return {
    format,
    headers: headers.map((header) => header.trim()),
    rows: data,
    firstRowNumber: headerIndex + 2,
  };
}
