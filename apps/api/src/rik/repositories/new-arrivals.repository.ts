import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * What RIK staff are currently featuring as newly introduced.
 *
 * A SHOP WINDOW, NOT A CATALOGUE ENTRY. A listing is an announcement card:
 * a name, an optional line of copy, a picture, and a publishing window.
 * Nothing here creates, renames, prices, stocks or makes anyone eligible for
 * anything.
 *
 * TWO KINDS OF LISTING, SINCE MIGRATION 0056:
 *
 *   STANDALONE   `provision_id` is NULL and `product_name` carries the name a
 *                member of staff typed. This is the ordinary case: staff
 *                announce something without having to find it in, or add it
 *                to, the entitlement catalogue.
 *   LINKED       `provision_id` points at a rik.provisions row, and the name
 *                and fallback picture come from there. 0055's original shape,
 *                kept working rather than thrown away.
 *
 * The SQL resolves the difference once, in `display_name` and
 * `effective_image_ref`, so no caller above this file has to know which kind
 * of row it is holding.
 *
 * TWO READS, DELIBERATELY DIFFERENT:
 *
 *   `listPublished`  what a CUSTOMER may see: published, inside its date
 *                    window today, and — for a LINKED listing only — whose
 *                    provision is itself still active. A standalone listing
 *                    has no catalogue state to be gated by.
 *   `listAll`        what an ADMINISTRATOR must see: every row including the
 *                    unpublished and the expired, because managing them is
 *                    the job.
 *
 * Mixing those two is how an unpublished draft reaches a customer, so they
 * are separate methods with separate SQL rather than one method with a flag.
 */

/** A listing, with the provision fields resolved where one is linked. */
export interface NewArrivalRecord {
  id: string;
  /** NULL for a standalone listing. */
  provision_id: string | null;
  /** The staff-typed name. NULL when the listing is linked to a provision. */
  product_name: string | null;
  /** The name to show: the provision's when linked, the typed one otherwise. */
  display_name: string;
  headline: string | null;
  /** The listing's own uploaded picture. */
  image_ref: string | null;
  /** What to render: the listing's own picture, else the provision's. */
  effective_image_ref: string | null;
  is_published: boolean;
  published_from: string | null;
  published_until: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;

  // Joined from rik.provisions — read-only here, never written by this file,
  // and all NULL for a standalone listing.
  code: string | null;
  name: string | null;
  brand: string | null;
  unit: string | null;
  pack_size: string | null;
  pack_unit: string | null;
  issue_period: string | null;
  provision_is_active: boolean | null;
  provision_image_ref: string | null;
  pool_code: string | null;
  pool_name: string | null;
}

const COLUMNS = `
  na.id, na.provision_id, na.product_name, na.headline, na.image_ref,
  na.is_published,
  na.published_from::text AS published_from,
  na.published_until::text AS published_until,
  na.display_order,
  na.created_at::text AS created_at,
  na.updated_at::text AS updated_at,
  -- Resolved once here so no screen has to know the fallback rule.
  coalesce(p.name, na.product_name)      AS display_name,
  coalesce(na.image_ref, p.image_ref)    AS effective_image_ref,
  p.code, p.name, p.brand, p.unit,
  p.pack_size::text AS pack_size,
  p.pack_unit,
  p.issue_period,
  p.is_active AS provision_is_active,
  p.image_ref AS provision_image_ref,
  pool.code AS pool_code,
  pool.name AS pool_name`;

// LEFT JOIN since 0056: a standalone listing has no provision to join to, and
// an INNER JOIN would silently hide every one of them.
const FROM = `
  FROM rik.new_arrivals na
  LEFT JOIN rik.provisions p ON p.id = na.provision_id
  LEFT JOIN rik.entitlement_pools pool ON pool.id = p.pool_id`;

/**
 * Visible to a customer today.
 *
 * The catalogue conditions are wrapped in `provision_id IS NULL OR (...)`:
 * a linked listing still disappears when its product is retired or outside
 * its effective dates, and a standalone listing — which references no
 * product — is governed by its own publish flag and window alone.
 */
const VISIBLE_TODAY = `
  na.is_published
  AND (na.published_from  IS NULL OR na.published_from  <= CURRENT_DATE)
  AND (na.published_until IS NULL OR na.published_until >= CURRENT_DATE)
  AND (
    na.provision_id IS NULL
    OR (
      p.is_active
      AND p.effective_from <= CURRENT_DATE
      AND (p.effective_to IS NULL OR p.effective_to >= CURRENT_DATE)
    )
  )`;

export interface NewArrivalInput {
  /** NULL for a standalone listing. */
  provisionId: string | null;
  /** Required when provisionId is null; the database CHECK enforces it too. */
  productName: string | null;
  headline: string | null;
  publishedFrom: string | null;
  publishedUntil: string | null;
  displayOrder: number;
  isPublished: boolean;
}

