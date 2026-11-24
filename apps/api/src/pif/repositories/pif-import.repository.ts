import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * The stored bulk-product-import batch (LAUNCH PREPARATION).
 *
 * An import is deliberately a RECORD, not a side effect: the file is parsed
 * and judged, the judgement is stored, the operator reads it, and only then
 * is anything written to the catalogue. This repository stores and reads
 * that record. It contains no catalogue rules — those live in
 * PifCatalogueService and are called from PifImportService, so the import
 * cannot become a second, laxer way into the catalogue.
 *
 * NO DELETE anywhere in this file, because the application holds no DELETE
 * on either table (migration 0051). An import that went wrong is exactly
 * the record someone will want to read afterwards.
 */

export type ImportBatchStatus = 'PREVIEW' | 'APPLIED' | 'DISCARDED' | 'FAILED';
export type ImportRowVerdict = 'CREATE' | 'UPDATE' | 'INVALID';

export interface ImportBatchRecord {
  id: string;
  source_filename: string;
  source_format: 'XLSX' | 'CSV';
  byte_size: number;
  status: ImportBatchStatus;
  total_rows: number;
  create_rows: number;
  update_rows: number;
  invalid_rows: number;
  applied_rows: number;
  failure_reason: string | null;
  uploaded_by: string;
  uploaded_by_name: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
}

export interface ImportRowRecord {
  id: string;
  batch_id: string;
  row_no: number;
  verdict: ImportRowVerdict;
  sku: string | null;
  name: string | null;
  target_product_id: string | null;
  parsed: Record<string, unknown>;
  problems: string[];
  applied_at: string | null;
}

export interface ImportRowWrite {
  rowNo: number;
  verdict: ImportRowVerdict;
  sku: string | null;
  name: string | null;
  targetProductId: string | null;
  parsed: Record<string, unknown>;
  problems: string[];
}

export interface ImportBatchWrite {
  filename: string;
  format: 'XLSX' | 'CSV';
  byteSize: number;
  totalRows: number;
  createRows: number;
  updateRows: number;
  invalidRows: number;
}

const BATCH_COLUMNS = `b.id, b.source_filename, b.source_format, b.byte_size, b.status,
        b.total_rows, b.create_rows, b.update_rows, b.invalid_rows, b.applied_rows,
        b.failure_reason, b.uploaded_by, u.display_name AS uploaded_by_name,
        b.created_at::text AS created_at, b.decided_at::text AS decided_at,
        b.decided_by, d.display_name AS decided_by_name`;

const BATCH_FROM = `FROM pif.product_import_batches b
        LEFT JOIN shared.users u ON u.id = b.uploaded_by
        LEFT JOIN shared.users d ON d.id = b.decided_by`;

@Injectable()
export class PifImportRepository {
  constructor(private readonly db: DatabaseService) {}

