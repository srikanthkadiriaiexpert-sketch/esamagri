/**
 * CSV serialisation for Admin Portal exports.
 *
 * Deliberately split in two: `toCsv` is pure and is where every rule lives, so
 * the rules can be tested without a DOM; `downloadCsv` is the three lines of
 * browser plumbing that hand the file to the operator. Nothing here fetches
 * anything or knows what a voucher is.
 *
 * THE FOUR RULES, AND WHY EACH ONE IS NOT OPTIONAL
 *
 * 1. QUOTING (RFC 4180). A field is quoted when it contains a comma, a double
 *    quote, a tab, a carriage return or a newline, or when it has leading or trailing
 *    whitespace that a reader would otherwise eat. Internal double quotes are
 *    doubled. An officer named `Kumar, A.` or an address with a line break is
 *    ordinary data here, not an edge case.
 *
 * 2. CRLF line endings. RFC 4180 says CRLF, and Excel on Windows is where
 *    these files are opened.
 *
 * 3. A UTF-8 BOM. Without it Excel opens a UTF-8 CSV as the system codepage
 *    and mangles every non-ASCII name. The BOM belongs to the FILE, so it is
 *    added by `downloadCsv` and never by `toCsv` — a BOM in the middle of a
 *    string nobody is downloading is just a stray character that breaks tests.
 *
 * 4. FORMULA NEUTRALISATION. A cell beginning `=`, `+`, `-`, `@`, a tab or a
 *    carriage return is executed as a formula by Excel, Google Sheets and
 *    LibreOffice. `=HYPERLINK(...)` or `=cmd|...` in a field someone typed into
 *    the application becomes code when a staff member opens the export. The
 *    value is prefixed with an apostrophe, which those applications strip on
 *    display. This CHANGES the exported bytes, which is the trade: a visible
 *    leading apostrophe in a rare field, against an export that can run
 *    commands. Pass `neutraliseFormulas: false` only for a machine-read file
 *    that no spreadsheet will open.
 */

export type CsvValue = string | number | boolean | null | undefined;

export interface CsvOptions {
  /** Default true. See rule 4 above; turn it off only for machine-read files. */
  neutraliseFormulas?: boolean;
}

// A tab is included so a field holding one survives a reader that treats
// tabs as delimiters, and so a formula-neutralised leading tab is visible.
const NEEDS_QUOTING = /[",\r\n\t]/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** One value to one CSV field. Exported for the tests; prefer `toCsv`. */
export function csvField(value: CsvValue, options: CsvOptions = {}): string {
  const neutralise = options.neutraliseFormulas !== false;

  if (value === null || value === undefined) return '';

  let text = typeof value === 'string' ? value : String(value);

  if (neutralise && FORMULA_LEAD.test(text)) {
    text = `'${text}`;
  }

  const hasEdgeSpace = text !== text.trim();
  if (NEEDS_QUOTING.test(text) || hasEdgeSpace) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Header row plus data rows to a CSV document.
 *
 * An empty `rows` array still produces the header line. That is intentional:
 * an export of nothing should be a valid file that says what it would have
 * contained, not a zero-byte download that looks like a failure.
 */
export function toCsv(
  headers: readonly string[],
  rows: readonly CsvValue[][],
  options: CsvOptions = {}
): string {
  const lines: string[] = [headers.map((h) => csvField(h, options)).join(',')];
  for (const row of rows) {
    lines.push(row.map((cell) => csvField(cell, options)).join(','));
  }
  return lines.join('\r\n');
}

/**
 * A column set, so a caller declares each column's header and how to read it
 * from one record exactly once. Keeps the header row and the data row from
 * drifting apart, which is the usual way an export ends up one column out.
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

export function toCsvFromColumns<T>(
  columns: readonly CsvColumn<T>[],
  records: readonly T[],
  options: CsvOptions = {}
): string {
  return toCsv(
    columns.map((c) => c.header),
    records.map((record) => columns.map((c) => c.value(record))),
    options
  );
}

/**
 * A filename-safe, sortable stamp: 2026-11-10-0801. Local time, because the
 * operator naming a file is thinking in their own clock.
 */
export function timestampForFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  );
}

/**
 * Hands the CSV to the browser as a download.
 *
 * Separated from `toCsv` so the rules above are testable in a plain Node
 * environment. The BOM is prepended here — see rule 3.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoked on a later tick: revoking synchronously can cancel the download
    // in some browsers before it has started reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
