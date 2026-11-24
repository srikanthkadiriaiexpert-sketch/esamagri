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
import { CurrentPeriodLock } from './test-support/current-period-lock';

/**
 * PHASE E — physical fulfilment, over real HTTP against real PostgreSQL.
 *
 * WHAT THIS SUITE IS DESIGNED TO PROVE
 *
 *  1. A ration is issued because a staff member RECORDED it. Never because
 *     time passed, never because a page was opened.
 *  2. WHAT WAS HANDED OVER is recorded line by line, with the substitution
 *     if there was one — and the officer's confirmed selection is not
 *     touched by any of it.
 *  3. THE LOCKED LANES HOLD. Pickup and delivery each follow their own
 *     sequence, and the database refuses every other path even when the
 *     application is bypassed.
 *  4. A COMPLETED VOUCHER IS NOT EDITED. It is corrected by a recorded
 *     reversal that leaves the original where it is.
 *  5. UNISSUED FRESH LAPSES at the final window, as NOT_COLLECTED with a
 *     reason — never as COLLECTED, and never on a new voucher number.
 *  6. UNISSUED DRY CARRIES FORWARD exactly one month, is spent before the
 *     current month's own balance, and lapses when that window closes.
 *
 * FIXTURE DISCIPLINE. Dates derive from the calendar at run time. The
 * fixture periods are claimed by ATTEMPTING the insert, so the suite is
 * independent of the order jest starts the other suites in.
 */
