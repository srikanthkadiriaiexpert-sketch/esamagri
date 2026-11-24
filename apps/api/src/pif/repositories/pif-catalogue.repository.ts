import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';

/**
 * The PIF grocery catalogue — categories, subcategories and products
 * (PHASE F).
 *
 * TWO READS, DELIBERATELY DIFFERENT, the same split the RIK repositories
 * use and for the same reason:
 *
 *   `listPublic*`  what a CUSTOMER may see — active, not deleted. An
 *                  unavailable product is still listed (so the shopper
 *                  learns it exists and is out today) but it is marked, and
 *                  the order path refuses it.
 *   `listAdmin*`   what an ADMINISTRATOR must see — everything, including
 *                  what has been deactivated, because reading the row they
 *                  just switched off is part of the job.
 *
 * Mixing them is how a deactivated product reappears in front of a shopper.
 *
 * NO PRICE ARITHMETIC HAPPENS HERE. This repository stores and returns rows.
 * What a line costs is PifPricingService's, computed from these rows.
 *
 * NO STOCK. There is no quantity on hand in PIF, and no column for one.
 * `active` says the product exists; `available` says it can be ordered
 * today; `max_order_qty` caps a single order. All three are administrator
 * decisions, never a counted balance.
 */

export interface CategoryRecord {
  id: string;
  name: string;
  parent_id: string | null;
  parent_name: string | null;
  description: string | null;
  image_ref: string | null;
  sort_order: number;
  active: boolean;
  /** 'grocers' | 'fresh-mart', or NULL on a pre-business row from 0019/demo-catalogue. */
  business_slug: string | null;
  /**
   * The stable navigation key migration 0061 added and 0062 populated from
   * apps/customer-web/src/lib/businesses/category-tree.ts -- the same slugs
   * the customer app's URLs are built from. NULL on the 14 pre-business rows,
   * which never had one.
   *
   * It exists so a shop screen can turn a URL slug into THIS ROW'S ID without
   * matching on name. Name matching would be wrong here and this project has
   * already been bitten by it twice: "Rice" is both an approved Grocers shelf
   * and a demo subcategory of "Staples", and "Beverages" is both an approved
   * Grocers main and a demo main.
   */
  slug: string | null;
  product_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProductRecord {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  parent_category_id: string | null;
  parent_category_name: string | null;
  unit: string;
  pack_size: string | null;
  pack_unit: string | null;
  selling_price: string;
  purchase_price: string | null;
  tax_rate_id: string | null;
  tax_rate_name: string | null;
  tax_rate_pct: string | null;
  discount_pct: string | null;
  image_ref: string | null;
  min_order_qty: string;
  max_order_qty: string | null;
  qty_step: string;
  active: boolean;
  available: boolean;
  variant_group: string | null;
  variant_label: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface TaxRateRecord {
  id: string;
  name: string;
  rate_pct: string;
  active: boolean;
}

export interface ProductWrite {
  sku: string;
  name: string;
  barcode: string | null;
  brand: string | null;
  description: string | null;
  categoryId: string | null;
  unit: string;
  packSize: number | null;
  packUnit: string | null;
  sellingPrice: number;
  purchasePrice: number | null;
  taxRateId: string | null;
  discountPct: number | null;
  minOrderQty: number;
  maxOrderQty: number | null;
  qtyStep: number;
  active: boolean;
  available: boolean;
  variantGroup: string | null;
  variantLabel: string | null;
}

export interface CategoryWrite {
  name: string;
  parentId: string | null;
  description: string | null;
  sortOrder: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// CATEGORY SOFT DELETION  (migration 0063).
//
// pif.categories.deleted_at means exactly what pif.products.deleted_at has
// meant since migration 0011: NULL is "not deleted". It is NOT `active`.
// `active` is the facility's own "off the shelf today" switch, and the Admin
// Portal deliberately keeps showing a deactivated category so staff can turn
// it back on. A soft-deleted category is gone from both the Admin Portal and
// the Customer App, and comes back only by setting deleted_at = NULL.
//
// A SUBCATEGORY IS HIDDEN WITH ITS PARENT. Both category listings below also
// require the parent row to be undeleted, so a soft-deleted main category
// never leaves its children behind as orphans in the list.
//
// WHAT IS DELIBERATELY NOT FILTERED, and why:
//   findCategory             fetch-by-id, left open so a soft-deleted row can
//                            still be read back and restored.
//   findProductCategories    the spreadsheet import's bulk before-value read.
//   every INSERT / UPDATE    these are writes, not listings.
//   pif-orders.repository.ts untouched, so the existing orders keep resolving
//                            their product names.
//
// TO RESTORE one category:
//   UPDATE pif.categories SET deleted_at = NULL WHERE id = '...';
// or run pif-demo-soft-delete-recovery-*.sql from the backups folder, which
// restores all 14 legacy categories and 21 DEMO products together.
// ---------------------------------------------------------------------------

/** Not soft-deleted, for a query that aliases pif.categories as `alias`. */
const VISIBLE_CATEGORY = (alias: string): string => `${alias}.deleted_at IS NULL`;

// ---------------------------------------------------------------------------
// TEMPORARY DEMO-PRODUCT VISIBILITY FILTER.  Reversible by one line.
//
// The 21 demonstration products from database/demo/demo-catalogue.sql (every
// one has a sku beginning 'DEMO-') are hidden from every customer and Admin
// Portal listing, from product detail, and from the cart and checkout paths.
//
// NOTHING IN THE DATABASE CHANGES. The 21 rows stay exactly as they are:
// not deleted, not deactivated, not soft-deleted, nothing rewritten. The 8
// orders and 13 order items that name them keep resolving, because the order
// read path joins pif.products in pif-orders.repository.ts and is deliberately
// NOT filtered here.
//
// TO REVERSE: set HIDE_DEMO_PRODUCTS to false. That is the whole undo — every
// predicate below collapses to `true` and the products reappear immediately.
// No migration, no data fix, no other file to touch.
//
// NOW REDUNDANT, AND KEPT ON PURPOSE. Once pif-demo-soft-delete-*.sql has set
// deleted_at on all 21 rows, every listing already excludes them through the
// `p.deleted_at IS NULL` predicate those queries have always carried, so this
// sku filter decides nothing. It is left at `true` so there is no window in
// which the products reappear between deploying this file and running that
// script. Set it to false once the soft delete is applied and verified.
//
// WHAT IS DELIBERATELY NOT FILTERED, and why:
//   findProduct / findProductBySku  identity lookups the spreadsheet import
//                                   needs: hiding a SKU from the importer
//                                   would make it try to create a duplicate
//                                   and hit pif_products_sku_uq.
//   findProductCategories           the import's bulk before-value read.
//   every INSERT / UPDATE path      these are writes, not listings.
// ---------------------------------------------------------------------------
const HIDE_DEMO_PRODUCTS = true;

/**
 * For a query that aliases pif.products as `p` AND joins its category as `c`
 * (every caller of this constant uses PRODUCT_FROM, which does both).
 *
 * Two reasons a product is hidden: its own DEMO- sku, or the category it is
 * filed under is one of the hidden legacy rows. A product with no category at
 * all (category_id IS NULL) stays visible -- absence of a category is not
 * evidence of being demo data.
 */
const VISIBLE_PRODUCT = HIDE_DEMO_PRODUCTS
  ? `p.sku NOT LIKE 'DEMO-%' AND (p.category_id IS NULL OR ${VISIBLE_CATEGORY('c')})`
  : `(p.category_id IS NULL OR ${VISIBLE_CATEGORY('c')})`;
/** For the per-category count, which aliases it as `pr`. */
const VISIBLE_PRODUCT_PR = HIDE_DEMO_PRODUCTS ? "pr.sku NOT LIKE 'DEMO-%'" : 'true';
/** For categoryUsage, whose sub-select uses no alias. */
const VISIBLE_PRODUCT_BARE = HIDE_DEMO_PRODUCTS ? "sku NOT LIKE 'DEMO-%'" : 'true';

const CATEGORY_COLUMNS = `c.id, c.name, c.parent_id, p.name AS parent_name,
        c.description, c.image_ref, c.sort_order, c.active,
        c.business_slug, c.slug,
        c.created_at::text AS created_at, c.updated_at::text AS updated_at,
        (SELECT count(*) FROM pif.products pr
          WHERE pr.category_id = c.id AND pr.deleted_at IS NULL
            AND ${VISIBLE_PRODUCT_PR})::int AS product_count`;

const PRODUCT_COLUMNS = `p.id, p.sku, p.barcode, p.name, p.brand, p.description,
        p.category_id, c.name AS category_name,
        c.parent_id AS parent_category_id, pc.name AS parent_category_name,
        p.unit, p.pack_size::text AS pack_size, p.pack_unit,
        p.selling_price::text AS selling_price, p.purchase_price::text AS purchase_price,
        p.tax_rate_id, t.name AS tax_rate_name, t.rate_pct::text AS tax_rate_pct,
        p.discount_pct::text AS discount_pct, p.image_ref,
        p.min_order_qty::text AS min_order_qty, p.max_order_qty::text AS max_order_qty,
        p.qty_step::text AS qty_step,
        p.active, p.available, p.variant_group, p.variant_label,
        p.created_at::text AS created_at, p.updated_at::text AS updated_at,
        p.created_by, p.updated_by`;

const PRODUCT_FROM = `FROM pif.products p
        LEFT JOIN pif.categories c  ON c.id = p.category_id
        LEFT JOIN pif.categories pc ON pc.id = c.parent_id
        LEFT JOIN pif.tax_rates t   ON t.id = p.tax_rate_id`;

@Injectable()
export class PifCatalogueRepository {
  constructor(private readonly db: DatabaseService) {}

  // ---------------------------------------------------------------- categories

  /** Top-level categories a shopper may browse, with their subcategories. */
  async listPublicCategories(): Promise<CategoryRecord[]> {
    return this.run<CategoryRecord>(
      `SELECT ${CATEGORY_COLUMNS}
         FROM pif.categories c
         LEFT JOIN pif.categories p ON p.id = c.parent_id
        WHERE c.active AND (c.parent_id IS NULL OR p.active)
          AND ${VISIBLE_CATEGORY('c')}
          AND (c.parent_id IS NULL OR ${VISIBLE_CATEGORY('p')})
        ORDER BY c.sort_order, c.name`
    );
  }

  /**
   * Every category, deactivated ones included, GROUPED BY SHOP.
   *
   * THE SHOP MUST BE THE FIRST SORT KEY. Migration 0062 assigns sort_order
   * per business -- Grocers' main categories run 10..190 while Fresh Mart's
   * are 10 and 20 -- so ordering on sort_order alone interleaves the two
   * shops and scatters Fresh Mart's ten rows through the middle of Grocers'
   * 154. That is not a data fault: every row is returned either way, but the
   * Admin Portal reads as though Fresh Mart were missing.
   *
   * The remaining keys are unchanged, so a subcategory still follows its own
   * parent: coalesce(p.sort_order, c.sort_order) groups a child with its
   * parent, and c.parent_id NULLS FIRST puts the parent row above its
   * children.
   *
   * The two shops are spelled out rather than sorted alphabetically so the
   * order is the facility's own, Grocers then Fresh Mart, and not an accident
   * of f sorting before g. They are the same two values
   * pif_categories_business_chk already permits; anything else, including the
   * pre-business demo rows whose business_slug is NULL, sorts last.
   */
  async listAdminCategories(): Promise<CategoryRecord[]> {
    return this.run<CategoryRecord>(
      `SELECT ${CATEGORY_COLUMNS}
         FROM pif.categories c
         LEFT JOIN pif.categories p ON p.id = c.parent_id
        WHERE ${VISIBLE_CATEGORY('c')}
          AND (c.parent_id IS NULL OR ${VISIBLE_CATEGORY('p')})
        ORDER BY CASE c.business_slug
                   WHEN 'grocers'    THEN 1
                   WHEN 'fresh-mart' THEN 2
                   ELSE 3
                 END,
                 coalesce(p.sort_order, c.sort_order), coalesce(p.name, c.name),
                 c.parent_id NULLS FIRST, c.sort_order, c.name`
    );
  }

  async findCategory(id: string, client?: PoolClient): Promise<CategoryRecord | null> {
    const rows = await this.run<CategoryRecord>(
      `SELECT ${CATEGORY_COLUMNS}
         FROM pif.categories c
         LEFT JOIN pif.categories p ON p.id = c.parent_id
        WHERE c.id = $1`,
      [id],
      client
    );
    return rows[0] ?? null;
  }

  async findCategoryByName(name: string, parentId: string | null): Promise<CategoryRecord | null> {
    const rows = await this.run<CategoryRecord>(
      `SELECT ${CATEGORY_COLUMNS}
         FROM pif.categories c
         LEFT JOIN pif.categories p ON p.id = c.parent_id
        WHERE lower(c.name) = lower($1)
          AND c.parent_id IS NOT DISTINCT FROM $2
          AND ${VISIBLE_CATEGORY('c')}`,
      [name, parentId]
    );
    return rows[0] ?? null;
  }

  async insertCategory(write: CategoryWrite, actorId: string): Promise<string> {
    const rows = await this.run<{ id: string }>(
      `INSERT INTO pif.categories
         (name, parent_id, description, sort_order, active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6)
       RETURNING id`,
      [write.name, write.parentId, write.description, write.sortOrder, write.active, actorId]
    );
    return rows[0]!.id;
  }

  async updateCategory(id: string, write: CategoryWrite, actorId: string): Promise<void> {
    await this.run(
      `UPDATE pif.categories
          SET name = $2, parent_id = $3, description = $4, sort_order = $5,
              active = $6, updated_at = now(), updated_by = $7
        WHERE id = $1`,
      [id, write.name, write.parentId, write.description, write.sortOrder, write.active, actorId]
    );
  }

  async setCategoryImage(id: string, imageRef: string | null, actorId: string): Promise<void> {
    await this.run(
      `UPDATE pif.categories
          SET image_ref = $2, updated_at = now(), updated_by = $3
        WHERE id = $1`,
      [id, imageRef, actorId]
    );
  }

  /** Does anything still point at this category? Deactivation is safe; a
   *  reparent that would orphan products is not. */
  async categoryUsage(id: string): Promise<{ products: number; children: number }> {
    const rows = await this.run<{ products: string; children: string }>(
      `SELECT (SELECT count(*) FROM pif.products
                WHERE category_id = $1 AND deleted_at IS NULL
                  AND ${VISIBLE_PRODUCT_BARE})::text AS products,
              (SELECT count(*) FROM pif.categories
                WHERE parent_id = $1 AND deleted_at IS NULL)::text AS children`,
      [id]
    );
    return { products: Number(rows[0]!.products), children: Number(rows[0]!.children) };
  }

  // ------------------------------------------------------------------ products

  async findProduct(id: string, client?: PoolClient): Promise<ProductRecord | null> {
    const rows = await this.run<ProductRecord>(
      `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM} WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [id],
      client
    );
    return rows[0] ?? null;
  }

  /** The customer-visible product, or null — a deactivated one reads as absent. */
  async findPublicProduct(id: string): Promise<ProductRecord | null> {
    const rows = await this.run<ProductRecord>(
      `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
        WHERE p.id = $1 AND p.deleted_at IS NULL AND p.active
          AND ${VISIBLE_PRODUCT}`,
      [id]
    );
    return rows[0] ?? null;
  }

  async findProductBySku(sku: string): Promise<ProductRecord | null> {
    const rows = await this.run<ProductRecord>(
      `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM} WHERE lower(p.sku) = lower($1)`,
      [sku]
    );
    return rows[0] ?? null;
  }

  /**
   * The current category of each of these products, in ONE query.
   *
   * WHY IT EXISTS. The spreadsheet import must know what category a product is
   * ALREADY in, so a row that changes only a price is not mistaken for a move
   * (see the three states in PifCatalogueService.prepareProduct). Asking per
   * row would be an N+1 over a file of up to PIF_IMPORT_MAX_ROWS rows, which is
   * exactly what this module's "read the reference data ONCE" rule forbids.
   *
   * `= ANY($1::uuid[])` sends one array parameter and makes one index scan on
   * the primary key, whatever the batch size.
   *
   * NO deleted_at FILTER, deliberately: the caller is asking "what category is
   * this row in", and a product the import targets has already been decided to
   * exist by the preview. A product that has since gone is reported as a stale
   * preview by the caller, which is a clearer failure than a silent miss.
   *
   * An id with no row is simply absent from the map. The caller must treat
   * absence as "gone", never as "no category".
   */
  async findProductCategories(ids: readonly string[]): Promise<Map<string, string | null>> {
    if (ids.length === 0) return new Map();
    const rows = await this.run<{ id: string; category_id: string | null }>(
      `SELECT id, category_id FROM pif.products WHERE id = ANY($1::uuid[])`,
      [[...ids]]
    );
    return new Map(rows.map((row) => [row.id, row.category_id]));
  }

  /**
   * The shopper's listing. Server-side search and pagination, because the
   * catalogue is meant to hold thousands of SKUs and no screen may ever ask
   * for all of them.
   *
   * A category filter includes that category's subcategories, so tapping
   * "Grains" shows everything beneath it.
   */
  async listPublicProducts(filter: {
    categoryId?: string | null;
    query?: string | null;
    availableOnly?: boolean;
    limit: number;
    offset: number;
  }): Promise<{ items: ProductRecord[]; total: number }> {
    const where: string[] = ['p.deleted_at IS NULL', 'p.active', VISIBLE_PRODUCT];
    const params: unknown[] = [];

    if (filter.categoryId) {
      params.push(filter.categoryId);
      where.push(`(p.category_id = $${params.length} OR c.parent_id = $${params.length})`);
    }
    if (filter.query && filter.query.trim() !== '') {
      params.push(`%${filter.query.trim()}%`);
      const i = params.length;
      where.push(`(p.name ILIKE $${i} OR p.brand ILIKE $${i} OR p.sku ILIKE $${i})`);
    }
    if (filter.availableOnly) {
      where.push('p.available');
    }

    const clause = where.join(' AND ');
    const totals = await this.run<{ total: string }>(
      `SELECT count(*)::text AS total ${PRODUCT_FROM} WHERE ${clause}`,
      params
    );
    params.push(filter.limit, filter.offset);
    const items = await this.run<ProductRecord>(
      `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
        WHERE ${clause}
        ORDER BY p.available DESC, p.name
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items, total: Number(totals[0]!.total) };
  }

  /** The administrator's listing: everything, filterable by status. */
  async listAdminProducts(filter: {
    categoryId?: string | null;
    query?: string | null;
    status?: 'ALL' | 'ACTIVE' | 'INACTIVE' | 'UNAVAILABLE';
    limit: number;
    offset: number;
  }): Promise<{ items: ProductRecord[]; total: number }> {
    const where: string[] = ['p.deleted_at IS NULL', VISIBLE_PRODUCT];
    const params: unknown[] = [];

    if (filter.categoryId) {
      params.push(filter.categoryId);
      where.push(`(p.category_id = $${params.length} OR c.parent_id = $${params.length})`);
    }
    if (filter.query && filter.query.trim() !== '') {
      params.push(`%${filter.query.trim()}%`);
      const i = params.length;
      where.push(`(p.name ILIKE $${i} OR p.brand ILIKE $${i} OR p.sku ILIKE $${i} OR p.barcode ILIKE $${i})`);
    }
    if (filter.status === 'ACTIVE') where.push('p.active');
    if (filter.status === 'INACTIVE') where.push('NOT p.active');
    if (filter.status === 'UNAVAILABLE') where.push('NOT p.available');

    const clause = where.join(' AND ');
    const totals = await this.run<{ total: string }>(
      `SELECT count(*)::text AS total ${PRODUCT_FROM} WHERE ${clause}`,
      params
    );
    params.push(filter.limit, filter.offset);
    const items = await this.run<ProductRecord>(
      `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
        WHERE ${clause}
        ORDER BY p.updated_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items, total: Number(totals[0]!.total) };
  }

  /** The other packs/sizes of one product family, customer-visible only. */
  async listPublicVariants(variantGroup: string, excludeId: string): Promise<ProductRecord[]> {
    return this.run<ProductRecord>(
      `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
        WHERE p.deleted_at IS NULL AND p.active AND ${VISIBLE_PRODUCT}
          AND p.variant_group = $1 AND p.id <> $2
        ORDER BY p.pack_size NULLS LAST, p.name`,
      [variantGroup, excludeId]
    );
  }

  async insertProduct(write: ProductWrite, actorId: string): Promise<string> {
    const rows = await this.run<{ id: string }>(
      `INSERT INTO pif.products
         (sku, name, barcode, brand, description, category_id, unit, pack_size, pack_unit,
          selling_price, purchase_price, tax_rate_id, discount_pct,
          min_order_qty, max_order_qty, qty_step, active, available,
          variant_group, variant_label, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)
       RETURNING id`,
      [
        write.sku,
        write.name,
        write.barcode,
        write.brand,
        write.description,
        write.categoryId,
        write.unit,
        write.packSize,
        write.packUnit,
        write.sellingPrice,
        write.purchasePrice,
        write.taxRateId,
        write.discountPct,
        write.minOrderQty,
        write.maxOrderQty,
        write.qtyStep,
        write.active,
        write.available,
        write.variantGroup,
        write.variantLabel,
        actorId,
      ]
    );
    return rows[0]!.id;
  }

  async updateProduct(id: string, write: ProductWrite, actorId: string): Promise<void> {
    await this.run(
      `UPDATE pif.products
          SET sku = $2, name = $3, barcode = $4, brand = $5, description = $6,
              category_id = $7, unit = $8, pack_size = $9, pack_unit = $10,
              selling_price = $11, purchase_price = $12, tax_rate_id = $13, discount_pct = $14,
              min_order_qty = $15, max_order_qty = $16, qty_step = $17,
              active = $18, available = $19, variant_group = $20, variant_label = $21,
              updated_at = now(), updated_by = $22
        WHERE id = $1 AND deleted_at IS NULL`,
      [
        id,
        write.sku,
        write.name,
        write.barcode,
        write.brand,
        write.description,
        write.categoryId,
        write.unit,
        write.packSize,
        write.packUnit,
        write.sellingPrice,
        write.purchasePrice,
        write.taxRateId,
        write.discountPct,
        write.minOrderQty,
        write.maxOrderQty,
        write.qtyStep,
        write.active,
        write.available,
        write.variantGroup,
        write.variantLabel,
        actorId,
      ]
    );
  }

  /** Activate/deactivate and availability, the two switches used most. */
  async setProductFlags(
    id: string,
    flags: { active?: boolean; available?: boolean },
    actorId: string
  ): Promise<void> {
    await this.run(
      `UPDATE pif.products
          SET active     = coalesce($2, active),
              available  = coalesce($3, available),
              updated_at = now(), updated_by = $4
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, flags.active ?? null, flags.available ?? null, actorId]
    );
  }

  async setProductImage(id: string, imageRef: string | null, actorId: string): Promise<void> {
    await this.run(
      `UPDATE pif.products
          SET image_ref = $2, updated_at = now(), updated_by = $3
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, imageRef, actorId]
    );
  }

  async setProductPrice(
    id: string,
    price: { sellingPrice: number; taxRateId: string | null; discountPct: number | null },
    actorId: string
  ): Promise<void> {
    await this.run(
      `UPDATE pif.products
          SET selling_price = $2, tax_rate_id = $3, discount_pct = $4,
              updated_at = now(), updated_by = $5
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, price.sellingPrice, price.taxRateId, price.discountPct, actorId]
    );
  }

  // ----------------------------------------------------------------- tax rates

  async listTaxRates(activeOnly = false): Promise<TaxRateRecord[]> {
    return this.run<TaxRateRecord>(
      `SELECT id, name, rate_pct::text AS rate_pct, active
         FROM pif.tax_rates
        ${activeOnly ? 'WHERE active' : ''}
        ORDER BY rate_pct, name`
    );
  }

  async findTaxRate(id: string): Promise<TaxRateRecord | null> {
    const rows = await this.run<TaxRateRecord>(
      `SELECT id, name, rate_pct::text AS rate_pct, active FROM pif.tax_rates WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async insertTaxRate(name: string, ratePct: number): Promise<string> {
    const rows = await this.run<{ id: string }>(
      `INSERT INTO pif.tax_rates (name, rate_pct) VALUES ($1,$2) RETURNING id`,
      [name, ratePct]
    );
    return rows[0]!.id;
  }

  private async run<T extends QueryResultRow>(
    sql: string,
    params: unknown[] = [],
    client?: PoolClient
  ): Promise<T[]> {
    if (client) {
      const res = await client.query(sql, params);
      return res.rows as T[];
    }
    return this.db.query<T>(sql, params);
  }
}
