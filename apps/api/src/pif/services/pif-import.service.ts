import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ExcelJS from 'exceljs';
import type { ApiEnv } from '@esamagri/config';
import type { AuthContext } from '../../auth/auth-context';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import {
  PifCatalogueRepository,
  type CategoryRecord,
  type TaxRateRecord,
} from '../repositories/pif-catalogue.repository';
import {
  PifImportRepository,
  type ImportBatchRecord,
  type ImportRowRecord,
  type ImportRowVerdict,
  type ImportRowWrite,
} from '../repositories/pif-import.repository';
import {
  CatalogueError,
  PifCatalogueService,
  type ProductInput,
} from './pif-catalogue.service';
import {
  parseSheet,
  readBoolean,
  readNumber,
  SheetError,
  TEMPLATE_HEADINGS,
  type SheetField,
  type SheetRow,
} from './pif-import-sheet';

/**
 * Bulk product import, in two deliberate halves (LAUNCH PREPARATION).
 *
 *   PREVIEW   the uploaded file is read, every row is judged by the SAME
 *             catalogue rules the admin screen uses, and the judgement is
 *             stored. NOTHING is written to the catalogue.
 *   APPLY     the operator, having read the preview, confirms it. Only then
 *             are products created and updated — through
 *             PifCatalogueService, so every one is validated again and
 *             audited individually.
 *
 * WHY THE TWO HALVES ARE SEPARATE, in one sentence: an operator must be able
 * to see what a file would do to the live shop before it does it.
 *
 * WHAT "UPDATE" MEANS HERE, because it is the one rule that can surprise. A
 * row whose SKU already exists updates that product. Only the columns THE
 * FILE ACTUALLY HAS are changed: a file without a Brand column leaves every
 * brand alone, while a file WITH a Brand column and an empty cell clears
 * that brand. Any other rule would let a short spreadsheet quietly erase
 * half the catalogue.
 *
 * WHAT IT WILL NOT DO
 *
 *   * It will not create a category. A category named in the file that does
 *     not exist in the portal is reported, by name, and its rows are
 *     refused — otherwise one misspelling becomes a new aisle in the shop.
 *   * It will not invent a GST rate. The `GST %` figure must match a tax
 *     rate configured in the portal, which is where GST lives.
 *   * It will not import a stock quantity, a supplier or a cost of goods,
 *     and says so when it sees such a column.
 *   * It will not delete or deactivate anything. A product missing from the
 *     spreadsheet is simply not mentioned by it; withdrawing a product
 *     stays a deliberate act on the product's own screen.
 */

export type ImportErrorCode =
  | 'FILE_MISSING'
  | 'FILE_TOO_LARGE'
  | 'FILE_UNREADABLE'
  | 'TOO_MANY_ROWS'
  | 'BATCH_NOT_FOUND'
  | 'BATCH_ALREADY_DECIDED'
  | 'NOTHING_TO_APPLY';

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface PreviewSummary {
  batch: ImportBatchRecord;
  /** Categories the file names that do not exist — create these first. */
  missingCategories: string[];
  /** GST figures in the file with no configured tax rate. */
  unknownTaxRates: string[];
  /** Columns recognised but deliberately not imported, with the reason. */
  ignoredColumns: Array<{ heading: string; reason: string }>;
  /** Headings that matched nothing. */
  unknownColumns: string[];
  /** The fields this file actually provides. */
  columnsUsed: SheetField[];
}

interface JudgedRow extends ImportRowWrite {
  input: ProductInput | null;
}

@Injectable()
export class PifImportService {
  private readonly logger = new Logger('PifImport');
  private readonly maxBytes: number;
  private readonly maxRows: number;

  constructor(
    private readonly imports: PifImportRepository,
    private readonly catalogue: PifCatalogueRepository,
    private readonly catalogueService: PifCatalogueService,
    private readonly auditLog: AuditLogRepository,
    config: ConfigService<ApiEnv, true>
  ) {
    this.maxBytes = config.get('PIF_IMPORT_MAX_BYTES', { infer: true });
    this.maxRows = config.get('PIF_IMPORT_MAX_ROWS', { infer: true });
  }

