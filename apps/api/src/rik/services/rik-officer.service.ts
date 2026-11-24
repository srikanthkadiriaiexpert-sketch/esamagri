import { Injectable } from '@nestjs/common';
import type { AuthContext } from '../../auth/auth-context';
import { normaliseMobileOrNull } from '../../shared/mobile-number';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import { AuthSessionsRepository } from '../../shared/repositories/auth-sessions.repository';
import {
  OfficersRepository,
  type OfficerRecord,
} from '../repositories/officers.repository';

export class OfficerLinkConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficerLinkConflictError';
  }
}

/**
 * Officer registration and lookup (STEP 15B Phase A).
 *
 * RECONSTRUCTED from the approved Phase A report after the working container
 * was lost; not the recovered original bytes.
 *
 * REGISTRATION IS ADMINISTRATIVE, AND ONLY ADMINISTRATIVE
 *
 * There is no customer-facing sign-up. An officer exists in e-Samagri because
 * a RIK administrator registered them, which is why this service takes an
 * AuthContext and writes an audit row for every change it makes.
 *
 * WHAT IS COLLECTED, AND WHAT IS REFUSED
 *
 * Collected: name, mobile number, quarter (block, number, optional landmark)
 * and dietary preference. That is the whole list.
 *
 * NOT collected, because the specification prohibits it: service number,
 * rank, unit, Aadhaar, PAN. There is no column for any of them (migration
 * 0044 asserts their absence) and no field in the DTO, so a body carrying one
 * is refused by `forbidNonWhitelisted` before it reaches here.
 *
 * NOT collected either: eligible days. Eligibility is the facility's
 * operational data and arrives through its own import; registration does not
 * create an eligibility row, and an officer may never enter, edit, declare or
 * override the figure.
 *
 * THE IDENTIFIER IS NOT THIS SERVICE'S BUSINESS
 *
 * `rik_id` is issued by the database. This service never reads it before a
 * write, never composes one and never passes one down. It only reports the
 * identifier the database issued.
 */

export type OfficerValidationCode =
  | 'BLANK_FIELD'
  | 'INVALID_MOBILE'
  | 'DUPLICATE_MOBILE'
  | 'INVALID_DIETARY_PREFERENCE'
  | 'FIELD_TOO_LONG';

export class OfficerValidationError extends Error {
  readonly code: OfficerValidationCode;
  readonly field: string;

  constructor(code: OfficerValidationCode, field: string, message: string) {
    super(message);
    this.name = 'OfficerValidationError';
    this.code = code;
    this.field = field;
  }
}

export class OfficerNotFoundError extends Error {
  constructor(what: string) {
    super(`No officer matches ${what}.`);
    this.name = 'OfficerNotFoundError';
  }
}

const MAX_NAME = 120;
const MAX_QUARTER = 60;
const MAX_LANDMARK = 120;
const DIETS = ['PV', 'EV', 'NV'] as const;

/**
 * One mobile number to one canonical ten-digit form, or a refusal by name.
 *
 * Exported because Phase B's eligibility import must normalise the facility's
 * spreadsheet the SAME way this normalised the number at registration — two
 * different normalisations would mean an officer who can never be matched.
 * There is exactly one implementation and both paths call it.
 *
 * The implementation now lives in shared/mobile-number.ts, because customer
 * login and PIF self-registration must match the SAME way too, and AuthModule
 * deliberately does not depend on RikModule. This wrapper keeps RIK's own
 * error code, field name and message exactly as they were.
 *
 * What it tolerates: spaces, hyphens, brackets and dots anywhere; a leading
 * `+`; and the `+91` / `91` / `0` trunk prefixes an Indian number is written
 * with. What it does not tolerate: anything that is not then ten digits
 * starting 6, 7, 8 or 9. A number this refuses is refused by name, never
 * guessed at.
 */
export function normaliseMobile(value: string): string {
  const national = normaliseMobileOrNull(value);
  if (national === null) {
    throw new OfficerValidationError(
      'INVALID_MOBILE',
      'mobileNumber',
      'A mobile number must be ten digits beginning 6, 7, 8 or 9. +91, spaces and hyphens are accepted and removed.'
    );
  }
  return national;
}

function required(value: string | undefined | null, field: string, label: string): string {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') {
    throw new OfficerValidationError('BLANK_FIELD', field, `${label} is required.`);
  }
  return trimmed;
}

