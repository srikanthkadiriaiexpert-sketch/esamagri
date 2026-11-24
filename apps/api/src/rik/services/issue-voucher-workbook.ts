import ExcelJS from 'exceljs';

/**
 * The RIK issue-voucher workbook (PHASE C).
 *
 * PURE. Rows in, a Buffer out. No Nest, no database, no HTTP, no clock —
 * so every rule below is testable by reading the workbook back, which is
 * what the spec beside this file does. The same reasoning that put
 * `buildVoucherFilterClause` and `summaryView` in files of their own.
 *
 * NOTHING HERE IS CALCULATED FROM SCRATCH. Quantities arrive already
 * replayed from each selection's frozen `rule_snapshot`; this file groups,
 * sorts and writes them. It owns no entitlement rule and no fulfilment
 * rule, and it cannot: it never sees a pool scale, a conversion or an
 * outcome.
 *
 * TWO RULES THE APPROVED SCOPE FIXED, AND WHY EACH IS LOAD-BEARING
 *
 * 1. QUANTITIES ARE NEVER COMBINED ACROSS UNITS. Grams, millilitres and
 *    pieces do not add up, and a column that added them would be a number
 *    nobody could act on. Every total in Provision Summary is a total for
 *    ONE provision in ONE unit — the aggregation key carries the unit, so
 *    merging across units is not prevented by care, it is unrepresentable.
 *    Delivery Summary therefore reports a LINE COUNT, not a quantity.
 *
 * 2. QUANTITIES ARE NEVER ROUNDED INTO PACKS. `Total quantity` and
 *    `Configured pack size` are separate columns and no column divides one
 *    by the other, because whether a part pack rounds up, down or is
 *    reported as a fraction is a business rule this phase was not given.
 *    The store decides, in front of the figures.
 *
 * DATES ARE WRITTEN AS THE SERVER'S OWN ISO TEXT, deliberately. Writing a
 * real date cell would make Excel apply the reader's locale and timezone
 * to a timestamp that is already unambiguous, and a ration issued at
 * 00:30 would shift a day for a reader in another zone. ISO text sorts
 * correctly and means one thing everywhere.
 */

export type RationType = 'FRESH' | 'DRY';
export type FulfillmentMode = 'PICKUP' | 'DELIVERY';

/** One row of the register: a voucher, with no provision detail. */
export interface RegisterRow {
  voucherNumber: string;
  selectionReference: string | null;
  rikId: string;
  officerName: string;
  mobileNumber: string;
  rationType: RationType;
  fulfillmentMode: FulfillmentMode;
  pickupLocationName: string | null;
  deliveryAddress: string | null;
  status: string;
  statusLabel: string;
  periodName: string;
  issueDate: string | null;
  createdAt: string;
}

/**
 * One provision on one voucher, as that voucher's frozen snapshot records
 * it. `destination` is the pickup location or the delivery address
 * according to the voucher's own mode — one column, because a sheet is
 * already restricted to one lane.
 */
export interface LineRow {
  voucherNumber: string;
  rikId: string;
  officerName: string;
  mobileNumber: string;
  destination: string;
  periodName: string;
  rationType: RationType;
  fulfillmentMode: FulfillmentMode;
  poolCode: string;
  poolName: string;
  provisionId: string;
  provisionCode: string;
  provisionName: string;
  brand: string | null;
  quantity: number;
  unit: string;
  packSize: number | null;
  packUnit: string | null;
  status: string;
  statusLabel: string;
}

export interface ProvisionSummaryRow {
  rationType: RationType;
  poolCode: string;
  poolName: string;
  provisionCode: string;
  provisionName: string;
  brand: string | null;
  unit: string;
  packSize: number | null;
  packUnit: string | null;
  deliveryQuantity: number;
  pickupQuantity: number;
  totalQuantity: number;
  voucherCount: number;
}

export interface DeliverySummaryRow {
  voucherNumber: string;
  rikId: string;
  officerName: string;
  mobileNumber: string;
  deliveryAddress: string;
  periodName: string;
  rationType: RationType;
  statusLabel: string;
  provisionLines: number;
}

export interface WorkbookInput {
  register: readonly RegisterRow[];
  lines: readonly LineRow[];
  /** Echoed into each sheet's caption so a printed file says what it covers. */
  filterSummary: string;
  generatedAt: string;
}

export const SHEET_NAMES = [
  'Voucher Register',
  'Home Delivery',
  'Store Pickup',
  'Provision Summary',
  'Delivery Summary',
] as const;

/**
 * Consolidates lines by provision.
 *
 * THE KEY CARRIES THE UNIT, THE PACK SIZE AND THE PACK UNIT, not just the
 * provision id. Vouchers in one export can span months, and each replays
 * the configuration frozen at ITS confirmation — so the same provision can
 * legitimately appear with a pack size that was changed between periods.
 * Keying on the provision alone would silently merge those into one row
 * carrying whichever pack size happened to be seen first. They stay
 * separate rows, which is the truthful answer even though it is the less
 * tidy one.
 */
