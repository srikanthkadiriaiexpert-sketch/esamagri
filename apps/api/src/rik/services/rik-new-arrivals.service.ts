import { Injectable } from '@nestjs/common';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import type { AuthContext } from '../../auth/auth-context';
import { NewArrivalsRepository, type NewArrivalRecord } from '../repositories/new-arrivals.repository';

/**
 * The New Arrivals listing rules.
 *
 * SINCE MIGRATION 0056 A LISTING STANDS ALONE. Staff type a product name,
 * write an optional line of copy, upload a picture, and publish. No
 * catalogue product has to be chosen, found or created first — a New
 * Arrivals card is an announcement, not an entitlement.
 *
 * LINKING IS STILL POSSIBLE AND STILL GUARDED. A listing may optionally name
 * a rik.provisions row, and when it does the old defences all still apply:
 *
 *   1. the column is a foreign key into rik.provisions, so a PIF product id
 *      is physically unstorable;
 *   2. this service looks the id up in rik.provisions BEFORE inserting, so
 *      the refusal is a clear 400 rather than a referential-integrity error;
 *   3. nothing in this file, or reachable from it, ever reads pif.products.
 *
 * A STANDALONE LISTING REFERENCES NOTHING AT ALL, so there is no product id
 * — RIK or PIF — for it to carry across a module boundary. The "RIK only"
 * property is preserved by having no reference rather than by constraining
 * one.
 *
 * NOTHING HERE TOUCHES ENTITLEMENT. This service writes exactly one table,
 * rik.new_arrivals. It never reads or writes a pool, a scale, a conversion, a
 * selection, an issue window, a voucher or a provision — `findProvision` is a
 * SELECT, used only to validate an optional link and to name the product in
 * the audit entry. There is no UPDATE against rik.provisions anywhere in this
 * file. Featuring a product cannot make an officer eligible for it.
 */

export class NewArrivalValidationError extends Error {
  constructor(
    readonly code:
      | 'PROVISION_NOT_FOUND'
      | 'PROVISION_INACTIVE'
      | 'ALREADY_LISTED'
      | 'INVALID_WINDOW'
      | 'NAME_REQUIRED'
      | 'IMAGE_REQUIRED'
      | 'NOT_FOUND',
    message: string,
    readonly field?: string
  ) {
    super(message);
    this.name = 'NewArrivalValidationError';
  }
}

/** The 140-character caps the database also enforces. */
const HEADLINE_MAX = 140;
const NAME_MAX = 140;

function cleanHeadline(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.slice(0, HEADLINE_MAX);
}

/**
 * A product name is required and must survive trimming. Returning the
 * trimmed value rather than the raw one keeps "  " out of the column, which
 * the database CHECK would refuse anyway — better a sentence than a 500.
 */
function cleanName(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') {
    throw new NewArrivalValidationError(
      'NAME_REQUIRED',
      'A product name is required.',
      'productName'
    );
  }
  return trimmed.slice(0, NAME_MAX);
}

/** What goes in the audit trail: the listing, never the whole product. */
function listingAudit(record: NewArrivalRecord): Record<string, unknown> {
  return {
    id: record.id,
    name: record.display_name,
    provisionCode: record.code,
    standalone: record.provision_id === null,
    headline: record.headline,
    hasOwnImage: record.image_ref !== null,
    isPublished: record.is_published,
    publishedFrom: record.published_from,
    publishedUntil: record.published_until,
    displayOrder: record.display_order,
  };
}

@Injectable()
export class RikNewArrivalsService {
  constructor(
    private readonly repo: NewArrivalsRepository,
    private readonly auditLog: AuditLogRepository
  ) {}

  /** The customer-facing list: published, in window, linked product still active. */
  listForCustomers(): Promise<NewArrivalRecord[]> {
    return this.repo.listPublished();
  }

  /** Everything, for staff. */
  listForStaff(): Promise<NewArrivalRecord[]> {
    return this.repo.listAll();
  }

