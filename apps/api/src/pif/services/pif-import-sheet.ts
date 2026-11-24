import ExcelJS from 'exceljs';

/**
 * Reading the client's spreadsheet (LAUNCH PREPARATION).
 *
 * This file knows about FILES AND CELLS and nothing else: no catalogue
 * rules, no database, no permissions. It turns an uploaded .xlsx or .csv
 * into a header map and a list of rows of strings, and it names the columns
 * it did not recognise so the operator is told rather than left guessing.
 *
 * WHY IT IS THIS FORGIVING. The file comes from a victualling yard's own
 * records, not from a developer. `Selling Price`, `selling price`,
 * `SellingPrice` and `Rate` all mean the same thing; a price may arrive as
 * `₹ 1,250.50`; a yes/no column may say `Y`, `yes`, `TRUE` or `1`; and there
 * will be blank rows and a stray total row at the bottom. All of that is
 * handled here, once, so the rest of the import deals in clean values.
 *
 * WHY IT IS NOT MORE FORGIVING THAN THAT. It will not guess a column it does
 * not know, and it will not invent a value that is absent. An unrecognised
 * column is REPORTED AND IGNORED — in particular a column called `stock`,
 * `on hand` or `quantity available`, which is listed here as deliberately
 * ignored because PIF has no stock concept and an import must not smuggle
 * one in.
 */

/** Every field the import understands, and the spellings accepted for it. */
const FIELD_ALIASES: Readonly<Record<string, readonly string[]>> = {
  sku: ['sku', 'skucode', 'itemcode', 'productcode', 'code'],
  name: ['name', 'productname', 'itemname', 'product', 'item'],
  brand: ['brand', 'make', 'company'],
  description: ['description', 'details', 'productdescription'],
  category: ['category', 'maincategory', 'categoryname', 'group'],
  subcategory: ['subcategory', 'subcategoryname', 'subgroup'],
  unit: ['unit', 'uom', 'unitofmeasure', 'measure'],
  packSize: ['packsize', 'pack', 'size', 'netquantity'],
  packUnit: ['packunit', 'packuom'],
  sellingPrice: ['sellingprice', 'price', 'rate', 'saleprice', 'unitprice'],
  purchasePrice: ['purchaseprice', 'cost', 'purchasecost', 'costprice'],
  gstPct: ['gst', 'gstpct', 'gstpercent', 'gstrate', 'tax', 'taxpct', 'taxpercent', 'taxrate'],
  discountPct: ['discount', 'discountpct', 'discountpercent'],
  minOrderQty: ['minorderqty', 'minqty', 'minimumqty', 'minimumorderquantity'],
  maxOrderQty: ['maxorderqty', 'maxqty', 'maximumqty', 'maximumorderquantity', 'orderlimit'],
  qtyStep: ['qtystep', 'step', 'increment', 'stepsize'],
  barcode: ['barcode', 'ean', 'upc'],
  variantGroup: ['variantgroup', 'family', 'productfamily'],
  variantLabel: ['variantlabel', 'variant', 'packlabel'],
  available: ['available', 'availabletoday', 'intoday'],
  active: ['active', 'enabled', 'listed'],
};

/**
 * Columns that are recognised in order to be IGNORED, with the reason shown
 * to the operator. Silently dropping a column the client clearly meant
 * something by is how trust in an import is lost.
 */
const IGNORED_COLUMNS: Readonly<Record<string, string>> = {
  stock: 'PIF keeps no stock count — use the Available column to say what can be ordered today.',
  stockqty: 'PIF keeps no stock count — use the Available column instead.',
  onhand: 'PIF keeps no stock count — use the Available column instead.',
  quantityavailable: 'PIF keeps no stock count — use the Available column instead.',
  openingstock: 'PIF keeps no stock count — use the Available column instead.',
  supplier: 'PIF has no supplier or purchasing records.',
  suppliername: 'PIF has no supplier or purchasing records.',
  hsn: 'Not stored: GST comes from the configured tax rates, by rate.',
  mrp: 'Not stored: the shop charges the selling price, so put that figure in Selling Price.',
  margin: 'Not stored — it follows from the selling and purchase prices.',
  srno: 'A serial number column is not needed.',
  sno: 'A serial number column is not needed.',
  slno: 'A serial number column is not needed.',
};