  async insertBatch(write: ImportBatchWrite, actorId: string): Promise<string> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO pif.product_import_batches
         (source_filename, source_format, byte_size,
          total_rows, create_rows, update_rows, invalid_rows, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        write.filename,
        write.format,
        write.byteSize,
        write.totalRows,
        write.createRows,
        write.updateRows,
        write.invalidRows,
        actorId,
      ]
    );
    return rows[0]!.id;
  }

  /**
   * All of a batch's judged rows, in one statement.
   *
   * One multi-row INSERT rather than a loop: a five-hundred-SKU file would
   * otherwise be five hundred round trips, and the rows of one batch are a
   * single fact that should land together or not at all.
   */
  async insertRows(batchId: string, rows: ImportRowWrite[]): Promise<void> {
    if (rows.length === 0) return;

    const values: string[] = [];
    const params: unknown[] = [batchId];
    for (const row of rows) {
      const base = params.length;
      values.push(
        `($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}::jsonb)`
      );
      params.push(
        row.rowNo,
        row.verdict,
        row.sku,
        row.name,
        row.targetProductId,
        JSON.stringify(row.parsed),
        JSON.stringify(row.problems)
      );
    }

    await this.db.query(
      `INSERT INTO pif.product_import_rows
         (batch_id, row_no, verdict, sku, name, target_product_id, parsed, problems)
       VALUES ${values.join(', ')}`,
      params
    );
  }

  async findBatch(id: string): Promise<ImportBatchRecord | null> {
    const rows = await this.db.query<ImportBatchRecord>(
      `SELECT ${BATCH_COLUMNS} ${BATCH_FROM} WHERE b.id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async listBatches(limit: number): Promise<ImportBatchRecord[]> {
    return this.db.query<ImportBatchRecord>(
      `SELECT ${BATCH_COLUMNS} ${BATCH_FROM} ORDER BY b.created_at DESC LIMIT $1`,
      [limit]
    );
  }

  async listRows(
    batchId: string,
    filter: { verdict?: ImportRowVerdict; limit: number; offset: number }
  ): Promise<{ items: ImportRowRecord[]; total: number }> {
    const params: unknown[] = [batchId];
    let clause = 'batch_id = $1';
    if (filter.verdict) {
      params.push(filter.verdict);
      clause += ` AND verdict = $${params.length}`;
    }
    const totals = await this.db.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM pif.product_import_rows WHERE ${clause}`,
      params
    );
    params.push(filter.limit, filter.offset);
    const items = await this.db.query<ImportRowRecord>(
      `SELECT id, batch_id, row_no, verdict, sku, name, target_product_id,
              parsed, problems, applied_at::text AS applied_at
         FROM pif.product_import_rows
        WHERE ${clause}
        ORDER BY row_no
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items, total: Number(totals[0]!.total) };
  }

  /** Every row this batch would write, in file order. */
  async applicableRows(batchId: string): Promise<ImportRowRecord[]> {
    return this.db.query<ImportRowRecord>(
      `SELECT id, batch_id, row_no, verdict, sku, name, target_product_id,
              parsed, problems, applied_at::text AS applied_at
         FROM pif.product_import_rows
        WHERE batch_id = $1 AND verdict <> 'INVALID' AND applied_at IS NULL
        ORDER BY row_no`,
      [batchId]
    );
  }

  /**
   * Claims the batch for a decision, or answers false.
   *
   * THE WHOLE POINT. `WHERE status = 'PREVIEW'` makes "apply this batch"
   * single-shot in the database rather than in the application: two
   * administrators pressing Apply at the same moment produce one claim and
   * one refusal, and a file cannot be imported twice. The same statement
   * serves DISCARDED, so discarding an already-applied batch is equally
   * impossible.
   */
  async claim(
    batchId: string,
    status: Exclude<ImportBatchStatus, 'PREVIEW'>,
    actorId: string
  ): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE pif.product_import_batches
          SET status = $2, decided_at = now(), decided_by = $3
        WHERE id = $1 AND status = 'PREVIEW'
        RETURNING id`,
      [batchId, status, actorId]
    );
    return rows.length === 1;
  }

  /**
   * One applied row, recorded the moment its product was written.
   *
   * Written per row, on purpose: if applying a large file stops part-way,
   * `applied_at` says exactly how far it got and a retry can continue rather
   * than duplicating what already landed.
   */
  async markRowApplied(rowId: string, productId: string): Promise<void> {
    await this.db.query(
      `UPDATE pif.product_import_rows
          SET applied_at = now(), target_product_id = $2
        WHERE id = $1 AND applied_at IS NULL`,
      [rowId, productId]
    );
  }

  async recordProgress(batchId: string, appliedRows: number): Promise<void> {
    await this.db.query(
      `UPDATE pif.product_import_batches SET applied_rows = $2 WHERE id = $1`,
      [batchId, appliedRows]
    );
  }

  /** Applying stopped part-way: say so, and say how far it got. */
  async recordFailure(batchId: string, appliedRows: number, reason: string): Promise<void> {
    await this.db.query(
      `UPDATE pif.product_import_batches
          SET status = 'FAILED', applied_rows = $2, failure_reason = $3
        WHERE id = $1`,
      [batchId, appliedRows, reason.slice(0, 500)]
    );
  }

  /** A batch still awaiting a decision, by the same operator and file. */
  async findOpenBatchFor(filename: string, actorId: string): Promise<ImportBatchRecord | null> {
    const rows = await this.db.query<ImportBatchRecord>(
      `SELECT ${BATCH_COLUMNS} ${BATCH_FROM}
        WHERE b.status = 'PREVIEW' AND b.uploaded_by = $2 AND b.source_filename = $1
        ORDER BY b.created_at DESC
        LIMIT 1`,
      [filename, actorId]
    );
    return rows[0] ?? null;
  }
}