  async create(
    context: AuthContext,
    input: {
      productName?: string | null;
      provisionId?: string | null;
      headline?: string | null;
      publishedFrom?: string | null;
      publishedUntil?: string | null;
      displayOrder?: number;
      isPublished?: boolean;
    }
  ): Promise<NewArrivalRecord> {
    const provisionId = input.provisionId ?? null;
    let productName: string | null = null;

    if (provisionId === null) {
      // The ordinary path: a standalone announcement.
      productName = cleanName(input.productName);
    } else {
      // The optional linked path, with 0055's checks intact.
      const provision = await this.repo.findProvision(provisionId);
      if (provision === null) {
        throw new NewArrivalValidationError(
          'PROVISION_NOT_FOUND',
          'That product is not in the RIK catalogue. A linked listing can only feature a RIK provision.',
          'provisionId'
        );
      }
      if (!provision.is_active) {
        throw new NewArrivalValidationError(
          'PROVISION_INACTIVE',
          `"${provision.name}" is retired and cannot be featured.`,
          'provisionId'
        );
      }
      if (await this.repo.findByProvision(provisionId)) {
        throw new NewArrivalValidationError(
          'ALREADY_LISTED',
          `"${provision.name}" is already listed under New Arrivals.`,
          'provisionId'
        );
      }
    }

    const publishedFrom = input.publishedFrom ?? null;
    const publishedUntil = input.publishedUntil ?? null;
    assertWindow(publishedFrom, publishedUntil);

    // A standalone listing has no picture yet — the file is uploaded to the
    // row once it exists, which is what keeps the existing validated upload
    // path in use. So it cannot be created already published.
    const wantsPublished = input.isPublished ?? false;
    if (wantsPublished && provisionId === null) {
      throw new NewArrivalValidationError(
        'IMAGE_REQUIRED',
        'Save the listing as a draft first, upload its image, then publish it.',
        'isPublished'
      );
    }

    const created = await this.repo.insert(
      {
        provisionId,
        productName,
        headline: cleanHeadline(input.headline) ?? null,
        publishedFrom,
        publishedUntil,
        displayOrder: input.displayOrder ?? 0,
        isPublished: wantsPublished,
      },
      context.principalId
    );

    await this.audit(context, 'RIK_NEW_ARRIVAL_CREATED', created.id, null, listingAudit(created));
    return created;
  }

  async update(
    context: AuthContext,
    id: string,
    patch: {
      productName?: string;
      headline?: string | null;
      publishedFrom?: string | null;
      publishedUntil?: string | null;
      displayOrder?: number;
    }
  ): Promise<NewArrivalRecord> {
    const before = await this.require(id);

    const publishedFrom = patch.publishedFrom !== undefined ? patch.publishedFrom : before.published_from;
    const publishedUntil = patch.publishedUntil !== undefined ? patch.publishedUntil : before.published_until;
    assertWindow(publishedFrom, publishedUntil);

    // Renaming is only meaningful for a standalone listing; a linked one
    // takes its name from the catalogue and must not grow a second copy.
    let productName: string | undefined;
    if (patch.productName !== undefined) {
      if (before.provision_id !== null) {
        throw new NewArrivalValidationError(
          'NAME_REQUIRED',
          'This listing takes its name from the RIK catalogue and cannot be renamed here.',
          'productName'
        );
      }
      productName = cleanName(patch.productName);
    }

    const after = await this.repo.update(
      id,
      { ...patch, productName, headline: cleanHeadline(patch.headline) },
      context.principalId
    );
    if (after === null) throw new NewArrivalValidationError('NOT_FOUND', 'That listing no longer exists.');

    await this.audit(context, 'RIK_NEW_ARRIVAL_UPDATED', id, listingAudit(before), listingAudit(after));
    return after;
  }

  /**
   * Publish or unpublish. An unpublished listing leaves the customer list
   * immediately.
   *
   * Publishing is where "an image is required" is enforced. A standalone
   * listing with no picture would render as an empty card, so it is refused
   * by name here and by a CHECK constraint in the database underneath.
   * Unpublishing is never blocked — taking something down must always work.
   */
  async setPublished(context: AuthContext, id: string, isPublished: boolean): Promise<NewArrivalRecord> {
    const before = await this.require(id);

    if (isPublished && before.provision_id === null && before.image_ref === null) {
      throw new NewArrivalValidationError(
        'IMAGE_REQUIRED',
        `"${before.display_name}" needs an image before it can be published.`,
        'image'
      );
    }

    const after = await this.repo.update(id, { isPublished }, context.principalId);
    if (after === null) throw new NewArrivalValidationError('NOT_FOUND', 'That listing no longer exists.');

    await this.audit(
      context,
      isPublished ? 'RIK_NEW_ARRIVAL_PUBLISHED' : 'RIK_NEW_ARRIVAL_UNPUBLISHED',
      id,
      listingAudit(before),
      listingAudit(after)
    );
    return after;
  }

