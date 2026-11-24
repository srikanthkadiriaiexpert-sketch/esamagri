import { Controller, Get, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RikIncomingRequestService } from './services/rik-incoming-request.service';
import { IncomingRequestQueryDto } from './dto/rik-incoming-request.dto';

/**
 * Incoming RIK requests (PHASE B) — confirmed selections awaiting a voucher.
 *
 * AUTHORIZATION — NO NEW ROLE, NO NEW PERMISSION.
 *
 * `rik.order.manage`, exactly as RikIssueVouchersController requires. That
 * is the right code and not merely a convenient one: every row this
 * endpoint returns exists to be acted on by POSTing it to that controller,
 * so anyone who can see the queue can already work it, and anyone who
 * cannot work it has no operational reason to read the officers' names,
 * mobile numbers and home addresses it carries. The approved seed grants
 * `rik.order.manage` to RIK_ADMIN (and, since migration 0050, SUPER_ADMIN)
 * and to nobody else.
 *
 * DELIVERY_STAFF HOLDS NO rik.* PERMISSION AT ALL and so cannot reach this
 * route — which matters more here than on most screens, because this one
 * lists home addresses. RIK_PICKUP_STAFF holds `rik.order.mark_ready` and
 * `rik.order.mark_collected`, neither of which appears below.
 *
 * THERE IS ONE ROUTE AND IT IS A GET. No POST, no PATCH, no delete, and no
 * "mark as processed" — a request leaves this queue by acquiring a voucher
 * through the existing /admin/rik/issue-vouchers endpoint and by no other
 * means. There is deliberately no second way to make work disappear.
 */
@Controller('admin/rik/incoming-requests')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class RikIncomingRequestsController {
  constructor(private readonly requests: RikIncomingRequestService) {}

  @Get()
  @RequirePermissions('rik.order.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async list(@Query() query: IncomingRequestQueryDto) {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const { items, total } = await this.requests.list({
      q: query.q,
      rationType: query.rationType,
      fulfillmentMode: query.fulfillmentMode,
      periodId: query.periodId,
      confirmedFrom: query.confirmedFrom,
      confirmedTo: query.confirmedTo,
      limit,
      offset,
    });
    return { items, total, limit, offset };
  }
}
