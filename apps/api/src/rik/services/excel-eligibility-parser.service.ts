import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

/**
 * The ONLY place in this application that knows what a spreadsheet is
 * (STEP 15B Phase B).
 *
 * ExcelJS is isolated behind this service deliberately. Everything above it
 * receives plain rows of strings and has no idea they came from a workbook,
 * so the matching, validation and audit logic is testable without a binary
 * fixture and a future change of library touches one file.
 *
 * WHAT IT WILL NOT DO
 *
 *   * it does not evaluate formulas. A cell is read through its cached value
 *     only; ExcelJS does not compute formulas on read, and where a cell holds
 *     one this reads the stored RESULT and nothing else;
 *   * it does not run macros. .xlsm is refused by extension before the bytes
 *     are opened at all;
 *   * it does not write, and it never touches the filesystem — the workbook
 *     is parsed from the in-memory buffer;
 *   * it does not interpret. Every value comes out as the raw trimmed text
 *     the sheet contained, including nonsense, so the layer above can record
 *     what the facility actually sent and refuse it by name.
 *
 * THE SHEET'S SHAPE IS FIXED AND NARROW
 *
 * Three columns: Name, Mobile Number, Eligible Days. There is deliberately no
 * period column — the period is chosen in the upload screen, so a sheet
 * cannot quietly target a month the administrator did not pick. There is no
 * RIK ID column either: the identifier is resolved by the system, never
 * supplied by the facility.
 */

/** A row exactly as the sheet contained it. Nothing normalised, nothing judged. */
export interface RawEligibilityRow {
  /** 1-based row number in the sheet, so a reviewer can find it. */
  sheetRow: number;
  name: string;
  mobile: string;
  eligibleDays: string;
}

export type ParseFailureCode =
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'UNREADABLE_WORKBOOK'
  | 'NO_WORKSHEET'
  | 'MISSING_HEADER'
  | 'NO_DATA_ROWS'
  | 'TOO_MANY_ROWS';

export class ExcelParseError extends Error {
  readonly code: ParseFailureCode;
  readonly detail: Record<string, unknown>;

  constructor(code: ParseFailureCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ExcelParseError';
    this.code = code;
    this.detail = detail;
  }
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_DATA_ROWS = 20_000;

const XLSX_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Some browsers and some versions of Excel send this for .xlsx.
  'application/octet-stream',
  '',
]);

/**
 * Header synonyms, matched after the same canonicalisation the names
 * themselves get. A facility spreadsheet is maintained by people, so "Mobile"
 * and "Mobile Number" and "MOBILE NO" are all the same column — but the set
 * is a FIXED LIST, not a fuzzy match. A header this does not recognise is a
 * refusal that names the column, never a guess.
 */
const HEADERS = {
  name: ['name', 'officer name', 'officername'],
  mobile: ['mobile', 'mobile number', 'mobile no', 'mobileno', 'mobile_number', 'phone', 'phone number'],
  eligibleDays: ['eligible days', 'eligibledays', 'eligible_days', 'days', 'eligible day'],
} as const;