function withinLength(value: string, max: number, field: string, label: string): string {
  if (value.length > max) {
    throw new OfficerValidationError(
      'FIELD_TOO_LONG',
      field,
      `${label} must be ${max} characters or fewer.`
    );
  }
  return value;
}

export interface RegisterOfficerInput {
  name: string;
  mobileNumber: string;
  quarterBlock: string;
  quarterNumber: string;
  landmark?: string | null;
  /**
   * REQUIRED when registering a new officer; IGNORED when linking a resident
   * who already has an account. The DTO cannot enforce that, because which
   * path applies is only known after the mobile number has been normalised and
   * looked up — so the rule lives in `register()` below, where that lookup
   * happens.
   */
  dietaryPreference?: string;
}

/** What `register()` did, so the caller can tell the staff member. */
export type OfficerRegistrationOutcome = 'REGISTERED' | 'LINKED';

export interface RegisterOfficerResult {
  officer: OfficerRecord;
  outcome: OfficerRegistrationOutcome;
}

@Injectable()
export class RikOfficerService {
  constructor(
    private readonly officers: OfficersRepository,
    private readonly auditLog: AuditLogRepository,
    /**
     * Ending a customer's sessions. Comes from SharedModule, which RikModule
     * already imports and which already exports this repository — so adding
     * the capability needed no module wiring, no new provider and no
     * migration.
     */
    private readonly sessions: AuthSessionsRepository
  ) {}

  /**
   * Register a new officer, OR link a resident who already has an account.
   *
   * ONE ENTRY POINT, TWO OUTCOMES. The project owner's instruction was to
   * reuse this workflow rather than build a second approval surface, so this
   * is still the same endpoint, the same permission
   * (`rik.entitlement.allocate`) and the same screen. What changed is the
   * duplicate branch: a mobile number that already belongs to a resident WITH
   * NO RIK ID is now a link, not a refusal. Before this change it refused with
   * "already belongs to officer null", because rik_id was NULL.
   *
   * The three cases, decided after the mobile number is canonicalised:
   *
   *   no such customer            -> REGISTERED  (create a row, as before)
   *   customer with rik_id NULL   -> LINKED      (update that row)
   *   customer with a rik_id      -> DUPLICATE_MOBILE (refused, as before)
   *
   * WHY THE DIETARY CHECK MOVED BELOW THE LOOKUP. It is mandatory for a new
   * officer and ignored for a link (approved decision T2-2/T2-9), and which
   * path applies is not known until the lookup has happened. One consequence
   * worth knowing: a request carrying BOTH an invalid dietary preference and a
   * mobile number that already belongs to an officer now reports
   * DUPLICATE_MOBILE where it previously reported INVALID_DIETARY_PREFERENCE.
   * Every single-fault case reports exactly what it did before.
   */
  async register(context: AuthContext, input: RegisterOfficerInput): Promise<RegisterOfficerResult> {
    const name = withinLength(required(input.name, 'name', 'The officer name'), MAX_NAME, 'name', 'The officer name');
    const quarterBlock = withinLength(
      required(input.quarterBlock, 'quarterBlock', 'The quarter block'),
      MAX_QUARTER,
      'quarterBlock',
      'The quarter block'
    );
    const quarterNumber = withinLength(
      required(input.quarterNumber, 'quarterNumber', 'The quarter number'),
      MAX_QUARTER,
      'quarterNumber',
      'The quarter number'
    );

    const landmarkRaw = (input.landmark ?? '').trim();
    const landmark =
      landmarkRaw === '' ? null : withinLength(landmarkRaw, MAX_LANDMARK, 'landmark', 'The landmark');

    const mobileNumber = normaliseMobile(input.mobileNumber);
    const createdBy = context.principalType === 'STAFF' ? context.principalId : null;

    // Includes soft-deleted rows: the mobile number is unique across the whole
    // table, so this must cover them or the INSERT fails with a database error
    // instead of a sentence.
    const existing = await this.officers.findCustomerByMobile(mobileNumber);

    if (existing !== null && existing.rik_id !== null) {
      throw new OfficerValidationError(
        'DUPLICATE_MOBILE',
        'mobileNumber',
        `That mobile number already belongs to officer ${existing.rik_id}.`
      );
    }

    // A REMOVED account. The number is still taken, because mobile_number is
    // unique across the whole table including soft-deleted rows, so this
    // cannot be linked and cannot be reused. Refusing here matters: without
    // it, the link below would update zero rows and report a concurrency
    // conflict, telling the staff member something that is not true.
    if (existing !== null && existing.deleted_at !== null) {
      throw new OfficerValidationError(
        'DUPLICATE_MOBILE',
        'mobileNumber',
        'That mobile number belongs to an account that has been removed, and cannot be reused.'
      );
    }

    if (existing !== null) {
      return {
        officer: await this.link(context, existing, {
          officialName: name,
          quarterBlock,
          quarterNumber,
          landmark,
          createdBy,
        }),
        outcome: 'LINKED',
      };
    }

    // A NEW officer: the dietary preference is required here and nowhere else.
    if (!(DIETS as readonly string[]).includes(input.dietaryPreference ?? '')) {
      throw new OfficerValidationError(
        'INVALID_DIETARY_PREFERENCE',
        'dietaryPreference',
        'The dietary preference must be PV, EV or NV.'
      );
    }

    const officer = await this.officers.create({
      name,
      // The facility's spelling starts as the name the administrator typed.
      // It is held separately so that a later edit by the officer to their own
      // display name cannot break an eligibility import's name verification.
      officialName: name,
      mobileNumber,
      quarterBlock,
      quarterNumber,
      landmark,
      dietaryPreference: input.dietaryPreference as 'PV' | 'EV' | 'NV',
      createdBy,
    });

    await this.audit(context, 'RIK_OFFICER_REGISTERED', officer.id, null, {
      rikId: officer.rik_id,
      name: officer.name,
      officialName: officer.official_name,
      mobileNumber: officer.mobile_number,
      dietaryPreference: officer.dietary_preference,
      quarterBlock: officer.quarter_block,
      quarterNumber: officer.quarter_number,
    });

    return { officer, outcome: 'REGISTERED' };
  }

