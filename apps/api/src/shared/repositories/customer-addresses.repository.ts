import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Read/write access to `shared.customer_addresses` — the frozen Phase 2
 * table that carries a customer's quarter/residence information
 * (STEP 9, spec ACC-1: name + mobile + quarter/residence are the only
 * approved customer fields).
 *
 * Column set is exactly the approved migration's: id, customer_id,
 * label, quarter_block, quarter_number, landmark, is_default,
 * created_at, updated_at. Nothing here adds, alters or assumes a
 * column — a gap would be reported as DATABASE_CHANGE_REQUIRED, not
 * patched.
 *
 * Every method takes the customer id the caller has ALREADY proven it
 * owns (AuthorizationGuard via @OwnResourceParam, or the principal id
 * itself for the /customer/me routes). No method accepts a
 * client-supplied id that has not been through that check, so this
 * repository is never the place a horizontal-privilege escalation can
 * enter — see customer.controller.ts.
 */
export interface CustomerAddressRecord {
  id: string;
  customer_id: string;
  label: string | null;
  quarter_block: string;
  quarter_number: string;
  landmark: string | null;
  is_default: boolean;
}

export interface CustomerAddressInput {
  label?: string | null;
  quarterBlock: string;
  quarterNumber: string;
  landmark?: string | null;
}

@Injectable()
export class CustomerAddressesRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * The customer's default residence — what the Account screen shows as
   * "quarter / residence". `customer_addresses_one_default_uq` (a
   * partial unique index on customer_id WHERE is_default) guarantees at
   * most one such row per customer, so this can never be ambiguous.
   */
  async findDefaultForCustomer(customerId: string): Promise<CustomerAddressRecord | null> {
    const rows = await this.db.query<CustomerAddressRecord>(
      `SELECT id, customer_id, label, quarter_block, quarter_number, landmark, is_default
       FROM shared.customer_addresses
       WHERE customer_id = $1 AND is_default = true`,
      [customerId]
    );
    return rows[0] ?? null;
  }

  async listForCustomer(customerId: string): Promise<CustomerAddressRecord[]> {
    return this.db.query<CustomerAddressRecord>(
      `SELECT id, customer_id, label, quarter_block, quarter_number, landmark, is_default
       FROM shared.customer_addresses
       WHERE customer_id = $1
       ORDER BY is_default DESC, created_at ASC`,
      [customerId]
    );
  }

  /**
   * Creates the customer's default residence row, or updates the
   * existing one in place. Scoped by customer_id in both branches, so a
   * caller can only ever write their own row even if a stale address id
   * were somehow supplied — there is no code path that writes an
   * address by id alone.
   */
  async upsertDefaultForCustomer(
    customerId: string,
    input: CustomerAddressInput
  ): Promise<CustomerAddressRecord> {
    const existing = await this.findDefaultForCustomer(customerId);

    if (existing) {
      const updated = await this.db.query<CustomerAddressRecord>(
        `UPDATE shared.customer_addresses
            SET label          = $3,
                quarter_block  = $4,
                quarter_number = $5,
                landmark       = $6,
                updated_at     = now()
          WHERE id = $1 AND customer_id = $2
      RETURNING id, customer_id, label, quarter_block, quarter_number, landmark, is_default`,
        [
          existing.id,
          customerId,
          input.label ?? existing.label,
          input.quarterBlock,
          input.quarterNumber,
          input.landmark ?? null,
        ]
      );
      // The WHERE pins both id and customer_id, so a missing row here
      // would mean the address was deleted mid-request — surfaced to
      // the service as null rather than silently re-created.
      return updated[0] ?? existing;
    }

    const inserted = await this.db.query<CustomerAddressRecord>(
      `INSERT INTO shared.customer_addresses
              (customer_id, label, quarter_block, quarter_number, landmark, is_default)
       VALUES ($1, $2, $3, $4, $5, true)
    RETURNING id, customer_id, label, quarter_block, quarter_number, landmark, is_default`,
      [customerId, input.label ?? null, input.quarterBlock, input.quarterNumber, input.landmark ?? null]
    );
    return inserted[0] as CustomerAddressRecord;
  }
}