  // ------------------------------------------------------------------ preview

  async preview(
    context: AuthContext,
    file: { originalname?: string; buffer?: Buffer; size?: number }
  ): Promise<PreviewSummary> {
    const buffer = file.buffer;
    if (buffer === undefined || buffer.length === 0) {
      throw new ImportError('FILE_MISSING', 'No file was uploaded.');
    }
    if (buffer.length > this.maxBytes) {
      throw new ImportError(
        'FILE_TOO_LARGE',
        `That file is ${(buffer.length / 1_000_000).toFixed(1)} MB. The limit is ${(this.maxBytes / 1_000_000).toFixed(0)} MB — split it into two files.`
      );
    }

    const filename = (file.originalname ?? 'upload').slice(0, 200);
    let sheet;
    try {
      sheet = await parseSheet(buffer, filename);
    } catch (err) {
      if (err instanceof SheetError) throw new ImportError('FILE_UNREADABLE', err.message);
      throw err;
    }

    if (sheet.rows.length === 0) {
      throw new ImportError('FILE_UNREADABLE', 'That file has column headings but no products.');
    }
    if (sheet.rows.length > this.maxRows) {
      throw new ImportError(
        'TOO_MANY_ROWS',
        `That file has ${sheet.rows.length} rows. The limit for one import is ${this.maxRows} — split it into smaller files.`
      );
    }

    // Read the reference data ONCE: the whole category tree, the tax rates,
    // and nothing else. A five-hundred-row file must not become fifteen
    // hundred lookups.
    const categories = await this.catalogue.listAdminCategories();
    const taxRates = await this.catalogue.listTaxRates(false);

    const missingCategories = new Set<string>();
    const unknownTaxRates = new Set<string>();
    const skuRows = new Map<string, number>();

    const judged: JudgedRow[] = [];
    for (const row of sheet.rows) {
      judged.push(
        await this.judge(row, sheet.present, {
          categories,
          taxRates,
          skuRows,
          missingCategories,
          unknownTaxRates,
        })
      );
    }

    const counts = {
      create: judged.filter((row) => row.verdict === 'CREATE').length,
      update: judged.filter((row) => row.verdict === 'UPDATE').length,
      invalid: judged.filter((row) => row.verdict === 'INVALID').length,
    };

    const batchId = await this.imports.insertBatch(
      {
        filename,
        format: sheet.format,
        byteSize: buffer.length,
        totalRows: judged.length,
        createRows: counts.create,
        updateRows: counts.update,
        invalidRows: counts.invalid,
      },
      context.principalId
    );
    await this.imports.insertRows(
      batchId,
      judged.map(({ input: _input, ...write }) => write)
    );

    await this.audit(context, 'PIF_PRODUCT_IMPORT_PREVIEWED', batchId, {
      filename,
      format: sheet.format,
      rows: judged.length,
      ...counts,
    });

    const batch = await this.imports.findBatch(batchId);
    return {
      batch: batch!,
      missingCategories: [...missingCategories].sort(),
      unknownTaxRates: [...unknownTaxRates].sort(),
      ignoredColumns: sheet.ignored,
      unknownColumns: sheet.unknown,
      columnsUsed: sheet.present,
    };
  }

  // -------------------------------------------------------------------- apply