  /**
   * Issue a RIK ID to a resident who already has an account.
   *
   * Everything this does NOT write is as important as what it does: no `name`
   * (their display name stays theirs, T2-3), no `dietary_preference` (never
   * overwritten by a staff member, T2-2), and no new customer row at any point.
   *
   * The audit event is RIK_OFFICER_LINKED rather than RIK_OFFICER_REGISTERED
   * (T2-5), because a link and a creation are different events and an auditor
   * reading "registered" against a resident who had been shopping on PIF for
   * six months would be reading a false statement. `before` carries the state
   * that existed, so the row records that rik_id went from null to the issued
   * identifier and that name and dietary preference did not move.
   */
  private async link(
    context: AuthContext,
    existing: OfficerRecord,
    input: {
      officialName: string;
      quarterBlock: string;
      quarterNumber: string;
      landmark: string | null;
      createdBy: string | null;
    }
  ): Promise<OfficerRecord> {
    const linked = await this.officers.linkExistingCustomer({
      customerId: existing.id,
      officialName: input.officialName,
      quarterBlock: input.quarterBlock,
      quarterNumber: input.quarterNumber,
      landmark: input.landmark,
      createdBy: input.createdBy,
    });

    // Zero rows updated means another request linked this resident between the
    // lookup and the update. Reporting it is better than issuing a second
    // identifier or silently returning the other request's result as our own.
    if (linked === null) {
      throw new OfficerLinkConflictError(
        'That resident was approved for RIK by another request a moment ago. Reload the list to see their RIK ID.'
      );
    }

    await this.audit(
      context,
      'RIK_OFFICER_LINKED',
      linked.id,
      {
        rikId: null,
        name: existing.name,
        officialName: existing.official_name,
        mobileNumber: existing.mobile_number,
        dietaryPreference: existing.dietary_preference,
      },
      {
        rikId: linked.rik_id,
        name: linked.name,
        officialName: linked.official_name,
        mobileNumber: linked.mobile_number,
        dietaryPreference: linked.dietary_preference,
        quarterBlock: linked.quarter_block,
        quarterNumber: linked.quarter_number,
        linkedExistingCustomer: true,
        displayNamePreserved: linked.name === existing.name,
        dietaryPreferencePreserved:
          linked.dietary_preference === existing.dietary_preference,
      }
    );

    return linked;
  }

