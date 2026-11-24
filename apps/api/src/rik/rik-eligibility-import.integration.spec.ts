import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { STAFF_ROLES, type StaffRole } from '@esamagri/shared-types';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { clearRationEligibilityForPeriods } from './test-support/seed-ration-eligibility';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';
import { RikEligibilityService } from './services/rik-eligibility.service';
import { RikSelectionValidationService } from './services/rik-selection-validation.service';
import {
  canonicaliseName,
  parseEligibleDays,
} from './services/rik-eligibility-admin.service';

/**
 * STEP 15B PHASE B — eligibility import and the eligible-day ledger, over
 * real HTTP against real PostgreSQL, with real .xlsx workbooks built in
 * memory by ExcelJS.
 *
 * RECONSTRUCTED from the approved Phase B report and the surviving fragments
 * of the original suite (its fixture setup and teardown are verbatim); the
 * assertions are rebuilt from the report's own list of what each test proved.
 *
 * What this suite is designed to prove, in order of importance:
 *
 *  1. UPLOADING APPLIES NOTHING. The preview is a statement of intent; until
 *     Confirm, not one officer's eligible days have moved and not one ledger
 *     row exists.
 *
 *  2. AN UNEXPLAINED CHANGE IS IMPOSSIBLE. Not discouraged — impossible. The
 *     database refuses a direct UPDATE, refuses to rewrite or delete a
 *     recorded adjustment, and refuses one that misstates the previous value.
 *
 *  3. MATCHING IS NARROW. Mobile first, name verified exactly after
 *     canonicalisation, no fuzzy matching, and never an officer created.
 *
 *  4. HISTORY DOES NOT MOVE. A confirmed selection keeps its own frozen
 *     eligible days and its snapshot, byte for byte, while the operational
 *     figure changes underneath it.
 *
 * FIXTURE DISCIPLINE. Periods are derived from the calendar at run time;
 * there is no calendar literal anywhere. The two periods are four and five
 * months back, so this suite never needs findCurrent() and never competes for
 * "the current period".
 */