export function summariseProvisions(lines: readonly LineRow[]): ProvisionSummaryRow[] {
  const groups = new Map<string, ProvisionSummaryRow & { vouchers: Set<string> }>();

  for (const line of lines) {
    const key = [
      line.rationType,
      line.provisionId,
      line.unit,
      line.packSize === null ? '' : String(line.packSize),
      line.packUnit ?? '',
    ].join('|');

    let group = groups.get(key);
    if (group === undefined) {
      group = {
        rationType: line.rationType,
        poolCode: line.poolCode,
        poolName: line.poolName,
        provisionCode: line.provisionCode,
        provisionName: line.provisionName,
        brand: line.brand,
        unit: line.unit,
        packSize: line.packSize,
        packUnit: line.packUnit,
        deliveryQuantity: 0,
        pickupQuantity: 0,
        totalQuantity: 0,
        voucherCount: 0,
        vouchers: new Set<string>(),
      };
      groups.set(key, group);
    }

    if (line.fulfillmentMode === 'DELIVERY') group.deliveryQuantity += line.quantity;
    else group.pickupQuantity += line.quantity;
    group.totalQuantity += line.quantity;
    group.vouchers.add(line.voucherNumber);
  }

  return [...groups.values()]
    .map(({ vouchers, ...row }) => ({ ...row, voucherCount: vouchers.size }))
    .sort(
      (a, b) =>
        a.rationType.localeCompare(b.rationType) ||
        a.poolCode.localeCompare(b.poolCode) ||
        a.provisionCode.localeCompare(b.provisionCode) ||
        a.unit.localeCompare(b.unit)
    );
}

/**
 * One row per DELIVERY voucher: who, where, and HOW MANY LINES.
 *
 * A line count rather than a quantity, for rule 1 above — the provisions on
 * one voucher are in different units, so there is no single number to put
 * here. The driver counts items against Home Delivery; this sheet is the
 * manifest they tick off and sign.
 */
export function summariseDeliveries(
  register: readonly RegisterRow[],
  lines: readonly LineRow[]
): DeliverySummaryRow[] {
  const lineCounts = new Map<string, number>();
  for (const line of lines) {
    if (line.fulfillmentMode !== 'DELIVERY') continue;
    lineCounts.set(line.voucherNumber, (lineCounts.get(line.voucherNumber) ?? 0) + 1);
  }

  return register
    .filter((v) => v.fulfillmentMode === 'DELIVERY')
    .map((v) => ({
      voucherNumber: v.voucherNumber,
      rikId: v.rikId,
      officerName: v.officerName,
      mobileNumber: v.mobileNumber,
      // A delivery voucher always carries an address — the voucher endpoint
      // refuses to create one without it (FULFILLMENT_MISSING). The fallback
      // is here so a corrupted row reads as a stated absence rather than as
      // the word "null" on a driver's manifest.
      deliveryAddress: v.deliveryAddress ?? 'No address recorded',
      periodName: v.periodName,
      rationType: v.rationType,
      statusLabel: v.statusLabel,
      provisionLines: lineCounts.get(v.voucherNumber) ?? 0,
    }))
    .sort((a, b) => a.deliveryAddress.localeCompare(b.deliveryAddress) || a.voucherNumber.localeCompare(b.voucherNumber));
}

interface Column {
  header: string;
  width: number;
}

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  caption: string,
  columns: readonly Column[],
  rows: readonly unknown[][]
): void {
  const sheet = workbook.addWorksheet(name);

  // Row 1 is a caption naming the filter this file was produced under, so a
  // printed sheet on a counter cannot be mistaken for a different day's.
  sheet.addRow([caption]);
  sheet.getRow(1).font = { italic: true, size: 9 };

  const header = sheet.addRow(columns.map((c) => c.header));
  header.font = { bold: true };
  sheet.columns = columns.map((c) => ({ width: c.width }));

  for (const row of rows) sheet.addRow(row);

  // Freeze the caption and the header so a long sheet stays readable.
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
  sheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2 + rows.length, column: columns.length },
  };
}

const REGISTER_COLUMNS: readonly Column[] = [
  { header: 'Voucher number', width: 18 },
  { header: 'Selection reference', width: 18 },
  { header: 'RIK ID', width: 12 },
  { header: 'Officer name', width: 26 },
  { header: 'Mobile number', width: 15 },
  { header: 'Ration type', width: 12 },
  { header: 'Fulfilment mode', width: 15 },
  { header: 'Pickup location', width: 24 },
  { header: 'Delivery address', width: 34 },
  { header: 'Status', width: 18 },
  { header: 'Status code', width: 20 },
  { header: 'Issue period', width: 18 },
  { header: 'Issue date', width: 26 },
  { header: 'Created at', width: 26 },
];