  /**
   * Deactivate or reactivate. Never delete: the RIK ID is on issue records.
   */
  async setActive(context: AuthContext, officerId: string, isActive: boolean): Promise<OfficerRecord> {
    const before = await this.officers.findById(officerId);
    if (before === null) throw new OfficerNotFoundError(officerId);

    const after = await this.officers.setActive(officerId, isActive);
    if (after === null) throw new OfficerNotFoundError(officerId);

    // Only audit a real change. Pressing Deactivate on an already-inactive
    // officer is not an event, and recording it would make the history read
    // as though something happened.
    if (before.is_active !== after.is_active) {
      await this.audit(
        context,
        isActive ? 'RIK_OFFICER_REACTIVATED' : 'RIK_OFFICER_DEACTIVATED',
        officerId,
        { rikId: before.rik_id, isActive: before.is_active },
        { rikId: after.rik_id, isActive: after.is_active }
      );
    }

    return after;
  }

  /**
   * SIGN THIS OFFICER OUT EVERYWHERE.
   *
   * WHY THIS EXISTS. A customer session now lasts a rolling 365 days, which
   * is the point — it stops the facility paying for an OTP every time
   * somebody opens the app. The cost of a long session is that a lost or
   * handed-on phone stays signed in for a year, and until now there was
   * nothing staff could do about it: `revokeAllForPrincipal` had existed
   * since the session table was built and was only ever called with 'STAFF'.
   * This is the customer half of a control that was already half there.
   *
   * WHAT IT DOES AND DOES NOT DO. It revokes every unrevoked
   * `shared.auth_sessions` row for this customer, across every device and
   * every token family. It does NOT deactivate the officer, touch their RIK
   * ID, their eligibility, their entitlement or any voucher: the officer
   * remains exactly who they were and may sign in again with a fresh OTP.
   * That is deliberately a smaller hammer than Deactivate, which is the
   * other button on the same row.
   *
   * ============================================================
   * THE 15-MINUTE WINDOW, STATED RATHER THAN GLOSSED OVER.
   * ============================================================
   *
   * This does NOT invalidate an access token that has already been issued.
   * `JwtAuthGuard` verifies a JWT's signature and expiry and does not consult
   * `shared.auth_sessions`, so a token minted moments before this call stays
   * acceptable until it expires — up to JWT_ACCESS_TTL, 15 minutes. What is
   * immediate is that no NEW access token can be obtained: the next refresh
   * fails and the app falls back to the login screen.
   *
   * So this is "signed out within fifteen minutes", not "signed out this
   * instant". Making it instant would mean a database read on every single
   * authenticated request, which is a different architecture and a separate
   * decision. The UI says fifteen minutes for the same reason this comment
   * does — a control that overstates what it does is worse than one that
   * explains itself.
   *
   * IDEMPOTENT. Revoking the sessions of a customer who has none revokes
   * nothing and is not an error; the count returned is 0 and the audit row
   * records that honestly.
   */
  async revokeSessions(
    context: AuthContext,
    officerId: string
  ): Promise<{ officer: OfficerRecord; revokedSessions: number }> {
    const officer = await this.officers.findById(officerId);
    if (officer === null) throw new OfficerNotFoundError(officerId);

    // 'CUSTOMER', always. The principal type is not taken from the caller:
    // an officer IS a customer in shared.customers, and passing a type
    // through from a request would be a way to aim this at a staff account.
    const revokedSessions = await this.sessions.revokeAllForPrincipal('CUSTOMER', officerId);

    await this.audit(
      context,
      'RIK_OFFICER_SESSIONS_REVOKED',
      officerId,
      null,
      { rikId: officer.rik_id, revokedSessions }
    );

    return { officer, revokedSessions };
  }

  async search(params: { q?: string; limit: number; offset: number }): Promise<{
    items: OfficerRecord[];
    total: number;
  }> {
    const [items, total] = await Promise.all([
      this.officers.search(params),
      this.officers.count(params.q),
    ]);
    return { items, total };
  }

  async get(officerId: string): Promise<OfficerRecord> {
    const officer = await this.officers.findById(officerId);
    if (officer === null) throw new OfficerNotFoundError(officerId);
    return officer;
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
      entityType: 'rik.officer',
      entityId,
      before: before ?? undefined,
      after,
    });
  }
}
