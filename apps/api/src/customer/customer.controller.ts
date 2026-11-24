import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ERROR_CODES } from '@esamagri/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import { OwnResourceParam } from '../auth/decorators/own-resource-param.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AccessTokenPrincipal } from '../auth/services/token.service';
import { UpdateCustomerProfileDto } from './dto/update-profile.dto';
import { CustomerNotFoundError, CustomerProfileService, type CustomerProfile } from './services/customer-profile.service';

/**
 * The customer's own profile (STEP 9).
 *
 * Two route shapes, both server-authoritative about ownership:
 *
 *  - `/customer/me`            — identity comes from the verified access
 *                                token's principal. No id is accepted
 *                                from the client at all, so there is no
 *                                id to tamper with. This is what the
 *                                customer app actually calls.
 *  - `/customer/:customerId`   — the addressable form, guarded by
 *                                @RequireCustomer + @OwnResourceParam.
 *                                AuthorizationGuard compares the URL id
 *                                to the authenticated principal BEFORE
 *                                the handler runs; a mismatch is 403
 *                                with the same generic body whether or
 *                                not that other customer exists, so it
 *                                cannot be used to probe valid ids.
 *
 * Neither shape trusts a customer id, role, permission or module
 * selection supplied by the browser (kickoff Section 17). A STAFF
 * principal — including SUPER_ADMIN — is 403 on every route here, not
 * 401: these are a customer's own records, and staff access to customer
 * data is a separate, permission-gated admin concern for a later phase.
 *
 * Guard order matters: JwtAuthGuard (401, is the caller authenticated
 * at all?) always runs before AuthorizationGuard (403, may THIS caller
 * reach THIS resource?).
 */
@Controller('customer')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class CustomerController {
  constructor(private readonly profiles: CustomerProfileService) {}

  /** The authenticated customer's own profile — no id crosses the wire. */
  @Get('me')
  @RequireCustomer()
  async getOwnProfile(@CurrentPrincipal() principal: AccessTokenPrincipal): Promise<CustomerProfile> {
    return this.load(principal.principalId);
  }

  /**
   * Same profile, addressed by id. Ownership is proven by the guard, so
   * by the time this runs `customerId` is guaranteed to equal the
   * authenticated principal's id.
   */
  @Get(':customerId')
  @RequireCustomer()
  @OwnResourceParam('customerId')
  async getProfileById(@Param('customerId') customerId: string): Promise<CustomerProfile> {
    return this.load(customerId);
  }

  /**
   * Updates the caller's own name and/or quarter/residence. The target
   * is always the principal's own id — a customer id in the body is
   * rejected by forbidNonWhitelisted rather than honoured, so there is
   * no body-borne path to another customer's row either.
   */
  @Patch('me')
  @RequireCustomer()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async updateOwnProfile(
    @CurrentPrincipal() principal: AccessTokenPrincipal,
    @Body() dto: UpdateCustomerProfileDto
  ): Promise<CustomerProfile> {
    try {
      return await this.profiles.updateProfile(principal.principalId, {
        name: dto.name,
        quarterBlock: dto.quarterBlock,
        quarterNumber: dto.quarterNumber,
        landmark: dto.landmark,
        label: dto.label,
        dietaryPreference: dto.dietaryPreference,
      });
    } catch (err: unknown) {
      throw this.toHttp(err);
    }
  }

  private async load(customerId: string): Promise<CustomerProfile> {
    try {
      return await this.profiles.getProfile(customerId);
    } catch (err: unknown) {
      throw this.toHttp(err);
    }
  }

  /**
   * Domain error → HTTP, without leaking driver text. Anything that is
   * not a known domain error is re-thrown untouched so Nest's own
   * handling applies — a database or stack-trace detail is never shaped
   * into a customer-visible message here (kickoff Section 15).
   */
  private toHttp(err: unknown): unknown {
    if (err instanceof CustomerNotFoundError) {
      return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Customer not found.' });
    }
    return err;
  }
}