function headerKey(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

@Injectable()
export class ExcelEligibilityParserService {
  /**
   * Turn an uploaded workbook into raw rows, or refuse it by name.
   *
   * The file is checked by extension and size BEFORE ExcelJS is handed the
   * bytes, so a 400 MB file or a .xlsm never reaches the parser at all.
   */
  async parse(file: { originalname: string; mimetype: string; size: number; buffer: Buffer }): Promise<{
    rows: RawEligibilityRow[];
    sheetName: string;
  }> {
    const name = (file.originalname ?? '').trim();
    if (!/\.xlsx$/i.test(name)) {
      throw new ExcelParseError(
        'UNSUPPORTED_FILE_TYPE',
        'The eligibility file must be a .xlsx workbook. .xls and .xlsm are not accepted.',
        { fileName: name }
      );
    }
    if (!XLSX_MIME.has((file.mimetype ?? '').toLowerCase())) {
      throw new ExcelParseError(
        'UNSUPPORTED_FILE_TYPE',
        'That file does not look like a .xlsx workbook.',
        { mimetype: file.mimetype }
      );
    }
    if (!file.buffer || file.size <= 0) {
      throw new ExcelParseError('UNREADABLE_WORKBOOK', 'The uploaded file was empty.');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ExcelParseError(
        'FILE_TOO_LARGE',
        `The eligibility file must be ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB or smaller.`,
        { size: file.size, max: MAX_UPLOAD_BYTES }
      );
    }

    const workbook = new ExcelJS.Workbook();
    try {
      // ExcelJS types `load` against the global Buffer shape; the Node
      // Buffer we hold is structurally compatible but not assignable under
      // the stricter lib.dom typings, so the cast is a typing bridge only.
      await workbook.xlsx.load(file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch {
      // The underlying error can carry zip internals and file paths; it is
      // deliberately not propagated.
      throw new ExcelParseError(
        'UNREADABLE_WORKBOOK',
        'That workbook could not be read. It may be corrupt, password-protected, or not a real .xlsx file.'
      );
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new ExcelParseError('NO_WORKSHEET', 'The workbook contains no worksheet.');
    }

    const headerRow = sheet.getRow(1);
    const columns = this.resolveColumns(headerRow);

    const rows: RawEligibilityRow[] = [];
    const lastRow = sheet.actualRowCount > 0 ? sheet.rowCount : 1;
    for (let r = 2; r <= lastRow; r += 1) {
      const row = sheet.getRow(r);
      const nameCell = this.cellText(row, columns.name);
      const mobileCell = this.cellText(row, columns.mobile);
      const daysCell = this.cellText(row, columns.eligibleDays);

      // A wholly empty row is spreadsheet padding, not a record, and is
      // skipped rather than reported as a missing-field exception.
      if (nameCell === '' && mobileCell === '' && daysCell === '') continue;

      if (rows.length >= MAX_DATA_ROWS) {
        throw new ExcelParseError(
          'TOO_MANY_ROWS',
          `The eligibility file must contain ${MAX_DATA_ROWS} rows or fewer.`,
          { max: MAX_DATA_ROWS }
        );
      }
      rows.push({ sheetRow: r, name: nameCell, mobile: mobileCell, eligibleDays: daysCell });
    }

    if (rows.length === 0) {
      throw new ExcelParseError('NO_DATA_ROWS', 'The workbook has a header but no eligibility rows.');
    }

    return { rows, sheetName: sheet.name };
  }

  private resolveColumns(headerRow: ExcelJS.Row): { name: number; mobile: number; eligibleDays: number } {
    const found: Partial<Record<keyof typeof HEADERS, number>> = {};
    const seen: string[] = [];

    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = headerKey(this.valueText(cell.value));
      if (key.length === 0) return;
      seen.push(key);
      for (const [field, synonyms] of Object.entries(HEADERS) as Array<
        [keyof typeof HEADERS, readonly string[]]
      >) {
        if (found[field] === undefined && synonyms.includes(key)) found[field] = col;
      }
    });

    const missing = (Object.keys(HEADERS) as Array<keyof typeof HEADERS>).filter(
      (f) => found[f] === undefined
    );
    if (missing.length > 0) {
      throw new ExcelParseError(
        'MISSING_HEADER',
        `The first row must name the columns Name, Mobile Number and Eligible Days. Missing: ${missing.join(', ')}.`,
        { missing, headersFound: seen }
      );
    }

    return {
      name: found.name!,
      mobile: found.mobile!,
      eligibleDays: found.eligibleDays!,
    };
  }

  private cellText(row: ExcelJS.Row, column: number): string {
    return this.valueText(row.getCell(column).value);
  }

  /**
   * One cell to one trimmed string, without evaluating anything.
   *
   * A formula cell is read through its stored `result`; nothing is computed.
   * A date is rendered ISO rather than localised, so a reviewer sees what the
   * sheet holds rather than what this machine's locale makes of it. A number
   * keeps full precision, because '7.5' must survive to be REFUSED as a
   * decimal rather than silently become 7 or 8.
   */
  private valueText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value instanceof Date) return value.toISOString().slice(0, 10);

    if (typeof value === 'object') {
      const record = value as unknown as Record<string, unknown>;
      // Formula cell: the cached result only.
      if ('result' in record) return this.valueText(record.result as ExcelJS.CellValue);
      // Rich text: the concatenated runs.
      if ('richText' in record && Array.isArray(record.richText)) {
        return (record.richText as Array<{ text?: string }>)
          .map((run) => run.text ?? '')
          .join('')
          .trim();
      }
      // Hyperlink cell: the visible text, not the target.
      if ('text' in record) return this.valueText(record.text as ExcelJS.CellValue);
      // An error cell ({ error: '#N/A' }) is text so it can be refused by name.
      if ('error' in record) return String(record.error);
    }
    return '';
  }
}
