import { Injectable } from '@nestjs/common';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import type { AuthContext } from '../../auth/auth-context';
import {
  PromotionalBannersRepository,
  type PromotionalBannerRecord,
} from '../repositories/promotional-banners.repository';

/**
 * Seasonal promotional banners, as the Admin Portal manages them.
 *
 * WHAT THIS CAN AND CANNOT DO. It writes exactly one table,
 * rik.promotional_banners. It reads no provision, no pool, no scale, no
 * voucher and no eligibility row. Uploading a Diwali picture cannot change
 * what anybody is entitled to, and no code path here is capable of it.
 *
 * THE HERO IS NOT INVOLVED. The home screen's permanent hero is a committed
 * asset rendered by the customer app's own component. This service has no
 * reference to it, cannot address it, and cannot stop it rendering. A
 * customer with no active banner sees today's home screen unchanged.
 *
 * THE RULES THAT LIVE HERE RATHER THAN IN THE DTO:
 *   - a banner cannot be published without a picture, because a published
 *     banner with no image puts an empty box under the hero;
 *   - a window that closes before it opens is refused, because it looks
 *     published and shows nothing forever;
 *   - removing the picture of a published banner unpublishes it, rather than
 *     leaving a live banner in a state the database forbids.
 *
 * Every mutation is attributed in shared.audit_log before it returns.
 */

export class BannerValidationError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INVALID_WINDOW' | 'IMAGE_REQUIRED' | 'TITLE_REQUIRED',
    message: string,
    readonly field?: string
  ) {
    super(message);
    this.name = 'BannerValidationError';
  }
}

/** What goes in the audit trail. The picture is a key, never bytes. */
function bannerAudit(record: PromotionalBannerRecord): Record<string, unknown> {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    imageRef: record.image_ref,
    isPublished: record.is_published,
    startsOn: record.starts_on,
    endsOn: record.ends_on,
    displayOrder: record.display_order,
  };
}

/** A window that closes before it opens is invisible forever while looking published. */
function assertWindow(startsOn: string | null, endsOn: string | null): void {
  if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
    throw new BannerValidationError(
      'INVALID_WINDOW',
      'The end date cannot be before the start date.',
      'endsOn'
    );
  }
}

function assertTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new BannerValidationError('TITLE_REQUIRED', 'Give the banner a title.', 'title');
  }
  return trimmed;
}

@Injectable()
export class RikBannersService {
  constructor(
    private readonly repo: PromotionalBannersRepository,
    private readonly auditLog: AuditLogRepository
  ) {}

  /** Every banner, for the Admin Portal. */
  listForStaff(): Promise<PromotionalBannerRecord[]> {
    return this.repo.listAll();
  }

  /** Published, pictured and inside its window today. */
  listForCustomers(): Promise<PromotionalBannerRecord[]> {
    return this.repo.listActive();
  }

  async create(
    context: AuthContext,
    input: {
      title: string;
      description?: string | null;
      startsOn?: string | null;
      endsOn?: string | null;
      displayOrder?: number;
    }
  ): Promise<PromotionalBannerRecord> {
    const title = assertTitle(input.title);
    const startsOn = input.startsOn ?? null;
    const endsOn = input.endsOn ?? null;
    assertWindow(startsOn, endsOn);

    const created = await this.repo.insert(
      {
        title,
        description: input.description?.trim() || null,
        startsOn,
        endsOn,
        displayOrder: input.displayOrder ?? 0,
      },
      context.principalId
    );

    await this.audit(context, 'RIK_BANNER_CREATED', created.id, null, bannerAudit(created));
    return created;
  }

