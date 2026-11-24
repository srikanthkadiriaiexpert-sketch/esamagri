import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Seasonal promotional banners — the pictures RIK staff put on the customer
 * home screen for Diwali, Sankranti, Christmas, a summer offer.
 *
 * THIS IS NOT THE HERO. The home screen's hero is a committed brand asset
 * rendered by HomePage.tsx's own HeroBanner component. Nothing in this file
 * or anything reading it can replace, crop, reorder or hide it. These banners
 * render BELOW it, and when none is scheduled the screen is exactly what it
 * is today.
 *
 * NOTHING HERE REACHES AN ENTITLEMENT. One table, rik.promotional_banners.
 * No pool, scale, conversion, provision, voucher or eligibility row is read
 * or written on any path in this file.
 *
 * TWO READS, DELIBERATELY DIFFERENT — the same split New Arrivals uses, for
 * the same reason:
 *
 *   `listActive`  what a CUSTOMER may see: published, and inside its date
 *                 window today.
 *   `listAll`     what an ADMINISTRATOR must see: every row including drafts
 *                 and expired ones, because managing them is the job.
 *
 * Collapsing those into one method with a flag is how a draft reaches a
 * customer, so they are separate SQL.
 */

export interface PromotionalBannerRecord {
  id: string;
  title: string;
  description: string | null;
  image_ref: string | null;
  is_published: boolean;
  starts_on: string | null;
  ends_on: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `
  b.id, b.title, b.description, b.image_ref, b.is_published,
  b.starts_on::text  AS starts_on,
  b.ends_on::text    AS ends_on,
  b.display_order,
  b.created_at::text AS created_at,
  b.updated_at::text AS updated_at`;

const FROM = `FROM rik.promotional_banners b`;

/**
 * Live for a customer today.
 *
 * A NULL start means "from the moment it was published" and a NULL end means
 * "until staff take it down", so both bounds are optional and each is
 * compared only when it is set.
 */
const LIVE_TODAY = `
  b.is_published
  AND b.image_ref IS NOT NULL
  AND (b.starts_on IS NULL OR b.starts_on <= CURRENT_DATE)
  AND (b.ends_on   IS NULL OR b.ends_on   >= CURRENT_DATE)`;

export interface PromotionalBannerInput {
  title: string;
  description: string | null;
  startsOn: string | null;
  endsOn: string | null;
  displayOrder: number;
}

@Injectable()
export class PromotionalBannersRepository {
  constructor(private readonly db: DatabaseService) {}

  /** The customer-facing list. */
  listActive(): Promise<PromotionalBannerRecord[]> {
    return this.db.query<PromotionalBannerRecord>(
      `SELECT ${COLUMNS} ${FROM}
        WHERE ${LIVE_TODAY}
        ORDER BY b.display_order, b.created_at DESC`
    );
  }

  /** Everything, for the Admin Portal. */
  listAll(): Promise<PromotionalBannerRecord[]> {
    return this.db.query<PromotionalBannerRecord>(
      `SELECT ${COLUMNS} ${FROM} ORDER BY b.display_order, b.created_at DESC`
    );
  }

  async findById(id: string): Promise<PromotionalBannerRecord | null> {
    const rows = await this.db.query<PromotionalBannerRecord>(
      `SELECT ${COLUMNS} ${FROM} WHERE b.id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  /**
   * A banner always starts as a draft with no picture.
   *
   * `is_published` is not a parameter: the CHECK constraint refuses a
   * published row without an image_ref, and the image arrives in a separate
   * multipart request after this one. Offering a "create published" path here
   * would only produce a constraint violation staff could not act on.
   */
  async insert(input: PromotionalBannerInput, actorId: string): Promise<PromotionalBannerRecord> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO rik.promotional_banners
         (title, description, starts_on, ends_on, display_order, is_published, created_by, updated_by)
       VALUES ($1, $2, $3::date, $4::date, $5, false, $6, $6)
       RETURNING id`,
      [input.title, input.description, input.startsOn, input.endsOn, input.displayOrder, actorId]
    );
    const created = await this.findById(rows[0].id);
    if (created === null) {
      throw new Error('promotional banner disappeared immediately after insert');
    }
    return created;
  }

  /**
   * Patch the editable fields.
   *
   * `undefined` leaves a column alone; an explicit `null` clears it. That
   * distinction is preserved all the way from the DTO, so "don't touch the
   * end date" and "remove the end date" stay different requests.
   */
  async update(
    id: string,
    patch: {
      title?: string;
      description?: string | null;
      startsOn?: string | null;
      endsOn?: string | null;
      displayOrder?: number;
    },
    actorId: string
  ): Promise<PromotionalBannerRecord | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    const add = (fragment: string, value: unknown) => {
      values.push(value);
      sets.push(fragment.replace('$n', `$${values.length}`));
    };

    if (patch.title !== undefined) add('title = $n', patch.title);
    if (patch.description !== undefined) add('description = $n', patch.description);
    if (patch.startsOn !== undefined) add('starts_on = $n::date', patch.startsOn);
    if (patch.endsOn !== undefined) add('ends_on = $n::date', patch.endsOn);
    if (patch.displayOrder !== undefined) add('display_order = $n', patch.displayOrder);

    if (sets.length === 0) return this.findById(id);

    values.push(actorId);
    const actorPlaceholder = `$${values.length}`;
    values.push(id);
    const idPlaceholder = `$${values.length}`;

    await this.db.query(
      `UPDATE rik.promotional_banners
          SET ${sets.join(', ')}, updated_by = ${actorPlaceholder}, updated_at = now()
        WHERE id = ${idPlaceholder}`,
      values
    );
    return this.findById(id);
  }

  /** Attach or replace the picture. Returns the row as it now stands. */
  async setImageRef(id: string, imageRef: string | null, actorId: string): Promise<PromotionalBannerRecord | null> {
    await this.db.query(
      `UPDATE rik.promotional_banners
          SET image_ref = $1, updated_by = $2, updated_at = now()
        WHERE id = $3`,
      [imageRef, actorId, id]
    );
    return this.findById(id);
  }

  /**
   * Publish or unpublish.
   *
   * Unpublishing is always allowed. Publishing without a picture is refused
   * by the CHECK constraint, and the service checks first so staff get a
   * sentence rather than a constraint name.
   */
  async setPublished(id: string, isPublished: boolean, actorId: string): Promise<PromotionalBannerRecord | null> {
    await this.db.query(
      `UPDATE rik.promotional_banners
          SET is_published = $1, updated_by = $2, updated_at = now()
        WHERE id = $3`,
      [isPublished, actorId, id]
    );
    return this.findById(id);
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM rik.promotional_banners WHERE id = $1 RETURNING id`,
      [id]
    );
    return rows.length > 0;
  }
}
