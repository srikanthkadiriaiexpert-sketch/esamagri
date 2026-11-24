import { Injectable, Logger } from '@nestjs/common';
import {
  CustomersRepository,
  isRikAuthorised,
} from '../../shared/repositories/customers.repository';
import {
  CustomerAddressesRepository,
  type CustomerAddressRecord,
} from '../../shared/repositories/customer-addresses.repository';

/**
 * The customer's own profile, assembled from the two frozen Phase 2
 * tables that hold the approved fields (spec ACC-1):
 *
 *   shared.customers           → name, mobile_number
 *   shared.customer_addresses  → quarter/residence (default row)
 *
 * Nothing else is read or returned. No Aadhaar/PAN/service number/rank/
 * unit/family field exists in this shape, and none is invented — the
 * specification limits the customer record to name, mobile number and
 * quarter/residence.
 *
 * Authorization is NOT performed here. Every caller reaches this
 * service only after JwtAuthGuard + AuthorizationGuard have established
 * the principal and (for id-addressed routes) proven ownership, and the
 * customer id passed in is either the principal's own id or an id the
 * guard has already matched against it. Keeping the check in the guard
 * layer — not scattered through services — is what makes the ownership
 * rule auditable in one place.
 */
export class CustomerNotFoundError extends Error {
  constructor(message = 'Customer not found.') {
    super(message);
    this.name = 'CustomerNotFoundError';
  }
}

export interface CustomerResidence {
  label: string | null;
  quarterBlock: string;
  quarterNumber: string;
  landmark: string | null;
}

export interface CustomerProfile {
  customerId: string;
  name: string;
  mobileNumber: string;
  /**
   * PV / EV / NV, or null when it has not been recorded.
   *
   * Never defaulted. A customer with no preference recorded is shown a
   * prompt, not somebody else's ration — see STEP 11D.
   */
  dietaryPreference: 'PV' | 'EV' | 'NV' | null;
  /** null when the customer has not recorded a residence yet — an empty state, not an error. */
  residence: CustomerResidence | null;
  /**
   * Whether this customer has an approved, active RIK profile.
   *
   * The Customer App uses it to decide whether to OFFER the RIK module. It is
   * a convenience for the interface and nothing more: every RIK route is
   * independently refused by AuthorizationGuard's @RequireRikCustomer check,
   * so a client that ignored this flag, or forged it, would gain nothing.
   *
   * It is computed by `isRikAuthorised` — the same function the guard uses —
   * so what the app is told and what the server will allow cannot drift apart.
   */
  rikAuthorised: boolean;
}

export interface UpdateCustomerProfileInput {
  name?: string;
  /**
   * The officer's own dietary preference (STEP 11E).
   *
   * Self-service because it is a fact about the person, and until now
   * only SQL could set it — which left a customer whose preference had
   * never been recorded permanently unable to see any ration at all.
   *
   * Changing it changes what FUTURE calculations produce. It cannot
   * touch a confirmed selection: that row carries its own basis and
   * rule snapshot, and the database refuses to rewrite either.
   */
  dietaryPreference?: 'PV' | 'EV' | 'NV';
  quarterBlock?: string;
  quarterNumber?: string;
  landmark?: string | null;
  label?: string | null;
}

@Injectable()
export class CustomerProfileService {
  private readonly logger = new Logger(CustomerProfileService.name);

  constructor(
    private readonly customers: CustomersRepository,
    private readonly addresses: CustomerAddressesRepository
  ) {}

  async getProfile(customerId: string): Promise<CustomerProfile> {
    const customer = await this.customers.findById(customerId);
    if (!customer || !customer.is_active) {
      // Ownership was already proven upstream, so this is a genuinely
      // missing/deactivated account (e.g. soft-deleted between token
      // issuance and this request), never a probe for someone else's id.
      throw new CustomerNotFoundError();
    }

    const address = await this.addresses.findDefaultForCustomer(customerId);
    const rikAuthorisation = await this.customers.findRikAuthorisation(customerId);
    return this.toProfile(
      customer.id,
      customer.name,
      customer.mobile_number,
      address,
      customer.dietary_preference ?? null,
      isRikAuthorised(rikAuthorisation)
    );
  }

  /**
   * Updates only the approved, customer-editable fields. A residence
   * update requires both quarter_block and quarter_number, because the
   * frozen table declares both NOT NULL — a half-filled residence is
   * rejected by validation rather than written as an empty string.
   */
  async updateProfile(customerId: string, input: UpdateCustomerProfileInput): Promise<CustomerProfile> {
    const existing = await this.customers.findById(customerId);
    if (!existing || !existing.is_active) {
      throw new CustomerNotFoundError();
    }

    let name = existing.name;
    if (input.name !== undefined) {
      const updated = await this.customers.updateName(customerId, input.name);
      if (!updated) throw new CustomerNotFoundError();
      name = updated.name;
    }

    let dietaryPreference = existing.dietary_preference ?? null;
    if (input.dietaryPreference !== undefined) {
      const updated = await this.customers.updateDietaryPreference(customerId, input.dietaryPreference);
      if (!updated) throw new CustomerNotFoundError();
      dietaryPreference = updated.dietary_preference ?? null;
      this.logger.log(`Customer dietary preference recorded (customerId=${customerId})`);
    }

    let address = await this.addresses.findDefaultForCustomer(customerId);
    if (input.quarterBlock !== undefined && input.quarterNumber !== undefined) {
      address = await this.addresses.upsertDefaultForCustomer(customerId, {
        label: input.label ?? null,
        quarterBlock: input.quarterBlock,
        quarterNumber: input.quarterNumber,
        landmark: input.landmark ?? null,
      });
    }

    this.logger.log(`Customer profile updated (customerId=${customerId})`);
    // Re-read the authorisation rather than assuming it is unchanged: a
    // profile update and a RIK approval can happen in either order, and a
    // stale false here would hide the module from someone just approved.
    const rikAuthorisation = await this.customers.findRikAuthorisation(customerId);
    return this.toProfile(
      customerId,
      name,
      existing.mobile_number,
      address,
      dietaryPreference,
      isRikAuthorised(rikAuthorisation)
    );
  }

  private toProfile(
    customerId: string,
    name: string,
    mobileNumber: string,
    address: CustomerAddressRecord | null,
    dietaryPreference: 'PV' | 'EV' | 'NV' | null,
    rikAuthorised: boolean
  ): CustomerProfile {
    return {
      customerId,
      name,
      mobileNumber,
      dietaryPreference,
      rikAuthorised,
      residence: address
        ? {
            label: address.label,
            quarterBlock: address.quarter_block,
            quarterNumber: address.quarter_number,
            landmark: address.landmark,
          }
        : null,
    };
  }
}