describe('RIK fulfilment (PHASE E, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;
  let eligibilityService: RikEligibilityService;
  let entitlement: RikEntitlementService;
  let validation: RikSelectionValidationService;

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(4, '5').slice(0, 4);
  const mobile = (suffix: number) => `9817${digits}${String(suffix).padStart(2, '0')}`;

  const staffIdByRole = new Map<StaffRole, string>();
  const tokenByRole = new Map<StaffRole, string>();

  interface Officer {
    officerId: string;
    rikId: string;
    name: string;
    token: string;
  }
  const officers = new Map<string, Officer>();

  /** The current month's fixture period — the one vouchers are issued in. */
  let periodId: string;
  let periodStart: string;
  /** The month before it — the carry-forward source. */
  let priorPeriodId: string;
  let priorStart: string;
  let pickupLocationId: string;

  const server = () => app.getHttpServer();
  const bearer = (role: StaffRole) => `Bearer ${tokenByRole.get(role)}`;
  const asAdmin = () => bearer('RIK_ADMIN');
  const asCounter = () => bearer('RIK_PICKUP_STAFF');

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = (back: number) => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - back, 1));
  };
  const monthEnd = (back: number) => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - back + 1, 0));
  };
  const plusDays = (isoDate: string, n: number): string => {
    const [y, m, d] = isoDate.split('-').map(Number);
    return iso(new Date(Date.UTC(y!, m! - 1, d! + n)));
  };
  const today = () => iso(new Date());

  const registerOfficer = async (key: string, suffix: number): Promise<void> => {
    const res = await request(server())
      .post('/admin/rik/officers')
      .set('Authorization', asAdmin())
      .send({
        name: `Jest 15E ${key} ${runId}`,
        mobileNumber: mobile(suffix),
        quarterBlock: 'E',
        quarterNumber: String(300 + suffix),
        dietaryPreference: 'NV',
      })
      .expect(201);
    officers.set(key, {
      officerId: res.body.officerId,
      rikId: res.body.rikId,
      name: res.body.name,
      token: tokenService.signAccessToken({
        principalType: 'CUSTOMER',
        principalId: res.body.officerId,
      }),
    });
  };

  /** A provision the officer may actually select, with a legal quantity. */
  const selectable = async (
    basis: Awaited<ReturnType<RikEligibilityService['resolveBasis']>>,
    issuePeriod: 'FRESH' | 'DRY',
    skip: string[] = []
  ): Promise<{ provisionId: string; poolId: string; quantity: number; ratio: number } | null> => {
    const calc = await entitlement.calculate(basis);
    for (const pool of [...calc.dry, ...calc.fresh]) {
      for (const p of pool.provisions) {
        if (p.issuePeriod !== issuePeriod || skip.includes(p.provisionId)) continue;
        let q = p.maxSelectableQuantity;
        if (p.maxQuantity !== null) q = Math.min(q, p.maxQuantity);
        if (p.maxPacks !== null && p.packSize !== null) q = Math.min(q, p.maxPacks * p.packSize);
        q = Math.floor(q / 2); // leave room, so a later line cannot overflow the pool
        if (q > 0) return { provisionId: p.provisionId, poolId: pool.poolId, quantity: q, ratio: p.consumptionRatio };
      }
    }
    return null;
  };

  /** Seed eligibility, choose one line of each stream, confirm. */
  const confirm = async (
    key: string,
    fulfillment: 'PICKUP' | 'DELIVERY',
    options: { period?: string; days?: number; only?: 'FRESH' | 'DRY' } = {}
  ): Promise<string> => {
    const officer = officers.get(key)!;
    const period = options.period ?? periodId;
    await db.query(
      `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days)
       VALUES ($1,$2,$3) ON CONFLICT (customer_id, period_id) DO NOTHING`,
      [officer.officerId, period, options.days ?? 20]
    );
    // The per-type figures, both at the SAME number as the legacy row, so
    // every quantity this suite asserts is unchanged while the engine reads
    // its real source. A figure above the Fresh maximum of 30 writes nothing
    // and leaves the pre-0066 fallback in place — see the helper.
    await seedBothRationTypes(db, officer.officerId, period, options.days ?? 20);
    const basis = await eligibilityService.resolveBasis(officer.officerId, period);
    const streams: Array<'FRESH' | 'DRY'> = options.only ? [options.only] : ['DRY', 'FRESH'];
    for (const stream of streams) {
      const choice = await selectable(basis, stream);
      if (choice === null) throw new Error(`fixture: nothing selectable for ${stream}`);
      const { result } = await validation.setQuantity(basis, choice.provisionId, choice.quantity);
      if (!result.ok) throw new Error(`fixture: ${stream} refused — ${result.reason}`);
    }
    const confirmed = await validation.confirm(basis, {
      availabilityAcknowledged: true,
      fulfillmentType: fulfillment,
      pickupLocationId: fulfillment === 'PICKUP' ? pickupLocationId : null,
      deliveryAddress: fulfillment === 'DELIVERY' ? `E-${300}, Jest 15E ${runId}` : null,
    });
    return confirmed.selectionId;
  };

  const makeVoucher = async (selectionId: string, rationType: 'FRESH' | 'DRY') => {
    const res = await request(server())
      .post('/admin/rik/issue-vouchers')
      .set('Authorization', asAdmin())
      .send({ selectionId, rationType })
      .expect(201);
    return res.body as { voucherId: string; voucherNumber: string; status: string };
  };

  /** What the counter should hand over, from the officer's own snapshot. */
  const confirmedLines = async (selectionId: string, customerId: string, rationType: 'FRESH' | 'DRY') => {
    const calc = await validation.recalculateFromSnapshot(selectionId, customerId);
    const out: Array<{ provisionId: string; quantity: number; poolId: string; ratio: number; poolCode: string }> = [];
    for (const pool of [...calc!.fresh, ...calc!.dry]) {
      for (const p of pool.provisions) {
        if (p.selectedQuantity > 0 && p.issuePeriod === rationType) {
          out.push({
            provisionId: p.provisionId,
            quantity: p.selectedQuantity,
            poolId: pool.poolId,
            ratio: p.consumptionRatio,
            poolCode: pool.code,
          });
        }
      }
    }
    return out;
  };

  /** Move a window directly — raw SQL, because the admin API rightly refuses
   *  some of the intermediate states these tests walk through. */
  const moveWindow = async (period: string, code: string, start: string, end: string) => {
    await db.query(
      `UPDATE rik.issue_windows SET start_date = $3::date, end_date = $4::date,
              operating_days = ARRAY[$3::date]
        WHERE period_id = $1 AND window_code = $2`,
      [period, code, start, end]
    );
  };

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

    const passwordHash = await app.get(PasswordService).hash('CorrectHorseBatteryStaple!1');
    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    const grantedBy = bootstrap[0]!.id;

    const staffAccount = async (username: string, display: string): Promise<string> => {
      const found = await db.query<{ id: string }>(`SELECT id FROM shared.users WHERE username = $1`, [username]);
      if (found.length > 0) return found[0]!.id;
      const made = await db.query<{ id: string }>(
        `INSERT INTO shared.users (id, username, password_hash, display_name, status)
         VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
        [username, passwordHash, display]
      );
      return made[0]!.id;
    };

    for (const role of STAFF_ROLES) {
      const id = await staffAccount(`jest_15e_${role.toLowerCase()}`, `Jest 15E ${role}`);
      staffIdByRole.set(role, id);
      await db.query(
        `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
         SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3 ON CONFLICT DO NOTHING`,
        [id, grantedBy, role]
      );
      tokenByRole.set(role, tokenService.signAccessToken({ principalType: 'STAFF', principalId: id }));
    }

    const pickup = await db.query<{ id: string }>(
      `SELECT id FROM rik.pickup_locations WHERE is_active ORDER BY name LIMIT 1`
    );
    pickupLocationId = pickup[0]!.id;

    // TWO ADJACENT fixture months: the carry-forward source and its target.
    // Claimed by attempting the insert, so a suite that got there first
    // simply moves this one along rather than failing it.
    const catalogue = await db.query<{ effective_from: string }>(
      `SELECT max(effective_from)::text AS effective_from FROM rik.provisions WHERE is_active`
    );
    const catalogueFrom = catalogue[0]!.effective_from;

    // TWO STABLE fixture periods under fixed names, claimed once into a free
    // adjacent pair and ADOPTED by every later run. They have to be stable:
    // a voucher and an issue window are both permanent, so a run-unique pair
    // would consume two calendar months of the shared fixture space for ever.
    // The officers are run-unique instead, which gives each run its own
    // selections inside the same two periods.
    const existing = await db.query<{ id: string; start_date: string; name: string }>(
      `SELECT id, start_date::text AS start_date, name FROM rik.entitlement_periods
        WHERE name IN ('Jest 15E source', 'Jest 15E target') ORDER BY start_date`
    );

    if (existing.length === 2) {
      priorPeriodId = existing[0]!.id;
      priorStart = existing[0]!.start_date;
      periodId = existing[1]!.id;
      periodStart = existing[1]!.start_date;
    } else {
      const claim = async (start: string, end: string, name: string) => {
        try {
          const rows = await db.query<{ id: string; start_date: string }>(
            `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
             VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'ACTIVE')
             RETURNING id, start_date::text AS start_date`,
            [name, start, end]
          );
          return rows[0]!;
        } catch {
          return null;
        }
      };

      // TWO HALVES OF ONE FREE MONTH, not two calendar months.
      //
      // A ration period is a date range, not a month, and the carry-forward
      // rule needs the source to be the period IMMEDIATELY before the
      // target. Two halves of one month are adjacent by construction and
      // consume one month of the shared fixture space instead of two —
      // which matters, because the other suites claim whole months by
      // relative offset (this month, last month, two back, four, five,
      // eight, nine) and the catalogue is only effective from its own
      // effective date onwards.
      let claimed = false;
      for (let back = 3; back <= 23 && !claimed; back += 1) {
        const first = iso(monthStart(back));
        const last = iso(monthEnd(back));
        if (last < catalogueFrom) continue;
        const split = plusDays(first, 13);

        const source = await claim(first, split, 'Jest 15E source');
        if (source === null) continue;
        const target = await claim(plusDays(split, 1), last, 'Jest 15E target');
        if (target === null) {
          await clearRationEligibilityForPeriods(db, [source.id]);
          await db.query(`DELETE FROM rik.entitlement_periods WHERE id = $1`, [source.id]);
          continue;
        }
        priorPeriodId = source.id;
        priorStart = source.start_date;
        periodId = target.id;
        periodStart = target.start_date;
        claimed = true;
      }
      if (!claimed) throw new Error('fixture: no free month to split');
    }

    // The configured schedule for both periods, through the approved route.
    // 0047 refuses a window DELETE, so a second run finds them already there
    // and moves them back into place rather than creating them again.
    for (const [period, start] of [
      [periodId, periodStart],
      [priorPeriodId, priorStart],
    ] as const) {
      const have = await db.query<{ window_code: string }>(
        `SELECT window_code FROM rik.issue_windows WHERE period_id = $1`,
        [period]
      );
      const present = new Set(have.map((w) => w.window_code));
      for (const seq of [1, 2, 3]) {
        const day = plusDays(start, (seq - 1) * 5);
        if (present.has(`FRESH_${seq}`)) {
          await moveWindow(period, `FRESH_${seq}`, day, plusDays(day, 1));
        } else {
          await request(server())
            .post('/admin/rik/issue-windows')
            .set('Authorization', asAdmin())
            .send({
              periodId: period,
              rationType: 'FRESH',
              sequenceNo: seq,
              startDate: day,
              endDate: plusDays(day, 1),
              operatingDays: [day],
            })
            .expect(201);
        }
      }
      if (present.has('DRY')) {
        await moveWindow(period, 'DRY', start, plusDays(start, 12));
      } else {
        await request(server())
          .post('/admin/rik/issue-windows')
          .set('Authorization', asAdmin())
          .send({
            periodId: period,
            rationType: 'DRY',
            sequenceNo: 1,
            startDate: start,
            endDate: plusDays(start, 12),
            operatingDays: [plusDays(start, 1)],
          })
          .expect(201);
      }
    }

    for (const [key, suffix] of [
      ['collect', 10],
      ['refuse', 11],
      ['deliver', 12],
      ['nodeliver', 13],
      ['substitute', 14],
      ['lapse', 15],
      ['carry', 16],
      ['correct', 17],
      ['concurrent', 18],
      ['immutable', 19],
    ] as const) {
      await registerOfficer(key, suffix);
    }
  });

  afterAll(async () => {
    const principals = [...officers.values()].map((o) => o.officerId);
    await db.query(`DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])`, [principals]);
    await app.close();
  });

  // =================================================================
  // 1. Pickup: collection and explicit non-collection
  // =================================================================
  describe('1 — a pickup voucher is collected, or explicitly not collected', () => {
    let voucher: { voucherId: string; voucherNumber: string };
    let lines: Awaited<ReturnType<typeof confirmedLines>>;
    let selectionId: string;

    beforeAll(async () => {
      selectionId = await confirm('collect', 'PICKUP');
      voucher = await makeVoucher(selectionId, 'DRY');
      lines = await confirmedLines(selectionId, officers.get('collect')!.officerId, 'DRY');
    });

    it('starts at the entry status of the pickup lane', async () => {
      const rows = await db.query<{ status: string }>(
        `SELECT status FROM rik.issue_vouchers WHERE id = $1`,
        [voucher.voucherId]
      );
      expect(rows[0]!.status).toBe('READY_FOR_PICKUP');
    });

    it('records a collection with what was actually handed over', async () => {
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/pickup`)
        .set('Authorization', asCounter())
        .send({
          outcome: 'COLLECTED',
          lines: lines.map((l) => ({ provisionId: l.provisionId, quantity: l.quantity })),
        })
        .expect(201);

      expect(res.body.status).toBe('COLLECTED');
      expect(res.body.voucherNumber).toBe(voucher.voucherNumber);
    });

    it('moved the voucher status — and the application never wrote it', async () => {
      const rows = await db.query<{ status: string }>(
        `SELECT status FROM rik.issue_vouchers WHERE id = $1`,
        [voucher.voucherId]
      );
      expect(rows[0]!.status).toBe('COLLECTED');

      // The projection is the ONLY path: app_rik holds no UPDATE at all.
      const grants = await db.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'rik' AND table_name = 'issue_vouchers' AND grantee = 'app_rik'`
      );
      expect(grants.map((g) => g.privilege_type).sort()).toEqual(['INSERT', 'SELECT']);
    });

    it('recorded the staff member, the moment and the issue lines', async () => {
      const rows = await db.query<{
        outcome: string;
        recorded_by: string;
        recorded_by_role: string;
        recorded_at: string;
        lines: string;
      }>(
        `SELECT o.outcome, o.recorded_by, o.recorded_by_role, o.recorded_at::text,
                (SELECT count(*)::text FROM rik.issue_voucher_issue_lines l WHERE l.outcome_id = o.id) AS lines
           FROM rik.issue_voucher_outcomes o WHERE o.voucher_id = $1`,
        [voucher.voucherId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.outcome).toBe('COLLECTED');
      expect(rows[0]!.recorded_by).toBe(staffIdByRole.get('RIK_PICKUP_STAFF'));
      expect(rows[0]!.recorded_by_role).toContain('RIK_PICKUP_STAFF');
      expect(Number(rows[0]!.lines)).toBe(lines.length);
    });

    it('wrote an audit entry for the collection', async () => {
      const rows = await db.query<{ action: string }>(
        `SELECT action FROM shared.audit_log WHERE entity_id = $1 ORDER BY created_at`,
        [voucher.voucherId]
      );
      expect(rows.map((r) => r.action)).toContain('RIK_VOUCHER_COLLECTED');
    });

    it('refuses a SECOND collection of the same voucher', async () => {
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/pickup`)
        .set('Authorization', asCounter())
        .send({
          outcome: 'COLLECTED',
          lines: lines.map((l) => ({ provisionId: l.provisionId, quantity: l.quantity })),
        });
      expect(res.status).toBe(409);
      expect(res.body.details.reason).toBe('ALREADY_COMPLETED');
    });

    it('the DATABASE refuses a second completion even when the application is bypassed', async () => {
      await expect(
        db.query(
          `INSERT INTO rik.issue_voucher_outcomes
             (voucher_id, voucher_number, sequence_no, event_type, outcome, recorded_by, recorded_by_role)
           VALUES ($1, $2, 99, 'OUTCOME', 'COLLECTED', $3, 'RIK_PICKUP_STAFF')`,
          [voucher.voucherId, voucher.voucherNumber, staffIdByRole.get('RIK_PICKUP_STAFF')]
        )
      ).rejects.toThrow();
    });

    it('records an explicit NOT COLLECTED, with its reason', async () => {
      const selection = await confirm('refuse', 'PICKUP');
      const v = await makeVoucher(selection, 'DRY');
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${v.voucherId}/pickup`)
        .set('Authorization', asCounter())
        .send({ outcome: 'NOT_COLLECTED', reason: 'Officer did not attend the counter' })
        .expect(201);
      expect(res.body.status).toBe('NOT_COLLECTED');

      const rows = await db.query<{ reason: string; lines: string }>(
        `SELECT o.reason, (SELECT count(*)::text FROM rik.issue_voucher_issue_lines l WHERE l.outcome_id = o.id) AS lines
           FROM rik.issue_voucher_outcomes o WHERE o.voucher_id = $1`,
        [v.voucherId]
      );
      expect(rows[0]!.reason).toBe('Officer did not attend the counter');
      expect(Number(rows[0]!.lines)).toBe(0);
    });

    it('refuses a non-collection with no reason', async () => {
      const selection = await confirm('concurrent', 'PICKUP');
      const v = await makeVoucher(selection, 'DRY');
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${v.voucherId}/pickup`)
        .set('Authorization', asCounter())
        .send({ outcome: 'NOT_COLLECTED' });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('REASON_REQUIRED');
    });

    it('NOTHING is ever inferred: a voucher nobody touched is still ready', async () => {
      const selection = await confirm('immutable', 'PICKUP');
      const v = await makeVoucher(selection, 'DRY');
      const rows = await db.query<{ status: string; events: string }>(
        `SELECT v.status, (SELECT count(*)::text FROM rik.issue_voucher_outcomes o WHERE o.voucher_id = v.id) AS events
           FROM rik.issue_vouchers v WHERE v.id = $1`,
        [v.voucherId]
      );
      expect(rows[0]!.status).toBe('READY_FOR_PICKUP');
      expect(rows[0]!.events).toBe('0');
    });
  });

  // =================================================================
  // 2. Delivery lifecycle
  // =================================================================
  describe('2 — a delivery voucher goes out, then is delivered or refused', () => {
    let voucher: { voucherId: string; voucherNumber: string };
    let lines: Awaited<ReturnType<typeof confirmedLines>>;

    beforeAll(async () => {
      const selection = await confirm('deliver', 'DELIVERY');
      voucher = await makeVoucher(selection, 'DRY');
      lines = await confirmedLines(selection, officers.get('deliver')!.officerId, 'DRY');
    });

    it('cannot be DELIVERED before it has gone out', async () => {
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/delivery`)
        .set('Authorization', asAdmin())
        .send({ outcome: 'DELIVERED', lines: lines.map((l) => ({ provisionId: l.provisionId, quantity: l.quantity })) });
      expect(res.status).toBe(400);
    });

    it('goes OUT FOR DELIVERY', async () => {
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/delivery`)
        .set('Authorization', asAdmin())
        .send({ outcome: 'OUT_FOR_DELIVERY' })
        .expect(201);
      expect(res.body.status).toBe('OUT_FOR_DELIVERY');
    });

    it('is then DELIVERED, with what was handed over', async () => {
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/delivery`)
        .set('Authorization', asAdmin())
        .send({
          outcome: 'DELIVERED',
          lines: lines.map((l) => ({ provisionId: l.provisionId, quantity: l.quantity })),
        })
        .expect(201);
      expect(res.body.status).toBe('DELIVERED');
      expect(res.body.voucherNumber).toBe(voucher.voucherNumber);
    });

    it('records an explicit NOT DELIVERED with its reason', async () => {
      const selection = await confirm('nodeliver', 'DELIVERY');
      const v = await makeVoucher(selection, 'DRY');
      await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${v.voucherId}/delivery`)
        .set('Authorization', asAdmin())
        .send({ outcome: 'OUT_FOR_DELIVERY' })
        .expect(201);
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${v.voucherId}/delivery`)
        .set('Authorization', asAdmin())
        .send({ outcome: 'NOT_DELIVERED', reason: 'Nobody at the quarter on two attempts' })
        .expect(201);
      expect(res.body.status).toBe('NOT_DELIVERED');
    });

    it('the DATABASE refuses a pickup outcome on a delivery voucher', async () => {
      await expect(
        db.query(
          `INSERT INTO rik.issue_voucher_outcomes
             (voucher_id, voucher_number, sequence_no, event_type, outcome, recorded_by, recorded_by_role)
           VALUES ($1, $2, 90, 'OUTCOME', 'COLLECTED', $3, 'RIK_ADMIN')`,
          [voucher.voucherId, voucher.voucherNumber, staffIdByRole.get('RIK_ADMIN')]
        )
      ).rejects.toThrow();
    });
  });

  // =================================================================
  // 3. Who may change a status
  // =================================================================
  describe('3 — an unauthorized status change is refused', () => {
    let voucherId: string;

    beforeAll(async () => {
      const rows = await db.query<{ id: string }>(
        `SELECT v.id FROM rik.issue_vouchers v WHERE v.period_id = $1 AND v.status = 'READY_FOR_PICKUP' LIMIT 1`,
        [periodId]
      );
      voucherId = rows[0]!.id;
    });

    it('an anonymous caller is refused', async () => {
      await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucherId}/pickup`)
        .send({ outcome: 'COLLECTED' })
        .expect(401);
    });

    it('DELIVERY_STAFF cannot touch a RIK voucher at all', async () => {
      for (const lane of ['pickup', 'delivery']) {
        const res = await request(server())
          .post(`/admin/rik/fulfillment/vouchers/${voucherId}/${lane}`)
          .set('Authorization', bearer('DELIVERY_STAFF'))
          .send({ outcome: lane === 'pickup' ? 'COLLECTED' : 'OUT_FOR_DELIVERY' });
        expect(res.status).toBe(403);
      }
    });

    it('DELIVERY_STAFF holds no rik.* permission at all', async () => {
      const rows = await db.query<{ code: string }>(
        `SELECT p.code FROM shared.roles r
           JOIN shared.role_permissions rp ON rp.role_id = r.id
           JOIN shared.permissions p ON p.id = rp.permission_id
          WHERE r.name = 'DELIVERY_STAFF' AND p.code LIKE 'rik.%'`
      );
      expect(rows).toEqual([]);
    });

    it('the counter cannot work the delivery lane, and PIF roles cannot work either', async () => {
      await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucherId}/delivery`)
        .set('Authorization', asCounter())
        .send({ outcome: 'OUT_FOR_DELIVERY' })
        .expect(403);

      // A PIF role holds nothing in RIK and is refused at the door.
      for (const role of ['PIF_ADMIN', 'PIF_CASHIER'] as StaffRole[]) {
        await request(server())
          .post(`/admin/rik/fulfillment/vouchers/${voucherId}/pickup`)
          .set('Authorization', bearer(role))
          .send({ outcome: 'COLLECTED' })
          .expect(403);
      }
    });

    it('SUPER_ADMIN reaches the counter by GRANT, and is then held to the same rules', async () => {
      // PHASE F granted SUPER_ADMIN rik.order.mark_collected explicitly, so
      // it is no longer refused at the door. What it is NOT given is a way
      // around the fulfilment rules: a completion with no lines is refused
      // for the overall administrator exactly as for the counter staff.
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucherId}/pickup`)
        .set('Authorization', bearer('SUPER_ADMIN'))
        .send({ outcome: 'COLLECTED' });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('NOTHING_ISSUED');

      const unchanged = await db.query<{ status: string; events: string }>(
        `SELECT status, (SELECT count(*)::text FROM rik.issue_voucher_outcomes o WHERE o.voucher_id = v.id) AS events
           FROM rik.issue_vouchers v WHERE v.id = $1`,
        [voucherId]
      );
      expect(unchanged[0]!.events).toBe('0');
    });

    it('a customer cannot record anything', async () => {
      await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucherId}/pickup`)
        .set('Authorization', `Bearer ${officers.get('collect')!.token}`)
        .send({ outcome: 'COLLECTED' })
        .expect(403);
    });

    it('no new ROLE exists, and the rik.* permission set is exactly as PHASE E left it', async () => {
      const rows = await db.query<{ roles: string; perms: string }>(
        `SELECT (SELECT count(*)::text FROM shared.roles) AS roles,
                (SELECT count(*)::text FROM shared.permissions) AS perms`
      );
      expect(rows[0]).toEqual({ roles: '6', perms: '22' });
      const purchasing = await db.query(`SELECT 1 FROM shared.roles WHERE name = 'PURCHASING'`);
      expect(purchasing).toEqual([]);
    });
  });

  // =================================================================
  // 4 & 5. Substitution
  // =================================================================
  describe('4 — an approved substitution is recorded, the selection is not', () => {
    let voucher: { voucherId: string; voucherNumber: string };
    let selectionId: string;
    let original: Awaited<ReturnType<typeof confirmedLines>>[number];
    let substitute: { provisionId: string; name: string; consumptionRatio: number };
    let snapshotBefore: string;

    beforeAll(async () => {
      selectionId = await confirm('substitute', 'PICKUP');
      voucher = await makeVoucher(selectionId, 'DRY');
      const lines = await confirmedLines(selectionId, officers.get('substitute')!.officerId, 'DRY');
      original = lines[0]!;

      const res = await request(server())
        .get(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}`)
        .set('Authorization', asCounter())
        .expect(200);
      // A pool with only one provision has no alternative to offer — Salt is
      // one — so the fixture takes a line that genuinely has one.
      const group = res.body.substitutionOptions.find(
        (g: { alternatives: unknown[] }) => g.alternatives.length > 0
      );
      if (group === undefined) throw new Error('fixture: no pool offers an alternative');
      original = lines.find((l) => l.provisionId === group.originalProvisionId)!;
      substitute = group.alternatives[0];

      const rows = await db.query<{ snap: string }>(
        `SELECT rule_snapshot::text AS snap FROM rik.entitlement_selections WHERE id = $1`,
        [selectionId]
      );
      snapshotBefore = rows[0]!.snap;
    });

    it('offers only alternatives from the SAME entitlement pool', async () => {
      const res = await request(server())
        .get(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}`)
        .set('Authorization', asCounter())
        .expect(200);
      for (const group of res.body.substitutionOptions) {
        const ids = group.alternatives.map((a: { provisionId: string }) => a.provisionId);
        const rows = await db.query<{ total: string }>(
          `SELECT count(*)::text AS total FROM rik.provisions pr
             JOIN rik.entitlement_pools p ON p.id = pr.pool_id
            WHERE pr.id = ANY($1::uuid[]) AND p.code <> $2`,
          [ids, group.poolCode]
        );
        expect(rows[0]!.total).toBe('0');
      }
    });

    it('computes the equivalent quantity from the approved consumption ratios', async () => {
      const res = await request(server())
        .get(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}`)
        .set('Authorization', asCounter())
        .expect(200);
      const group = res.body.substitutionOptions.find(
        (g: { originalProvisionId: string }) => g.originalProvisionId === original.provisionId
      );
      for (const alt of group.alternatives) {
        expect(alt.equivalentQuantity).toBeCloseTo(group.poolEquivalentQty / alt.consumptionRatio, 3);
      }
    });

    it('records a partial substitution: some of the original, some of the substitute', async () => {
      const half = Math.floor(original.quantity / 2);
      const substituteQty = Math.max(
        1,
        Math.floor(((original.quantity - half) * original.ratio) / substitute.consumptionRatio)
      );
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/pickup`)
        .set('Authorization', asCounter())
        .send({
          outcome: 'COLLECTED',
          lines: [
            { provisionId: original.provisionId, quantity: half },
            {
              provisionId: substitute.provisionId,
              quantity: substituteQty,
              originalProvisionId: original.provisionId,
              substitutionReason: 'Original out of stock at the counter',
            },
          ],
        })
        .expect(201);
      expect(res.body.status).toBe('COLLECTED');
    });

    it('the voucher shows the ACTUAL issue, naming what it replaced', async () => {
      const res = await request(server())
        .get(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}`)
        .set('Authorization', asCounter())
        .expect(200);
      const substituted = res.body.issuedLines.find(
        (l: { substitutedFor: unknown }) => l.substitutedFor !== null
      );
      expect(substituted.provisionId).toBe(substitute.provisionId);
      expect(substituted.substitutedFor.provisionId).toBe(original.provisionId);
      expect(substituted.substitutedFor.reason).toBe('Original out of stock at the counter');
      expect(res.body.issuedLines).toHaveLength(2);
    });

    it('the officer’s confirmed selection is byte-for-byte unchanged', async () => {
      const rows = await db.query<{ snap: string; status: string }>(
        `SELECT rule_snapshot::text AS snap, status FROM rik.entitlement_selections WHERE id = $1`,
        [selectionId]
      );
      expect(rows[0]!.snap).toBe(snapshotBefore);
      expect(rows[0]!.status).toBe('CONFIRMED');

      const items = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.entitlement_selection_items WHERE selection_id = $1`,
        [selectionId]
      );
      expect(Number(items[0]!.total)).toBeGreaterThan(0);
    });
  });

  describe('5 — an unapproved substitution or an impossible quantity is refused', () => {
    let voucherId: string;
    let selectionId: string;
    let original: Awaited<ReturnType<typeof confirmedLines>>[number];

    beforeAll(async () => {
      selectionId = await confirm('lapse', 'PICKUP');
      const v = await makeVoucher(selectionId, 'DRY');
      voucherId = v.voucherId;
      original = (await confirmedLines(selectionId, officers.get('lapse')!.officerId, 'DRY'))[0]!;
    });

    const send = (lines: unknown[]) =>
      request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucherId}/pickup`)
        .set('Authorization', asCounter())
        .send({ outcome: 'COLLECTED', lines });

    it('refuses a provision from another entitlement pool', async () => {
      const other = await db.query<{ id: string }>(
        `SELECT pr.id FROM rik.provisions pr
           JOIN rik.entitlement_pools p ON p.id = pr.pool_id
          WHERE p.ration_type = 'DRY' AND p.id <> $1 AND pr.is_active AND pr.is_customer_selectable
          LIMIT 1`,
        [original.poolId]
      );
      const res = await send([
        {
          provisionId: other[0]!.id,
          quantity: 1,
          originalProvisionId: original.provisionId,
          substitutionReason: 'Trying to hand over something else entirely',
        },
      ]);
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('SUBSTITUTE_NOT_APPROVED');
    });

    it('refuses a substitution with no reason', async () => {
      const group = (
        await request(server())
          .get(`/admin/rik/fulfillment/vouchers/${voucherId}`)
          .set('Authorization', asCounter())
          .expect(200)
      ).body.substitutionOptions.find(
        (g: { originalProvisionId: string }) => g.originalProvisionId === original.provisionId
      );
      const res = await send([
        {
          provisionId: group.alternatives[0].provisionId,
          quantity: 1,
          originalProvisionId: original.provisionId,
        },
      ]);
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('REASON_REQUIRED');
    });

    it('refuses a provision the officer never chose and that substitutes for nothing', async () => {
      // A real catalogue item of the SAME pool that this officer did not
      // choose: handing it over silently would be an amendment of their
      // selection, so it is only ever issuable as a recorded substitution.
      const unchosen = await db.query<{ id: string }>(
        `SELECT pr.id FROM rik.provisions pr
          WHERE pr.pool_id = $1 AND pr.is_active AND pr.is_customer_selectable
            AND pr.issue_period = 'DRY' AND pr.id <> $2
          ORDER BY pr.code LIMIT 1`,
        [original.poolId, original.provisionId]
      );
      const res = await send([{ provisionId: unchosen[0]!.id, quantity: 1 }]);
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('PROVISION_NOT_IN_SNAPSHOT');
    });

    it('refuses a quantity beyond the officer’s entitlement', async () => {
      const res = await send([{ provisionId: original.provisionId, quantity: 9_999_999 }]);
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('QUANTITY_EXCEEDS_ENTITLEMENT');
    });

    it('refuses a zero or negative quantity at the shape gate', async () => {
      for (const q of [0, -5]) {
        const res = await send([{ provisionId: original.provisionId, quantity: q }]);
        expect(res.status).toBe(400);
      }
    });

    it('refuses a completion with no lines at all', async () => {
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucherId}/pickup`)
        .set('Authorization', asCounter())
        .send({ outcome: 'COLLECTED' });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('NOTHING_ISSUED');
    });

    it('and after all those refusals, NOTHING was recorded', async () => {
      const rows = await db.query<{ events: string; lines: string; status: string }>(
        `SELECT (SELECT count(*)::text FROM rik.issue_voucher_outcomes o WHERE o.voucher_id = v.id) AS events,
                (SELECT count(*)::text FROM rik.issue_voucher_issue_lines l WHERE l.voucher_id = v.id) AS lines,
                v.status
           FROM rik.issue_vouchers v WHERE v.id = $1`,
        [voucherId]
      );
      expect(rows[0]).toEqual({ events: '0', lines: '0', status: 'READY_FOR_PICKUP' });
    });
  });

  // =================================================================
  // 6. Correction of a completed voucher
  // =================================================================
  describe('6 — a completed voucher is corrected by a recorded reversal', () => {
    let voucher: { voucherId: string; voucherNumber: string };
    let outcomeId: string;

    beforeAll(async () => {
      const selection = await confirm('correct', 'PICKUP');
      voucher = await makeVoucher(selection, 'DRY');
      const lines = await confirmedLines(selection, officers.get('correct')!.officerId, 'DRY');
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/pickup`)
        .set('Authorization', asCounter())
        .send({
          outcome: 'COLLECTED',
          lines: lines.map((l) => ({ provisionId: l.provisionId, quantity: l.quantity })),
        })
        .expect(201);
      outcomeId = res.body.outcomeId;
    });

    it('there is NO delete and NO edit route for a completed voucher', async () => {
      for (const method of ['delete', 'put', 'patch'] as const) {
        const agent = request(server());
        const res = await agent[method](
          `/admin/rik/fulfillment/vouchers/${voucher.voucherId}/pickup`
        )
          .set('Authorization', asAdmin())
          .send({ outcome: 'NOT_COLLECTED', reason: 'trying to edit' });
        expect([404, 405]).toContain(res.status);
      }
    });

    it('the DATABASE refuses an update or a delete of a fulfilment record', async () => {
      await expect(
        db.query(`UPDATE rik.issue_voucher_outcomes SET outcome = 'NOT_COLLECTED' WHERE id = $1`, [outcomeId])
      ).rejects.toThrow();
      await expect(
        db.query(`DELETE FROM rik.issue_voucher_outcomes WHERE id = $1`, [outcomeId])
      ).rejects.toThrow();
    });

    it('a correction requires a reason', async () => {
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/corrections`)
        .set('Authorization', asAdmin())
        .send({ outcomeId });
      expect(res.status).toBe(400);
    });

    it('the counter cannot correct; only the administrator can', async () => {
      await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/corrections`)
        .set('Authorization', asCounter())
        .send({ outcomeId, reason: 'Recorded against the wrong officer' })
        .expect(403);
    });

    it('reverses the completion and returns the voucher to ready', async () => {
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/corrections`)
        .set('Authorization', asAdmin())
        .send({ outcomeId, reason: 'Recorded against the wrong officer' })
        .expect(201);
      expect(res.body.status).toBe('READY_FOR_PICKUP');
      expect(res.body.voucherNumber).toBe(voucher.voucherNumber);
    });

    it('the ORIGINAL completion is still there, with its lines', async () => {
      const rows = await db.query<{ outcome: string; event_type: string }>(
        `SELECT outcome, event_type FROM rik.issue_voucher_outcomes
          WHERE voucher_id = $1 ORDER BY sequence_no`,
        [voucher.voucherId]
      );
      expect(rows.map((r) => r.outcome)).toEqual(['COLLECTED', 'REVERSED']);
      expect(rows.map((r) => r.event_type)).toEqual(['OUTCOME', 'CORRECTION']);

      const lines = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.issue_voucher_issue_lines WHERE outcome_id = $1`,
        [outcomeId]
      );
      expect(Number(lines[0]!.total)).toBeGreaterThan(0);
    });

    it('what it issued no longer counts as issued', async () => {
      const res = await request(server())
        .get(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}`)
        .set('Authorization', asCounter())
        .expect(200);
      expect(res.body.issuedLines).toEqual([]);
      expect(res.body.completion).toBeNull();
    });

    it('records the actor, the moment, the previous status and the reason', async () => {
      const rows = await db.query<{ before: string; after: string; actor: string }>(
        `SELECT before::text, after::text, actor_id AS actor FROM shared.audit_log
          WHERE entity_id = $1 AND action = 'RIK_VOUCHER_COMPLETION_REVERSED'`,
        [voucher.voucherId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.before).toContain('COLLECTED');
      expect(rows[0]!.after).toContain('Recorded against the wrong officer');
      expect(rows[0]!.actor).toBe(staffIdByRole.get('RIK_ADMIN'));
    });

    it('the same completion cannot be reversed twice', async () => {
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/corrections`)
        .set('Authorization', asAdmin())
        .send({ outcomeId, reason: 'Trying the same correction again' });
      expect(res.status).toBe(409);
    });

    it('and the voucher can then be completed again, correctly', async () => {
      const lines = await confirmedLines(
        (await db.query<{ selection_id: string }>(
          `SELECT selection_id FROM rik.issue_vouchers WHERE id = $1`,
          [voucher.voucherId]
        ))[0]!.selection_id,
        officers.get('correct')!.officerId,
        'DRY'
      );
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/pickup`)
        .set('Authorization', asCounter())
        .send({
          outcome: 'COLLECTED',
          lines: lines.map((l) => ({ provisionId: l.provisionId, quantity: l.quantity })),
        })
        .expect(201);
      expect(res.body.status).toBe('COLLECTED');
    });
  });

  // =================================================================
  // 7. Fresh continuation and the final-window lapse
  // =================================================================
  describe('7 — a Fresh voucher spans the windows and lapses at the last one', () => {
    let voucher: { voucherId: string; voucherNumber: string };

    beforeAll(async () => {
      const rows = await db.query<{ id: string }>(
        `SELECT id FROM rik.entitlement_selections
          WHERE customer_id = $1 AND period_id = $2 AND status = 'CONFIRMED'`,
        [officers.get('collect')!.officerId, periodId]
      );
      voucher = await makeVoucher(rows[0]!.id, 'FRESH');
    });

    it('the same voucher carries across every configured Fresh window', async () => {
      // The three windows are configured and the voucher belongs to none of
      // them: it is not reissued per window and keeps one number throughout.
      const windows = await db.query<{ window_code: string }>(
        `SELECT window_code FROM rik.issue_windows
          WHERE period_id = $1 AND ration_type = 'FRESH' ORDER BY sequence_no`,
        [periodId]
      );
      expect(windows.map((w) => w.window_code)).toEqual(['FRESH_1', 'FRESH_2', 'FRESH_3']);

      const columns = await db.query<{ column_name: string }>(
        `SELECT a.attname AS column_name FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = 'rik.issue_vouchers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND a.attname IN ('issue_window_id', 'window_code')`
      );
      expect(columns).toEqual([]);
    });

    it('lapses once the final window has closed — keeping its own number', async () => {
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/lapse`)
        .set('Authorization', asAdmin())
        .expect(201);
      expect(res.body.lapsed).toBe(true);

      const rows = await db.query<{ status: string; voucher_number: string }>(
        `SELECT status, voucher_number FROM rik.issue_vouchers WHERE id = $1`,
        [voucher.voucherId]
      );
      expect(rows[0]!.status).toBe('NOT_COLLECTED');
      expect(rows[0]!.voucher_number).toBe(voucher.voucherNumber);
    });

    it('lapsed as NOT COLLECTED with reason WINDOW_CLOSED and a SYSTEM-level record', async () => {
      const rows = await db.query<{ outcome: string; reason: string; role: string }>(
        `SELECT outcome, reason, recorded_by_role AS role FROM rik.issue_voucher_outcomes
          WHERE voucher_id = $1 ORDER BY sequence_no DESC LIMIT 1`,
        [voucher.voucherId]
      );
      expect(rows[0]!.outcome).toBe('NOT_COLLECTED');
      expect(rows[0]!.reason).toBe('WINDOW_CLOSED');
      expect(rows[0]!.role).toContain('RIK_ADMIN');
    });

    it('NOTHING was marked collected or delivered, and NO second voucher appeared', async () => {
      const rows = await db.query<{ collected: string; vouchers: string }>(
        `SELECT (SELECT count(*)::text FROM rik.issue_voucher_outcomes o
                  WHERE o.voucher_id = $1 AND o.outcome IN ('COLLECTED','DELIVERED')) AS collected,
                (SELECT count(*)::text FROM rik.issue_vouchers v
                  WHERE v.selection_id = (SELECT selection_id FROM rik.issue_vouchers WHERE id = $1)
                    AND v.ration_type = 'FRESH') AS vouchers`,
        [voucher.voucherId]
      );
      expect(rows[0]).toEqual({ collected: '0', vouchers: '1' });
    });

    it('eligible days did not move, and no adjustment was written', async () => {
      const rows = await db.query<{ days: number; adjustments: string }>(
        `SELECT e.eligible_days AS days,
                (SELECT count(*)::text FROM rik.eligibility_adjustments a
                  WHERE a.customer_id = e.customer_id AND a.period_id = e.period_id) AS adjustments
           FROM rik.customer_period_eligibility e
          WHERE e.customer_id = $1 AND e.period_id = $2`,
        [officers.get('collect')!.officerId, periodId]
      );
      expect(rows[0]!.days).toBe(20);
      expect(rows[0]!.adjustments).toBe('0');
    });

    it('the DRY voucher of the same selection is untouched by the Fresh lapse', async () => {
      const rows = await db.query<{ status: string }>(
        `SELECT v.status FROM rik.issue_vouchers v
          WHERE v.selection_id = (SELECT selection_id FROM rik.issue_vouchers WHERE id = $1)
            AND v.ration_type = 'DRY'`,
        [voucher.voucherId]
      );
      expect(rows[0]!.status).toBe('COLLECTED');
    });

    it('lapsing again changes nothing', async () => {
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/lapse`)
        .set('Authorization', asAdmin())
        .expect(201);
      expect(res.body.lapsed).toBe(false);

      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.issue_voucher_outcomes WHERE voucher_id = $1`,
        [voucher.voucherId]
      );
      expect(rows[0]!.total).toBe('1');
    });

    it('a confirmed selection is still immutable after all of it', async () => {
      const rows = await db.query<{ status: string; snap: boolean }>(
        `SELECT status, rule_snapshot IS NOT NULL AS snap FROM rik.entitlement_selections
          WHERE id = (SELECT selection_id FROM rik.issue_vouchers WHERE id = $1)`,
        [voucher.voucherId]
      );
      expect(rows[0]!.status).toBe('CONFIRMED');
      expect(rows[0]!.snap).toBe(true);
      await expect(
        db.query(
          `UPDATE rik.entitlement_selections SET eligible_days = 99
            WHERE id = (SELECT selection_id FROM rik.issue_vouchers WHERE id = $1)`,
          [voucher.voucherId]
        )
      ).rejects.toThrow();
    });
  });

  // =================================================================
  // 7B. Still open: the reminder, and no premature lapse
  // =================================================================
  describe('7B — a Fresh voucher that is still open does not lapse, and reminds', () => {
    /**
     * This is the one group that needs the period containing TODAY, because
     * "the final window has not closed yet" and "it closes in N days" are
     * both statements about today. It therefore takes the same advisory lock
     * the other current-period suites take, and parks its fixture out of the
     * current month again on the way out.
     */
    let lock: CurrentPeriodLock;
    let currentPeriodId: string;
    let voucherId: string;
    let ours = false;

    const PARK_MONTHS_BACK = 300;

    beforeAll(async () => {
      lock = await CurrentPeriodLock.acquire();
      const centre = today();
      const start = plusDays(centre, -3);
      const end = plusDays(centre, 10);

      const found = await db.query<{ id: string }>(
        `SELECT id FROM rik.entitlement_periods WHERE name = 'Jest 15E current'`
      );
      if (found.length > 0) {
        currentPeriodId = found[0]!.id;
        ours = true;
        await db.query(
          `UPDATE rik.entitlement_periods SET start_date = $2::date, end_date = $3::date WHERE id = $1`,
          [currentPeriodId, start, end]
        );
      } else {
        const foreign = await db.query<{ name: string }>(
          `SELECT name FROM rik.entitlement_periods WHERE CURRENT_DATE BETWEEN start_date AND end_date`
        );
        if (foreign.length > 0) {
          throw new Error(`fixture: "${foreign[0]!.name}" still covers today; it was left un-parked`);
        }
        const made = await db.query<{ id: string }>(
          `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
           VALUES (shared.uuid_generate_v7(), 'Jest 15E current', $1::date, $2::date, 'ACTIVE')
           RETURNING id`,
          [start, end]
        );
        currentPeriodId = made[0]!.id;
        ours = true;
      }

      // Three Fresh windows, the last of which closes two days from now — so
      // the voucher is open, and the reminder is due.
      const have = await db.query<{ window_code: string }>(
        `SELECT window_code FROM rik.issue_windows WHERE period_id = $1`,
        [currentPeriodId]
      );
      const present = new Set(have.map((w) => w.window_code));
      // HIGHEST SEQUENCE FIRST: 0047's ordering trigger judges each write on
      // its own, so a schedule moving FORWARD out of the parking slot has to
      // bring window 3 back before window 2 follows it.
      const layout: Array<[string, string, string]> = [
        ['FRESH_3', plusDays(centre, 1), plusDays(centre, 2)],
        ['FRESH_2', plusDays(centre, -1), plusDays(centre, -1)],
        ['FRESH_1', plusDays(centre, -3), plusDays(centre, -3)],
      ];
      for (const [code, from, to] of layout) {
        if (present.has(code)) {
          await moveWindow(currentPeriodId, code, from, to);
        } else {
          await request(server())
            .post('/admin/rik/issue-windows')
            .set('Authorization', asAdmin())
            .send({
              periodId: currentPeriodId,
              rationType: 'FRESH',
              sequenceNo: Number(code.slice(-1)),
              startDate: from,
              endDate: to,
              operatingDays: [from],
            })
            .expect(201);
        }
      }

      await registerOfficer('open', 20);
      const selection = await confirm('open', 'PICKUP', { period: currentPeriodId, only: 'FRESH' });
      const v = await makeVoucher(selection, 'FRESH');
      voucherId = v.voucherId;
    });

    afterAll(async () => {
      // Park the fixture: period first, then its windows ascending, in one
      // transaction — the Phase C discipline, so the current month is free
      // for every other suite.
      if (ours) {
        const parkStart = iso(monthStart(PARK_MONTHS_BACK));
        await db.withTransaction(async (client) => {
          await client.query(
            `UPDATE rik.entitlement_periods SET start_date = $2::date, end_date = $3::date WHERE id = $1`,
            [currentPeriodId, parkStart, plusDays(parkStart, 27)]
          );
          const rows = await client.query<{ id: string; sequence_no: number }>(
            `SELECT id, sequence_no FROM rik.issue_windows
              WHERE period_id = $1 AND ration_type = 'FRESH' ORDER BY sequence_no ASC`,
            [currentPeriodId]
          );
          for (const w of rows.rows) {
            const day = plusDays(parkStart, w.sequence_no - 1);
            await client.query(
              `UPDATE rik.issue_windows SET start_date = $2::date, end_date = $2::date,
                      operating_days = ARRAY[$2::date] WHERE id = $1`,
              [w.id, day]
            );
          }
        });
      }
      await lock.release();
    });

    it('does not lapse while the final Fresh window is still open', async () => {
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucherId}/lapse`)
        .set('Authorization', asAdmin())
        .expect(201);
      expect(res.body.lapsed).toBe(false);
      expect(res.body.reason).toMatch(/still open/i);

      const rows = await db.query<{ status: string }>(
        `SELECT status FROM rik.issue_vouchers WHERE id = $1`,
        [voucherId]
      );
      expect(rows[0]!.status).toBe('READY_FOR_PICKUP');
    });

    it('reminds the officer as the final Fresh window approaches', async () => {
      const res = await request(server())
        .get(`/rik/issue-vouchers/${voucherId}`)
        .set('Authorization', `Bearer ${officers.get('open')!.token}`)
        .expect(200);
      expect(res.body.issueStatus.reminderDue).toBe(true);
      expect(res.body.issueStatus.daysToFinalWindowClose).toBeLessThanOrEqual(3);
      expect(res.body.issueStatus.lapsed).toBe(false);
      expect(res.body.issueStatus.finalWindowCode).toBe('FRESH_3');
    });

    it('a schedule change moves the officer’s dates without touching the voucher', async () => {
      const before = await db.query<{ voucher_number: string; status: string }>(
        `SELECT voucher_number, status FROM rik.issue_vouchers WHERE id = $1`,
        [voucherId]
      );
      const id = (
        await db.query<{ id: string }>(
          `SELECT id FROM rik.issue_windows WHERE period_id = $1 AND window_code = 'FRESH_3'`,
          [currentPeriodId]
        )
      )[0]!.id;
      const moved = plusDays(today(), 7);
      await request(server())
        .patch(`/admin/rik/issue-windows/${id}`)
        .set('Authorization', asAdmin())
        .send({ startDate: moved, endDate: moved, operatingDays: [moved] })
        .expect(200);

      const res = await request(server())
        .get(`/rik/issue-vouchers/${voucherId}`)
        .set('Authorization', `Bearer ${officers.get('open')!.token}`)
        .expect(200);
      expect(res.body.issueStatus.finalWindowEndDate).toBe(moved);
      expect(res.body.issueStatus.reminderDue).toBe(false);
      expect(res.body.voucherNumber).toBe(before[0]!.voucher_number);

      const after = await db.query<{ voucher_number: string; status: string }>(
        `SELECT voucher_number, status FROM rik.issue_vouchers WHERE id = $1`,
        [voucherId]
      );
      expect(after[0]).toEqual(before[0]);
    });
  });

  // =================================================================
  // 8. Previous-month Dry carry-forward
  // =================================================================
  describe('8 — one previous month of unissued Dry carries forward, then lapses', () => {
    let sourceSelection: string;
    let targetSelection: string;
    let carryPoolCode: string;
    let carriedQty: number;
    const officerKey = 'carry';

    beforeAll(async () => {
      // The source month: confirmed, vouchered, and NOT collected.
      sourceSelection = await confirm(officerKey, 'PICKUP', { period: priorPeriodId, only: 'DRY' });
      const sourceVoucher = await makeVoucher(sourceSelection, 'DRY');
      await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${sourceVoucher.voucherId}/pickup`)
        .set('Authorization', asCounter())
        .send({ outcome: 'NOT_COLLECTED', reason: 'Officer was at sea for the whole window' })
        .expect(201);

      // Both fixture periods are in the past, so their Dry windows are
      // already closed — which is exactly the state a carry-forward is
      // established from. The window stays inside its own period: 0047
      // refuses one that does not.
      await moveWindow(priorPeriodId, 'DRY', priorStart, plusDays(priorStart, 12));
    });

    it('establishes NOTHING for an officer who confirmed no selection', async () => {
      await registerOfficer('nothing', 21);
      const res = await request(server())
        .post('/admin/rik/fulfillment/carry-forward')
        .set('Authorization', asAdmin())
        .send({
          customerId: officers.get('nothing')!.officerId,
          sourcePeriodId: priorPeriodId,
          targetPeriodId: periodId,
        })
        .expect(201);
      expect(res.body.established).toEqual([]);
      expect(res.body.skipped.join(' ')).toMatch(/confirmed no selection/i);

      // Nothing was fabricated to fill the gap.
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.dry_carry_forward WHERE customer_id = $1`,
        [officers.get('nothing')!.officerId]
      );
      expect(rows[0]!.total).toBe('0');
    });

    it('establishes the unissued balance once the source window has closed', async () => {
      const res = await request(server())
        .post('/admin/rik/fulfillment/carry-forward')
        .set('Authorization', asAdmin())
        .send({
          customerId: officers.get(officerKey)!.officerId,
          sourcePeriodId: priorPeriodId,
          targetPeriodId: periodId,
        })
        .expect(201);
      expect(res.body.established.length).toBeGreaterThan(0);
      carryPoolCode = res.body.established[0].poolCode;
      carriedQty = res.body.established[0].quantity;
      expect(carriedQty).toBeGreaterThan(0);
      expect(res.body.established[0].remaining).toBe(carriedQty);
    });

    it('the figure is the confirmed entitlement minus what was physically issued', async () => {
      const rows = await db.query<{ basis: string; quantity: string }>(
        `SELECT basis::text, quantity::text FROM rik.dry_carry_forward
          WHERE customer_id = $1 AND source_period_id = $2`,
        [officers.get(officerKey)!.officerId, priorPeriodId]
      );
      const basis = JSON.parse(rows[0]!.basis);
      expect(basis.physicallyIssued).toBe(0);
      expect(basis.confirmedEquivalent).toBeGreaterThan(0);
      expect(Number(rows[0]!.quantity)).toBeCloseTo(basis.confirmedEquivalent - basis.physicallyIssued, 4);
      expect(basis.establishedFrom).toBe('CONFIRMED_SELECTION_AND_PHYSICAL_ISSUE');
    });

    it('establishing it again is idempotent — no duplicate balance', async () => {
      await request(server())
        .post('/admin/rik/fulfillment/carry-forward')
        .set('Authorization', asAdmin())
        .send({
          customerId: officers.get(officerKey)!.officerId,
          sourcePeriodId: priorPeriodId,
          targetPeriodId: periodId,
        })
        .expect(201);
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.dry_carry_forward
          WHERE customer_id = $1 AND source_period_id = $2`,
        [officers.get(officerKey)!.officerId, priorPeriodId]
      );
      expect(rows[0]!.total).toBe('1');
    });

    it('the DATABASE refuses a duplicate for the same source and pool', async () => {
      const row = await db.query<{
        customer_id: string;
        pool_id: string;
        source_selection_id: string;
        unit: string;
      }>(
        `SELECT customer_id, pool_id, source_selection_id, unit FROM rik.dry_carry_forward
          WHERE customer_id = $1 AND source_period_id = $2`,
        [officers.get(officerKey)!.officerId, priorPeriodId]
      );
      await expect(
        db.query(
          `INSERT INTO rik.dry_carry_forward
             (customer_id, source_period_id, target_period_id, source_selection_id, pool_id,
              quantity, unit, basis, established_by_role)
           VALUES ($1,$2,$3,$4,$5,1,$6,'{}'::jsonb,'RIK_ADMIN')`,
          [
            row[0]!.customer_id,
            priorPeriodId,
            periodId,
            row[0]!.source_selection_id,
            row[0]!.pool_id,
            row[0]!.unit,
          ]
        )
      ).rejects.toThrow();
    });

    it('is shown on the target period’s Dry voucher, SEPARATELY from this month’s own', async () => {
      targetSelection = await confirm(officerKey, 'PICKUP', { only: 'DRY' });
      const v = await makeVoucher(targetSelection, 'DRY');
      const res = await request(server())
        .get(`/admin/rik/fulfillment/vouchers/${v.voucherId}`)
        .set('Authorization', asCounter())
        .expect(200);
      expect(res.body.carryForward).toHaveLength(1);
      expect(res.body.carryForward[0].poolCode).toBe(carryPoolCode);
      expect(res.body.carryForward[0].quantity).toBe(carriedQty);
      expect(res.body.carryForward[0].sourcePeriodName).toContain('source');
    });

    it('is SPENT FIRST when the officer collects this month', async () => {
      const voucherRow = await db.query<{ id: string }>(
        `SELECT id FROM rik.issue_vouchers WHERE selection_id = $1 AND ration_type = 'DRY'`,
        [targetSelection]
      );
      const lines = await confirmedLines(targetSelection, officers.get(officerKey)!.officerId, 'DRY');
      await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucherRow[0]!.id}/pickup`)
        .set('Authorization', asCounter())
        .send({
          outcome: 'COLLECTED',
          lines: lines.map((l) => ({ provisionId: l.provisionId, quantity: l.quantity })),
        })
        .expect(201);

      const drawn = await db.query<{ carry: string; equivalent: string }>(
        `SELECT sum(carry_forward_qty)::text AS carry, sum(pool_equivalent_qty)::text AS equivalent
           FROM rik.issue_voucher_issue_lines WHERE voucher_id = $1`,
        [voucherRow[0]!.id]
      );
      expect(Number(drawn[0]!.carry)).toBeGreaterThan(0);
      expect(Number(drawn[0]!.carry)).toBeLessThanOrEqual(Number(drawn[0]!.equivalent));
    });

    it('the remaining carried balance went down by exactly what was drawn', async () => {
      const rows = await db.query<{ quantity: string; remaining: string; drawn: string }>(
        `SELECT d.quantity::text, rik.dry_carry_forward_remaining(d.id)::text AS remaining,
                COALESCE((SELECT sum(l.carry_forward_qty) FROM rik.issue_voucher_issue_lines l
                           JOIN rik.issue_vouchers v ON v.id = l.voucher_id
                          WHERE v.customer_id = d.customer_id AND v.period_id = d.target_period_id
                            AND l.pool_id = d.pool_id), 0)::text AS drawn
           FROM rik.dry_carry_forward d WHERE d.customer_id = $1 AND d.source_period_id = $2`,
        [officers.get(officerKey)!.officerId, priorPeriodId]
      );
      expect(Number(rows[0]!.remaining)).toBeCloseTo(
        Number(rows[0]!.quantity) - Number(rows[0]!.drawn),
        4
      );
    });

    it('NO STACKING: a period that received a carry-forward cannot itself be a source', async () => {
      const row = await db.query<{ pool_id: string; source_selection_id: string; unit: string }>(
        `SELECT pool_id, source_selection_id, unit FROM rik.dry_carry_forward
          WHERE customer_id = $1 AND target_period_id = $2`,
        [officers.get(officerKey)!.officerId, periodId]
      );
      // Carrying THIS period forward again would compound two months.
      await expect(
        db.query(
          `INSERT INTO rik.dry_carry_forward
             (customer_id, source_period_id, target_period_id, source_selection_id, pool_id,
              quantity, unit, basis, established_by_role)
           VALUES ($1,$2,$2,$3,$4,1,$5,'{}'::jsonb,'RIK_ADMIN')`,
          [
            officers.get(officerKey)!.officerId,
            periodId,
            row[0]!.source_selection_id,
            row[0]!.pool_id,
            row[0]!.unit,
          ]
        )
      ).rejects.toThrow();
    });

    it('lapses once that window closes, and is recorded with its reason', async () => {
      const res = await request(server())
        .post('/admin/rik/fulfillment/carry-forward/lapse')
        .set('Authorization', asAdmin())
        .send({ customerId: officers.get(officerKey)!.officerId, targetPeriodId: periodId })
        .expect(201);
      expect(res.body.lapsed).toBe(1);

      const rows = await db.query<{ lapsed_at: string; lapse_reason: string }>(
        `SELECT lapsed_at::text, lapse_reason FROM rik.dry_carry_forward
          WHERE customer_id = $1 AND target_period_id = $2`,
        [officers.get(officerKey)!.officerId, periodId]
      );
      expect(rows[0]!.lapsed_at).not.toBeNull();
      expect(rows[0]!.lapse_reason).toMatch(/Dry window closed/i);
    });

    it('a lapse is recorded once, and the balance itself is frozen', async () => {
      const rows = await db.query<{ id: string }>(
        `SELECT id FROM rik.dry_carry_forward WHERE customer_id = $1 AND target_period_id = $2`,
        [officers.get(officerKey)!.officerId, periodId]
      );
      await expect(
        db.query(`UPDATE rik.dry_carry_forward SET quantity = 999 WHERE id = $1`, [rows[0]!.id])
      ).rejects.toThrow();
      await expect(
        db.query(`DELETE FROM rik.dry_carry_forward WHERE id = $1`, [rows[0]!.id])
      ).rejects.toThrow();
      await expect(
        db.query(`UPDATE rik.dry_carry_forward SET lapsed_at = now() WHERE id = $1`, [rows[0]!.id])
      ).rejects.toThrow();
    });

    it('the source selection and snapshot were never touched by any of it', async () => {
      const rows = await db.query<{ status: string; snap: boolean }>(
        `SELECT status, rule_snapshot IS NOT NULL AS snap
           FROM rik.entitlement_selections WHERE id = $1`,
        [sourceSelection]
      );
      expect(rows[0]).toEqual({ status: 'CONFIRMED', snap: true });
    });
  });

  // =================================================================
  // 9. The officer's own view
  // =================================================================
  describe('9 — the officer sees the fulfilment status, read only', () => {
    it('shows what was actually issued on their own voucher', async () => {
      const rows = await db.query<{ id: string }>(
        `SELECT v.id FROM rik.issue_vouchers v
          WHERE v.customer_id = $1 AND v.status = 'COLLECTED' LIMIT 1`,
        [officers.get('substitute')!.officerId]
      );
      const res = await request(server())
        .get(`/rik/issue-vouchers/${rows[0]!.id}`)
        .set('Authorization', `Bearer ${officers.get('substitute')!.token}`)
        .expect(200);

      expect(res.body.issueStatus.status).toBe('COLLECTED');
      expect(res.body.issueStatus.completedAt).not.toBeNull();
      expect(res.body.issueStatus.issued.length).toBeGreaterThan(0);
      const substituted = res.body.issueStatus.issued.find(
        (l: { substitutedFor: unknown }) => l.substitutedFor !== null
      );
      expect(substituted.substitutedFor.reason).toBe('Original out of stock at the counter');
    });

    it('the PHASE D voucher document is intact beside it — destination included', async () => {
      // The regression this test exists for: PHASE E's block was first added
      // under the name `fulfillment`, which the document has used since PHASE
      // D for the DESTINATION. The spread replaced it, and the officer's own
      // screen lost its collection point. The two now have separate names and
      // this asserts both are present at once.
      const rows = await db.query<{ id: string }>(
        `SELECT v.id FROM rik.issue_vouchers v
          WHERE v.customer_id = $1 AND v.status = 'COLLECTED' LIMIT 1`,
        [officers.get('substitute')!.officerId]
      );
      const res = await request(server())
        .get(`/rik/issue-vouchers/${rows[0]!.id}`)
        .set('Authorization', `Bearer ${officers.get('substitute')!.token}`)
        .expect(200);

      expect(['PICKUP', 'DELIVERY']).toContain(res.body.fulfillment.mode);
      expect(res.body.fulfillment).toHaveProperty('pickupLocationName');
      expect(res.body.fulfillment).toHaveProperty('deliveryAddress');
      if (res.body.fulfillment.mode === 'PICKUP') {
        expect(res.body.fulfillment.pickupLocationName).toBeTruthy();
      } else {
        expect(res.body.fulfillment.deliveryAddress).toBeTruthy();
      }
      expect(res.body.voucherNumber).toBeTruthy();
      expect(res.body.pools.length).toBeGreaterThan(0);
      expect(res.body.issueStatus.status).toBe('COLLECTED');
    });

    it('sends the officer NO staff identity and no correction detail', async () => {
      const rows = await db.query<{ id: string }>(
        `SELECT v.id FROM rik.issue_vouchers v WHERE v.customer_id = $1 LIMIT 1`,
        [officers.get('correct')!.officerId]
      );
      const res = await request(server())
        .get(`/rik/issue-vouchers/${rows[0]!.id}`)
        .set('Authorization', `Bearer ${officers.get('correct')!.token}`)
        .expect(200);
      const fulfillment = JSON.stringify(res.body.issueStatus);
      expect(fulfillment).not.toContain('recordedBy');
      expect(fulfillment).not.toContain('RIK_PICKUP_STAFF');
      expect(fulfillment).not.toContain('RIK_ADMIN');
      expect(fulfillment).not.toContain('REVERSED');
      expect(fulfillment).not.toContain('outcomeId');
      expect(fulfillment).not.toContain('notes');
      expect(res.body.issueStatus.events).toBeUndefined();
    });

    it('offers the officer no way to change anything', async () => {
      const rows = await db.query<{ id: string }>(
        `SELECT id FROM rik.issue_vouchers WHERE customer_id = $1 LIMIT 1`,
        [officers.get('collect')!.officerId]
      );
      for (const method of ['post', 'patch', 'put', 'delete'] as const) {
        const agent = request(server());
        const res = await agent[method](`/rik/issue-vouchers/${rows[0]!.id}`)
          .set('Authorization', `Bearer ${officers.get('collect')!.token}`)
          .send({ status: 'COLLECTED' });
        expect([404, 405]).toContain(res.status);
      }
    });

    it('another officer’s voucher still answers 404, not 403', async () => {
      const rows = await db.query<{ id: string }>(
        `SELECT id FROM rik.issue_vouchers WHERE customer_id = $1 LIMIT 1`,
        [officers.get('collect')!.officerId]
      );
      await request(server())
        .get(`/rik/issue-vouchers/${rows[0]!.id}`)
        .set('Authorization', `Bearer ${officers.get('deliver')!.token}`)
        .expect(404);
    });
  });

  // =================================================================
  // 10. The baseline
  // =================================================================
  describe('10 — the approved baseline is untouched', () => {
    it('the schema is 68 tables and 5 views', async () => {
      const rows = await db.query<{ tables: string; views: string }>(
        `SELECT (SELECT count(*)::text FROM pg_catalog.pg_tables
                  WHERE schemaname IN ('shared','rik','pif')) AS tables,
                (SELECT count(*)::text FROM pg_catalog.pg_views
                  WHERE schemaname IN ('shared','rik','pif')) AS views`
      );
      expect(rows[0]).toEqual({ tables: '68', views: '5' });
    });

    it('pif holds 23 tables, and not one of them is RIK\u2019s', async () => {
      // PHASE F added pif.order_events. What matters to THIS suite is that
      // the RIK side did not move: the count is pinned so a future PIF change
      // that reached into rik.* would fail here, in a RIK suite.
      const rows = await db.query<{ pif: string; rik: string }>(
        `SELECT (SELECT count(*)::text FROM pg_catalog.pg_tables WHERE schemaname = 'pif') AS pif,
                (SELECT count(*)::text FROM pg_catalog.pg_tables WHERE schemaname = 'rik') AS rik`
      );
      expect(rows[0]).toEqual({ pif: '23', rik: '31' });
    });

    it('no stock or inventory quantity table was introduced for RIK', async () => {
      const rows = await db.query<{ tablename: string }>(
        `SELECT tablename FROM pg_catalog.pg_tables
          WHERE schemaname = 'rik' AND tablename IN ('inventory', 'inventory_transactions')`
      );
      // The two Phase 2 legacy tables remain, and remain EMPTY and unused.
      const used = await db.query<{ total: string }>(
        `SELECT (SELECT count(*) FROM rik.inventory) + (SELECT count(*) FROM rik.inventory_transactions) AS total`
      );
      expect(rows).toHaveLength(2);
      expect(Number(used[0]!.total)).toBe(0);
    });

    it('the catalogue, scales and conversions are exactly as they were', async () => {
      const rows = await db.query<{ pools: string; provisions: string; scales: string; conversions: string }>(
        `SELECT (SELECT count(*)::text FROM rik.entitlement_pools) AS pools,
                (SELECT count(*)::text FROM rik.provisions) AS provisions,
                (SELECT count(*)::text FROM rik.pool_scales) AS scales,
                (SELECT count(*)::text FROM rik.pool_conversions) AS conversions`
      );
      expect(rows[0]).toEqual({ pools: '18', provisions: '190', scales: '50', conversions: '7' });
    });

    it('the 18 category covers are still in place', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(image_ref)::text AS total FROM rik.entitlement_pools`
      );
      expect(rows[0]!.total).toBe('18');
    });
  });

  // =================================================================
  // 11. Two requests at the same moment
  // =================================================================
  describe('11 — simultaneous and duplicate completions', () => {
    let voucher: { voucherId: string; voucherNumber: string };
    let lines: Awaited<ReturnType<typeof confirmedLines>>;

    beforeAll(async () => {
      // The 'concurrent' officer's FRESH voucher is untouched: the only other
      // test that used this officer was refused at the shape gate on its DRY
      // voucher and recorded nothing.
      const selection = await confirm('concurrent', 'PICKUP');
      voucher = await makeVoucher(selection, 'FRESH');
      lines = await confirmedLines(selection, officers.get('concurrent')!.officerId, 'FRESH');
    });

    it('TWO AT ONCE: exactly one of two simultaneous collections is recorded', async () => {
      const body = {
        outcome: 'COLLECTED',
        lines: lines.map((l) => ({ provisionId: l.provisionId, quantity: l.quantity })),
      };
      const send = () =>
        request(server())
          .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/pickup`)
          .set('Authorization', asCounter())
          .send(body);

      // Fired together, not one after the other: the guard being proven is
      // the UNIQUE (voucher_id, sequence_no) key and the lifecycle trigger,
      // not an application-level "have I already" check.
      const results = await Promise.all([send(), send()]);
      const accepted = results.filter((r) => r.status === 201 || r.status === 200);
      const refused = results.filter((r) => r.status >= 400);

      expect(accepted).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]!.status).toBe(409);
    });

    it('left exactly ONE completion, ONE set of issue lines and ONE audit entry', async () => {
      const rows = await db.query<{ outcomes: string; lines: string; status: string }>(
        `SELECT (SELECT count(*)::text FROM rik.issue_voucher_outcomes o WHERE o.voucher_id = v.id) AS outcomes,
                (SELECT count(*)::text FROM rik.issue_voucher_issue_lines l WHERE l.voucher_id = v.id) AS lines,
                v.status
           FROM rik.issue_vouchers v WHERE v.id = $1`,
        [voucher.voucherId]
      );
      expect(rows[0]!.outcomes).toBe('1');
      expect(Number(rows[0]!.lines)).toBe(lines.length);
      expect(rows[0]!.status).toBe('COLLECTED');

      const audit = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM shared.audit_log
          WHERE entity_id = $1 AND action = 'RIK_VOUCHER_COLLECTED'`,
        [voucher.voucherId]
      );
      expect(audit[0]!.total).toBe('1');
    });

    it('a REPEATED request afterwards is refused, and still changes nothing', async () => {
      const res = await request(server())
        .post(`/admin/rik/fulfillment/vouchers/${voucher.voucherId}/pickup`)
        .set('Authorization', asCounter())
        .send({
          outcome: 'COLLECTED',
          lines: lines.map((l) => ({ provisionId: l.provisionId, quantity: l.quantity })),
        });
      expect(res.status).toBe(409);

      const rows = await db.query<{ outcomes: string }>(
        `SELECT count(*)::text AS outcomes FROM rik.issue_voucher_outcomes WHERE voucher_id = $1`,
        [voucher.voucherId]
      );
      expect(rows[0]!.outcomes).toBe('1');
    });
  });
});