  /**
   * Removes the listing.
   *
   * No product is deleted, and none could be from here: the repository's only
   * DELETE names rik.new_arrivals. For a linked listing the audit entry
   * records the provision code so that "what did we stop featuring, and when"
   * is answerable.
   */
  async remove(context: AuthContext, id: string): Promise<{ name: string; provisionCode: string | null }> {
    const before = await this.require(id);
    await this.repo.remove(id);
    await this.audit(context, 'RIK_NEW_ARRIVAL_REMOVED', id, listingAudit(before), {
      removed: true,
      name: before.display_name,
      provisionCode: before.code,
      // Stated in the trail so that a later reader does not have to infer it.
      provisionDeleted: false,
    });
    return { name: before.display_name, provisionCode: before.code };
  }

  /**
   * Attach or replace the listing's own picture.
   *
   * Returns `before` as well as `after` so the caller can delete the file the
   * listing used to point at — AFTER the row has been updated, never before.
   * A failure part-way therefore leaves a row pointing at a file that still
   * exists, which is recoverable; the opposite order would leave a row
   * pointing at a file that has already gone, which is not.
   *
   * NO PROVISION IS TOUCHED. This writes `rik.new_arrivals.image_ref` and
   * nothing else. A catalogue photograph lives on `rik.provisions.image_ref`,
   * is managed on the Provisions screen, and no statement in this file can
   * reach it.
   */
  async setImage(
    context: AuthContext,
    id: string,
    imageRef: string
  ): Promise<{ before: NewArrivalRecord; after: NewArrivalRecord }> {
    const before = await this.require(id);
    const after = await this.repo.update(id, { imageRef }, context.principalId);
    if (after === null) throw new NewArrivalValidationError('NOT_FOUND', 'That listing no longer exists.');

    await this.audit(context, 'RIK_NEW_ARRIVAL_IMAGE_SET', id, listingAudit(before), {
      ...listingAudit(after),
      imageRef,
      // Recorded so the trail answers "did featuring this product change its
      // catalogue photograph?" without anyone having to reason about it.
      provisionImageChanged: false,
    });
    return { before, after };
  }

  /**
   * Drop the listing's picture.
   *
   * A LINKED listing falls back to the catalogue photograph, which is the
   * documented no-image behaviour. A STANDALONE listing has nothing to fall
   * back to, so removing its picture also takes it off the customer screen —
   * it is unpublished in the same step rather than left published and blank.
   */
  async removeImage(
    context: AuthContext,
    id: string
  ): Promise<{ before: NewArrivalRecord; after: NewArrivalRecord; unpublished: boolean }> {
    const before = await this.require(id);

    const mustUnpublish = before.provision_id === null && before.is_published;
    const after = await this.repo.update(
      id,
      mustUnpublish ? { imageRef: null, isPublished: false } : { imageRef: null },
      context.principalId
    );
    if (after === null) throw new NewArrivalValidationError('NOT_FOUND', 'That listing no longer exists.');

    await this.audit(context, 'RIK_NEW_ARRIVAL_IMAGE_REMOVED', id, listingAudit(before), {
      ...listingAudit(after),
      removedImageRef: before.image_ref,
      unpublishedBecauseImageRemoved: mustUnpublish,
      provisionImageChanged: false,
    });
    return { before, after, unpublished: mustUnpublish };
  }

  private async require(id: string): Promise<NewArrivalRecord> {
    const found = await this.repo.findById(id);
    if (found === null) throw new NewArrivalValidationError('NOT_FOUND', 'That listing does not exist.');
    return found;
  }

  private async audit(
    context: AuthContext,
    action: string,
    entityId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>
  ): Promise<void> {
    await this.auditLog.logEvent({
      actorId: context.principalId,
      actorRole: [...context.roles].sort().join(',') || 'STAFF',
      module: 'rik',
      action,
      entityType: 'rik.new_arrivals',
      entityId,
      before: before ?? undefined,
      after,
    });
  }
}

/** A window that closes before it opens is invisible forever while looking published. */
function assertWindow(from: string | null, until: string | null): void {
  if (from === null || until === null) return;
  if (until < from) {
    throw new NewArrivalValidationError(
      'INVALID_WINDOW',
      'The end date cannot be before the start date.',
      'publishedUntil'
    );
  }
}