@Injectable()
export class NewArrivalsRepository {
  constructor(private readonly db: DatabaseService) {}

  /** The customer-facing list. */
  listPublished(): Promise<NewArrivalRecord[]> {
    return this.db.query<NewArrivalRecord>(
      `SELECT ${COLUMNS} ${FROM}
        WHERE ${VISIBLE_TODAY}
        ORDER BY na.display_order, na.created_at DESC`
    );
  }

  /** Everything, for the Admin Portal. */
  listAll(): Promise<NewArrivalRecord[]> {
    return this.db.query<NewArrivalRecord>(
      `SELECT ${COLUMNS} ${FROM} ORDER BY na.display_order, na.created_at DESC`
    );
  }

  async findById(id: string): Promise<NewArrivalRecord | null> {
    const rows = await this.db.query<NewArrivalRecord>(`SELECT ${COLUMNS} ${FROM} WHERE na.id = $1`, [id]);
    return rows[0] ?? null;
  }

  async findByProvision(provisionId: string): Promise<NewArrivalRecord | null> {
    const rows = await this.db.query<NewArrivalRecord>(`SELECT ${COLUMNS} ${FROM} WHERE na.provision_id = $1`, [
      provisionId,
    ]);
    return rows[0] ?? null;
  }

  /**
   * The provision a listing MAY point at.
   *
   * Only used on the optional linked path. It reads rik.provisions and
   * nothing else, so a PIF product id returns null here and the insert is
   * refused with a clear message rather than a foreign-key error.
   */
  async findProvision(
    provisionId: string
  ): Promise<{ id: string; code: string; name: string; is_active: boolean } | null> {
    const rows = await this.db.query<{ id: string; code: string; name: string; is_active: boolean }>(
      `SELECT id, code, name, is_active FROM rik.provisions WHERE id = $1`,
      [provisionId]
    );
    return rows[0] ?? null;
  }

  async insert(input: NewArrivalInput, actorId: string): Promise<NewArrivalRecord> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO rik.new_arrivals
         (provision_id, product_name, headline, published_from, published_until,
          display_order, is_published, created_by, updated_by)
       VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $8)
       RETURNING id`,
      [
        input.provisionId,
        input.productName,
        input.headline,
        input.publishedFrom,
        input.publishedUntil,
        input.displayOrder,
        input.isPublished,
        actorId,
      ]
    );
    const created = await this.findById(rows[0]!.id);
    if (created === null) throw new Error('rik.new_arrivals: the row just inserted could not be read back.');
    return created;
  }

  /**
   * A partial update. Every field is optional and `undefined` means "leave
   * it alone" — distinct from `null`, which clears a nullable column. COALESCE
   * on the parameter would conflate the two, so each column tests the
   * parameter's presence with a companion flag instead.
   */
  async update(
    id: string,
    patch: {
      productName?: string;
      headline?: string | null;
      publishedFrom?: string | null;
      publishedUntil?: string | null;
      displayOrder?: number;
      isPublished?: boolean;
      imageRef?: string | null;
    },
    actorId: string
  ): Promise<NewArrivalRecord | null> {
    await this.db.query(
      `UPDATE rik.new_arrivals SET
         product_name    = CASE WHEN $2  THEN $3::text     ELSE product_name    END,
         headline        = CASE WHEN $4  THEN $5::text     ELSE headline        END,
         published_from  = CASE WHEN $6  THEN $7::date     ELSE published_from  END,
         published_until = CASE WHEN $8  THEN $9::date     ELSE published_until END,
         display_order   = CASE WHEN $10 THEN $11::integer ELSE display_order   END,
         is_published    = CASE WHEN $12 THEN $13::boolean ELSE is_published    END,
         image_ref       = CASE WHEN $14 THEN $15::text    ELSE image_ref       END,
         updated_at      = now(),
         updated_by      = $16
       WHERE id = $1`,
      [
        id,
        patch.productName !== undefined,
        patch.productName ?? null,
        patch.headline !== undefined,
        patch.headline ?? null,
        patch.publishedFrom !== undefined,
        patch.publishedFrom ?? null,
        patch.publishedUntil !== undefined,
        patch.publishedUntil ?? null,
        patch.displayOrder !== undefined,
        patch.displayOrder ?? 0,
        patch.isPublished !== undefined,
        patch.isPublished ?? false,
        patch.imageRef !== undefined,
        patch.imageRef ?? null,
        actorId,
      ]
    );
    return this.findById(id);
  }

  /**
   * Removes the LISTING.
   *
   * `DELETE FROM rik.new_arrivals` — no provision is named in this statement
   * and none can be affected by it. Where a listing is linked, the foreign
   * key is ON DELETE RESTRICT, so there is no cascade path back to the
   * catalogue either.
   */
  async remove(id: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(`DELETE FROM rik.new_arrivals WHERE id = $1 RETURNING id`, [id]);
    return rows.length > 0;
  }
}
