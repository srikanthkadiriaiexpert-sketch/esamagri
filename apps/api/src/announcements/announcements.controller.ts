import { Controller, Get, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AccessTokenPrincipal } from '../auth/services/token.service';
import {
  CustomersRepository,
  isRikAuthorised,
} from '../shared/repositories/customers.repository';
import { RateLimit } from '../common/rate-limit.guard';
import { ListAnnouncementsQueryDto } from './dto/list-announcements.query.dto';
import { AnnouncementsService, type CustomerAnnouncement } from './announcements.service';

/**
 * The customer-facing announcement board (closes backlog NOT-1/NOT-2).
 *
 * The four screens that read it — the app home, the RIK home, the PIF
 * home and Notifications — have been calling `GET /announcements` since
 * they were written. Until now nothing answered, so each rendered its
 * honest "No announcements yet" empty state. This controller is the
 * route they were always addressed to; not one line of the app changes.
 *
 * AUTHENTICATED, NOT PUBLIC. `@UseGuards(JwtAuthGuard)` without
 * `@Public()` means a valid session is required, the same as every other
 * screen these notices appear on. Announcements are broadcast content
 * rather than secrets, but they are yard operational notices — issue
 * days, closures, delivery changes — and there is no reason for them to
 * be readable by anyone who can reach the port.
 *
 * READ ONLY, BY CONSTRUCTION. One GET. Writing stays where it already
 * is, behind `shared.announcement.manage` on the admin routes, and that
 * permission is not granted to a customer principal. Nothing here
 * weakens or duplicates that.
 *
 * RATE LIMIT 'read', the class the guard applies to GETs by default —
 * stated explicitly because this route is hit on nearly every screen
 * load and a future reader should see that it was considered rather
 * than inherited by accident.
 */
@Controller('announcements')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class AnnouncementsController {
  constructor(
    private readonly announcements: AnnouncementsService,
    private readonly customers: CustomersRepository
  ) {}

  /**
   * WHO MAY SEE RIK NOTICES IS DECIDED HERE, FROM THE DATABASE.
   *
   * `isRikAuthorised` is the same predicate the RIK guard and the customer
   * profile use, over the same `shared.customers` row, read fresh on every
   * request — so an officer deactivated a moment ago stops receiving RIK
   * notices on their very next load, and a resident the facility approved
   * starts receiving them without signing out. There is no second definition
   * of "is a RIK customer" anywhere in this request path.
   *
   * NOTHING IS TAKEN FROM THE REQUEST. The `audience` query parameter can
   * only narrow what this answer already permits — see `audiencesFor`.
   *
   * A NON-CUSTOMER PRINCIPAL IS NOT RIK-AUTHORISED. A staff member reaching
   * this customer-facing route has no `shared.customers` row, so they see the
   * all-customer and PIF notices and not the RIK ones. That is deliberately
   * the narrow answer: the admin portal reads announcements through its own
   * routes, and a route meant for residents should not quietly become a
   * second way for staff to read operational traffic.
   */
  @Get()
  @RateLimit('read')
  async list(
    @CurrentPrincipal() principal: AccessTokenPrincipal,
    @Query() query: ListAnnouncementsQueryDto
  ): Promise<CustomerAnnouncement[]> {
    const rikAuthorised =
      principal.principalType === 'CUSTOMER'
        ? isRikAuthorised(await this.customers.findRikAuthorisation(principal.principalId))
        : false;

    return this.announcements.listForCustomer(query.audience, rikAuthorised);
  }
}
