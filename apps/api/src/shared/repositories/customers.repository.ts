import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * The two facts that decide whether a customer may use RIK.
 *
 * Returned as data rather than as a boolean so the authorisation layer can
 * tell "has no RIK profile" from "has one but is deactivated" and record the
 * distinction in the audit log. The RIK ID itself never leaves that layer.
 */
export interface CustomerRikAuthorisation {
  customerId: string;
  rikId: string | null;
  isActive: boolean;
}

/**
 * Whether these facts amount to an approved, active RIK profile.
 *
 * THE POINT OF THIS FUNCTION IS THAT THERE IS ONLY ONE OF IT. Two callers need
 * the answer: AuthorizationGuard, which REFUSES a request, and the customer
 * profile, which tells the Customer App whether to show the RIK module. If
 * those two ever disagreed, a resident would be shown a module every request
 * to which is refused, or — far worse — the module would be hidden from
 * someone entitled to it and nobody would notice, because nothing would error.
 *
 * So the predicate lives here, both callers use it, and a spec asserts they
 * agree for every case.
 */
export function isRikAuthorised(authorisation: CustomerRikAuthorisation | null): boolean {
  return authorisation !== null && authorisation.isActive && authorisation.rikId !== null;
}

export interface CustomerRecord {
  id: string;
  mobile_number: string;
  name: string;
  is_active: boolean;
  /** null until it has been recorded. Never defaulted — see STEP 11D. */
  dietary_preference?: 'PV' | 'EV' | 'NV' | null;
}

/**
 * Read access to shared.customers for authentication purposes, plus PIF
 * self-registration.
 *
 * REGISTRATION USED TO BE ABSENT FROM THIS FILE, and the comment that stood
 * here explained why: `name` is NOT NULL and OTP-only registration had no
 * source for it, which was recorded as a BUSINESS_DECISION_REQUIRED item.
 * That decision has now been taken — the registration form collects the name,
 * the quarter block and the quarter number — so `createPifCustomer` below is
 * the answer to it rather than an invention.
 */
@Injectable()
export class CustomersRepository {
  constructor(private readonly db: DatabaseService) {}

  async findByMobileNumber(mobileNumber: string): Promise<CustomerRecord | null> {
    const rows = await this.db.query<CustomerRecord>(
      `SELECT id, mobile_number, name, is_active, dietary_preference
       FROM shared.customers
       WHERE mobile_number = $1 AND deleted_at IS NULL`,
      [mobileNumber]
    );
    return rows[0] ?? null;
  }

  /**
   * Whether this customer has an approved, active RIK profile.
   *
   * Reads the SAME `shared.customers` row the customer app authenticates
   * against — there is no second customer identity, no parallel table and no
   * cached copy. It is deliberately a fresh query per request that needs it:
   * an officer deactivated a moment ago must lose RIK access on their very
   * next request, not when a token expires, which is the same rule
   * AuthorizationService applies to staff roles.
   *
   * Only the three columns the decision needs are selected. `rik_id` is
   * returned so the caller can distinguish a PIF-only resident from a
   * deactivated officer; it is used for that decision and nothing else.
   */
  async findRikAuthorisation(customerId: string): Promise<CustomerRikAuthorisation | null> {
    const rows = await this.db.query<{ id: string; rik_id: string | null; is_active: boolean }>(
      `SELECT id, rik_id, is_active
         FROM shared.customers
        WHERE id = $1 AND deleted_at IS NULL`,
      [customerId]
    );
    const row = rows[0];
    if (row === undefined) return null;
    return { customerId: row.id, rikId: row.rik_id, isActive: row.is_active };
  }

  /**
   * Added for STEP 7's own-profile ownership-check demo
   * (`GET /demo/authz/customer/:customerId/profile`) — the caller is
   * always required (by AuthorizationGuard, via `@OwnResourceParam`)
   * to already be the authenticated customer with this exact id before
   * this is ever called, so this method itself does no further
   * authorization — it's a plain lookup, same as findByMobileNumber.
   */
  async findById(customerId: string): Promise<CustomerRecord | null> {
    const rows = await this.db.query<CustomerRecord>(
      `SELECT id, mobile_number, name, is_active, dietary_preference
       FROM shared.customers
       WHERE id = $1 AND deleted_at IS NULL`,
      [customerId]
    );
    return rows[0] ?? null;
  }