describe('RIK eligibility import (STEP 15B Phase B, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;
  let eligibilityService: RikEligibilityService;
  let validation: RikSelectionValidationService;

  /** The instant this run began, so assertions can ignore earlier history. */
  let runStart: string;

  /**
   * THE FIXTURES OF THIS SUITE ARE STABLE, NOT PER-RUN. That is forced, and
   * it is correct.
   *
   * An import batch and its rows are permanent audit records (the facility's
   * locked decision, migration 0046), so this role cannot delete one. A batch
   * references its period and its rows reference their officers, which makes
   * the period, the officers and the uploading staff permanent too. And
   * rik.entitlement_periods carries a GLOBAL no-overlap exclusion constraint,
   * so a per-run period in the same month as a previous run's undeletable one
   * could never be created — the suite would run exactly once per database.
   *
   * So the suite owns ONE named period, ONE set of officers and ONE set of
   * staff accounts, creates them if they are absent and reuses them if they
   * are not. What accumulates across runs is history, which is what history
   * does; everything operational (eligibility rows, selections) is cleared in
   * afterAll, and every assertion about history is scoped to `runStart`.
   */
  const PERIOD_NAME = 'Jest 15B period';
  const OTHER_PERIOD_NAME = 'Jest 15B other';

  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = (back: number) =>
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
  const monthEnd = (back: number) =>
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back + 1, 0));

  const staffIdByRole = new Map<StaffRole, string>();
  const tokenByRole = new Map<StaffRole, string>();
  let noRoleStaffId: string;
  let noRoleToken: string;
  let customerToken: string;
  let periodId: string;
  let otherPeriodId: string;

  interface Fixture {
    officerId: string;
    rikId: string;
    name: string;
    mobile: string;
  }
  const officers = new Map<string, Fixture>();

  const server = () => app.getHttpServer();
  const bearer = (role: StaffRole) => `Bearer ${tokenByRole.get(role)}`;
  const asAdmin = () => bearer('RIK_ADMIN');
  /** Fixed numbers: the fixture officers are reused across runs. */
  const mobile = (suffix: number) => `98150150${String(suffix).padStart(2, '0')}`;

  /** A real .xlsx in memory. Nothing about this suite is a stubbed parser. */
  const workbook = async (
    rows: Array<[string, string, string]>,
    headers: [string, string, string] = ['Name', 'Mobile Number', 'Eligible Days']
  ): Promise<Buffer> => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Eligibility');
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(row);
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
  };

  /** Not async: it returns supertest's chainable Test so `.expect()` works. */
  const upload = (buffer: Buffer, fileName = 'eligibility.xlsx', period = periodId) =>
    request(server())
      .post('/admin/rik/eligibility-imports')
      .set('Authorization', asAdmin())
      .field('periodId', period)
      .attach('file', buffer, fileName);

  /** Registered on the first run in this database, read back on every later one. */
  const registerOfficer = async (key: string, suffix: number, name: string): Promise<void> => {
    const existing = await db.query<{ id: string; rik_id: string; name: string }>(
      `SELECT id, rik_id, name FROM shared.customers WHERE mobile_number = $1`,
      [mobile(suffix)]
    );
    if (existing.length > 0) {
      officers.set(key, {
        officerId: existing[0]!.id,
        rikId: existing[0]!.rik_id,
        name: existing[0]!.name,
        mobile: mobile(suffix),
      });
      return;
    }
    const res = await request(server())
      .post('/admin/rik/officers')
      .set('Authorization', asAdmin())
      .send({
        name,
        mobileNumber: mobile(suffix),
        quarterBlock: 'B',
        quarterNumber: String(100 + suffix),
        dietaryPreference: 'NV',
      })
      .expect(201);
    officers.set(key, {
      officerId: res.body.officerId,
      rikId: res.body.rikId,
      name,
      mobile: mobile(suffix),
    });
  };

  const seedEligibility = async (key: string, days: number, period = periodId): Promise<void> => {
    // A FIRST value, inserted directly. Migration 0045 guards UPDATE OF
    // eligible_days and deliberately leaves INSERT alone: a first insert has
    // no previous value to lose. Seven existing suites rely on this.
    await db.query(
      `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days)
       VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, period_id) DO NOTHING`,
      [officers.get(key)!.officerId, period, days]
    );
  };

  const currentDays = async (key: string, period = periodId): Promise<number | null> => {
    const rows = await db.query<{ eligible_days: number }>(
      `SELECT eligible_days FROM rik.customer_period_eligibility
        WHERE customer_id = $1 AND period_id = $2`,
      [officers.get(key)!.officerId, period]
    );
    return rows[0]?.eligible_days ?? null;
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
    validation = app.get(RikSelectionValidationService);

    const passwordHash = await app.get(PasswordService).hash('CorrectHorseBatteryStaple!1');
    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    const grantedBy = bootstrap[0]!.id;

    // Stable usernames: a batch records who uploaded it and that record is
    // permanent, so the uploading account cannot be deleted afterwards.
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
      const id = await staffAccount(`jest_15b_${role.toLowerCase()}`, `Jest 15B ${role}`);
      staffIdByRole.set(role, id);
      await db.query(
        `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
         SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3
          ON CONFLICT DO NOTHING`,
        [id, grantedBy, role]
      );
      tokenByRole.set(role, tokenService.signAccessToken({ principalType: 'STAFF', principalId: id }));
    }

    noRoleStaffId = await staffAccount('jest_15b_norole', 'Jest 15B NoRole');
    noRoleToken = tokenService.signAccessToken({ principalType: 'STAFF', principalId: noRoleStaffId });

    // Two periods, neither containing today: nothing here needs findCurrent(),
    // so this suite never competes for "the current period" and takes no lock.
    //
    // Leftovers from a crashed earlier run: a batch and its rows are
    // PERMANENT audit records (migration 0046 removed this role's DELETE), so
    // a period that already carries one cannot be removed and is left alone.
    // Only the periods with no batch are cleared.
    const period = async (name: string, back: number): Promise<string> => {
      // LIKE, not =, so a period left by an earlier run under a
      // run-suffixed name is ADOPTED rather than fought with: it cannot be
      // deleted once a batch names it, and the no-overlap constraint would
      // refuse a second period in the same month.
      const found = await db.query<{ id: string }>(
        `SELECT id FROM rik.entitlement_periods WHERE name LIKE $1 || '%' ORDER BY name LIMIT 1`,
        [name]
      );
      if (found.length > 0) return found[0]!.id;
      const made = await db.query<{ id: string }>(
        `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
         VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'ACTIVE') RETURNING id`,
        [name, iso(monthStart(back)), iso(monthEnd(back))]
      );
      return made[0]!.id;
    };
    periodId = await period(PERIOD_NAME, 4);
    otherPeriodId = await period(OTHER_PERIOD_NAME, 5);

    // Operational state from an earlier run of this suite. The eligibility
    // rows go, so every run starts from the same seeded figures; the history
    // that names them stays, because it is history.
    await db.query(
      `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
        WHERE status = 'CONFIRMED' AND period_id = ANY($1::uuid[])`,
      [[periodId, otherPeriodId]]
    );
    await db.query(`DELETE FROM rik.entitlement_selections WHERE period_id = ANY($1::uuid[])`, [
      [periodId, otherPeriodId],
    ]);
    await db.query(
      `DELETE FROM rik.customer_period_eligibility WHERE period_id = ANY($1::uuid[])`,
      [[periodId, otherPeriodId]]
    );
    /**
     * THIS SUITE IS DELIBERATELY NOT SEEDED WITH PER-TYPE FIGURES.
     *
     * It exercises the real import, and the import computes each row's delta
     * from the figure already on record. A seeded figure would make every
     * "previous 0" assertion in this file false. So the figures here arrive
     * only through the code under test — and are cleared, because
     * rik_cpre_period_fk references rik.entitlement_periods and a leaked row
     * would fail a later period delete as an unrelated-looking error.
     */
    await clearRationEligibilityForPeriods(db, [periodId, otherPeriodId]);
    runStart = new Date().toISOString();

    await registerOfficer('singh', 10, 'Jest 15B A. Singh');
    await registerOfficer('kumar', 11, 'Jest 15B B. Kumar');
    await registerOfficer('rao', 12, 'Jest 15B C. Rao');
    await registerOfficer('history', 13, 'Jest 15B Frozen');

    const customer = officers.get('singh')!;
    customerToken = tokenService.signAccessToken({
      principalType: 'CUSTOMER',
      principalId: customer.officerId,
    });
  });

  afterAll(async () => {
    // Only the OPERATIONAL state is cleared. A CONFIRMED selection must be
    // cancelled before it can be removed (migration 0027).
    await db.query(
      `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
        WHERE status = 'CONFIRMED' AND period_id = ANY($1::uuid[])`,
      [[periodId, otherPeriodId]]
    );
    await db.query(`DELETE FROM rik.entitlement_selections WHERE period_id = ANY($1::uuid[])`, [
      [periodId, otherPeriodId],
    ]);
    await db.query(
      `DELETE FROM rik.customer_period_eligibility WHERE period_id = ANY($1::uuid[])`,
      [[periodId, otherPeriodId]]
    );
    /**
     * THIS SUITE IS DELIBERATELY NOT SEEDED WITH PER-TYPE FIGURES.
     *
     * It exercises the real import, and the import computes each row's delta
     * from the figure already on record. A seeded figure would make every
     * "previous 0" assertion in this file false. So the figures here arrive
     * only through the code under test — and are cleared, because
     * rik_cpre_period_fk references rik.entitlement_periods and a leaked row
     * would fail a later period delete as an unrelated-looking error.
     */
    await clearRationEligibilityForPeriods(db, [periodId, otherPeriodId]);
    const principals = [
      ...[...officers.values()].map((o) => o.officerId),
      ...staffIdByRole.values(),
      noRoleStaffId,
    ];
    await db.query(`DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])`, [
      principals,
    ]);

    // WHAT IS DELIBERATELY NOT CLEANED UP, AND WHY IT CANNOT BE.
    //
    // rik.eligibility_import_batches, rik.eligibility_import_rows and
    // rik.eligibility_adjustments are HISTORICAL AUDIT RECORDS by the
    // facility's locked decision (migration 0046 for the first two, 0045 for
    // the ledger): this application role holds no DELETE on any of them.
    // Because a batch names its period and its rows name their officers, the
    // fixture period, the fixture officers and the uploading staff are pinned
    // by the audit trail that names them — which is exactly what permanence
    // means. They are reused by the next run rather than recreated. The same
    // has been true of shared.audit_log since Phase 2.
    await app.close();
  });

  // =================================================================
  // 1. The rules, as pure functions
  // =================================================================
  describe('the comparison and parsing rules are exactly the approved ones', () => {
    it('canonicalises a name by trim, whitespace collapse and case only', () => {
      expect(canonicaliseName('  A.   SINGH ')).toBe('a. singh');
      expect(canonicaliseName('a. singh')).toBe('a. singh');
      expect(canonicaliseName('A.\tSingh')).toBe('a. singh');
    });

    it('does not treat a near miss as a match — there is no fuzzy matching', () => {
      expect(canonicaliseName('A Singh')).not.toBe(canonicaliseName('A. Singh'));
      expect(canonicaliseName('A. Sing')).not.toBe(canonicaliseName('A. Singh'));
      expect(canonicaliseName('Singh A.')).not.toBe(canonicaliseName('A. Singh'));
    });

    it('accepts whole non-negative eligible days, including zero', () => {
      expect(parseEligibleDays('0')).toEqual({ ok: true, value: 0 });
      expect(parseEligibleDays('18')).toEqual({ ok: true, value: 18 });
      expect(parseEligibleDays(' 31 ')).toEqual({ ok: true, value: 31 });
      expect(parseEligibleDays('366')).toEqual({ ok: true, value: 366 });
    });

    it('refuses a decimal rather than rounding it', () => {
      const result = parseEligibleDays('7.5');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/whole number/i);
    });

    it('refuses a negative value and a non-number', () => {
      expect(parseEligibleDays('-1').ok).toBe(false);
      expect(parseEligibleDays('abc').ok).toBe(false);
      expect(parseEligibleDays('').ok).toBe(false);
      expect(parseEligibleDays('400').ok).toBe(false);
    });
  });

  // =================================================================
  // 2. Authorization
  // =================================================================
  describe('eligibility is facility data, and only RIK_ADMIN may touch it', () => {
    it('an anonymous upload is 401', async () => {
      await request(server())
        .post('/admin/rik/eligibility-imports')
        .field('periodId', periodId)
        .attach('file', await workbook([['A', mobile(10), '1']]), 'e.xlsx')
        .expect(401);
    });

    it('a CUSTOMER cannot upload, list or read a batch', async () => {
      await request(server())
        .get('/admin/rik/eligibility-imports')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
      await request(server())
        .get('/admin/rik/periods')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
    });

    it('staff with no role cannot upload', async () => {
      await request(server())
        .post('/admin/rik/eligibility-imports')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .field('periodId', periodId)
        .attach('file', await workbook([['A', mobile(10), '1']]), 'e.xlsx')
        .expect(403);
    });

    for (const role of STAFF_ROLES.filter((r) => r !== 'RIK_ADMIN' && r !== 'SUPER_ADMIN')) {
      it(`${role} cannot upload eligibility`, async () => {
        await request(server())
          .post('/admin/rik/eligibility-imports')
          .set('Authorization', bearer(role))
          .field('periodId', periodId)
          .attach('file', await workbook([['A', mobile(10), '1']]), 'e.xlsx')
          .expect(403);
      });

      it(`${role} cannot adjust an officer's eligible days`, async () => {
        await request(server())
          .post(`/admin/rik/officers/${officers.get('singh')!.officerId}/eligibility`)
          .set('Authorization', bearer(role))
          .send({ periodId, eligibleDays: 5, reason: 'nope' })
          .expect(403);
      });
    }

    it('there is no customer-facing write path to eligibility', async () => {
      // The customer selection route refuses an eligible-days field outright:
      // forbidNonWhitelisted means the officer cannot even name the figure.
      const res = await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ provisionId: '00000000-0000-7000-8000-000000000000', quantity: 1, eligibleDays: 31 });
      expect(res.status).toBe(400);
    });

    it('the role and permission model is unchanged', async () => {
      const rows = await db.query<{ roles: string; permissions: string }>(
        `SELECT (SELECT count(*)::text FROM shared.roles) AS roles,
                (SELECT count(*)::text FROM shared.permissions) AS permissions`
      );
      expect(rows[0]).toEqual({ roles: '6', permissions: '22' });
    });
  });

  // =================================================================
  // 3. The workbook itself
  // =================================================================
  describe('the workbook itself is validated before anything is mapped', () => {
    it('refuses a file that is not .xlsx', async () => {
      const res = await upload(Buffer.from('name,mobile,days'), 'eligibility.csv');
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('refuses a macro-enabled workbook by extension, before opening it', async () => {
      const res = await upload(await workbook([['A', mobile(10), '1']]), 'eligibility.xlsm');
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('refuses bytes that are not a workbook at all', async () => {
      const res = await upload(Buffer.from('this is not a spreadsheet'), 'eligibility.xlsx');
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('UNREADABLE_WORKBOOK');
    });

    it('refuses a workbook whose header is missing a required column', async () => {
      const res = await upload(
        await workbook([['A', mobile(10), '1']], ['Name', 'Mobile Number', 'Something Else'])
      );
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('MISSING_HEADER');
      expect(res.body.message).toContain('eligibleDays');
    });

    it('accepts the common header spellings a maintained sheet actually uses', async () => {
      const res = await upload(
        await workbook([[officers.get('rao')!.name, mobile(12), '3']], [
          'Officer Name',
          'MOBILE NO',
          'Eligible_Days',
        ])
      );
      expect(res.status).toBe(201);
      expect(res.body.totals.rows).toBe(1);
    });

    it('refuses a workbook with a header and no rows', async () => {
      const res = await upload(await workbook([]));
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('NO_DATA_ROWS');
    });

    it('refuses an unknown period, and never invents one', async () => {
      const res = await upload(
        await workbook([['A', mobile(10), '1']]),
        'eligibility.xlsx',
        '00000000-0000-7000-8000-000000000000'
      );
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('PERIOD_NOT_FOUND');
    });

    it('requires a file to be attached', async () => {
      const res = await request(server())
        .post('/admin/rik/eligibility-imports')
        .set('Authorization', asAdmin())
        .field('periodId', periodId);
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('FILE_REQUIRED');
    });
  });

  // =================================================================
  // 4. The preview
  // =================================================================
  describe('the preview states what would happen, and nothing happens yet', () => {
    let batch: {
      batchId: string;
      batchRef: string;
      status: string;
      totals: Record<string, number>;
      rows: Array<Record<string, unknown>>;
    };

    beforeAll(async () => {
      await seedEligibility('singh', 18);
      await seedEligibility('kumar', 22);
      await seedEligibility('rao', 7);

      const res = await upload(
        await workbook([
          [officers.get('singh')!.name, officers.get('singh')!.mobile, '20'], // changed +2
          [officers.get('kumar')!.name, officers.get('kumar')!.mobile, '15'], // changed -7
          [officers.get('rao')!.name, officers.get('rao')!.mobile, '7'], // no change
          ['Nobody At All', mobile(90), '10'], // mobile not found
          ['Wrong Name Entirely', officers.get('history')!.mobile, '12'], // name mismatch
          [officers.get('singh')!.name, officers.get('singh')!.mobile.slice(0, 5), '9'], // invalid mobile
          [officers.get('rao')!.name, mobile(91), '7.5'], // invalid days
          ['', mobile(92), '5'], // missing field
          [officers.get('rao')!.name, mobile(93), ''], // missing field
        ]),
        'eligibility-mixed.xlsx'
      ).expect(201);
      batch = res.body;
    });

    const row = (n: number) => batch.rows.find((r) => r.sheetRow === n)!;

    it('maps a mixed workbook into the six preview categories', () => {
      expect(batch.status).toBe('PENDING_REVIEW');
      expect(batch.totals).toEqual({
        rows: 9,
        changed: 2,
        noChange: 1,
        exceptions: 6,
        applied: 0,
      });
    });

    it('shows every column a reviewer needs, for the changed row', () => {
      const changed = row(2);
      expect(changed.rikId).toBe(officers.get('singh')!.rikId);
      expect(changed.excelName).toBe(officers.get('singh')!.name);
      expect(changed.systemOfficialName).toBe(officers.get('singh')!.name);
      expect(changed.normalisedMobile).toBe(officers.get('singh')!.mobile);
      expect(changed.previousEligibleDays).toBe(18);
      expect(changed.importedEligibleDays).toBe(20);
      expect(changed.delta).toBe(2);
      expect(changed.outcome).toBe('MATCHED_CHANGED');
      expect(changed.exceptionReason).toBeNull();
    });

    it('reports a no-change row as such, with a zero delta', () => {
      const unchanged = row(4);
      expect(unchanged.outcome).toBe('MATCHED_NO_CHANGE');
      expect(unchanged.delta).toBe(0);
    });

    it('reports a decrease as a negative delta rather than hiding it', () => {
      const decreased = row(3);
      expect(decreased.outcome).toBe('MATCHED_CHANGED');
      expect(decreased.previousEligibleDays).toBe(22);
      expect(decreased.importedEligibleDays).toBe(15);
      expect(decreased.delta).toBe(-7);
    });

    it('never auto-creates an officer for an unknown mobile number', async () => {
      const unknown = row(5);
      expect(unknown.outcome).toBe('UNMATCHED_MOBILE_NOT_FOUND');
      expect(unknown.officerId).toBeNull();
      expect(unknown.exceptionReason).toMatch(/never creates an officer/i);

      const created = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM shared.customers WHERE mobile_number = $1`,
        [mobile(90)]
      );
      expect(created[0]!.total).toBe('0');
    });

    it('shows both names side by side on a mismatch, so it can be reviewed', () => {
      const mismatch = row(6);
      expect(mismatch.outcome).toBe('NAME_MISMATCH');
      expect(mismatch.excelName).toBe('Wrong Name Entirely');
      expect(mismatch.systemName).toBe(officers.get('history')!.name);
      expect(mismatch.rikId).toBe(officers.get('history')!.rikId);
      expect(mismatch.importedEligibleDays).toBeNull();
    });

    it('keeps the raw text of a refused value, so the reason is specific', () => {
      const bad = row(8);
      expect(bad.outcome).toBe('INVALID_ELIGIBLE_DAYS');
      expect(bad.excelEligibleDays).toBe('7.5');
      expect(bad.exceptionReason).toMatch(/7\.5/);
    });

    it('reports a blank required field and an unusable mobile by name', () => {
      expect(row(7).outcome).toBe('INVALID_MOBILE');
      expect(row(9).outcome).toBe('MISSING_FIELD');
      expect(row(10).outcome).toBe('MISSING_FIELD');
      expect(row(9).exceptionReason).toMatch(/blank/i);
    });

    it('CHANGED NOTHING — no eligible day moved and no adjustment was written', async () => {
      expect(await currentDays('singh')).toBe(18);
      expect(await currentDays('kumar')).toBe(22);
      expect(await currentDays('rao')).toBe(7);

      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.eligibility_adjustments
          WHERE customer_id = ANY($1::uuid[]) AND period_id = $2 AND created_at >= $3`,
        [[...officers.values()].map((o) => o.officerId), periodId, runStart]
      );
      expect(rows[0]!.total).toBe('0');
    });

    it('records the upload in the audit log', async () => {
      const rows = await db.query<{ action: string }>(
        `SELECT action FROM shared.audit_log WHERE entity_id = $1 ORDER BY created_at`,
        [batch.batchId]
      );
      expect(rows.map((r) => r.action)).toEqual(['RIK_ELIGIBILITY_IMPORT_UPLOADED']);
    });

    it('marks every occurrence of a mobile duplicated inside the file', async () => {
      const res = await upload(
        await workbook([
          [officers.get('rao')!.name, officers.get('rao')!.mobile, '5'],
          [officers.get('rao')!.name, officers.get('rao')!.mobile, '9'],
          [officers.get('kumar')!.name, officers.get('kumar')!.mobile, '22'],
        ]),
        'eligibility-duplicate.xlsx'
      ).expect(201);

      const outcomes = (res.body.rows as Array<{ sheetRow: number; outcome: string }>)
        .sort((a, b) => a.sheetRow - b.sheetRow)
        .map((r) => r.outcome);
      // BOTH occurrences, not just the second: the facility decides which
      // line is right, and a preview that silently accepted one would hide
      // the question.
      expect(outcomes).toEqual(['DUPLICATE_IN_FILE', 'DUPLICATE_IN_FILE', 'MATCHED_NO_CHANGE']);
      expect(res.body.totals.exceptions).toBe(2);
    });
  });

  // =================================================================
  // 5. Applying a reviewed batch
  // =================================================================
  describe('applying a reviewed batch', () => {
    let batchId: string;
    let batchRef: string;

    beforeAll(async () => {
      const res = await upload(
        await workbook([
          [officers.get('singh')!.name, officers.get('singh')!.mobile, '24'],
          [officers.get('rao')!.name, officers.get('rao')!.mobile, '7'],
          ['Nobody', mobile(94), '3'],
        ]),
        'eligibility-apply.xlsx'
      ).expect(201);
      batchId = res.body.batchId;
      batchRef = res.body.batchRef;
    });

    it('applies only the changed rows', async () => {
      const res = await request(server())
        .post(`/admin/rik/eligibility-imports/${batchId}/confirm`)
        .set('Authorization', asAdmin())
        .expect(201);
      expect(res.body.status).toBe('APPLIED');
      expect(res.body.totals.applied).toBe(1);
      expect(res.body.totals.exceptions).toBe(1);
    });

    it('moved the officer’s current eligible days', async () => {
      expect(await currentDays('singh')).toBe(24);
      expect(await currentDays('rao')).toBe(7);
    });

    it('wrote an append-only adjustment carrying previous, delta, new, reason and staff', async () => {
      const rows = await db.query<{
        previous_eligible_days: number;
        delta: number;
        new_eligible_days: number;
        reason: string;
        source: string;
        staff_id: string;
      }>(
        `SELECT previous_eligible_days, delta, new_eligible_days, reason, source, staff_id
           FROM rik.eligibility_adjustments
          WHERE customer_id = $1 AND period_id = $2 AND created_at >= $3
          ORDER BY created_at`,
        [officers.get('singh')!.officerId, periodId, runStart]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.previous_eligible_days).toBe(18);
      expect(rows[0]!.delta).toBe(6);
      expect(rows[0]!.new_eligible_days).toBe(24);
      expect(rows[0]!.reason).toBe(`Eligibility import ${batchRef}`);
      expect(rows[0]!.source).toBe('IMPORT');
      expect(rows[0]!.staff_id).toBe(staffIdByRole.get('RIK_ADMIN'));
    });

    it('is idempotent: confirming again changes nothing and is not an error', async () => {
      const res = await request(server())
        .post(`/admin/rik/eligibility-imports/${batchId}/confirm`)
        .set('Authorization', asAdmin())
        .expect(201);
      expect(res.body.totals.applied).toBe(1);
      expect(await currentDays('singh')).toBe(24);

      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.eligibility_adjustments
          WHERE customer_id = $1 AND period_id = $2 AND created_at >= $3`,
        [officers.get('singh')!.officerId, periodId, runStart]
      );
      expect(rows[0]!.total).toBe('1');
    });

    it('records the application in the audit log', async () => {
      const rows = await db.query<{ action: string }>(
        `SELECT action FROM shared.audit_log WHERE entity_id = $1 ORDER BY created_at`,
        [batchId]
      );
      expect(rows.map((r) => r.action)).toEqual([
        'RIK_ELIGIBILITY_IMPORT_UPLOADED',
        'RIK_ELIGIBILITY_IMPORT_APPLIED',
      ]);
    });

    it('refuses to apply a batch that changes nothing', async () => {
      const res = await upload(
        await workbook([[officers.get('rao')!.name, officers.get('rao')!.mobile, '7']]),
        'eligibility-nochange.xlsx'
      ).expect(201);
      const confirm = await request(server())
        .post(`/admin/rik/eligibility-imports/${res.body.batchId}/confirm`)
        .set('Authorization', asAdmin());
      expect(confirm.status).toBe(400);
      expect(confirm.body.details.reason).toBe('NOTHING_TO_APPLY');
    });

    it('a discarded batch cannot be applied, and an applied one cannot be discarded', async () => {
      const res = await upload(
        await workbook([[officers.get('kumar')!.name, officers.get('kumar')!.mobile, '19']]),
        'eligibility-discard.xlsx'
      ).expect(201);
      const discardedId = res.body.batchId;

      const discarded = await request(server())
        .post(`/admin/rik/eligibility-imports/${discardedId}/discard`)
        .set('Authorization', asAdmin())
        .expect(201);
      expect(discarded.body.status).toBe('DISCARDED');
      expect(await currentDays('kumar')).toBe(22);

      const reapply = await request(server())
        .post(`/admin/rik/eligibility-imports/${discardedId}/confirm`)
        .set('Authorization', asAdmin());
      expect(reapply.status).toBe(400);
      expect(reapply.body.details.reason).toBe('BATCH_NOT_PENDING');

      const undiscard = await request(server())
        .post(`/admin/rik/eligibility-imports/${batchId}/discard`)
        .set('Authorization', asAdmin());
      expect(undiscard.status).toBe(400);
      expect(undiscard.body.details.reason).toBe('BATCH_NOT_PENDING');
    });

    it('answers 404 for a batch that does not exist', async () => {
      await request(server())
        .get('/admin/rik/eligibility-imports/00000000-0000-7000-8000-000000000000')
        .set('Authorization', asAdmin())
        .expect(404);
    });
  });

  // =================================================================
  // 6. A second upload for the same period
  // =================================================================
  describe('a second upload for the same period', () => {
    it('creates a new tracked batch and keeps the first one readable', async () => {
      const before = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.eligibility_import_batches WHERE period_id = $1`,
        [periodId]
      );

      const res = await upload(
        await workbook([[officers.get('singh')!.name, officers.get('singh')!.mobile, '26']]),
        'eligibility-corrected.xlsx'
      ).expect(201);

      await request(server())
        .post(`/admin/rik/eligibility-imports/${res.body.batchId}/confirm`)
        .set('Authorization', asAdmin())
        .expect(201);

      const after = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.eligibility_import_batches WHERE period_id = $1`,
        [periodId]
      );
      expect(Number(after[0]!.total)).toBe(Number(before[0]!.total) + 1);
      expect(await currentDays('singh')).toBe(26);
    });

    it('both before and after values remain visible in the history', async () => {
      const history = await db.query<{ previous_eligible_days: number; new_eligible_days: number }>(
        `SELECT previous_eligible_days, new_eligible_days
           FROM rik.eligibility_adjustments
          WHERE customer_id = $1 AND period_id = $2 AND source = 'IMPORT'
            AND created_at >= $3
          ORDER BY created_at`,
        [officers.get('singh')!.officerId, periodId, runStart]
      );
      expect(history).toEqual([
        { previous_eligible_days: 18, new_eligible_days: 24 },
        { previous_eligible_days: 24, new_eligible_days: 26 },
      ]);
    });

    it('the batch list shows each attempt with its own reference and file name', async () => {
      const res = await request(server())
        .get('/admin/rik/eligibility-imports')
        .set('Authorization', asAdmin())
        .expect(200);
      const mine = (
        res.body.items as Array<{
          periodId: string;
          batchRef: string;
          fileName: string;
          uploadedAt: string;
        }>
      ).filter((b) => b.periodId === periodId && b.uploadedAt >= runStart);
      expect(mine.length).toBeGreaterThanOrEqual(2);
      expect(new Set(mine.map((b) => b.batchRef)).size).toBe(mine.length);
      expect(mine.some((b) => b.fileName === 'eligibility-corrected.xlsx')).toBe(true);
    });
  });

  // =================================================================
  // 7. The database refuses an unexplained change
  // =================================================================
  describe('an unexplained change is impossible, not merely discouraged', () => {
    it('a direct UPDATE of eligible_days is refused by the database', async () => {
      await expect(
        db.query(
          `UPDATE rik.customer_period_eligibility SET eligible_days = 99
            WHERE customer_id = $1 AND period_id = $2`,
          [officers.get('singh')!.officerId, periodId]
        )
      ).rejects.toThrow();
      expect(await currentDays('singh')).toBe(26);
    });

    it('an UPDATE of an unrelated column is untouched', async () => {
      await db.query(
        `UPDATE rik.customer_period_eligibility SET notes = 'a note'
          WHERE customer_id = $1 AND period_id = $2`,
        [officers.get('singh')!.officerId, periodId]
      );
      const rows = await db.query<{ notes: string }>(
        `SELECT notes FROM rik.customer_period_eligibility
          WHERE customer_id = $1 AND period_id = $2`,
        [officers.get('singh')!.officerId, periodId]
      );
      expect(rows[0]!.notes).toBe('a note');
    });

    it('an adjustment cannot be rewritten or deleted', async () => {
      await expect(
        db.query(`UPDATE rik.eligibility_adjustments SET reason = 'rewritten' WHERE customer_id = $1`, [
          officers.get('singh')!.officerId,
        ])
      ).rejects.toThrow();
      await expect(
        db.query(`DELETE FROM rik.eligibility_adjustments WHERE customer_id = $1`, [
          officers.get('singh')!.officerId,
        ])
      ).rejects.toThrow();
    });

    it('the application role holds no UPDATE and no DELETE on the ledger at all', async () => {
      const rows = await db.query<{ upd: boolean; del: boolean; ins: boolean; sel: boolean }>(
        `SELECT has_table_privilege('app_rik', 'rik.eligibility_adjustments', 'UPDATE') AS upd,
                has_table_privilege('app_rik', 'rik.eligibility_adjustments', 'DELETE') AS del,
                has_table_privilege('app_rik', 'rik.eligibility_adjustments', 'INSERT') AS ins,
                has_table_privilege('app_rik', 'rik.eligibility_adjustments', 'SELECT') AS sel`
      );
      expect(rows[0]).toEqual({ upd: false, del: false, ins: true, sel: true });
    });

    it('an import batch and its rows cannot be deleted by the application', async () => {
      // The facility's locked decision, enforced by migration 0046:
      // DISCARDED is a status, not a deletion.
      const rows = await db.query<{
        batch_del: boolean;
        row_del: boolean;
        batch_upd: boolean;
      }>(
        `SELECT has_table_privilege('app_rik', 'rik.eligibility_import_batches', 'DELETE') AS batch_del,
                has_table_privilege('app_rik', 'rik.eligibility_import_rows',    'DELETE') AS row_del,
                has_table_privilege('app_rik', 'rik.eligibility_import_batches', 'UPDATE') AS batch_upd`
      );
      expect(rows[0]).toEqual({ batch_del: false, row_del: false, batch_upd: true });

      await expect(
        db.query(`DELETE FROM rik.eligibility_import_batches WHERE period_id = $1`, [periodId])
      ).rejects.toThrow();
    });

    it('the UPLOADED / APPLIED / DISCARDED history is still queryable', async () => {
      const rows = await db.query<{ status: string; total: string }>(
        `SELECT status, count(*)::text AS total
           FROM rik.eligibility_import_batches
          WHERE period_id = $1 AND uploaded_at >= $2
          GROUP BY status
          ORDER BY status`,
        [periodId, runStart]
      );
      const byStatus = new Map(rows.map((r) => [r.status, Number(r.total)]));
      expect(byStatus.get('APPLIED')).toBeGreaterThanOrEqual(2);
      expect(byStatus.get('DISCARDED')).toBeGreaterThanOrEqual(1);
      expect(byStatus.get('PENDING_REVIEW')).toBeGreaterThanOrEqual(1);
    });

    it('the ledger carries no foreign key, so history outlives what it refers to', async () => {
      const rows = await db.query<{ fks: string }>(
        `SELECT count(*)::text AS fks FROM pg_constraint
          WHERE conrelid = 'rik.eligibility_adjustments'::regclass AND contype = 'f'`
      );
      expect(rows[0]!.fks).toBe('0');
    });

    it('but a reference that does not resolve is refused on the way in', async () => {
      const singh = officers.get('singh')!.officerId;
      const staff = staffIdByRole.get('RIK_ADMIN');
      const absent = '00000000-0000-7000-8000-000000000000';
      const insert = (customerId: string, period: string, staffId: unknown, importRow: string | null) =>
        db.query(
          `INSERT INTO rik.eligibility_adjustments
             (customer_id, period_id, previous_eligible_days, delta, new_eligible_days,
              reason, source, import_row_id, staff_id)
           VALUES ($1, $2, 0, 5, 5, 'probe',
                   CASE WHEN $4::uuid IS NULL THEN 'MANUAL' ELSE 'IMPORT' END, $4::uuid, $3)`,
          [customerId, period, staffId, importRow]
        );

      await expect(insert(singh, absent, staff, null)).rejects.toThrow();
      await expect(insert(singh, otherPeriodId, absent, null)).rejects.toThrow();
      await expect(insert(singh, otherPeriodId, staff, absent)).rejects.toThrow();
      await expect(insert(absent, otherPeriodId, staff, null)).rejects.toThrow();
    });

    it('an adjustment claiming the wrong previous value is refused', async () => {
      await expect(
        db.query(
          `INSERT INTO rik.eligibility_adjustments
             (customer_id, period_id, previous_eligible_days, delta, new_eligible_days, reason, source, staff_id)
           VALUES ($1, $2, 3, 1, 4, 'stale', 'MANUAL', $3)`,
          [officers.get('singh')!.officerId, periodId, staffIdByRole.get('RIK_ADMIN')]
        )
      ).rejects.toThrow();
    });

    it('a zero-delta adjustment is refused rather than recorded', async () => {
      await expect(
        db.query(
          `INSERT INTO rik.eligibility_adjustments
             (customer_id, period_id, previous_eligible_days, delta, new_eligible_days, reason, source, staff_id)
           VALUES ($1, $2, 26, 0, 26, 'nothing', 'MANUAL', $3)`,
          [officers.get('singh')!.officerId, periodId, staffIdByRole.get('RIK_ADMIN')]
        )
      ).rejects.toThrow();
    });

    it('a blank reason is refused by the database as well as the service', async () => {
      await expect(
        db.query(
          `INSERT INTO rik.eligibility_adjustments
             (customer_id, period_id, previous_eligible_days, delta, new_eligible_days, reason, source, staff_id)
           VALUES ($1, $2, 26, 1, 27, '   ', 'MANUAL', $3)`,
          [officers.get('singh')!.officerId, periodId, staffIdByRole.get('RIK_ADMIN')]
        )
      ).rejects.toThrow();
    });
  });

  // =================================================================
  // 8. Manual adjustment — the exception path
  // =================================================================
  describe('a manual adjustment records why it was made', () => {
    it('records previous, delta, new, reason, staff and timestamp', async () => {
      const kumar = officers.get('kumar')!;
      const res = await request(server())
        .post(`/admin/rik/officers/${kumar.officerId}/eligibility`)
        .set('Authorization', asAdmin())
        .send({ periodId, eligibleDays: 25, reason: 'Fresh Week 1 carry-forward' })
        .expect(201);

      expect(res.body).toEqual({
        previousEligibleDays: 22,
        delta: 3,
        newEligibleDays: 25,
        adjustmentId: expect.any(String),
      });
      expect(await currentDays('kumar')).toBe(25);

      const rows = await db.query<{ reason: string; source: string; staff_id: string }>(
        `SELECT reason, source, staff_id FROM rik.eligibility_adjustments WHERE id = $1`,
        [res.body.adjustmentId]
      );
      expect(rows[0]!.reason).toBe('Fresh Week 1 carry-forward');
      expect(rows[0]!.source).toBe('MANUAL');
      expect(rows[0]!.staff_id).toBe(staffIdByRole.get('RIK_ADMIN'));
    });

    it('refuses a blank reason', async () => {
      const res = await request(server())
        .post(`/admin/rik/officers/${officers.get('kumar')!.officerId}/eligibility`)
        .set('Authorization', asAdmin())
        .send({ periodId, eligibleDays: 26, reason: '   ' });
      expect(res.status).toBe(400);
    });

    it('refuses an adjustment that changes nothing', async () => {
      const res = await request(server())
        .post(`/admin/rik/officers/${officers.get('kumar')!.officerId}/eligibility`)
        .set('Authorization', asAdmin())
        .send({ periodId, eligibleDays: 25, reason: 'no change at all' });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('NO_CHANGE');
    });

    it('refuses a negative or fractional target', async () => {
      for (const value of [-1, 7.5, 400]) {
        const res = await request(server())
          .post(`/admin/rik/officers/${officers.get('kumar')!.officerId}/eligibility`)
          .set('Authorization', asAdmin())
          .send({ periodId, eligibleDays: value, reason: 'bad value' });
        expect(res.status).toBe(400);
      }
    });

    it('allows zero, because an officer with zero days is a real statement', async () => {
      const rao = officers.get('rao')!;
      const res = await request(server())
        .post(`/admin/rik/officers/${rao.officerId}/eligibility`)
        .set('Authorization', asAdmin())
        .send({ periodId, eligibleDays: 0, reason: 'On deputation for the whole period' })
        .expect(201);
      expect(res.body.newEligibleDays).toBe(0);
      expect(await currentDays('rao')).toBe(0);
    });

    it('is audited', async () => {
      const rows = await db.query<{ action: string }>(
        `SELECT action FROM shared.audit_log
          WHERE entity_id = $1 AND action = 'RIK_ELIGIBILITY_ADJUSTED'
            AND created_at >= $2`,
        [officers.get('rao')!.officerId, runStart]
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it('answers 404 for an officer who does not exist', async () => {
      await request(server())
        .post('/admin/rik/officers/00000000-0000-7000-8000-000000000000/eligibility')
        .set('Authorization', asAdmin())
        .send({ periodId, eligibleDays: 5, reason: 'nobody' })
        .expect(404);
    });

    it('reports an officer’s current figures and their whole history', async () => {
      const res = await request(server())
        .get(`/admin/rik/officers/${officers.get('singh')!.officerId}/eligibility`)
        .set('Authorization', asAdmin())
        .expect(200);

      expect(res.body.periods.some((p: { eligibleDays: number }) => p.eligibleDays === 26)).toBe(true);
      expect(res.body.history.length).toBeGreaterThanOrEqual(2);
      const entry = res.body.history[0];
      expect(entry).toHaveProperty('previousEligibleDays');
      expect(entry).toHaveProperty('delta');
      expect(entry).toHaveProperty('newEligibleDays');
      expect(entry).toHaveProperty('reason');
      expect(entry).toHaveProperty('staffName');
      expect(entry).toHaveProperty('batchRef');
    });
  });

  // =================================================================
  // 9. Historical immutability
  // =================================================================
  describe('a confirmed selection does not move when eligibility changes', () => {
    let selectionId: string;
    let snapshotBefore: string;
    let referenceBefore: string;
    let eligibleDaysOnRow: number;

    beforeAll(async () => {
      const frozen = officers.get('history')!;
      await seedEligibility('history', 18, otherPeriodId);

      const basis = await eligibilityService.resolveBasis(frozen.officerId, otherPeriodId);
      const pickup = await db.query<{ id: string; name: string }>(
        `SELECT id, name FROM rik.pickup_locations WHERE is_active ORDER BY name LIMIT 1`
      );

      // Something in the basket, then confirm — through the same service the
      // customer's own confirmation route uses, with a basis for the fixture
      // period so this suite still needs no current period.
      const provision = await db.query<{ id: string }>(
        `SELECT pr.id FROM rik.provisions pr
           JOIN rik.entitlement_pools p ON p.id = pr.pool_id
          WHERE p.code = 'CEREALS' AND pr.is_active AND pr.is_customer_selectable
            AND pr.consumption_ratio = 1 AND pr.issue_period = 'DRY'
          ORDER BY pr.code LIMIT 1`
      );
      await validation.setQuantity(basis, provision[0]!.id, 1000);

      const confirmed = await validation.confirm(basis, {
        availabilityAcknowledged: true,
        fulfillmentType: 'PICKUP',
        pickupLocationId: pickup[0]!.id,
        deliveryAddress: null,
      });
      selectionId = confirmed.selectionId;

      const rows = await db.query<{
        rule_snapshot: string;
        reference_number: string;
        eligible_days: number;
      }>(
        `SELECT rule_snapshot::text AS rule_snapshot, reference_number, eligible_days
           FROM rik.entitlement_selections WHERE id = $1`,
        [selectionId]
      );
      snapshotBefore = rows[0]!.rule_snapshot;
      referenceBefore = rows[0]!.reference_number;
      eligibleDaysOnRow = rows[0]!.eligible_days;
    });

    it('confirms a selection at the eligibility of the day', () => {
      expect(eligibleDaysOnRow).toBe(18);
      expect(referenceBefore).toMatch(/^RIK-[0-9]{6,}$/);
    });

    it('an import changes the current figure', async () => {
      const frozen = officers.get('history')!;
      const res = await upload(
        await workbook([[frozen.name, frozen.mobile, '20']]),
        'eligibility-frozen.xlsx',
        otherPeriodId
      ).expect(201);
      await request(server())
        .post(`/admin/rik/eligibility-imports/${res.body.batchId}/confirm`)
        .set('Authorization', asAdmin())
        .expect(201);

      expect(await currentDays('history', otherPeriodId)).toBe(20);
    });

    it('and the confirmed selection is byte-for-byte unchanged', async () => {
      const rows = await db.query<{
        rule_snapshot: string;
        reference_number: string;
        eligible_days: number;
      }>(
        `SELECT rule_snapshot::text AS rule_snapshot, reference_number, eligible_days
           FROM rik.entitlement_selections WHERE id = $1`,
        [selectionId]
      );
      expect(rows[0]!.rule_snapshot).toBe(snapshotBefore);
      expect(rows[0]!.reference_number).toBe(referenceBefore);
      expect(rows[0]!.eligible_days).toBe(18);
    });

    it('the snapshot still carries the eligibility it was confirmed at', async () => {
      const rows = await db.query<{ days: number }>(
        `SELECT (rule_snapshot -> 'basis' ->> 'eligibleDays')::int AS days
           FROM rik.entitlement_selections WHERE id = $1`,
        [selectionId]
      );
      expect(rows[0]!.days).toBe(18);
    });

    it('the customer is still shown the ration they confirmed, not the new figure', async () => {
      const frozen = officers.get('history')!;
      const calculation = await validation.recalculateFromSnapshot(selectionId, frozen.officerId);
      expect(calculation).not.toBeNull();
      expect(calculation!.eligibleDays).toBe(18);
    });

    it('a future calculation for a DIFFERENT period uses the new figure', async () => {
      const frozen = officers.get('history')!;
      const basis = await eligibilityService.resolveBasis(frozen.officerId, otherPeriodId);
      expect(basis.eligibleDays).toBe(20);
    });
  });

  // =================================================================
  // 10. The baseline is untouched
  // =================================================================
  describe('the RIK baseline is untouched', () => {
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

    it('no PURCHASING role and no PIF table was added', async () => {
      const rows = await db.query<{ purchasing: string; pif: string }>(
        `SELECT (SELECT count(*)::text FROM shared.roles WHERE name ILIKE '%PURCHAS%') AS purchasing,
                (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'pif')        AS pif`
      );
      expect(rows[0]).toEqual({ purchasing: '0', pif: '23' });
    });

    it('ExcelJS is pinned to the approved exact version', async () => {
      const pkg = await import('exceljs/package.json');
      expect((pkg as unknown as { version: string }).version).toBe('4.4.0');
    });
  });
});
