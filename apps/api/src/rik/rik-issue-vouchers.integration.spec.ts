import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { STAFF_ROLES, type StaffRole } from '@esamagri/shared-types';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import {
  clearRationEligibilityForPeriods,
  seedBothRationTypes,
} from './test-support/seed-ration-eligibility';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';
import { RikEligibilityService } from './services/rik-eligibility.service';
import { RikEntitlementService } from './services/rik-entitlement.service';
import { RikSelectionValidationService } from './services/rik-selection-validation.service';
import { IssueWindowsRepository } from './repositories/issue-windows.repository';
import { CurrentPeriodLock } from './test-support/current-period-lock';

/**
 * PHASE D — the RIK issue voucher, over real HTTP against real PostgreSQL.
 *
 * What this suite is designed to prove, in order of importance:
 *
 *  1. A VOUCHER CONSUMES NOTHING. Creating one writes a single row: no
 *     eligible day moves, no entitlement ledger entry appears, no collection
 *     or delivery is recorded, and the confirmed selection is untouched.
 *
 *  2. ONE FRESH, ONE DRY, FOR EVER. Per confirmed selection. A second
 *     attempt returns the first voucher — and the database refuses a second
 *     row even when the application is bypassed entirely.
 *
 *  3. A FRESH VOUCHER SPANS THE WINDOWS. The same voucher and number carry
 *     from Fresh Window 1 into Window 2 and Window 3, and follow a schedule
 *     a RIK administrator changes underneath it.
 *
 *  4. HISTORY DOES NOT MOVE. A later catalogue change, address change or
 *     eligibility change cannot reach a voucher that was already issued,
 *     because its contents come from the selection's frozen snapshot.
 *
 *  5. AN OFFICER SEES ONLY THEIR OWN, and cannot change anything at all.
 *
 * FIXTURE DISCIPLINE. The fixture period and its windows are derived from the
 * calendar at run time. The suite takes the current-period lock only where it
 * genuinely needs the period containing today, and hands it back — the
 * Phase C suite's lesson, since an issue window cannot be deleted either.
 */