  /**
   * Writes the batch's applicable rows to the catalogue.
   *
   * THE ORDER OF OPERATIONS MATTERS, and it is: claim, re-validate
   * everything, then write. Claiming first makes a double-apply impossible
   * (the claim is a compare-and-set in the database). Re-validating before
   * the first write means that a catalogue which changed between preview and
   * apply — a category deactivated, a SKU taken by someone else — stops the
   * import before it has written anything, rather than half way through.
   *
   * After that point each row is written through PifCatalogueService, so
   * every product carries its own audit entry and its own created_by /
   * updated_by, exactly as if it had been typed into the admin screen. If a
   * write still fails — the database going away mid-file — the batch is
   * marked FAILED and each row's `applied_at` says exactly how far it got,
   * so nothing is guessed about what landed.
   */
  async apply(context: AuthContext, batchId: string): Promise<ImportBatchRecord> {
    const batch = await this.requireBatch(batchId);
    if (batch.status !== 'PREVIEW') {
      throw new ImportError(
        'BATCH_ALREADY_DECIDED',
        `That import was already ${batch.status.toLowerCase()}.`,
        { status: batch.status }
      );
    }

    const rows = await this.imports.applicableRows(batchId);
    if (rows.length === 0) {
      throw new ImportError(
        'NOTHING_TO_APPLY',
        'Every row in that file has a problem, so there is nothing to apply. Fix the file and upload it again.'
      );
    }

    const claimed = await this.imports.claim(batchId, 'APPLIED', context.principalId);
    if (!claimed) {
      const current = await this.requireBatch(batchId);
      throw new ImportError(
        'BATCH_ALREADY_DECIDED',
        `That import was already ${current.status.toLowerCase()}.`,
        { status: current.status }
      );
    }

    /*
     * ONE READ for the whole batch, before the loop.
     *
     * Validation needs each target product's CURRENT category, so that a row
     * changing only a price is not mistaken for a move onto a main category
     * and refused. Reading that per row would be an N+1 over a file of up to
     * PIF_IMPORT_MAX_ROWS rows, which this module's own rule forbids: "a
     * five-hundred-row file must not become fifteen hundred lookups".
     */
    const targetIds = rows
      .filter((row) => row.verdict === 'UPDATE' && row.target_product_id !== null)
      .map((row) => row.target_product_id as string);
    const currentCategories = await this.catalogue.findProductCategories(targetIds);

    // Re-validation pass. Nothing is written in this loop.
    const plan: Array<{ row: ImportRowRecord; input: ProductInput }> = [];
    const stale: string[] = [];
    for (const row of rows) {
      const input = row.parsed.input as ProductInput | undefined;
      if (input === undefined) {
        stale.push(`Row ${row.row_no}: the stored preview is unreadable.`);
        continue;
      }
      const targetId = row.verdict === 'UPDATE' ? row.target_product_id : null;
      // Absent from the map means the product has gone since the preview. That
      // is a stale preview, not a product with no category.
      if (targetId !== null && !currentCategories.has(targetId)) {
        stale.push(
          `Row ${row.row_no} (${row.sku ?? 'no SKU'}): the product it would update no longer exists.`
        );
        continue;
      }
      try {
        await this.catalogueService.validateProduct(
          input,
          targetId,
          targetId === null ? 'unknown' : { categoryId: currentCategories.get(targetId) ?? null }
        );
        plan.push({ row, input });
      } catch (err) {
        stale.push(
          `Row ${row.row_no} (${row.sku ?? 'no SKU'}): ${err instanceof Error ? err.message : 'no longer valid.'}`
        );
      }
    }

    if (stale.length > 0) {
      const reason = `The catalogue changed since this file was previewed. ${stale.slice(0, 10).join(' ')}`;
      await this.imports.recordFailure(batchId, 0, reason);
      await this.audit(context, 'PIF_PRODUCT_IMPORT_FAILED', batchId, {
        reason: 'stale preview',
        problems: stale.slice(0, 10),
      });
      throw new ImportError('BATCH_ALREADY_DECIDED', reason, { problems: stale.slice(0, 10) });
    }

    let applied = 0;
    try {
      for (const { row, input } of plan) {
        const productId =
          row.verdict === 'UPDATE'
            ? await this.updateExisting(context, row.target_product_id!, input)
            : await this.catalogueService.createProduct(context, input);
        await this.imports.markRowApplied(row.id, productId);
        applied += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The import stopped unexpectedly.';
      await this.imports.recordFailure(batchId, applied, message);
      this.logger.error(`import ${batchId} stopped after ${applied} of ${plan.length}: ${message}`);
      await this.audit(context, 'PIF_PRODUCT_IMPORT_FAILED', batchId, {
        applied,
        of: plan.length,
      });
      throw err;
    }

    await this.imports.recordProgress(batchId, applied);
    await this.audit(context, 'PIF_PRODUCT_IMPORT_APPLIED', batchId, {
      applied,
      created: plan.filter((entry) => entry.row.verdict === 'CREATE').length,
      updated: plan.filter((entry) => entry.row.verdict === 'UPDATE').length,
    });
    return (await this.imports.findBatch(batchId))!;
  }

  async discard(context: AuthContext, batchId: string): Promise<ImportBatchRecord> {
    const batch = await this.requireBatch(batchId);
    if (batch.status !== 'PREVIEW') {
      throw new ImportError(
        'BATCH_ALREADY_DECIDED',
        `That import was already ${batch.status.toLowerCase()}.`,
        { status: batch.status }
      );
    }
    const claimed = await this.imports.claim(batchId, 'DISCARDED', context.principalId);
    if (!claimed) {
      throw new ImportError('BATCH_ALREADY_DECIDED', 'That import was already decided.');
    }
    await this.audit(context, 'PIF_PRODUCT_IMPORT_DISCARDED', batchId, {
      rows: batch.total_rows,
    });
    return (await this.imports.findBatch(batchId))!;
  }

  // --------------------------------------------------------------------- read

  async batches(limit: number): Promise<ImportBatchRecord[]> {
    return this.imports.listBatches(Math.min(Math.max(limit, 1), 100));
  }

  async batch(batchId: string): Promise<ImportBatchRecord> {
    return this.requireBatch(batchId);
  }

  async rows(
    batchId: string,
    filter: { verdict?: ImportRowVerdict; limit: number; offset: number }
  ): Promise<{ items: ImportRowRecord[]; total: number }> {
    await this.requireBatch(batchId);
    return this.imports.listRows(batchId, filter);
  }

  /**
   * The blank workbook the operator fills in.
   *
   * Two sheets: `Products`, with the exact headings the import understands
   * and two example rows, and `How to fill this in`, which explains every
   * column in words — including that categories and GST rates must already
   * exist in the portal, and that there is no stock column.
   */
  async template(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'e-Samagri';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Products');
    sheet.addRow(TEMPLATE_HEADINGS.map((column) => column.heading));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { vertical: 'middle' };
    TEMPLATE_HEADINGS.forEach((column, index) => {
      sheet.getColumn(index + 1).width = Math.max(column.heading.length + 4, 14);
    });

    sheet.addRow([
      'TD-1KG',
      'Toor Dal 1 kg',
      'Yard Fresh',
      'Unpolished toor dal, 1 kg pack',
      'Pulses',
      '',
      'kg',
      1,
      'kg',
      142.5,
      128,
      5,
      '',
      1,
      10,
      1,
      '',
      'TOOR-DAL',
      '1 kg',
      'Yes',
      'Yes',
    ]);
    sheet.addRow([
      'SG-500G',
      'Sugar 500 g',
      '',
      '',
      'Staples',
      'Sugar & Jaggery',
      'g',
      500,
      'g',
      27,
      '',
      5,
      '',
      1,
      '',
      1,
      '',
      'SUGAR',
      '500 g',
      'Yes',
      'Yes',
    ]);
    sheet.getRow(1).commit();

    const notes = workbook.addWorksheet('How to fill this in');
    notes.columns = [
      { header: 'Column', key: 'column', width: 20 },
      { header: 'What to put in it', key: 'note', width: 90 },
    ];
    notes.getRow(1).font = { bold: true };
    for (const column of TEMPLATE_HEADINGS) {
      notes.addRow({ column: column.heading, note: column.note });
    }
    notes.addRow({});
    notes.addRow({
      column: 'Existing SKUs',
      note: 'A row whose SKU already exists UPDATES that product. Only the columns present in your file are changed.',
    });
    notes.addRow({
      column: 'Categories',
      note: 'Create your categories and subcategories in the portal first, then use exactly those names here.',
    });
    notes.addRow({
      column: 'GST %',
      note: 'Must match a tax rate configured in the portal (Catalogue → Tax rates). An unmatched figure is refused.',
    });
    notes.addRow({
      column: 'Stock',
      note: 'There is no stock column. e-Samagri does not count stock: “Available = No” is how you take something off sale for the day.',
    });
    notes.addRow({
      column: 'Images',
      note: 'Photographs are uploaded on each product’s own screen, not in this file.',
    });
    notes.addRow({
      column: 'Nothing is deleted',
      note: 'An import only creates and updates. A product you leave out of the file is left exactly as it is.',
    });

    const out = await workbook.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
  }

  // ------------------------------------------------------------------ judging

  private async judge(
    row: SheetRow,
    present: SheetField[],
    refs: {
      categories: CategoryRecord[];
      taxRates: TaxRateRecord[];
      skuRows: Map<string, number>;
      missingCategories: Set<string>;
      unknownTaxRates: Set<string>;
    }
  ): Promise<JudgedRow> {
    const problems: string[] = [];
    const value = (field: SheetField): string | undefined => row.values[field];

    const sku = (value('sku') ?? '').trim().toUpperCase();
    const name = (value('name') ?? '').trim();

    if (sku === '') problems.push('No SKU. Every product needs one.');
    if (name === '') problems.push('No name. Every product needs one.');

    // A SKU twice in one file: the first occurrence is kept, the second is
    // refused, naming the row that already used it. Applying both would make
    // the result depend on which row happened to be written last.
    let duplicateOf: number | null = null;
    if (sku !== '') {
      const seen = refs.skuRows.get(sku);
      if (seen !== undefined) duplicateOf = seen;
      else refs.skuRows.set(sku, row.rowNo);
    }
    if (duplicateOf !== null) {
      problems.push(`SKU ${sku} is already used by row ${duplicateOf} of this file.`);
    }

    const existing = sku === '' ? null : await this.catalogue.findProductBySku(sku);

    // --- category -------------------------------------------------------
    let categoryId: string | null | undefined;
    const categoryName = value('category');
    const subcategoryName = value('subcategory');
    if (categoryName !== undefined || subcategoryName !== undefined) {
      const resolved = resolveCategory(refs.categories, categoryName, subcategoryName);
      if (resolved.id === null) {
        problems.push(resolved.problem!);
        for (const missing of resolved.missing) refs.missingCategories.add(missing);
      }
      categoryId = resolved.id;
    }

    // --- tax rate -------------------------------------------------------
    let taxRateId: string | null | undefined;
    const gst = value('gstPct');
    if (gst !== undefined) {
      const pct = readNumber(gst);
      if (pct === null) {
        problems.push(`“${gst}” is not a GST percentage.`);
      } else {
        const rate = refs.taxRates.find(
          (candidate) => Number(candidate.rate_pct) === pct && candidate.active
        );
        if (rate === undefined) {
          problems.push(
            `No active tax rate of ${pct}% is configured. Add it under Tax rates, or correct the file.`
          );
          refs.unknownTaxRates.add(`${pct}`);
        } else {
          taxRateId = rate.id;
        }
      }
    }

    // --- numbers --------------------------------------------------------
    const number = (field: SheetField, label: string): number | null | undefined => {
      const raw = value(field);
      if (raw === undefined) return undefined;
      const parsed = readNumber(raw);
      if (parsed === null) {
        problems.push(`“${raw}” is not a number for ${label}.`);
        return null;
      }
      return parsed;
    };

    const sellingPrice = number('sellingPrice', 'the selling price');
    const purchasePrice = number('purchasePrice', 'the purchase price');
    const discountPct = number('discountPct', 'the discount');
    const packSize = number('packSize', 'the pack size');
    const minOrderQty = number('minOrderQty', 'the minimum order quantity');
    const maxOrderQty = number('maxOrderQty', 'the maximum order quantity');
    const qtyStep = number('qtyStep', 'the quantity step');

    const flag = (field: SheetField, label: string): boolean | undefined => {
      const raw = value(field);
      if (raw === undefined) return undefined;
      const parsed = readBoolean(raw);
      if (parsed === null) {
        problems.push(`“${raw}” is not Yes or No for ${label}.`);
        return undefined;
      }
      return parsed;
    };

    const available = flag('available', 'Available');
    const active = flag('active', 'Active');

    // --- the input, built on the existing product for an update ---------
    //
    // `provides` is the heart of the update rule: a field is only changed if
    // the FILE HAS THAT COLUMN. Everything else keeps the product's current
    // value, so a three-column price-update file changes three things.
    const provides = (field: SheetField): boolean => present.includes(field);
    const base: ProductInput | null =
      existing === null
        ? null
        : {
            sku: existing.sku,
            name: existing.name,
            barcode: existing.barcode,
            brand: existing.brand,
            description: existing.description,
            categoryId: existing.category_id,
            unit: existing.unit,
            packSize: existing.pack_size === null ? null : Number(existing.pack_size),
            packUnit: existing.pack_unit,
            sellingPrice: Number(existing.selling_price),
            purchasePrice:
              existing.purchase_price === null ? null : Number(existing.purchase_price),
            taxRateId: existing.tax_rate_id,
            discountPct: existing.discount_pct === null ? null : Number(existing.discount_pct),
            minOrderQty: Number(existing.min_order_qty),
            maxOrderQty: existing.max_order_qty === null ? null : Number(existing.max_order_qty),
            qtyStep: Number(existing.qty_step),
            active: existing.active,
            available: existing.available,
            variantGroup: existing.variant_group,
            variantLabel: existing.variant_label,
          };

    if (base === null) {
      if (!provides('unit') || (value('unit') ?? '') === '') {
        problems.push('No unit. Say kg, g, litre, ml, piece or packet.');
      }
      if (sellingPrice === undefined) {
        problems.push('No selling price.');
      }
    }

    const input: ProductInput = {
      sku: sku === '' ? (base?.sku ?? '') : sku,
      name: name === '' ? (base?.name ?? '') : name,
      unit: provides('unit') ? (value('unit') ?? '') : (base?.unit ?? ''),
      sellingPrice: sellingPrice ?? base?.sellingPrice ?? 0,
      barcode: provides('barcode') ? (value('barcode') ?? null) : (base?.barcode ?? null),
      brand: provides('brand') ? (value('brand') ?? null) : (base?.brand ?? null),
      description: provides('description')
        ? (value('description') ?? null)
        : (base?.description ?? null),
      categoryId: categoryId === undefined ? (base?.categoryId ?? null) : categoryId,
      packSize: packSize === undefined ? (base?.packSize ?? null) : packSize,
      packUnit: provides('packUnit') ? (value('packUnit') ?? null) : (base?.packUnit ?? null),
      purchasePrice: purchasePrice === undefined ? (base?.purchasePrice ?? null) : purchasePrice,
      taxRateId: taxRateId === undefined ? (base?.taxRateId ?? null) : taxRateId,
      discountPct: discountPct === undefined ? (base?.discountPct ?? null) : discountPct,
      minOrderQty: minOrderQty ?? base?.minOrderQty ?? 1,
      maxOrderQty: maxOrderQty === undefined ? (base?.maxOrderQty ?? null) : maxOrderQty,
      qtyStep: qtyStep ?? base?.qtyStep ?? 1,
      active: active ?? base?.active ?? true,
      available: available ?? base?.available ?? true,
      variantGroup: provides('variantGroup')
        ? (value('variantGroup') ?? null)
        : (base?.variantGroup ?? null),
      variantLabel: provides('variantLabel')
        ? (value('variantLabel') ?? null)
        : (base?.variantLabel ?? null),
    };

    // The catalogue's own rules, last, and only if the row is otherwise
    // coherent — reporting "price must be in rupees and paise" on a row that
    // has no SKU would bury the problem that matters.
    if (problems.length === 0) {
      try {
        // `existing` is the product this row would update, already read above —
        // so its current category costs no extra query. Passing it is what
        // keeps a price-only row on a legacy main-category product acceptable.
        await this.catalogueService.validateProduct(
          input,
          existing?.id ?? null,
          existing === null ? 'unknown' : { categoryId: existing.category_id }
        );
      } catch (err) {
        if (err instanceof CatalogueError) problems.push(err.message);
        else throw err;
      }
    }

    const verdict: ImportRowVerdict =
      problems.length > 0 ? 'INVALID' : existing === null ? 'CREATE' : 'UPDATE';

    return {
      rowNo: row.rowNo,
      verdict,
      sku: sku === '' ? null : sku,
      name: name === '' ? null : name,
      targetProductId: verdict === 'UPDATE' ? existing!.id : null,
      parsed: { input, raw: row.values },
      problems,
      input: verdict === 'INVALID' ? null : input,
    };
  }

  /** An update keeps the product's identity; only its fields change. */
  private async updateExisting(
    context: AuthContext,
    productId: string,
    input: ProductInput
  ): Promise<string> {
    await this.catalogueService.updateProduct(context, productId, input);
    return productId;
  }

  private async requireBatch(batchId: string): Promise<ImportBatchRecord> {
    const batch = await this.imports.findBatch(batchId);
    if (batch === null) {
      throw new ImportError('BATCH_NOT_FOUND', 'That import does not exist.');
    }
    return batch;
  }

  private async audit(
    context: AuthContext,
    action: string,
    batchId: string,
    after: Record<string, unknown>
  ): Promise<void> {
    await this.auditLog.logEvent({
      actorId: context.principalId,
      actorRole: [...context.roles].sort().join(',') || 'STAFF',
      module: 'pif',
      action,
      entityType: 'pif.product_import',
      entityId: batchId,
      after,
    });
  }
}

/**
 * A category named in words, resolved to the one row it can mean.
 *
 * The file may name a top-level category, a subcategory under it, or only a
 * subcategory. A name that matches nothing is reported BY NAME, because the
 * operator's next action is to go and create it — or to fix a spelling.
 */
function resolveCategory(
  categories: CategoryRecord[],
  categoryName: string | undefined,
  subcategoryName: string | undefined
): { id: string | null; problem?: string; missing: string[] } {
  const byName = (name: string, parentId: string | null | undefined): CategoryRecord | undefined =>
    categories.find(
      (candidate) =>
        candidate.name.trim().toLowerCase() === name.trim().toLowerCase() &&
        (parentId === undefined || candidate.parent_id === parentId)
    );

  if (categoryName !== undefined && categoryName.trim() !== '') {
    const parent = byName(categoryName, null);
    if (parent === undefined) {
      return {
        id: null,
        problem: `There is no category called “${categoryName}”. Create it in the portal first, or correct the spelling.`,
        missing: [categoryName.trim()],
      };
    }
    if (subcategoryName === undefined || subcategoryName.trim() === '') {
      return { id: parent.id, missing: [] };
    }
    const child = byName(subcategoryName, parent.id);
    if (child === undefined) {
      return {
        id: null,
        problem: `There is no subcategory called “${subcategoryName}” under “${parent.name}”.`,
        missing: [`${parent.name} › ${subcategoryName.trim()}`],
      };
    }
    return { id: child.id, missing: [] };
  }

  if (subcategoryName !== undefined && subcategoryName.trim() !== '') {
    const matches = categories.filter(
      (candidate) =>
        candidate.name.trim().toLowerCase() === subcategoryName.trim().toLowerCase() &&
        candidate.parent_id !== null
    );
    if (matches.length === 1) return { id: matches[0]!.id, missing: [] };
    if (matches.length === 0) {
      return {
        id: null,
        problem: `There is no subcategory called “${subcategoryName}”.`,
        missing: [subcategoryName.trim()],
      };
    }
    return {
      id: null,
      problem: `“${subcategoryName}” is the name of ${matches.length} subcategories. Add a Category column to say which one.`,
      missing: [],
    };
  }

  return { id: null, missing: [] };
}