export type SheetField = keyof typeof FIELD_ALIASES;

export interface SheetRow {
  /** The row number in the operator's own file, header row included. */
  rowNo: number;
  values: Partial<Record<SheetField, string>>;
}

export interface IgnoredColumn {
  heading: string;
  reason: string;
}

export interface ParsedSheet {
  format: 'XLSX' | 'CSV';
  /** The fields the file actually provides a column for. */
  present: SheetField[];
  rows: SheetRow[];
  ignored: IgnoredColumn[];
  /** Headings that matched nothing at all. */
  unknown: string[];
}

export class SheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetError';
  }
}

const normaliseHeading = (heading: string): string =>
  heading.toLowerCase().replace(/[^a-z0-9]/g, '');

const FIELD_BY_ALIAS: Map<string, SheetField> = (() => {
  const map = new Map<string, SheetField>();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) map.set(alias, field as SheetField);
  }
  return map;
})();

/** A zip file begins `PK\x03\x04`; a CSV does not. */
export function sniffFormat(buffer: Buffer, filename: string): 'XLSX' | 'CSV' {
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) return 'XLSX';
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xls')) {
    throw new SheetError(
      'That is an old .xls file. Open it in Excel and use “Save As” to make a .xlsx or .csv file, then upload that.'
    );
  }
  if (lower.endsWith('.xlsx')) {
    throw new SheetError('That file is named .xlsx but is not a valid Excel workbook.');
  }
  return 'CSV';
}

export async function parseSheet(buffer: Buffer, filename: string): Promise<ParsedSheet> {
  const format = sniffFormat(buffer, filename);
  const grid = format === 'XLSX' ? await readWorkbook(buffer) : readCsv(buffer);

  const headerIndex = grid.findIndex((row) => row.some((cell) => cell.trim() !== ''));
  if (headerIndex === -1) {
    throw new SheetError('That file has no rows in it.');
  }

  const headings = grid[headerIndex]!;
  const columns: Array<SheetField | null> = [];
  const present: SheetField[] = [];
  const ignored: IgnoredColumn[] = [];
  const unknown: string[] = [];

  headings.forEach((heading) => {
    const text = heading.trim();
    if (text === '') {
      columns.push(null);
      return;
    }
    const key = normaliseHeading(text);
    const field = FIELD_BY_ALIAS.get(key);
    if (field !== undefined) {
      columns.push(field);
      if (!present.includes(field)) present.push(field);
      return;
    }
    columns.push(null);
    const reason = IGNORED_COLUMNS[key];
    if (reason !== undefined) ignored.push({ heading: text, reason });
    else unknown.push(text);
  });

  if (!present.includes('sku') || !present.includes('name')) {
    throw new SheetError(
      'The first row must be the column headings, and must include at least SKU and Name. Download the template to see the expected columns.'
    );
  }

  const rows: SheetRow[] = [];
  for (let i = headerIndex + 1; i < grid.length; i += 1) {
    const cells = grid[i]!;
    // A blank line in the middle of a spreadsheet is a blank line, not a
    // product. It is skipped rather than reported as a broken row.
    if (cells.every((cell) => cell.trim() === '')) continue;

    const values: Partial<Record<SheetField, string>> = {};
    columns.forEach((field, column) => {
      if (field === null) return;
      const value = (cells[column] ?? '').trim();
      if (value !== '') values[field] = value;
    });
    // The row number as the operator sees it in Excel: one-based, header
    // included, counted from the top of the actual file.
    rows.push({ rowNo: i + 1, values });
  }

  return { format, present, rows, ignored, unknown };
}

// --------------------------------------------------------------------- xlsx