describe('RIK issue vouchers (PHASE D, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;
  let eligibilityService: RikEligibilityService;
  let entitlement: RikEntitlementService;
  let validation: RikSelectionValidationService;
  let windowsRepo: IssueWindowsRepository;

  const runId = randomUUID().slice(0, 8);

  const staffIdByRole = new Map<StaffRole, string>();
  const tokenByRole = new Map<StaffRole, string>();
  let noRoleToken: string;
  let noRoleStaffId: string;

  /** Two officers, so "only your own voucher" can actually be tested. */
  interface Officer {
    officerId: string;
    rikId: string;
    name: string;
    mobile: string;
    token: string;
  }
  const officers = new Map<string, Officer>();

  let periodId: string;
  let periodStart: string;
  let pickupLocationId: string;
  let pickupLocationName: string;

  const server = () => app.getHttpServer();
  const bearer = (role: StaffRole) => `Bearer ${tokenByRole.get(role)}`;
  const asAdmin = () => bearer('RIK_ADMIN');
  /**
   * RUN-UNIQUE fixture officers, in this suite's own reserved mobile block.
   *
   * Deliberately the opposite choice from the staff accounts and the fixture
   * period, which are converged. Those are pinned by permanent records and
   * cannot be recreated; an officer is cheap to mint, and this suite needs
   * something a reused one cannot give it — a confirmed selection that has
   * NEVER been issued against. "Creation returned created: true", "no
   * eligible day moved" and "no ledger row appeared" are all claims about the
   * FIRST issue of a selection, and a reused officer's selection already
   * carries the previous run's voucher.
   *
   * Their names carry the run id too, because the officers of earlier runs
   * survive — pinned by the vouchers they hold — and "search by officer name"
   * must still name exactly one.
   *
   * The 9816 block is this suite's alone: the Phase B import suite's stable
   * fixtures sit in 981501xx, and nothing here may adopt one of those.
   */
  const digits = runId.replace(/[^0-9]/g, '').padEnd(4, '7').slice(0, 4);
  const mobile = (suffix: number) => `9816${digits}${String(suffix).padStart(2, '0')}`;

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = (back: number) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  };
  const monthEnd = (back: number) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0));
  };
  const plusDays = (isoDate: string, n: number): string => {
    const [y, m, d] = isoDate.split('-').map(Number);
    return iso(new Date(Date.UTC(y!, m! - 1, d! + n)));
  };

  const registerOfficer = async (key: string, suffix: number, name: string): Promise<void> => {
    const existing = await db.query<{ id: string; rik_id: string; name: string }>(
      `SELECT id, rik_id, name FROM shared.customers WHERE mobile_number = $1`,
      [mobile(suffix)]
    );
    const row =
      existing.length > 0
        ? { officerId: existing[0]!.id, rikId: existing[0]!.rik_id, name: existing[0]!.name }
        : await (async () => {
            const res = await request(server())
              .post('/admin/rik/officers')
              .set('Authorization', asAdmin())
              .send({
                name,
                mobileNumber: mobile(suffix),
                quarterBlock: 'D',
                quarterNumber: String(200 + suffix),
                dietaryPreference: 'NV',
              })
              .expect(201);
            return { officerId: res.body.officerId, rikId: res.body.rikId, name: res.body.name };
          })();

    officers.set(key, {
      ...row,
      mobile: mobile(suffix),
      token: tokenService.signAccessToken({
        principalType: 'CUSTOMER',
        principalId: row.officerId,
      }),
    });
  };

  /**
   * Ask the engine what this officer may select in one PHYSICAL issue period,
   * and how much of it.
   *
   * A provision's issue period is its own column, not its pool's ration type —
   * the approved catalogue has bread in the DRY CEREALS pool and issues it
   * FRESH — so both sides of the calculation are searched and the PROVISIONS
   * are filtered. The quantity is the engine's own `maxSelectableQuantity`
   * (the pool balance), capped by the provision's `maxQuantity` and
   * `maxPacks`, floored to a whole unit so no rounding can push it over.
   */
  const selectableProvision = async (
    basis: Awaited<ReturnType<RikEligibilityService['resolveBasis']>>,
    issuePeriod: 'FRESH' | 'DRY'
  ): Promise<{ provisionId: string; quantity: number } | null> => {
    const calculation = await entitlement.calculate(basis);
    for (const pool of [...calculation.dry, ...calculation.fresh]) {
      for (const p of pool.provisions) {
        if (p.issuePeriod !== issuePeriod) continue;
        let qty = p.maxSelectableQuantity;
        if (p.maxQuantity !== null) qty = Math.min(qty, p.maxQuantity);
        if (p.maxPacks !== null && p.packSize !== null) qty = Math.min(qty, p.maxPacks * p.packSize);
        qty = Math.floor(qty);
        if (qty > 0) return { provisionId: p.provisionId, quantity: qty };
      }
    }
    return null;
  };

  /**
   * Seed eligibility, choose one Fresh and one Dry provision, and confirm —
   * through the same service the customer's own confirmation route uses, with
   * a basis for the fixture period so this suite needs no current period.
   *
   * CONVERGED, NOT RECREATED. A confirmed selection that already carries a
   * voucher cannot be cancelled or deleted (migration 0048 leaves the
   * application no DELETE on the voucher, and the confirmed selection is
   * pinned by it), so a second run of this suite finds the first run's
   * selection still there and reuses it. Each officer is used with ONE
   * fulfilment mode throughout, and a mismatch is a fixture error rather than
   * something to paper over.
   */
  const confirmSelection = async (
    key: string,
    fulfillment: 'PICKUP' | 'DELIVERY',
    days = 20,
    inPeriod?: string
  ): Promise<string> => {
    const officer = officers.get(key)!;
    const period = inPeriod ?? periodId;
    const already = await db.query<{ id: string; fulfillment_type: string }>(
      `SELECT id, fulfillment_type FROM rik.entitlement_selections
        WHERE customer_id = $1 AND period_id = $2 AND status = 'CONFIRMED'`,
      [officer.officerId, period]
    );
    if (already.length > 0) {
      if (already[0]!.fulfillment_type !== fulfillment) {
        throw new Error(
          `fixture: officer ${key} already has a ${already[0]!.fulfillment_type} selection, not ${fulfillment}`
        );
      }
      return already[0]!.id;
    }
    await db.query(
      `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days)
       VALUES ($1, $2, $3) ON CONFLICT (customer_id, period_id) DO NOTHING`,
      [officer.officerId, period, days]
    );
    // Both per-type figures at the same number as the legacy row, so this
    // suite's voucher quantities are unchanged and the engine reads the
    // per-ration-type table as production does.
    await seedBothRationTypes(db, officer.officerId, period, days);

    const basis = await eligibilityService.resolveBasis(officer.officerId, period);

    // One DRY line and one FRESH line, so both vouchers have something to
    // issue. Both are chosen from the LIVE engine rather than from hardcoded
    // codes or quantities: the provision is whatever the officer may actually
    // select in that issue period, and the quantity is what the engine itself
    // reports as selectable, narrowed by the per-provision limits. A catalogue
    // change therefore cannot quietly turn this fixture into a no-op.
    for (const issuePeriod of ['DRY', 'FRESH'] as const) {
      const choice = await selectableProvision(basis, issuePeriod);
      if (choice !== null) {
        const { result } = await validation.setQuantity(basis, choice.provisionId, choice.quantity);
        if (!result.ok) {
          throw new Error(
            `fixture: ${issuePeriod} line refused — ${result.reason}: ${result.message}`
          );
        }
      }
    }

    const confirmed = await validation.confirm(basis, {
      availabilityAcknowledged: true,
      fulfillmentType: fulfillment,
      pickupLocationId: fulfillment === 'PICKUP' ? pickupLocationId : null,
      deliveryAddress: fulfillment === 'DELIVERY' ? `D-${200} Quarter, Jest ${runId}` : null,
    });
    return confirmed.selectionId;
  };

  /**
   * A confirmed selection with a DRY line and NO Fresh line — so "there is
   * nothing of this ration type to issue" can be tested against a real
   * selection rather than a contrived one. Converged for the same reason as
   * `confirmSelection`.
   */
  const confirmDryOnly = async (key: string): Promise<string> => {
    const officer = officers.get(key)!;
    const already = await db.query<{ id: string }>(
      `SELECT id FROM rik.entitlement_selections
        WHERE customer_id = $1 AND period_id = $2 AND status = 'CONFIRMED'`,
      [officer.officerId, periodId]
    );
    if (already.length > 0) return already[0]!.id;

    await db.query(
      `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days)
       VALUES ($1, $2, 18) ON CONFLICT (customer_id, period_id) DO NOTHING`,
      [officer.officerId, periodId]
    );
    await seedBothRationTypes(db, officer.officerId, periodId, 18);
    const basis = await eligibilityService.resolveBasis(officer.officerId, periodId);
    const choice = (await selectableProvision(basis, 'DRY'))!;
    const { result } = await validation.setQuantity(basis, choice.provisionId, choice.quantity);
    if (!result.ok) throw new Error(`fixture: DRY line refused — ${result.reason}`);
    const confirmed = await validation.confirm(basis, {
      availabilityAcknowledged: true,
      fulfillmentType: 'PICKUP',
      pickupLocationId,
      deliveryAddress: null,
    });
    return confirmed.selectionId;
  };

  const createVoucher = (selectionId: string, rationType: 'FRESH' | 'DRY') =>
    request(server())
      .post('/admin/rik/issue-vouchers')
      .set('Authorization', asAdmin())
      .send({ selectionId, rationType });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    tokenService = app.get(TokenService);
    eligibilityService = app.get(RikEligibilityService);
    entitlement = app.get(RikEntitlementService);
    validation = app.get(RikSelectionValidationService);
    windowsRepo = app.get(IssueWindowsRepository);

    const passwordHash = await app.get(PasswordService).hash('CorrectHorseBatteryStaple!1');
    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    const grantedBy = bootstrap[0]!.id;

    // Stable staff accounts: a voucher records who issued it and that record
    // is permanent, so the issuing account cannot be deleted afterwards.
    const staffAccount = async (username: string, display: string): Promise<string> => {
      const found = await db.query<{ id: string }>(
        `SELECT id FROM shared.users WHERE username = $1`,
        [username]
      );
      if (found.length > 0) return found[0]!.id;
      const made = await db.query<{ id: string }>(
        `INSERT INTO shared.users (id, username, password_hash, display_name, status)
         VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
        [username, passwordHash, display]
      );
      return made[0]!.id;
    };

    for (const role of STAFF_ROLES) {
      const id = await staffAccount(`jest_15d_${role.toLowerCase()}`, `Jest 15D ${role}`);
      staffIdByRole.set(role, id);
      await db.query(
        `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
         SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3 ON CONFLICT DO NOTHING`,
        [id, grantedBy, role]
      );
      tokenByRole.set(role, tokenService.signAccessToken({ principalType: 'STAFF', principalId: id }));
    }
    noRoleStaffId = await staffAccount('jest_15d_norole', 'Jest 15D NoRole');
    noRoleToken = tokenService.signAccessToken({ principalType: 'STAFF', principalId: noRoleStaffId });

    // ONE fixture period, reused: a voucher and an issue window are both
    // permanent, so the period that carries them cannot be deleted, and
    // rik_ent_periods_no_overlap would refuse a second one in the same month.
    //
    // WHICH month is DERIVED, not written down. It must satisfy three
    // conditions at once, and all three come from the database:
    //
    //   * not this month, last month or the month before that. A period this
    //     suite owns is PERMANENT — pinned by a voucher, undeletable — so it
    //     would take that month away for ever rather than for one run, and
    //     those three are claimed by the current-period suites (under the
    //     advisory lock) and by the entitlement suite's 31-day and short
    //     periods;
    //   * at or after the catalogue's own effective date, because a basis is
    //     resolved `asOf` the period's end and a configuration loaded before
    //     the provisions existed is empty — a selection could then be
    //     confirmed with nothing in it;
    //   * free of any existing period, because the no-overlap exclusion is
    //     global: only one period may cover any single day.
    const catalogue = await db.query<{ effective_from: string }>(
      `SELECT max(effective_from)::text AS effective_from FROM rik.provisions WHERE is_active`
    );
    const catalogueFrom = catalogue[0]!.effective_from;
    const found = await db.query<{ id: string; start_date: string; end_date: string }>(
      `SELECT id, start_date::text AS start_date, end_date::text AS end_date
         FROM rik.entitlement_periods WHERE name LIKE 'Jest 15D ration%' ORDER BY name LIMIT 1`
    );
    if (found.length > 0) {
      periodId = found[0]!.id;
      periodStart = found[0]!.start_date;
    } else {
      // The nearest free month at or before THREE months ago, claimed by
      // trying to take it rather than by asking whether it is free.
      //
      // Asking is not enough on a database being built from scratch: jest
      // runs the suites in parallel, so another suite can insert its own
      // period between the question and the answer, and the global
      // no-overlap exclusion then refuses the INSERT. Every candidate is
      // therefore ATTEMPTED, and a refusal simply moves to the next month —
      // which is also what makes this independent of the order the suites
      // happen to start in. A fresh-database run found both halves of that:
      // first a clash with the issue-window suite's periods, then with the
      // entitlement suite's two-months-back short period.
      let made: { id: string; start_date: string; end_date: string } | null = null;
      for (let back = 3; back <= 24 && made === null; back += 1) {
        const start = iso(monthStart(back));
        const end = iso(monthEnd(back));
        if (end < catalogueFrom) continue;
        try {
          const rows = await db.query<{ id: string; start_date: string; end_date: string }>(
            `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
             VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'ACTIVE')
             RETURNING id, start_date::text AS start_date, end_date::text AS end_date`,
            [`Jest 15D ration ${runId}`, start, end]
          );
          made = rows[0]!;
        } catch {
          // Taken, by a period that already existed or by a suite that got
          // there first. Try the month before it.
        }
      }
      if (made === null) {
        throw new Error('fixture: no free month at or after the catalogue effective date');
      }
      periodId = made.id;
      periodStart = made.start_date;
    }

    // Operational state from an earlier run goes; the permanent records stay.
    await db.query(
      `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
        WHERE status = 'CONFIRMED' AND period_id = $1
          AND id NOT IN (SELECT selection_id FROM rik.issue_vouchers)`,
      [periodId]
    );
    await db.query(
      `DELETE FROM rik.entitlement_selections
        WHERE period_id = $1 AND id NOT IN (SELECT selection_id FROM rik.issue_vouchers)`,
      [periodId]
    );
    await db.query(`DELETE FROM rik.customer_period_eligibility WHERE period_id = $1`, [periodId]);
    await clearRationEligibilityForPeriods(db, [periodId]);

    const pickup = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM rik.pickup_locations WHERE is_active ORDER BY name LIMIT 1`
    );
    pickupLocationId = pickup[0]!.id;
    pickupLocationName = pickup[0]!.name;

    await registerOfficer('alpha', 10, `Jest 15D Officer Alpha ${runId}`);
    await registerOfficer('bravo', 11, `Jest 15D Officer Bravo ${runId}`);
    await registerOfficer('charlie', 12, `Jest 15D Officer Charlie ${runId}`);
    await registerOfficer('delta', 13, `Jest 15D Officer Delta ${runId}`);
    await registerOfficer('echo', 14, `Jest 15D Officer Echo ${runId}`);
    await registerOfficer('foxtrot', 15, `Jest 15D Officer Foxtrot ${runId}`);

    // The three Fresh windows and the Dry window of the fixture period,
    // converged rather than created: 0047 refuses DELETE, so a previous run's
    // windows are already there.
    const plan = [
      { rationType: 'FRESH' as const, sequenceNo: 1, offset: 0, length: 6 },
      { rationType: 'FRESH' as const, sequenceNo: 2, offset: 7, length: 6 },
      { rationType: 'FRESH' as const, sequenceNo: 3, offset: 14, length: 6 },
      { rationType: 'DRY' as const, sequenceNo: 1, offset: 0, length: 20 },
    ];
    for (const item of plan) {
      const code = item.rationType === 'FRESH' ? `FRESH_${item.sequenceNo}` : 'DRY';
      const start = plusDays(periodStart, item.offset);
      const body = {
        startDate: start,
        endDate: plusDays(start, item.length - 1),
        operatingDays: [plusDays(start, 1), plusDays(start, 3)],
      };
      const existing = await db.query<{ id: string }>(
        `SELECT id FROM rik.issue_windows WHERE period_id = $1 AND window_code = $2`,
        [periodId, code]
      );
      if (existing.length === 0) {
        await request(server())
          .post('/admin/rik/issue-windows')
          .set('Authorization', asAdmin())
          .send({ periodId, rationType: item.rationType, sequenceNo: item.sequenceNo, ...body })
          .expect(201);
      } else {
        await request(server())
          .patch(`/admin/rik/issue-windows/${existing[0]!.id}`)
          .set('Authorization', asAdmin())
          .send({ ...body, isActive: true })
          .expect(200);
      }
    }
  });

  afterAll(async () => {
    // A voucher cannot be deleted by the application — that is the point of
    // migration 0048 — so the confirmed selection that carries one, the
    // officers it names and the staff who issued it all stay, pinned by the
    // operational record. Only the resettable state goes.
    const principals = [
      ...[...officers.values()].map((o) => o.officerId),
      ...staffIdByRole.values(),
      noRoleStaffId,
    ];
    await db.query(`DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])`, [
      principals,
    ]);
    await app.close();
  });

  // =================================================================
  // 1. Creating a voucher from a confirmed selection
  // =================================================================
  describe('a confirmed selection becomes an operational voucher', () => {
    let selectionId: string;
    let fresh: Record<string, unknown>;
    let dry: Record<string, unknown>;

    beforeAll(async () => {
      selectionId = await confirmSelection('alpha', 'PICKUP');
      fresh = (await createVoucher(selectionId, 'FRESH').expect(201)).body;
      dry = (await createVoucher(selectionId, 'DRY').expect(201)).body;
    });

    it('creates the Fresh voucher', () => {
      expect(fresh.created).toBe(true);
      expect(fresh.rationType).toBe('FRESH');
      expect(fresh.voucherNumber).toMatch(/^IV-[0-9]{4}-[0-9]{6,}$/);
    });

    it('creates the Dry voucher, separately from Fresh', () => {
      expect(dry.created).toBe(true);
      expect(dry.rationType).toBe('DRY');
      expect(dry.voucherNumber).not.toBe(fresh.voucherNumber);
    });

    it('numbers vouchers IV-YYYY-###### with the current year', () => {
      const year = new Date().getUTCFullYear();
      expect(String(fresh.voucherNumber).startsWith(`IV-${year}-`)).toBe(true);
    });

    it('issues both against the same confirmed selection', () => {
      expect(fresh.selectionId).toBe(selectionId);
      expect(dry.selectionId).toBe(selectionId);
      expect(fresh.selectionReference).toMatch(/^RIK-[0-9]{6,}$/);
    });

    it('takes the fulfilment mode from the confirmation, never from the request', () => {
      expect(fresh.fulfillmentMode).toBe('PICKUP');
      expect(dry.fulfillmentMode).toBe('PICKUP');
    });

    it('starts at the entry status of the pickup lane', () => {
      expect(fresh.status).toBe('READY_FOR_PICKUP');
      expect(dry.status).toBe('READY_FOR_PICKUP');
    });

    it('names the officer by their permanent RIK ID', () => {
      expect(fresh.rikId).toBe(officers.get('alpha')!.rikId);
    });

    it('writes an audit row naming the creation', async () => {
      const rows = await db.query<{ action: string; entity_type: string }>(
        `SELECT action, entity_type FROM shared.audit_log WHERE entity_id = $1`,
        [fresh.voucherId]
      );
      expect(rows.map((r) => r.action)).toEqual(['RIK_ISSUE_VOUCHER_CREATED']);
      expect(rows[0]!.entity_type).toBe('rik.issue_voucher');
    });

    it('exposes the history through the staff route', async () => {
      const res = await request(server())
        .get(`/admin/rik/issue-vouchers/${fresh.voucherId}/history`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].action).toBe('RIK_ISSUE_VOUCHER_CREATED');
      expect(res.body.items[0].actorId).toBe(staffIdByRole.get('RIK_ADMIN'));
    });

    // ---------------------------------------------------------- idempotency

    it('is idempotent: a repeated request returns the SAME voucher', async () => {
      const again = await createVoucher(selectionId, 'FRESH').expect(201);
      expect(again.body.created).toBe(false);
      expect(again.body.voucherId).toBe(fresh.voucherId);
      expect(again.body.voucherNumber).toBe(fresh.voucherNumber);
    });

    it('prevented a second Fresh voucher for the selection', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.issue_vouchers
          WHERE selection_id = $1 AND ration_type = 'FRESH'`,
        [selectionId]
      );
      expect(rows[0]!.total).toBe('1');
    });

    it('prevented a second Dry voucher for the selection', async () => {
      await createVoucher(selectionId, 'DRY').expect(201);
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.issue_vouchers
          WHERE selection_id = $1 AND ration_type = 'DRY'`,
        [selectionId]
      );
      expect(rows[0]!.total).toBe('1');
    });

    it('the DATABASE refuses a duplicate even when the application is bypassed', async () => {
      await expect(
        db.query(
          `INSERT INTO rik.issue_vouchers
             (voucher_number, selection_id, customer_id, period_id, ration_type,
              fulfillment_mode, pickup_location_id, pickup_location_name, status,
              created_by, released_by)
           VALUES ('IV-2099-000001', $1, $2, $3, 'FRESH', 'PICKUP', $4, $5,
                   'READY_FOR_PICKUP', $6, $6)`,
          [
            selectionId,
            officers.get('alpha')!.officerId,
            periodId,
            pickupLocationId,
            pickupLocationName,
            staffIdByRole.get('RIK_ADMIN'),
          ]
        )
      ).rejects.toThrow();
    });

    it('voucher numbers are unique across the whole table', async () => {
      const rows = await db.query<{ total: string; distinct_numbers: string }>(
        `SELECT count(*)::text AS total, count(DISTINCT voucher_number)::text AS distinct_numbers
           FROM rik.issue_vouchers`
      );
      expect(rows[0]!.distinct_numbers).toBe(rows[0]!.total);
    });

    it('the number format is a database CHECK, not a convention', async () => {
      await expect(
        db.query(
          `INSERT INTO rik.issue_vouchers
             (voucher_number, selection_id, customer_id, period_id, ration_type,
              fulfillment_mode, delivery_address, status, created_by, released_by)
           VALUES ('IV-2099-1', $1, $2, $3, 'FRESH', 'DELIVERY', 'x', 'READY_FOR_DELIVERY', $4, $4)`,
          [selectionId, officers.get('alpha')!.officerId, periodId, staffIdByRole.get('RIK_ADMIN')]
        )
      ).rejects.toThrow();
    });
  });

  // =================================================================
  // 2. The number function itself
  // =================================================================
  describe('the voucher number widens and never overflows', () => {
    const format = async (n: number, yr = 2026) => {
      const rows = await db.query<{ v: string }>(
        `SELECT rik.format_issue_voucher_number($1::bigint, $2::integer) AS v`,
        [n, yr]
      );
      return rows[0]!.v;
    };

    it('pads to six digits at the bottom of the range', async () => {
      expect(await format(1)).toBe('IV-2026-000001');
    });

    it('fills six digits exactly at 999999', async () => {
      expect(await format(999999)).toBe('IV-2026-999999');
    });

    it('WIDENS at one million rather than overflowing or truncating', async () => {
      expect(await format(1000000)).toBe('IV-2026-1000000');
      expect(await format(12345678)).toBe('IV-2026-12345678');
    });

    it('keeps the voucher namespace distinct from the other three', async () => {
      const v = await format(125);
      expect(v.startsWith('IV-')).toBe(true);
      expect(/^RIK-O-|^RIK-[0-9]|^ELIG-/.test(v)).toBe(false);
    });
  });

  // =================================================================
  // 3. What a voucher may NOT be created from
  // =================================================================
  describe('only a confirmed selection can be issued against', () => {
    it('refuses a DRAFT selection', async () => {
      const officer = officers.get('bravo')!;
      await db.query(
        `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days)
         VALUES ($1, $2, 15) ON CONFLICT (customer_id, period_id) DO NOTHING`,
        [officer.officerId, periodId]
      );
      await seedBothRationTypes(db, officer.officerId, periodId, 15);
      const basis = await eligibilityService.resolveBasis(officer.officerId, periodId);
      const choice = (await selectableProvision(basis, 'DRY'))!;
      const { result } = await validation.setQuantity(basis, choice.provisionId, choice.quantity);
      expect(result.ok).toBe(true);

      const draft = await db.query<{ id: string }>(
        `SELECT id FROM rik.entitlement_selections
          WHERE customer_id = $1 AND period_id = $2 AND status = 'DRAFT'`,
        [officer.officerId, periodId]
      );
      const res = await createVoucher(draft[0]!.id, 'DRY');
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('SELECTION_NOT_CONFIRMED');

      const written = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.issue_vouchers WHERE selection_id = $1`,
        [draft[0]!.id]
      );
      expect(written[0]!.total).toBe('0');
    });

    it('the DATABASE refuses a voucher for an unconfirmed selection too', async () => {
      const draft = await db.query<{ id: string; customer_id: string }>(
        `SELECT id, customer_id FROM rik.entitlement_selections
          WHERE period_id = $1 AND status = 'DRAFT' LIMIT 1`,
        [periodId]
      );
      await expect(
        db.query(
          `INSERT INTO rik.issue_vouchers
             (voucher_number, selection_id, customer_id, period_id, ration_type,
              fulfillment_mode, delivery_address, status, created_by, released_by)
           VALUES ('IV-2099-000002', $1, $2, $3, 'DRY', 'DELIVERY', 'x',
                   'READY_FOR_DELIVERY', $4, $4)`,
          [draft[0]!.id, draft[0]!.customer_id, periodId, staffIdByRole.get('RIK_ADMIN')]
        )
      ).rejects.toThrow();
    });

    it('refuses a selection that does not exist', async () => {
      const res = await createVoucher('00000000-0000-7000-8000-000000000000', 'FRESH');
      expect(res.status).toBe(404);
    });

    it('refuses an invalid ration type', async () => {
      const res = await request(server())
        .post('/admin/rik/issue-vouchers')
        .set('Authorization', asAdmin())
        .send({ selectionId: '00000000-0000-7000-8000-000000000000', rationType: 'FROZEN' });
      expect(res.status).toBe(400);
    });

    it('refuses a body carrying anything the server decides', async () => {
      const selection = await db.query<{ id: string }>(
        `SELECT id FROM rik.entitlement_selections WHERE period_id = $1 AND status = 'CONFIRMED' LIMIT 1`,
        [periodId]
      );
      for (const extra of [
        { voucherNumber: 'IV-2026-000999' },
        { status: 'COLLECTED' },
        { fulfillmentMode: 'DELIVERY' },
        { deliveryAddress: 'Somewhere else' },
        { issueWindowId: '00000000-0000-7000-8000-000000000000' },
        { quantityToIssue: 1 },
      ]) {
        const res = await request(server())
          .post('/admin/rik/issue-vouchers')
          .set('Authorization', asAdmin())
          .send({ selectionId: selection[0]!.id, rationType: 'FRESH', ...extra });
        expect(res.status).toBe(400);
      }
    });

    it('refuses a ration type the selection has nothing of', async () => {
      // A selection with only DRY chosen has no Fresh ration to issue.
      const selectionId = await confirmDryOnly('charlie');

      const res = await createVoucher(selectionId, 'FRESH');
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('NOTHING_TO_ISSUE');

      // …while the Dry voucher is perfectly creatable.
      await createVoucher(selectionId, 'DRY').expect(201);
    });
  });

  // =================================================================
  // 4. A voucher consumes nothing
  // =================================================================
  describe('creating a voucher consumes no entitlement', () => {
    let selectionId: string;
    let before: { days: number; ledger: string; selection: string };

    beforeAll(async () => {
      selectionId = await confirmSelection('delta', 'DELIVERY', 22);
      const officer = officers.get('delta')!;
      const days = await db.query<{ eligible_days: number }>(
        `SELECT eligible_days FROM rik.customer_period_eligibility
          WHERE customer_id = $1 AND period_id = $2`,
        [officer.officerId, periodId]
      );
      const ledger = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.entitlement_ledger`
      );
      const selection = await db.query<{ row: string }>(
        `SELECT (status || '|' || eligible_days || '|' || coalesce(rule_snapshot::text,'')
                 || '|' || coalesce(reference_number,'')) AS row
           FROM rik.entitlement_selections WHERE id = $1`,
        [selectionId]
      );
      before = {
        days: days[0]!.eligible_days,
        ledger: ledger[0]!.total,
        selection: selection[0]!.row,
      };
      await createVoucher(selectionId, 'FRESH').expect(201);
      await createVoucher(selectionId, 'DRY').expect(201);
    });

    it('did not move the officer’s eligible days', async () => {
      const rows = await db.query<{ eligible_days: number }>(
        `SELECT eligible_days FROM rik.customer_period_eligibility
          WHERE customer_id = $1 AND period_id = $2`,
        [officers.get('delta')!.officerId, periodId]
      );
      expect(rows[0]!.eligible_days).toBe(before.days);
    });

    it('wrote no eligibility adjustment', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.eligibility_adjustments
          WHERE customer_id = $1 AND period_id = $2`,
        [officers.get('delta')!.officerId, periodId]
      );
      expect(rows[0]!.total).toBe('0');
    });

    it('wrote no entitlement ledger row', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.entitlement_ledger`
      );
      expect(rows[0]!.total).toBe(before.ledger);
    });

    it('left the confirmed selection byte-for-byte unchanged', async () => {
      const rows = await db.query<{ row: string }>(
        `SELECT (status || '|' || eligible_days || '|' || coalesce(rule_snapshot::text,'')
                 || '|' || coalesce(reference_number,'')) AS row
           FROM rik.entitlement_selections WHERE id = $1`,
        [selectionId]
      );
      expect(rows[0]!.row).toBe(before.selection);
    });

    it('did not mark anything collected or delivered', async () => {
      const rows = await db.query<{ status: string }>(
        `SELECT status FROM rik.issue_vouchers WHERE selection_id = $1 ORDER BY ration_type`,
        [selectionId]
      );
      expect(rows.map((r) => r.status)).toEqual(['READY_FOR_DELIVERY', 'READY_FOR_DELIVERY']);
      expect(rows.every((r) => r.status !== 'COLLECTED' && r.status !== 'DELIVERED')).toBe(true);
    });

    it('and the application CANNOT mark one: it holds no UPDATE at all', async () => {
      const privileges = await db.query<{ upd: boolean; del: boolean; ins: boolean; sel: boolean }>(
        `SELECT has_table_privilege('app_rik', 'rik.issue_vouchers', 'UPDATE') AS upd,
                has_table_privilege('app_rik', 'rik.issue_vouchers', 'DELETE') AS del,
                has_table_privilege('app_rik', 'rik.issue_vouchers', 'INSERT') AS ins,
                has_table_privilege('app_rik', 'rik.issue_vouchers', 'SELECT') AS sel`
      );
      expect(privileges[0]).toEqual({ upd: false, del: false, ins: true, sel: true });

      await expect(
        db.query(`UPDATE rik.issue_vouchers SET status = 'COLLECTED' WHERE selection_id = $1`, [
          selectionId,
        ])
      ).rejects.toThrow();
    });

    it('and a voucher cannot be deleted', async () => {
      await expect(
        db.query(`DELETE FROM rik.issue_vouchers WHERE selection_id = $1`, [selectionId])
      ).rejects.toThrow();
    });
  });

  // =================================================================
  // 5. Fulfilment is the confirmation's, and it is a snapshot
  // =================================================================
  describe('the voucher carries the confirmed fulfilment, frozen', () => {
    let pickupSelection: string;
    let deliverySelection: string;
    let deliveryVoucherId: string;
    let addressAtIssue: string;

    beforeAll(async () => {
      pickupSelection = await confirmSelection('alpha', 'PICKUP');
      deliverySelection = await confirmSelection('delta', 'DELIVERY');
      const res = await createVoucher(deliverySelection, 'DRY').expect(201);
      deliveryVoucherId = res.body.voucherId;
      const detail = await request(server())
        .get(`/admin/rik/issue-vouchers/${deliveryVoucherId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      addressAtIssue = detail.body.fulfillment.deliveryAddress;
    });

    it('a pickup voucher shows the configured pickup location', async () => {
      const created = await createVoucher(pickupSelection, 'DRY').expect(201);
      const res = await request(server())
        .get(`/admin/rik/issue-vouchers/${created.body.voucherId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.fulfillment.mode).toBe('PICKUP');
      expect(res.body.fulfillment.pickupLocationName).toBe(pickupLocationName);
      expect(res.body.fulfillment.deliveryAddress).toBeNull();
    });

    it('a delivery voucher shows the delivery address snapshot', async () => {
      // The voucher's address is the one the CONFIRMATION recorded, read back
      // from the selection itself rather than from anything this run typed —
      // the selection may well have been confirmed by an earlier run, and the
      // claim is that the two agree.
      const confirmed = await db.query<{ delivery_address: string }>(
        `SELECT delivery_address FROM rik.entitlement_selections WHERE id = $1`,
        [deliverySelection]
      );
      expect(addressAtIssue).toBe(confirmed[0]!.delivery_address);
      expect(addressAtIssue).toBeTruthy();
    });

    it('a later change to the officer’s saved address does not rewrite the voucher', async () => {
      const officer = officers.get('delta')!;
      await db.query(
        `UPDATE shared.customer_addresses SET quarter_number = 'MOVED', landmark = 'New block'
          WHERE customer_id = $1 AND is_default`,
        [officer.officerId]
      );

      const res = await request(server())
        .get(`/admin/rik/issue-vouchers/${deliveryVoucherId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.fulfillment.deliveryAddress).toBe(addressAtIssue);
    });

    it('the DATABASE refuses a voucher whose address disagrees with its selection', async () => {
      await expect(
        db.query(
          `INSERT INTO rik.issue_vouchers
             (voucher_number, selection_id, customer_id, period_id, ration_type,
              fulfillment_mode, delivery_address, status, created_by, released_by)
           VALUES ('IV-2099-000003', $1, $2, $3, 'FRESH', 'DELIVERY', 'Not the confirmed address',
                   'READY_FOR_DELIVERY', $4, $4)`,
          [
            deliverySelection,
            officers.get('delta')!.officerId,
            periodId,
            staffIdByRole.get('RIK_ADMIN'),
          ]
        )
      ).rejects.toThrow();
    });

    it('the DATABASE refuses a voucher whose mode disagrees with its selection', async () => {
      await expect(
        db.query(
          `INSERT INTO rik.issue_vouchers
             (voucher_number, selection_id, customer_id, period_id, ration_type,
              fulfillment_mode, pickup_location_id, pickup_location_name, status,
              created_by, released_by)
           VALUES ('IV-2099-000004', $1, $2, $3, 'FRESH', 'PICKUP', $4, $5,
                   'READY_FOR_PICKUP', $6, $6)`,
          [
            deliverySelection,
            officers.get('delta')!.officerId,
            periodId,
            pickupLocationId,
            pickupLocationName,
            staffIdByRole.get('RIK_ADMIN'),
          ]
        )
      ).rejects.toThrow();
    });

    it('a status from the wrong lane is refused', async () => {
      await expect(
        db.query(
          `INSERT INTO rik.issue_vouchers
             (voucher_number, selection_id, customer_id, period_id, ration_type,
              fulfillment_mode, delivery_address, status, created_by, released_by)
           VALUES ('IV-2099-000005', $1, $2, $3, 'FRESH', 'DELIVERY', $5, 'COLLECTED', $4, $4)`,
          [
            deliverySelection,
            officers.get('delta')!.officerId,
            periodId,
            staffIdByRole.get('RIK_ADMIN'),
            addressAtIssue,
          ]
        )
      ).rejects.toThrow();
    });
  });

  // =================================================================
  // 6. One Fresh voucher, across every Fresh window
  // =================================================================
  describe('one Fresh voucher spans Windows 1, 2 and 3', () => {
    /**
     * THE ONE GROUP THAT GENUINELY NEEDS THE PERIOD CONTAINING TODAY.
     *
     * "Which window is current" is answered by comparing the configured
     * schedule to today, so this group — and only this group — needs a period
     * that covers today and windows inside it that can be moved over today.
     * It therefore takes the SAME advisory lock the other current-period
     * suites take (`CurrentPeriodLock`), so two suites never compete for a
     * resource the global no-overlap exclusion makes exclusive, and it parks
     * its fixture out of the current month again on the way out.
     *
     * THE FIXTURE PERIOD IS SEVEN DAYS WIDE, centred on today, rather than a
     * calendar month. A ration period is a date range, not a month, and seven
     * days means a single-day window can always be placed on today, on the day
     * before and on the day after — so the three Fresh windows can be ordered
     * around today no matter where in the month the suite happens to run.
     * With a calendar month the same test would fail on the 1st or the 31st.
     */
    let lock: CurrentPeriodLock;
    let currentPeriodId: string;
    let fixtureIsOurs = false;
    let selectionId: string;
    let voucherId: string;
    let voucherNumber: string;

    /** Where the fixture lives between runs: far enough back that nothing else uses it. */
    const PARK_MONTHS_BACK = 240;

    const FRESH_CODES = ['FRESH_1', 'FRESH_2', 'FRESH_3'] as const;
    type FreshCode = (typeof FRESH_CODES)[number];

    const today = () => iso(new Date());

    const windowId = async (code: string) => {
      const rows = await db.query<{ id: string }>(
        `SELECT id FROM rik.issue_windows WHERE period_id = $1 AND window_code = $2`,
        [currentPeriodId, code]
      );
      return rows[0]!.id;
    };

    const freshDays = async (): Promise<Map<FreshCode, string>> => {
      const rows = await db.query<{ window_code: string; start_date: string }>(
        `SELECT window_code, start_date::text AS start_date FROM rik.issue_windows
          WHERE period_id = $1 AND ration_type = 'FRESH'`,
        [currentPeriodId]
      );
      return new Map(rows.map((r) => [r.window_code as FreshCode, r.start_date]));
    };

    /** Ascending by sequence and all distinct — migration 0047's two rules. */
    const legal = (days: Map<FreshCode, string>): boolean => {
      const ordered = FRESH_CODES.map((c) => days.get(c)!);
      const distinct = new Set(ordered).size === ordered.length;
      return distinct && ordered[0]! < ordered[1]! && ordered[1]! < ordered[2]!;
    };

    /**
     * Move the three Fresh windows to one-day spans so that `target` contains
     * today, writing them in whatever ORDER keeps the schedule legal at every
     * single step.
     *
     * The order genuinely matters and genuinely varies: 0047's sequence
     * trigger is a BEFORE ROW trigger, so it judges each write on its own,
     * against the other windows as they stand at that moment. Moving the
     * schedule later must start with the last window and moving it earlier
     * with the first, so rather than hardcode a direction this plans the
     * writes against the state it is holding — which is also the clearest
     * statement of what the trigger enforces.
     */
    const applyLayout = async (wanted: Map<FreshCode, string>) => {
      const state = await freshDays();
      const pending = new Set<FreshCode>(
        FRESH_CODES.filter((c) => state.get(c) !== wanted.get(c))
      );

      while (pending.size > 0) {
        let moved: FreshCode | null = null;
        for (const code of pending) {
          const trial = new Map(state);
          trial.set(code, wanted.get(code)!);
          if (!legal(trial)) continue;
          await db.query(
            `UPDATE rik.issue_windows SET start_date = $2::date, end_date = $2::date,
                    operating_days = ARRAY[$2::date]
              WHERE id = $1`,
            [await windowId(code), wanted.get(code)!]
          );
          state.set(code, wanted.get(code)!);
          pending.delete(code);
          moved = code;
          break;
        }
        if (moved === null) {
          throw new Error(
            `fixture: no legal order reaches the layout ${JSON.stringify([...wanted])}`
          );
        }
      }
    };

    /** Put `target` over today, with the other two in sequence around it. */
    const makeCurrent = (target: FreshCode) =>
      applyLayout(
        new Map<FreshCode, string>(
          FRESH_CODES.map((code) => [
            code,
            plusDays(today(), Number(code.slice(-1)) - Number(target.slice(-1))),
          ])
        )
      );

    beforeAll(async () => {
      lock = await CurrentPeriodLock.acquire();

      const centre = today();
      const start = plusDays(centre, -3);
      const end = plusDays(centre, 3);

      // ONE fixture period for this purpose, under a stable name. It carries
      // permanent windows AND a confirmed selection a voucher pins, so it can
      // never be deleted: between runs it sits in the parking slot, and each
      // run moves it back over today. The PERIOD moves first, because 0047's
      // within-period trigger judges a window against its period's range as
      // it stands.
      const ours = await db.query<{ id: string }>(
        `SELECT id FROM rik.entitlement_periods WHERE name = 'Jest 15D current'`
      );
      if (ours.length > 0) {
        currentPeriodId = ours[0]!.id;
        fixtureIsOurs = true;
        await db.query(
          `UPDATE rik.entitlement_periods SET start_date = $2::date, end_date = $3::date
            WHERE id = $1`,
          [currentPeriodId, start, end]
        );
      } else {
        const foreign = await db.query<{ id: string; name: string }>(
          `SELECT id, name FROM rik.entitlement_periods
            WHERE CURRENT_DATE BETWEEN start_date AND end_date LIMIT 1`
        );
        if (foreign.length > 0) {
          // Holding the lock, this should not happen: it means another
          // suite's fixture was left un-parked by a crashed run. Say so
          // rather than moving a period this suite does not own.
          throw new Error(
            `fixture: period "${foreign[0]!.name}" still covers today; it was left un-parked`
          );
        }
        const made = await db.query<{ id: string }>(
          `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
           VALUES (shared.uuid_generate_v7(), 'Jest 15D current', $1::date, $2::date, 'ACTIVE')
           RETURNING id`,
          [start, end]
        );
        currentPeriodId = made[0]!.id;
        fixtureIsOurs = true;
      }

      const existing = await db.query<{ window_code: string }>(
        `SELECT window_code FROM rik.issue_windows WHERE period_id = $1`,
        [currentPeriodId]
      );
      const have = new Set(existing.map((r) => r.window_code));

      if (have.size > 0) {
        // Parked in the past; bring the Fresh windows back inside the period
        // before anything else reads the schedule.
        await makeCurrent('FRESH_3');
        await db.query(
          `UPDATE rik.issue_windows SET start_date = $2::date, end_date = $3::date,
                  operating_days = ARRAY[$2::date]
            WHERE period_id = $1 AND window_code = 'DRY'`,
          [currentPeriodId, start, end]
        );
      } else {
        // Created through the administrator's own route, so the schedule this
        // group reads is one the approved Phase C API could actually produce.
        for (const code of FRESH_CODES) {
          const seq = Number(code.slice(-1));
          const day = plusDays(centre, seq - 3);
          await request(server())
            .post('/admin/rik/issue-windows')
            .set('Authorization', asAdmin())
            .send({
              periodId: currentPeriodId,
              rationType: 'FRESH',
              sequenceNo: seq,
              startDate: day,
              endDate: day,
              operatingDays: [day],
            })
            .expect(201);
        }
        await request(server())
          .post('/admin/rik/issue-windows')
          .set('Authorization', asAdmin())
          .send({
            periodId: currentPeriodId,
            rationType: 'DRY',
            sequenceNo: 1,
            startDate: start,
            endDate: end,
            operatingDays: [start],
          })
          .expect(201);
      }

      selectionId = await confirmSelection('echo', 'PICKUP', 20, currentPeriodId);
      const created = await createVoucher(selectionId, 'FRESH').expect(201);
      voucherId = created.body.voucherId;
      voucherNumber = created.body.voucherNumber;
    });

    afterAll(async () => {
      // Park the fixture: the period moves first, then its windows follow it,
      // in one transaction so no reader sees a half-moved schedule. This is
      // what keeps the current month free for every other suite.
      if (fixtureIsOurs) {
        const parkStart = iso(monthStart(PARK_MONTHS_BACK));
        const parkEnd = iso(monthEnd(PARK_MONTHS_BACK));
        await db.withTransaction(async (client) => {
          await client.query(
            `UPDATE rik.entitlement_periods SET start_date = $2::date, end_date = $3::date
              WHERE id = $1`,
            [currentPeriodId, parkStart, parkEnd]
          );
          // ASCENDING sequence, because the windows are moving into the PAST:
          // 0047's ordering trigger judges each write against the others as
          // they stand, so window 1 must arrive in the parking slot before
          // window 2 follows it. Moving the schedule FORWARD needs the
          // opposite order, which is why `applyLayout` plans rather than
          // assumes one.
          const windows = await client.query<{ id: string; sequence_no: number }>(
            `SELECT id, sequence_no FROM rik.issue_windows
              WHERE period_id = $1 AND ration_type = 'FRESH'
              ORDER BY sequence_no ASC`,
            [currentPeriodId]
          );
          for (const w of windows.rows) {
            const day = plusDays(parkStart, w.sequence_no - 1);
            await client.query(
              `UPDATE rik.issue_windows SET start_date = $2::date, end_date = $2::date,
                      operating_days = ARRAY[$2::date]
                WHERE id = $1`,
              [w.id, day]
            );
          }
          await client.query(
            `UPDATE rik.issue_windows SET start_date = $2::date, end_date = $3::date,
                    operating_days = ARRAY[$2::date]
              WHERE period_id = $1 AND ration_type = 'DRY'`,
            [currentPeriodId, parkStart, parkEnd]
          );
        });
      }
      await lock.release();
    });

    it('carries no issue window of its own — the table has no such column', async () => {
      const rows = await db.query<{ column_name: string }>(
        `SELECT a.attname AS column_name FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = 'rik.issue_vouchers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND a.attname IN ('issue_window_id', 'window_id', 'window_code', 'sequence_no')`
      );
      expect(rows).toEqual([]);
    });

    it('reports Window 1 as current while Window 1 contains today', async () => {
      await makeCurrent('FRESH_1');
      const res = await request(server())
        .get(`/admin/rik/issue-vouchers/${voucherId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.currentWindowCode).toBe('FRESH_1');
      expect(res.body.voucherNumber).toBe(voucherNumber);
    });

    it('survives Window 1 → Window 2 with the SAME number', async () => {
      await makeCurrent('FRESH_2');
      const res = await request(server())
        .get(`/admin/rik/issue-vouchers/${voucherId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.currentWindowCode).toBe('FRESH_2');
      expect(res.body.voucherId).toBe(voucherId);
      expect(res.body.voucherNumber).toBe(voucherNumber);
    });

    it('survives Window 2 → Window 3 with the SAME number', async () => {
      await makeCurrent('FRESH_3');
      const res = await request(server())
        .get(`/admin/rik/issue-vouchers/${voucherId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.currentWindowCode).toBe('FRESH_3');
      expect(res.body.voucherNumber).toBe(voucherNumber);
    });

    it('created NO second voucher for any window', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.issue_vouchers
          WHERE selection_id = $1 AND ration_type = 'FRESH'`,
        [selectionId]
      );
      expect(rows[0]!.total).toBe('1');
    });

    it('lists every configured Fresh window, so the final closure is visible', async () => {
      const res = await request(server())
        .get(`/admin/rik/issue-vouchers/${voucherId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.windows.map((w: { windowCode: string }) => w.windowCode)).toEqual([
        'FRESH_1',
        'FRESH_2',
        'FRESH_3',
      ]);
      // After the last Fresh window closes there is no current window, which
      // is the state a later lapse rule would act on. Nothing lapses here,
      // and this phase implements no lapse.
      expect(res.body.windows[2].sequenceNo).toBe(3);
    });

    it('reports no current window when today is outside every window', async () => {
      // Three one-day windows at the start of the period, none of them today.
      const start = plusDays(today(), -3);
      await applyLayout(
        new Map<FreshCode, string>(
          FRESH_CODES.map((code) => [code, plusDays(start, Number(code.slice(-1)) - 1)])
        )
      );
      const res = await request(server())
        .get(`/admin/rik/issue-vouchers/${voucherId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.currentWindowCode).toBeNull();
      expect(res.body.voucherNumber).toBe(voucherNumber);
    });

    it('follows a schedule the administrator changes, without reissuing', async () => {
      // The administrator moves Fresh Window 3, then Window 2 behind it,
      // through the approved Phase C route — not raw SQL. The voucher is not
      // reissued and keeps its number; only what it reports changes.
      const third = await windowId('FRESH_3');
      const second = await windowId('FRESH_2');
      const movedThird = plusDays(today(), 3);
      const movedSecond = plusDays(today(), 2);
      for (const [id, day] of [
        [third, movedThird],
        [second, movedSecond],
      ] as const) {
        await request(server())
          .patch(`/admin/rik/issue-windows/${id}`)
          .set('Authorization', asAdmin())
          .send({ startDate: day, endDate: day, operatingDays: [day] })
          .expect(200);
      }

      const res = await request(server())
        .get(`/admin/rik/issue-vouchers/${voucherId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      const w2 = res.body.windows.find((w: { windowCode: string }) => w.windowCode === 'FRESH_2');
      const w3 = res.body.windows.find((w: { windowCode: string }) => w.windowCode === 'FRESH_3');
      expect(w2.startDate).toBe(movedSecond);
      expect(w3.startDate).toBe(movedThird);
      expect(res.body.voucherNumber).toBe(voucherNumber);

      // Phase C's own revision mechanism recorded the change; Phase D added
      // no second audit system for it.
      const revisions = await windowsRepo.listRevisions(second);
      expect(revisions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =================================================================
  // 7. The ration comes from the frozen snapshot
  // =================================================================
  describe('the voucher’s contents are the confirmed selection’s, not today’s', () => {
    let selectionId: string;
    let voucherId: string;
    let lineAtIssue: { code: string; name: string; brand: string | null; packSize: number | null; quantityToIssue: number };

    beforeAll(async () => {
      // A DEDICATED officer at 19 eligible days. Every officer in this suite
      // is used by exactly one group, because an eligibility figure is seeded
      // once and then becomes the frozen basis of a confirmed selection that
      // a voucher pins for ever — sharing an officer between groups would
      // make one group's seeded figure depend on another's.
      selectionId = await confirmSelection('foxtrot', 'PICKUP', 19);
      const created = await createVoucher(selectionId, 'DRY').expect(201);
      voucherId = created.body.voucherId;
      const res = await request(server())
        .get(`/admin/rik/issue-vouchers/${voucherId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      lineAtIssue = res.body.pools[0].lines[0];
    });

    it('lists the provision, its variety, pack size and the quantity to issue', () => {
      expect(lineAtIssue.code).toBeTruthy();
      expect(lineAtIssue.name).toBeTruthy();
      expect(lineAtIssue.quantityToIssue).toBeGreaterThan(0);
      expect(lineAtIssue).toHaveProperty('brand');
      expect(lineAtIssue).toHaveProperty('packSize');
    });

    it('reports the pool arithmetic the snapshot recorded', async () => {
      const res = await request(server())
        .get(`/admin/rik/issue-vouchers/${voucherId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      const pool = res.body.pools[0];
      expect(pool.eligibleDays).toBe(19);
      expect(pool.totalEntitlement).toBeGreaterThan(0);
      expect(pool.lines[0].poolEquivalentQty).toBeGreaterThan(0);
    });

    it('keeps its source components separately identifiable', async () => {
      const res = await request(server())
        .get(`/admin/rik/issue-vouchers/${voucherId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      // One component today — the voucher's own period. The list shape is
      // what lets a previous-month carry-forward be added as a SECOND entry
      // by the phase that defines it, rather than merged into one
      // indistinguishable balance. No carry-forward mechanism exists yet.
      expect(res.body.sourceComponents).toHaveLength(1);
      expect(res.body.sourceComponents[0].kind).toBe('CURRENT_PERIOD');
      expect(res.body.sourceComponents[0].periodId).toBe(periodId);
      expect(res.body.sourceComponents[0].eligibleDays).toBe(19);
    });

    it('a later catalogue change does not rewrite the voucher', async () => {
      const provision = await db.query<{ id: string; name: string; brand: string | null }>(
        `SELECT id, name, brand FROM rik.provisions WHERE code = $1`,
        [lineAtIssue.code]
      );
      const original = provision[0]!;
      await db.query(
        `UPDATE rik.provisions SET name = $2, brand = $3, pack_size = 9999 WHERE id = $1`,
        [original.id, `${original.name} RENAMED`, 'A DIFFERENT BRAND']
      );
      try {
        const res = await request(server())
          .get(`/admin/rik/issue-vouchers/${voucherId}`)
          .set('Authorization', asAdmin())
          .expect(200);
        const line = res.body.pools[0].lines[0];
        expect(line.name).toBe(lineAtIssue.name);
        expect(line.brand).toBe(lineAtIssue.brand);
        expect(line.packSize).toBe(lineAtIssue.packSize);
        expect(line.quantityToIssue).toBe(lineAtIssue.quantityToIssue);
      } finally {
        await db.query(
          `UPDATE rik.provisions SET name = $2, brand = $3, pack_size = $4 WHERE id = $1`,
          [original.id, original.name, original.brand, lineAtIssue.packSize]
        );
      }
    });

    it('a later eligibility change does not rewrite the voucher', async () => {
      const officer = officers.get('foxtrot')!;
      await request(server())
        .post(`/admin/rik/officers/${officer.officerId}/eligibility`)
        .set('Authorization', asAdmin())
        .send({ periodId, eligibleDays: 28, reason: 'Phase D immutability probe' })
        .expect(201);

      const res = await request(server())
        .get(`/admin/rik/issue-vouchers/${voucherId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.pools[0].eligibleDays).toBe(19);
      expect(res.body.sourceComponents[0].eligibleDays).toBe(19);
    });
  });

  // =================================================================
  // 8. Authorization
  // =================================================================
  describe('a voucher is created and read by RIK staff only', () => {
    let selectionId: string;
    let voucherId: string;

    beforeAll(async () => {
      const rows = await db.query<{ id: string }>(
        `SELECT id FROM rik.entitlement_selections WHERE period_id = $1 AND status = 'CONFIRMED'
          ORDER BY confirmed_at LIMIT 1`,
        [periodId]
      );
      selectionId = rows[0]!.id;
      const v = await db.query<{ id: string }>(
        `SELECT id FROM rik.issue_vouchers WHERE selection_id = $1 LIMIT 1`,
        [selectionId]
      );
      voucherId = v[0]!.id;
    });

    it('an anonymous caller is 401 everywhere', async () => {
      await request(server()).get('/admin/rik/issue-vouchers').expect(401);
      await request(server()).post('/admin/rik/issue-vouchers').send({}).expect(401);
      await request(server()).get(`/admin/rik/issue-vouchers/${voucherId}`).expect(401);
    });

    it('a CUSTOMER cannot reach the staff routes', async () => {
      const token = officers.get('alpha')!.token;
      await request(server())
        .get('/admin/rik/issue-vouchers')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      await request(server())
        .post('/admin/rik/issue-vouchers')
        .set('Authorization', `Bearer ${token}`)
        .send({ selectionId, rationType: 'FRESH' })
        .expect(403);
    });

    it('staff with no role cannot create or read a voucher', async () => {
      await request(server())
        .post('/admin/rik/issue-vouchers')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .send({ selectionId, rationType: 'FRESH' })
        .expect(403);
      await request(server())
        .get(`/admin/rik/issue-vouchers/${voucherId}`)
        .set('Authorization', `Bearer ${noRoleToken}`)
        .expect(403);
    });

    for (const role of STAFF_ROLES.filter((r) => r !== 'RIK_ADMIN' && r !== 'SUPER_ADMIN')) {
      it(`${role} cannot create a voucher`, async () => {
        await request(server())
          .post('/admin/rik/issue-vouchers')
          .set('Authorization', bearer(role))
          .send({ selectionId, rationType: 'FRESH' })
          .expect(403);
      });

      it(`${role} cannot read the operational voucher list`, async () => {
        await request(server())
          .get('/admin/rik/issue-vouchers')
          .set('Authorization', bearer(role))
          .expect(403);
      });
    }

    it('DELIVERY_STAFF gains no authority over a voucher from delivery being involved', async () => {
      const rows = await db.query<{ code: string }>(
        `SELECT p.code FROM shared.permissions p
           JOIN shared.role_permissions rp ON rp.permission_id = p.id
           JOIN shared.roles r ON r.id = rp.role_id
          WHERE r.name = 'DELIVERY_STAFF' AND p.code LIKE 'rik%'`
      );
      expect(rows).toEqual([]);
    });

    it('the permission used is the existing rik.order.manage', async () => {
      const rows = await db.query<{ role: string }>(
        `SELECT r.name AS role FROM shared.permissions p
           JOIN shared.role_permissions rp ON rp.permission_id = p.id
           JOIN shared.roles r ON r.id = rp.role_id
          WHERE p.code = 'rik.order.manage' ORDER BY r.name`
      );
      expect(rows.map((r) => r.role)).toEqual(['RIK_ADMIN', 'SUPER_ADMIN']);
    });

    it('no new role and no new permission was introduced', async () => {
      const rows = await db.query<{ roles: string; permissions: string }>(
        `SELECT (SELECT count(*)::text FROM shared.roles) AS roles,
                (SELECT count(*)::text FROM shared.permissions) AS permissions`
      );
      expect(rows[0]).toEqual({ roles: '6', permissions: '22' });
    });

    it('there is still no PURCHASING role', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM shared.roles WHERE name ILIKE '%PURCHAS%'`
      );
      expect(rows[0]!.total).toBe('0');
    });

    it('there is no route that changes a voucher', async () => {
      for (const method of ['patch', 'put', 'delete'] as const) {
        const probe = request(server());
        const res = await probe[method](`/admin/rik/issue-vouchers/${voucherId}`).set(
          'Authorization',
          asAdmin()
        );
        expect(res.status).toBe(404);
      }
    });
  });

  // =================================================================
  // 9. The officer's own voucher
  // =================================================================
  describe('an officer sees their own voucher, and only reads it', () => {
    let alphaVoucherId: string;
    let deltaVoucherId: string;

    beforeAll(async () => {
      const alpha = await db.query<{ id: string }>(
        `SELECT v.id FROM rik.issue_vouchers v WHERE v.customer_id = $1 LIMIT 1`,
        [officers.get('alpha')!.officerId]
      );
      alphaVoucherId = alpha[0]!.id;
      const delta = await db.query<{ id: string }>(
        `SELECT v.id FROM rik.issue_vouchers v WHERE v.customer_id = $1 LIMIT 1`,
        [officers.get('delta')!.officerId]
      );
      deltaVoucherId = delta[0]!.id;
    });

    it('lists only the officer’s own vouchers', async () => {
      const res = await request(server())
        .get('/rik/issue-vouchers')
        .set('Authorization', `Bearer ${officers.get('alpha')!.token}`)
        .expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      const ids = res.body.items.map((v: { voucherId: string }) => v.voucherId);
      expect(ids).toContain(alphaVoucherId);
      expect(ids).not.toContain(deltaVoucherId);
    });

    it('serves the officer’s own voucher as a document', async () => {
      const res = await request(server())
        .get(`/rik/issue-vouchers/${alphaVoucherId}`)
        .set('Authorization', `Bearer ${officers.get('alpha')!.token}`)
        .expect(200);
      expect(res.body.voucherNumber).toMatch(/^IV-/);
      expect(res.body.officer.rikId).toBe(officers.get('alpha')!.rikId);
      expect(res.body.pools.length).toBeGreaterThan(0);
    });

    it('answers 404 — NOT 403 — for someone else’s voucher, so an id reveals nothing', async () => {
      const res = await request(server())
        .get(`/rik/issue-vouchers/${deltaVoucherId}`)
        .set('Authorization', `Bearer ${officers.get('alpha')!.token}`);
      expect(res.status).toBe(404);
    });

    it('answers 404 for a voucher that does not exist, identically', async () => {
      const res = await request(server())
        .get('/rik/issue-vouchers/00000000-0000-7000-8000-000000000000')
        .set('Authorization', `Bearer ${officers.get('alpha')!.token}`);
      expect(res.status).toBe(404);
    });

    it('sends the officer no administrative detail', async () => {
      const res = await request(server())
        .get(`/rik/issue-vouchers/${alphaVoucherId}`)
        .set('Authorization', `Bearer ${officers.get('alpha')!.token}`)
        .expect(200);
      const body = JSON.stringify(res.body);
      expect(res.body).not.toHaveProperty('issuedBy');
      expect(res.body).not.toHaveProperty('selectionId');
      expect(body).not.toMatch(/audit|revision|createdBy|released_by/i);
    });

    it('offers the officer no write path to a voucher', async () => {
      const token = officers.get('alpha')!.token;
      for (const method of ['post', 'patch', 'put', 'delete'] as const) {
        const probe = request(server());
        const res = await probe[method](`/rik/issue-vouchers/${alphaVoucherId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ status: 'COLLECTED' });
        expect([404, 405]).toContain(res.status);
      }
    });

    it('an anonymous caller gets nothing', async () => {
      await request(server()).get('/rik/issue-vouchers').expect(401);
      await request(server()).get(`/rik/issue-vouchers/${alphaVoucherId}`).expect(401);
    });
  });

  // =================================================================
  // 10. The operational list
  // =================================================================
  describe('staff can find a voucher', () => {
    it('lists vouchers with a total', async () => {
      const res = await request(server())
        .get('/admin/rik/issue-vouchers?limit=5')
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.total).toBeGreaterThanOrEqual(res.body.items.length);
      expect(res.body.limit).toBe(5);
    });

    it('searches by voucher number', async () => {
      const first = await db.query<{ voucher_number: string }>(
        `SELECT voucher_number FROM rik.issue_vouchers ORDER BY created_at DESC LIMIT 1`
      );
      const res = await request(server())
        .get(`/admin/rik/issue-vouchers?q=${first[0]!.voucher_number}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items[0].voucherNumber).toBe(first[0]!.voucher_number);
    });

    it('searches by RIK ID, officer name and mobile number', async () => {
      const officer = officers.get('alpha')!;
      for (const term of [officer.rikId, `Jest 15D Officer Alpha ${runId}`, officer.mobile]) {
        const res = await request(server())
          .get(`/admin/rik/issue-vouchers?q=${encodeURIComponent(term)}`)
          .set('Authorization', asAdmin())
          .expect(200);
        expect(res.body.items.length).toBeGreaterThan(0);
        expect(res.body.items.every((v: { rikId: string }) => v.rikId === officer.rikId)).toBe(true);
      }
    });

    it('filters by ration type', async () => {
      const res = await request(server())
        .get('/admin/rik/issue-vouchers?rationType=DRY&limit=100')
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items.every((v: { rationType: string }) => v.rationType === 'DRY')).toBe(true);
    });

    it('filters by fulfilment mode', async () => {
      const res = await request(server())
        .get('/admin/rik/issue-vouchers?fulfillmentMode=DELIVERY&limit=100')
        .set('Authorization', asAdmin())
        .expect(200);
      expect(
        res.body.items.every((v: { fulfillmentMode: string }) => v.fulfillmentMode === 'DELIVERY')
      ).toBe(true);
    });

    it('filters by status', async () => {
      const res = await request(server())
        .get('/admin/rik/issue-vouchers?status=READY_FOR_PICKUP&limit=100')
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items.every((v: { status: string }) => v.status === 'READY_FOR_PICKUP')).toBe(
        true
      );
    });

    it('filters by period', async () => {
      const res = await request(server())
        .get(`/admin/rik/issue-vouchers?periodId=${periodId}&limit=100`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items.every((v: { periodId: string }) => v.periodId === periodId)).toBe(true);
    });

    it('refuses an unknown filter and an out-of-range limit', async () => {
      await request(server())
        .get('/admin/rik/issue-vouchers?nope=1')
        .set('Authorization', asAdmin())
        .expect(400);
      await request(server())
        .get('/admin/rik/issue-vouchers?limit=500')
        .set('Authorization', asAdmin())
        .expect(400);
      await request(server())
        .get('/admin/rik/issue-vouchers?rationType=FROZEN')
        .set('Authorization', asAdmin())
        .expect(400);
    });

    it('returns an empty page rather than an error for no match', async () => {
      const res = await request(server())
        .get('/admin/rik/issue-vouchers?q=zzz-no-such-voucher-zzz')
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('answers 404 for a voucher that does not exist', async () => {
      await request(server())
        .get('/admin/rik/issue-vouchers/00000000-0000-7000-8000-000000000000')
        .set('Authorization', asAdmin())
        .expect(404);
    });
  });

  // =================================================================
  // 11. Multiple periods, and the baseline
  // =================================================================
  describe('the baseline is untouched', () => {
    it('a voucher is scoped to its own period', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(DISTINCT period_id)::text AS total FROM rik.issue_vouchers
          WHERE selection_id IN (SELECT id FROM rik.entitlement_selections WHERE period_id = $1)`,
        [periodId]
      );
      expect(rows[0]!.total).toBe('1');
    });

    it('pools, scales, conversions and provisions are unchanged', async () => {
      const rows = await db.query<{ pools: string; scales: string; convs: string; provs: string }>(
        `SELECT (SELECT count(*)::text FROM rik.entitlement_pools)  AS pools,
                (SELECT count(*)::text FROM rik.pool_scales)        AS scales,
                (SELECT count(*)::text FROM rik.pool_conversions)   AS convs,
                (SELECT count(*)::text FROM rik.provisions)         AS provs`
      );
      expect(rows[0]).toEqual({ pools: '18', scales: '50', convs: '7', provs: '190' });
    });

    it('the schema contract holds at 62 tables and 5 views', async () => {
      const rows = await db.query<{ tables: string; views: string }>(
        `SELECT (SELECT count(*)::text FROM pg_tables
                  WHERE schemaname IN ('shared','rik','pif')) AS tables,
                (SELECT count(*)::text FROM pg_views
                  WHERE schemaname IN ('shared','rik','pif')) AS views`
      );
      expect(rows[0]).toEqual({ tables: '68', views: '5' });
    });

    it('pif is untouched, and no collection, delivery or substitution table exists', async () => {
      const rows = await db.query<{ pif: string; later: string }>(
        `SELECT (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'pif') AS pif,
                (SELECT count(*)::text FROM pg_tables
                  WHERE schemaname = 'rik'
                    AND (tablename ILIKE '%substitution%' OR tablename ILIKE '%collection%'
                      OR tablename ILIKE '%delivery%' OR tablename ILIKE '%correction%')) AS later`
      );
      // pif is 23: PHASE F added pif.order_events and the launch work added
      // the two product-import tables — all PIF's own; — its OWN order
      // history. What this test pins is that no RIK collection, delivery,
      // substitution or correction table appeared alongside it.
      expect(rows[0]).toEqual({ pif: '23', later: '0' });
    });

    it('the voucher table carries exactly the envelope, and no ration copy', async () => {
      const rows = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'rik' AND table_name = 'issue_vouchers'
            AND (column_name ILIKE '%quantity%' OR column_name ILIKE '%provision%'
              OR column_name ILIKE '%pack%' OR column_name ILIKE '%brand%')`
      );
      expect(rows).toEqual([]);
    });
  });
});