  /**
   * STEP 9 — updates the customer's own display name, and nothing else.
   *
   * `mobile_number` is deliberately NOT updatable here: it is the
   * identity STEP 6 authenticates against (shared.customers.mobile_uq,
   * the OTP flow's lookup key), so changing it is an account-recovery
   * decision with its own verification requirements, not a profile
   * edit. That policy is a NEW BUSINESS DECISION REQUIRED item
   * surfaced during STEP 9 — proposed and open, deliberately NOT added
   * to the authoritative Open Decisions Register, and not invented
   * here. Until the client decides it, the number is read-only.
   *
   * The WHERE pins the customer id the caller has already been proven
   * to own; there is no variant of this method that updates a row by
   * any other key.
   */
  async updateName(customerId: string, name: string): Promise<CustomerRecord | null> {
    const rows = await this.db.query<CustomerRecord>(
      `UPDATE shared.customers
          SET name = $2, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
    RETURNING id, mobile_number, name, is_active, dietary_preference`,
      [customerId, name]
    );
    return rows[0] ?? null;
  }

  /**
   * Record the customer's own dietary preference (STEP 11E).
   *
   * This changes what FUTURE calculations produce and nothing else. A
   * confirmed selection carries its own basis and its own rule
   * snapshot, and migration 0029 makes both physically unwritable once
   * confirmed — so there is no path from this update to a past issue,
   * by design rather than by care.
   */
  /**
   * Create a PIF-only customer, or hand back the one that already exists.
   *
   * `rik_id` IS PASSED EXPLICITLY AS NULL. The column has a DEFAULT that calls
   * shared.format_officer_rik_id(nextval(...)), and a default fires only when
   * the column is OMITTED — which is exactly how officer registration issues
   * an identifier. Naming the column and sending NULL is what keeps a resident
   * who registers for PIF from being handed an officer identifier nobody
   * authorised. Requirement 3.
   *
   * `dietary_preference` is not in the column list at all, so it stays NULL.
   * Requirement 8.
   *
   * ON CONFLICT (mobile_number) DO NOTHING is what makes this safe to call
   * twice. `customers_mobile_uq` already guarantees one account per number;
   * this turns a concurrent second attempt from a 500 into a no-op, and the
   * caller reads the winner's row. Two residents racing on the same number
   * cannot produce two accounts, and neither can one resident double-tapping.
   *
   * The address is written in the SAME transaction: a resident with no quarter
   * cannot be delivered to, and a half-registered account would have consumed
   * the mobile number — which is unique — leaving them unable to try again.
   *
   * UNTIL MIGRATION 0065 IS APPLIED THIS WILL FAIL at the database, because
   * rik_id is still NOT NULL. That is expected: the schema change is a
   * separate reviewed deliverable, and PIF_SELF_REGISTRATION_ENABLED keeps the
   * endpoint unreachable in the meantime.
   */
  async createPifCustomer(input: {
    mobileNumber: string;
    name: string;
    quarterBlock: string;
    quarterNumber: string;
  }): Promise<{ customer: CustomerRecord; created: boolean }> {
    const customerId = await this.db.withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO shared.customers (mobile_number, name, is_active, rik_id)
         VALUES ($1, $2, true, NULL)
         ON CONFLICT (mobile_number) DO NOTHING
         RETURNING id`,
        [input.mobileNumber, input.name]
      );
      if (inserted.rows.length === 0) return null;

      const id = inserted.rows[0]!.id;
      await client.query(
        `INSERT INTO shared.customer_addresses
           (customer_id, label, quarter_block, quarter_number, landmark, is_default)
         VALUES ($1, 'Quarter', $2, $3, NULL, true)`,
        [id, input.quarterBlock, input.quarterNumber]
      );
      return id;
    });

    if (customerId === null) {
      // The number was already registered. Read that account back and report
      // that nothing was created, so the caller can sign the resident in
      // rather than failing or creating a duplicate.
      const existing = await this.findByMobileNumber(input.mobileNumber);
      if (existing === null) {
        // The row exists (the INSERT conflicted) but is soft-deleted, so
        // findByMobileNumber filters it out. The number is taken and cannot be
        // reused: mobile_number is unique across the whole table.
        throw new Error('MOBILE_NUMBER_UNAVAILABLE');
      }
      return { customer: existing, created: false };
    }

    const created = await this.findById(customerId);
    if (created === null) {
      // The row was committed in this process; a null here would mean the
      // transaction lied about its own result.
      throw new Error(`Customer ${customerId} was created but cannot be read back.`);
    }
    return { customer: created, created: true };
  }

  async updateDietaryPreference(
    customerId: string,
    dietaryPreference: 'PV' | 'EV' | 'NV'
  ): Promise<CustomerRecord | null> {
    const rows = await this.db.query<CustomerRecord>(
      `UPDATE shared.customers
          SET dietary_preference = $2, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
    RETURNING id, mobile_number, name, is_active, dietary_preference`,
      [customerId, dietaryPreference]
    );
    return rows[0] ?? null;
  }
}