async function readWorkbook(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS types this as a Node Buffer in one version and a DOM
    // ArrayBuffer in another; the value passed is a real Buffer either way.
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new SheetError('That Excel file could not be opened. Re-save it as .xlsx or .csv.');
  }

  const sheet = workbook.worksheets[0];
  if (sheet === undefined) throw new SheetError('That workbook has no sheets in it.');

  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    // `row.cellCount` ignores trailing empties, which is what we want.
    for (let c = 1; c <= Math.max(row.cellCount, 1); c += 1) {
      cells.push(cellText(row.getCell(c).value));
    }
    grid[rowNumber - 1] = cells;
  });
  // eachRow can leave holes if the sheet does.
  for (let i = 0; i < grid.length; i += 1) grid[i] ??= [];
  return grid;
}

/** Every shape an ExcelJS cell value can take, flattened to text. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // A formula cell: use what the formula produced, never the formula.
    if ('result' in record) return cellText(record.result);
    if ('text' in record && typeof record.text === 'string') return record.text;
    if ('richText' in record && Array.isArray(record.richText)) {
      return record.richText.map((part) => cellText((part as { text?: unknown }).text)).join('');
    }
    if ('hyperlink' in record && typeof record.text === 'string') return record.text;
  }
  return '';
}

// ---------------------------------------------------------------------- csv

/**
 * A small RFC 4180 reader: quoted fields, escaped quotes inside them, commas
 * and newlines inside quotes, CRLF or LF line endings, and a UTF-8 BOM.
 *
 * Written here rather than taken as a dependency because it is forty lines
 * and the alternative is another package in a government deployment.
 */
export function readCsv(buffer: Buffer): string[][] {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ------------------------------------------------------------ value reading

/**
 * `₹ 1,250.50` and `Rs 1250.50` are prices; `12 kg` and `abc` are not.
 *
 * Currency marks, thousands separators and spaces are removed; what is left
 * must be a plain number or the value is refused. Half-reading `12abc` as 12
 * would turn a typo into a price.
 */
export function readNumber(raw: string): number | null {
  const cleaned = raw.replace(/₹|rs\.?|,|\s/gi, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Yes / Y / true / 1 and their opposites. Anything else is undecided. */
export function readBoolean(raw: string): boolean | null {
  const text = raw.trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'available', 'active'].includes(text)) return true;
  if (['no', 'n', 'false', '0', 'unavailable', 'inactive'].includes(text)) return false;
  return null;
}

/** The headings the template writes, in the order it writes them. */
export const TEMPLATE_HEADINGS: ReadonlyArray<{ heading: string; note: string }> = [
  { heading: 'SKU', note: 'Required. The code your billing software uses. Must be unique.' },
  { heading: 'Name', note: 'Required. What the shopper sees, e.g. “Toor Dal 1 kg”.' },
  { heading: 'Brand', note: 'Optional.' },
  { heading: 'Description', note: 'Optional. One or two lines.' },
  { heading: 'Category', note: 'Must already exist in the portal, spelled the same way.' },
  { heading: 'Subcategory', note: 'Optional. Must already exist under that category.' },
  { heading: 'Unit', note: 'Required. kg, g, litre, ml, piece, packet…' },
  { heading: 'Pack Size', note: 'Optional number, e.g. 1 for a 1 kg pack.' },
  { heading: 'Pack Unit', note: 'Optional, e.g. kg.' },
  { heading: 'Selling Price', note: 'Required. Rupees and paise, e.g. 125.50.' },
  { heading: 'Purchase Price', note: 'Optional. Never shown to shoppers.' },
  { heading: 'GST %', note: 'Must match a tax rate configured in the portal, e.g. 5 or 18.' },
  { heading: 'Discount %', note: 'Optional, 0–100.' },
  { heading: 'Min Order Qty', note: 'Optional, default 1.' },
  { heading: 'Max Order Qty', note: 'Optional. Blank means no limit.' },
  { heading: 'Qty Step', note: 'Optional, default 1.' },
  { heading: 'Barcode', note: 'Optional. Must be unique if given.' },
  { heading: 'Variant Group', note: 'Optional. Same text on the 500 g and 1 kg packs of one item.' },
  { heading: 'Variant Label', note: 'Optional, e.g. “1 kg”.' },
  { heading: 'Available', note: 'Yes or No. Can it be ordered today? Default Yes.' },
  { heading: 'Active', note: 'Yes or No. Is it listed at all? Default Yes.' },
];