  async update(
    context: AuthContext,
    id: string,
    patch: {
      title?: string;
      description?: string | null;
      startsOn?: string | null;
      endsOn?: string | null;
      displayOrder?: number;
    }
  ): Promise<PromotionalBannerRecord> {
    const before = await this.require(id);

    const title = patch.title === undefined ? undefined : assertTitle(patch.title);

    // Validate the window as it will STAND after the patch, not as it was
    // sent: moving only the end date still has to respect the existing start.
    assertWindow(
      patch.startsOn === undefined ? before.starts_on : patch.startsOn,
      patch.endsOn === undefined ? before.ends_on : patch.endsOn
    );

    const after = await this.repo.update(
      id,
      {
        title,
        description:
          patch.description === undefined ? undefined : patch.description?.trim() || null,
        startsOn: patch.startsOn,
        endsOn: patch.endsOn,
        displayOrder: patch.displayOrder,
      },
      context.principalId
    );
    if (after === null) throw new BannerValidationError('NOT_FOUND', 'That banner does not exist.');

    await this.audit(context, 'RIK_BANNER_UPDATED', id, bannerAudit(before), bannerAudit(after));
    return after;
  }

  /**
   * Publish or unpublish.
   *
   * Publishing is refused without a picture. The database enforces the same
   * rule, but a CHECK violation reaches staff as a constraint name, and this
   * is a decision they can act on.
   */
  async setPublished(context: AuthContext, id: string, isPublished: boolean): Promise<PromotionalBannerRecord> {
    const before = await this.require(id);

    if (isPublished && before.image_ref === null) {
      throw new BannerValidationError(
        'IMAGE_REQUIRED',
        'Upload the banner picture before publishing it.',
        'imageRef'
      );
    }

    const after = await this.repo.setPublished(id, isPublished, context.principalId);
    if (after === null) throw new BannerValidationError('NOT_FOUND', 'That banner does not exist.');

    await this.audit(
      context,
      isPublished ? 'RIK_BANNER_PUBLISHED' : 'RIK_BANNER_UNPUBLISHED',
      id,
      bannerAudit(before),
      bannerAudit(after)
    );
    return after;
  }

  /**
   * Attach or replace the picture.
   *
   * Returns the previous key as well, so the controller can delete the file
   * that is no longer referenced — after the row has been updated, never
   * before, so a failed write can never orphan a live banner's image.
   */
  async setImage(
    context: AuthContext,
    id: string,
    imageRef: string
  ): Promise<{ before: PromotionalBannerRecord; after: PromotionalBannerRecord }> {
    const before = await this.require(id);
    const after = await this.repo.setImageRef(id, imageRef, context.principalId);
    if (after === null) throw new BannerValidationError('NOT_FOUND', 'That banner does not exist.');

    await this.audit(context, 'RIK_BANNER_IMAGE_SET', id, bannerAudit(before), bannerAudit(after));
    return { before, after };
  }

  /**
   * Remove the picture.
   *
   * A published banner cannot exist without one, so removing the picture
   * takes it off the home screen in the same statement. The response says so
   * explicitly rather than letting staff discover it.
   */
  async removeImage(
    context: AuthContext,
    id: string
  ): Promise<{ before: PromotionalBannerRecord; after: PromotionalBannerRecord; unpublished: boolean }> {
    const before = await this.require(id);
    const unpublished = before.is_published;

    if (unpublished) {
      await this.repo.setPublished(id, false, context.principalId);
    }
    const after = await this.repo.setImageRef(id, null, context.principalId);
    if (after === null) throw new BannerValidationError('NOT_FOUND', 'That banner does not exist.');

    await this.audit(context, 'RIK_BANNER_IMAGE_REMOVED', id, bannerAudit(before), {
      ...bannerAudit(after),
      unpublished,
    });
    return { before, after, unpublished };
  }

  /** Delete the banner row. The caller deletes the file afterwards. */
  async remove(context: AuthContext, id: string): Promise<PromotionalBannerRecord> {
    const before = await this.require(id);
    const removed = await this.repo.remove(id);
    if (!removed) throw new BannerValidationError('NOT_FOUND', 'That banner does not exist.');

    await this.audit(context, 'RIK_BANNER_REMOVED', id, bannerAudit(before), { removed: true });
    return before;
  }

  private async require(id: string): Promise<PromotionalBannerRecord> {
    const found = await this.repo.findById(id);
    if (found === null) throw new BannerValidationError('NOT_FOUND', 'That banner does not exist.');
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
      entityType: 'rik.promotional_banners',
      entityId,
      before: before ?? undefined,
      after,
    });
  }
}