const LINE_COLUMNS: readonly Column[] = [
  { header: 'Voucher number', width: 18 },
  { header: 'RIK ID', width: 12 },
  { header: 'Officer name', width: 26 },
  { header: 'Mobile number', width: 15 },
  { header: 'Destination', width: 34 },
  { header: 'Issue period', width: 18 },
  { header: 'Ration type', width: 12 },
  { header: 'Pool', width: 18 },
  { header: 'Provision code', width: 16 },
  { header: 'Provision', width: 26 },
  { header: 'Brand', width: 18 },
  { header: 'Quantity', width: 12 },
  { header: 'Unit', width: 10 },
  { header: 'Configured pack size', width: 20 },
  { header: 'Pack unit', width: 12 },
  { header: 'Status', width: 18 },
];

function lineValues(line: LineRow): unknown[] {
  return [
    line.voucherNumber,
    line.rikId,
    line.officerName,
    line.mobileNumber,
    line.destination,
    line.periodName,
    line.rationType,
    line.poolName,
    line.provisionCode,
    line.provisionName,
    line.brand ?? '',
    line.quantity,
    line.unit,
    line.packSize,
    line.packUnit ?? '',
    line.statusLabel,
  ];
}

/**
 * The five sheets, always all five, always in this order.
 *
 * A LANE WITH NO ROWS STILL GETS ITS SHEET, with its caption and its
 * headers. An export where Store Pickup is empty is a real answer — nobody
 * is collecting this week — and it must not look like a file that failed
 * to produce a sheet.
 */
export async function buildVoucherWorkbook(input: WorkbookInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'e-Samagri Admin Portal';
  workbook.created = new Date(input.generatedAt);

  const caption = `${input.filterSummary} · generated ${input.generatedAt}`;

  addSheet(
    workbook,
    SHEET_NAMES[0],
    caption,
    REGISTER_COLUMNS,
    input.register.map((v) => [
      v.voucherNumber,
      v.selectionReference ?? '',
      v.rikId,
      v.officerName,
      v.mobileNumber,
      v.rationType,
      v.fulfillmentMode,
      // Exactly one of these is set per voucher, by the server, according to
      // the mode. Both columns always exist so the sheet has one stable
      // shape whatever the mix.
      v.pickupLocationName ?? '',
      v.deliveryAddress ?? '',
      v.statusLabel,
      v.status,
      v.periodName,
      v.issueDate ?? '',
      v.createdAt,
    ])
  );

  const delivery = input.lines.filter((l) => l.fulfillmentMode === 'DELIVERY');
  const pickup = input.lines.filter((l) => l.fulfillmentMode === 'PICKUP');

  addSheet(workbook, SHEET_NAMES[1], caption, LINE_COLUMNS, delivery.map(lineValues));
  addSheet(workbook, SHEET_NAMES[2], caption, LINE_COLUMNS, pickup.map(lineValues));

  addSheet(
    workbook,
    SHEET_NAMES[3],
    // Said on the sheet itself, not only in a code comment: the person
    // reading the totals is the person who must not divide them.
    `${caption} · quantities are per provision and per unit; packs are NOT calculated`,
    [
      { header: 'Ration type', width: 12 },
      { header: 'Pool', width: 18 },
      { header: 'Provision code', width: 16 },
      { header: 'Provision', width: 26 },
      { header: 'Brand', width: 18 },
      { header: 'Unit', width: 10 },
      { header: 'Home delivery quantity', width: 22 },
      { header: 'Store pickup quantity', width: 22 },
      { header: 'Total quantity', width: 16 },
      { header: 'Configured pack size', width: 20 },
      { header: 'Pack unit', width: 12 },
      { header: 'Vouchers', width: 12 },
    ],
    summariseProvisions(input.lines).map((r) => [
      r.rationType,
      r.poolName,
      r.provisionCode,
      r.provisionName,
      r.brand ?? '',
      r.unit,
      r.deliveryQuantity,
      r.pickupQuantity,
      r.totalQuantity,
      r.packSize,
      r.packUnit ?? '',
      r.voucherCount,
    ])
  );

  addSheet(
    workbook,
    SHEET_NAMES[4],
    caption,
    [
      { header: 'Voucher number', width: 18 },
      { header: 'RIK ID', width: 12 },
      { header: 'Officer name', width: 26 },
      { header: 'Mobile number', width: 15 },
      { header: 'Delivery address', width: 40 },
      { header: 'Issue period', width: 18 },
      { header: 'Ration type', width: 12 },
      { header: 'Status', width: 18 },
      { header: 'Provision lines', width: 15 },
      { header: 'Handed over (signature)', width: 26 },
      { header: 'Remarks', width: 30 },
    ],
    summariseDeliveries(input.register, input.lines).map((r) => [
      r.voucherNumber,
      r.rikId,
      r.officerName,
      r.mobileNumber,
      r.deliveryAddress,
      r.periodName,
      r.rationType,
      r.statusLabel,
      r.provisionLines,
      // Two blank columns, on purpose: this sheet is printed and signed on
      // the round. They are not data and are never filled in by the server.
      '',
      '',
    ])
  );

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
