import { Injectable } from '@nestjs/common';
import {
  AnnouncementsRepository,
  type ActiveAnnouncementRecord,
  type AnnouncementAudience,
  type AnnouncementPriority,
} from '../shared/repositories/announcements.repository';
import type { CustomerAudienceFilter } from './dto/list-announcements.query.dto';

/**
 * What the customer app receives. The field names are the app's, not the
 * database's — `body` is `message` there and `target_audience` is
 * `audience` — so the mapping below is the one place the two vocabularies
 * meet.
 */
export interface CustomerAnnouncement {
  id: string;
  title: string;
  message: string;
  priority: AnnouncementPriority;
  audience: AnnouncementAudience;
  publishedAt: string;
  dismissible: boolean;
}

/**
 * The customer's view of the announcement board (closes backlog NOT-1).
 *
 * WHAT THIS SERVICE IS RESPONSIBLE FOR, and it is exactly one thing:
 * deciding which audiences the caller may see. Migration 0022's view
 * comment assigns it here in writing — "the backend service is
 * responsible for filtering by target_audience for the requesting
 * customer context" — because the database cannot know which module a
 * reader is standing in.
 *
 * WHAT IT IS NOT RESPONSIBLE FOR is whether an announcement is live at
 * all. Published, not-deleted and in-date are the view's conditions and
 * are applied before a row ever reaches this file. Nothing here can show
 * a draft, a withdrawn notice or an expired one, because nothing here is
 * given one.
 *
 * READ ONLY. This service holds no create, update or delete path. The
 * admin side keeps sole authorship through
 * `shared.announcement.manage`, which no customer holds.
 */
@Injectable()
export class AnnouncementsService {
  constructor(private readonly announcements: AnnouncementsRepository) {}

  /**
   * `ALL` IS ALWAYS INCLUDED, for every caller and every filter.
   *
   * An all-customer notice — a holiday closure, a yard-wide operational
   * change — is the kind that matters most, and a reader who happens to
   * be inside the PIF shop when it is published must still see it.
   * Treating `ALL` as a third mutually-exclusive audience would hide
   * precisely the announcements with the widest reach.
   *
   * ================================================================
   * RIK NOTICES REACH RIK CUSTOMERS, AND NOBODY ELSE.
   * ================================================================
   *
   * `rikAuthorised` is the server's own answer, read from
   * `shared.customers.rik_id` for the authenticated principal. It is never
   * taken from the request.
   *
   * With no filter, a RIK customer gets all three audiences and a PIF-only
   * resident gets `ALL` and `PIF`. This matters beyond tidiness: RIK notices
   * are operational — issue days, yard closures, entitlement changes — and a
   * resident with no ration entitlement reading "Dry issue moves to Thursday"
   * is being shown facility information that does not concern them and that
   * they cannot act on.
   *
   * THE FILTER CAN ONLY NARROW, NEVER WIDEN. A PIF-only caller asking for
   * `RIK` gets `ALL` alone — the intersection, not their request. So the
   * query parameter remains what it was for, letting a reader standing in one
   * module see that module's notices, and cannot become a way to read the
   * other module's.
   */
  private audiencesFor(
    filter: CustomerAudienceFilter | undefined,
    rikAuthorised: boolean
  ): AnnouncementAudience[] {
    const permitted: AnnouncementAudience[] = rikAuthorised
      ? ['ALL', 'RIK', 'PIF']
      : ['ALL', 'PIF'];

    if (filter === undefined) return permitted;
    // Intersection: the caller may choose among what they are entitled to see.
    return permitted.filter((audience) => audience === 'ALL' || audience === filter);
  }

  async listForCustomer(
    filter: CustomerAudienceFilter | undefined,
    rikAuthorised: boolean
  ): Promise<CustomerAnnouncement[]> {
    const rows = await this.announcements.listActiveForAudiences(
      this.audiencesFor(filter, rikAuthorised)
    );
    return rows.map((row) => this.toCustomerAnnouncement(row));
  }

  private toCustomerAnnouncement(row: ActiveAnnouncementRecord): CustomerAnnouncement {
    return {
      id: row.id,
      title: row.title,
      message: row.body,
      priority: row.priority,
      audience: row.target_audience,
      /*
       * `published_at` is nullable on the table. Every row reaching here
       * IS published — the view guarantees it — but a row published by a
       * path that left the timestamp unset would otherwise send the app
       * a null where it renders a date, and `new Date(null)` is 1970.
       * `created_at` is the honest nearest fact, and it is never null.
       */
      publishedAt: row.published_at ?? row.created_at,
      /*
       * APPROVED AS A CONSTANT, not a rule in disguise. The table has no
       * `dismissible` column, so there is nothing to read; returning a
       * fixed `true` keeps the app's contract satisfied without this
       * service inventing a policy — such as "URGENT cannot be
       * dismissed" — that no administrator could see or change. When
       * dismissal becomes a real decision it needs a column and a
       * migration, and this line is where it will read from.
       */
      dismissible: true,
    };
  }
}
