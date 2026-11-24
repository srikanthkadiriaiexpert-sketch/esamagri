import { Injectable, Logger } from '@nestjs/common';
import {
  AnnouncementsRepository,
  type AnnouncementAudience,
  type AnnouncementRecord,
  type AnnouncementPriority,
  type AnnouncementType,
} from '../../shared/repositories/announcements.repository';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import type { AuthContext } from '../../auth/auth-context';
import { canManageAudience, manageableAudiences, readableAudiences } from './announcement-scope';

export class AnnouncementAudienceForbiddenError extends Error {
  constructor(message = 'You cannot manage announcements for that audience.') {
    super(message);
    this.name = 'AnnouncementAudienceForbiddenError';
  }
}

export class AnnouncementNotFoundError extends Error {
  constructor(message = 'Announcement not found.') {
    super(message);
    this.name = 'AnnouncementNotFoundError';
  }
}

export interface AnnouncementView {
  id: string;
  title: string;
  body: string;
  announcementType: AnnouncementType;
  targetAudience: AnnouncementAudience;
  priority: AnnouncementPriority;
  startDate: string;
  endDate: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Announcement administration (STEP 10 Section 7).
 *
 * Two independent gates protect every path here, and both are
 * server-side:
 *
 *  1. AuthorizationGuard requires `shared.announcement.manage` before a
 *     handler runs at all (the approved seed grants it to SUPER_ADMIN,
 *     RIK_ADMIN and PIF_ADMIN).
 *  2. This service then checks the AUDIENCE against the caller's module
 *     scope — see announcement-scope.ts. Holding the permission is not
 *     sufficient to reach another module's announcements.
 *
 * Gate 2 is applied to the row's CURRENT audience on update, not just
 * to the submitted payload, so a PIF_ADMIN cannot edit an existing RIK
 * announcement by simply omitting the audience field.
 *
 * Every successful create/update is written to the existing
 * shared.audit_log via AuditLogRepository — the same audit path STEP 7
 * already uses for denials. No second audit system is introduced.
 */
@Injectable()
export class AdminAnnouncementsService {
  private readonly logger = new Logger(AdminAnnouncementsService.name);

  constructor(
    private readonly announcements: AnnouncementsRepository,
    private readonly auditLog: AuditLogRepository
  ) {}

  async list(context: AuthContext): Promise<{ items: AnnouncementView[]; manageableAudiences: readonly AnnouncementAudience[] }> {
    const readable = readableAudiences(context);
    const items = readable.length === 0 ? [] : await this.announcements.listForAudiences(readable);
    return {
      items: items.map(toView),
      // The UI uses this to decide which audience options to offer; the
      // server re-checks on every write regardless of what it sends.
      manageableAudiences: manageableAudiences(context),
    };
  }

  async countVisible(context: AuthContext): Promise<number> {
    const readable = readableAudiences(context);
    return readable.length === 0 ? 0 : this.announcements.countForAudiences(readable);
  }

  async create(
    context: AuthContext,
    input: {
      title: string;
      body: string;
      announcementType: AnnouncementType;
      targetAudience: AnnouncementAudience;
      priority: AnnouncementPriority;
      startDate?: string;
      endDate?: string | null;
      isPublished: boolean;
    }
  ): Promise<AnnouncementView> {
    if (!canManageAudience(context, input.targetAudience)) {
      throw new AnnouncementAudienceForbiddenError();
    }

    const created = await this.announcements.create({ ...input, createdBy: context.principalId });

    await this.auditLog.logEvent({
      actorId: context.principalId,
      actorRole: [...context.roles].sort().join(',') || 'STAFF',
      module: 'shared',
      action: 'ANNOUNCEMENT_CREATED',
      entityType: 'shared.announcements',
      entityId: created.id,
      after: {
        targetAudience: created.target_audience,
        priority: created.priority,
        isPublished: created.is_published,
      },
    });

    this.logger.log(`Announcement created (id=${created.id}, audience=${created.target_audience})`);
    return toView(created);
  }

  async update(
    context: AuthContext,
    id: string,
    input: { title?: string; body?: string; priority?: AnnouncementPriority; isPublished?: boolean; endDate?: string | null }
  ): Promise<AnnouncementView> {
    const existing = await this.announcements.findById(id);
    if (!existing) {
      throw new AnnouncementNotFoundError();
    }
    // Checked against the row's OWN audience: a module admin cannot edit
    // another module's announcement even though they hold the permission.
    if (!canManageAudience(context, existing.target_audience)) {
      throw new AnnouncementAudienceForbiddenError();
    }

    const updated = await this.announcements.update(id, { ...input, updatedBy: context.principalId });
    if (!updated) {
      throw new AnnouncementNotFoundError();
    }

    await this.auditLog.logEvent({
      actorId: context.principalId,
      actorRole: [...context.roles].sort().join(',') || 'STAFF',
      module: 'shared',
      action: 'ANNOUNCEMENT_UPDATED',
      entityType: 'shared.announcements',
      entityId: updated.id,
      before: { priority: existing.priority, isPublished: existing.is_published },
      after: { priority: updated.priority, isPublished: updated.is_published },
    });

    return toView(updated);
  }
}

function toView(r: AnnouncementRecord): AnnouncementView {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    announcementType: r.announcement_type,
    targetAudience: r.target_audience,
    priority: r.priority,
    startDate: r.start_date,
    endDate: r.end_date,
    isPublished: r.is_published,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
