import type { IssueVoucherRecord } from './repositories/issue-vouchers.repository';

/**
 * The voucher projection the operational LIST returns.
 *
 * WHY THIS IS ITS OWN MODULE. It lived in RikIssueVouchersController, which
 * means importing it dragged in JwtAuthGuard, AuthorizationGuard, TokenService
 * and @nestjs/jwt — a chain no unit test should need in order to check which
 * fields a response carries. The only import here is a TYPE, which TypeScript
 * erases, so this file has no runtime dependencies at all and the spec beside
 * it runs without Nest and without a database. Same reasoning as
 * buildVoucherFilterClause in the repository.
 *
 * THIS PROJECTION IS A DISCLOSURE BOUNDARY, not a convenience. IssueVoucherRecord
 * carries more than the list should publish — the officer's quarter block,
 * quarter number and landmark, the pickup location's id, who released the
 * voucher, the period's start and end dates. Those belong to the DETAIL view,
 * which a staff member reaches by opening one voucher. Anything added here is
 * added to every row of every list response and to the CSV export of all
 * filtered records, so the spec pins the exact key set: a field that appears
 * here without a deliberate decision fails the test.
 *
 * The controller re-exports this so its own public surface is unchanged.
 */
/** A voucher as the operational list shows it. */
export function summaryView(v: IssueVoucherRecord) {
  return {
    voucherId: v.id,
    voucherNumber: v.voucher_number,
    selectionId: v.selection_id,
    selectionReference: v.selection_reference,
    officerId: v.customer_id,
    rikId: v.rik_id,
    officerName: v.officer_official_name ?? v.officer_name,
    mobileNumber: v.mobile_number,
    rationType: v.ration_type,
    fulfillmentMode: v.fulfillment_mode,
    // Where the ration goes. Both columns are already fetched by
    // VOUCHER_SELECT, so this adds no query, no join and no database change -
    // it stops dropping two values the row already carried. The server sets
    // exactly one per voucher according to fulfillment_mode and leaves the
    // other NULL, so a PICKUP voucher reports a location and a NULL address
    // and a DELIVERY voucher the reverse.
    //
    // Both are already visible to the same staff on the voucher detail and
    // fulfilment screens, and every route carrying this projection requires
    // `rik.order.manage`. Nothing here widens who may read what; it widens
    // what the LIST response includes, so the CSV export of all filtered
    // records can report a destination at all.
    pickupLocationName: v.pickup_location_name,
    deliveryAddress: v.delivery_address,
    status: v.status,
    periodId: v.period_id,
    periodName: v.period_name,
    issueDate: v.released_at,
    createdAt: v.created_at,
  };
}
