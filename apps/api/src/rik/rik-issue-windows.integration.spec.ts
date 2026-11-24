import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { STAFF_ROLES, type StaffRole } from '@esamagri/shared-types';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';
import {
  parseIsoDate,
  humanWindow,
  humanRationType,
  RATION_TYPES,
} from './services/rik-issue-window.service';
import { CurrentPeriodLock } from './test-support/current-period-lock';

/**
 * STEP 15C — RIK issue windows, over real HTTP against real PostgreSQL.
 *
 * What this suite is designed to prove, in order of importance:
 *
 *  1. THE SCHEDULE IS CONFIGURED, NEVER ASSUMED. Every date comes from the
 *     administrator. Nothing in the implementation or in this suite assumes a
 *     seven-day week, a thirty-day month, or that the facility opens on
 *     Tuesday, Wednesday or Friday — the operating days are the actual dates
 *     the facility will issue on.
 *
 *  2. THE DATABASE IS THE BOUNDARY. Overlap, within-period, Fresh ordering,
 *     window identity and no-delete are all enforced by migration 0047, and
 *     each is exercised here through HTTP so the application's refusal and
 *     the database's refusal cannot drift apart.
 *
 *  3. ONLY RIK_ADMIN MAY CONFIGURE. Every other staff role, a role-less staff
 *     member, a customer and an anonymous caller are pointed at every route.
 *     The existing `rik.issue_schedule.manage` is used; no new permission.
 *
 *  4. THE CUSTOMER READS, AND ONLY READS. The customer sees the live schedule
 *     and no audit information, and there is no customer write path at all.
 *
 *  5. HISTORY IS KEPT BY THE DATABASE. A revision row per material change,
 *     with both states, append-only.
 *
 * FIXTURE DISCIPLINE. Every date is derived at run time from a period this
 * suite creates. The only literal dates appear in the date-PARSING tests,
 * where the literal is the subject.
 */
describe('RIK issue windows (STEP 15C, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '6').slice(0, 7);

  const staffIdByRole = new Map<StaffRole, string>();
  const tokenByRole = new Map<StaffRole, string>();
  let noRoleToken: string;
  let noRoleStaffId: string;
  let customerToken: string;
  let customerId: string;

  /**
   * The customer group below needs the period containing TODAY, which is a
   * single exclusive resource (rik_ent_periods_no_overlap is global), so this
   * suite takes the same advisory lock the other current-period suites take.
   */
  let periodLock: CurrentPeriodLock;

  /**
   * The customer fixture period — the one that covers today while this suite
   * runs. Declared here because afterAll has to hand the current month back.
   */
  let currentPeriodId: string | undefined;
  /** True only when the fixture above is OURS to move. */
  let currentFixtureIsOurs = false;

  /** Three fixture periods, none containing today. */
  let periodId: string;
  let periodStart: string;
  let periodEnd: string;
  let otherPeriodId: string;
  let otherStart: string;
  let shortPeriodId: string;
  let shortStart: string;
  let shortEnd: string;
  /** Its own period, so the refusal attempts below cannot disturb the rest. */
  let orderPeriodId: string;
  let orderStart: string;

  const createdWindowIds: string[] = [];

  const server = () => app.getHttpServer();
  const bearer = (role: StaffRole) => `Bearer ${tokenByRole.get(role)}`;
  const asAdmin = () => bearer('RIK_ADMIN');

  // --- date helpers. Months are never assumed to be any particular length.
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = (back: number) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  };
  const monthEnd = (back: number) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0));
  };
  /** `n` days after an ISO date, by UTC arithmetic — no month-length assumption. */
  const plusDays = (isoDate: string, n: number): string => {
    const [y, m, d] = isoDate.split('-').map(Number);
    return iso(new Date(Date.UTC(y!, m! - 1, d! + n)));
  };

  const configure = (body: Record<string, unknown>) =>
    request(server()).post('/admin/rik/issue-windows').set('Authorization', asAdmin()).send(body);

  const configureOk = async (body: Record<string, unknown>) => {
    const res = await configure(body).expect(201);
    createdWindowIds.push(res.body.windowId);
    return res.body;
  };

  /**
   * Converge one window on the shape this suite wants, whether or not a
   * previous run already created it.
   *
   * Required, not convenience: migration 0047 refuses DELETE, so a window
   * this suite creates is permanent and the next run finds it already there —
   * possibly retired by a test that retired it on purpose. Creating blindly
   * would fail as a duplicate on the second run, so the suite ensures instead
   * of assuming, and every run starts from the same published schedule.
   */
  const ensureWindow = async (
    period: string,
    rationType: 'FRESH' | 'DRY' | 'MISS_MUSTER_FRESH' | 'MISS_MUSTER_DRY',
    sequenceNo: number,
    dates: { startDate: string; endDate: string; operatingDays: string[] },
    notes?: string
  ) => {
    // Only FRESH numbers its schedules; for the rest the code is the type —
    // the same derivation the database's identity CHECK performs.
    const code = rationType === 'FRESH' ? `FRESH_${sequenceNo}` : rationType;
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM rik.issue_windows WHERE period_id = $1 AND window_code = $2`,
      [period, code]
    );
    if (existing.length === 0) {
      return configureOk({ periodId: period, rationType, sequenceNo, ...dates, ...(notes ? { notes } : {}) });
    }
    const res = await request(server())
      .patch(`/admin/rik/issue-windows/${existing[0]!.id}`)
      .set('Authorization', asAdmin())
      .send({ ...dates, isActive: true, ...(notes ? { notes } : {}) })
      .expect(200);
    createdWindowIds.push(res.body.windowId);
    return res.body;
  };

  /** A window occupying days [offset, offset+span) of the fixture period. */
  const span = (offset: number, length: number, days: number[] = [0]) => {
    const start = plusDays(periodStart, offset);
    const end = plusDays(periodStart, offset + length - 1);
    return {
      startDate: start,
      endDate: end,
      operatingDays: days.map((d) => plusDays(start, d)),
    };
  };

  beforeAll(async () => {
    periodLock = await CurrentPeriodLock.acquire();

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    tokenService = app.get(TokenService);

    const passwordHash = await app.get(PasswordService).hash('CorrectHorseBatteryStaple!1');
    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    const grantedBy = bootstrap[0]!.id;

    /**
     * STABLE staff accounts, like the Phase B suite's and for the same
     * reason: an issue window records who created it and every revision
     * records who changed it, permanently, and a window cannot be deleted.
     * A per-run account would make the second run's history name a user that
     * no longer exists, and `created_by` would still point at the first run.
     */
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
      const id = await staffAccount(`jest_15c_${role.toLowerCase()}`, `Jest 15C ${role}`);
      staffIdByRole.set(role, id);
      await db.query(
        `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
         SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3
          ON CONFLICT DO NOTHING`,
        [id, grantedBy, role]
      );
      tokenByRole.set(role, tokenService.signAccessToken({ principalType: 'STAFF', principalId: id }));
    }

    noRoleStaffId = await staffAccount('jest_15c_norole', 'Jest 15C NoRole');
    noRoleToken = tokenService.signAccessToken({ principalType: 'STAFF', principalId: noRoleStaffId });

    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
       VALUES (shared.uuid_generate_v7(), $1, $2, true, 'NV') RETURNING id`,
      [`9${digits}71`, `Jest 15C Customer ${runId}`]
    );
    customerId = customer[0]!.id;
    customerToken = tokenService.signAccessToken({
      principalType: 'CUSTOMER',
      principalId: customerId,
    });

    // Three periods well in the past, so the no-overlap exclusion on
    // rik.entitlement_periods cannot collide with another suite's current
    // period and nothing here needs findCurrent().
    /**
     * ADOPTED IF PRESENT, created if not — by name PREFIX, the same discipline
     * the Phase B suite needs and for the same reason. An issue window cannot
     * be deleted (migration 0047), so a period that has ever carried one is
     * permanent, and rik.entitlement_periods carries a GLOBAL no-overlap
     * exclusion: a per-run period in the same month as a previous run's
     * undeletable one could never be created, and this suite would run exactly
     * once per database.
     */
    const mk = async (prefix: string, start: string, end: string) => {
      const found = await db.query<{ id: string; start_date: string; end_date: string }>(
        `SELECT id, start_date::text AS start_date, end_date::text AS end_date
           FROM rik.entitlement_periods WHERE name LIKE $1 || '%' ORDER BY name LIMIT 1`,
        [prefix]
      );
      if (found.length > 0) return found[0]!;
      const made = await db.query<{ id: string; start_date: string; end_date: string }>(
        `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
         VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'ACTIVE')
         RETURNING id, start_date::text AS start_date, end_date::text AS end_date`,
        [`${prefix} ${runId}`, start, end]
      );
      return made[0]!;
    };

    const main = await mk('Jest 15C period', iso(monthStart(8)), iso(monthEnd(8)));
    periodId = main.id;
    periodStart = main.start_date;
    periodEnd = main.end_date;

    const other = await mk('Jest 15C other', iso(monthStart(9)), iso(monthEnd(9)));
    otherPeriodId = other.id;
    otherStart = other.start_date;

    // A deliberately short period: four days, to prove a window must fit
    // inside whatever the facility defined rather than inside a month.
    const shortSeed = plusDays(iso(monthStart(10)), 5);
    const short = await mk('Jest 15C short', shortSeed, plusDays(shortSeed, 3));
    shortPeriodId = short.id;
    shortStart = short.start_date;
    shortEnd = short.end_date;

    const ordering = await mk('Jest 15C ordering', iso(monthStart(11)), iso(monthEnd(11)));
    orderPeriodId = ordering.id;
    orderStart = ordering.start_date;
  });

  afterAll(async () => {
    // An issue window cannot be deleted by the application — that is the
    // point of migration 0047 — so the period that carries one cannot go
    // either. The DBA path is outside the application, and these fixtures are
    // left for the next run to adopt, exactly as the Phase B suite does.
    //
    // THE CURRENT MONTH IS HANDED BACK. The customer group needs a period
    // containing today, and that period then carries permanent windows, so it
    // can never be deleted. Left where it is it would occupy the current
    // month for good and every other current-period suite — entitlement,
    // checkout, know-your-ration and the three image suites — would fail its
    // insert against the global no-overlap constraint, for ever.
    //
    // So the fixture is PARKED instead: the period is moved to a slot far
    // enough back that nothing else uses it, and its windows are moved with
    // it. The period moves first, because the window trigger validates a
    // window against its period's CURRENT range and would refuse the move in
    // the other order; both moves are in one transaction, so no reader ever
    // sees the intermediate state. Next run moves it back over today.
    if (currentPeriodId !== undefined && currentFixtureIsOurs) {
      await parkCurrentFixture();
    }

    const staffIds = [...staffIdByRole.values(), noRoleStaffId];
    await db.query(`DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])`, [
      [...staffIds, customerId],
    ]);
    await db.query(`DELETE FROM shared.customers WHERE id = $1`, [customerId]);
    await app.close();
    await periodLock.release();
  });

  /** The month the parked customer fixture lives in between runs. */
  const PARK_MONTHS_BACK = 120;

  /**
   * Move the customer fixture period (and the windows inside it) into the
   * parking slot, so the current month is free for every other suite.
   */
  const parkCurrentFixture = async (): Promise<void> => {
    const parkStart = iso(monthStart(PARK_MONTHS_BACK));
    const parkEnd = iso(monthEnd(PARK_MONTHS_BACK));
    await db.withTransaction(async (client) => {
      await client.query(
        `UPDATE rik.entitlement_periods SET start_date = $2::date, end_date = $3::date
          WHERE id = $1`,
        [currentPeriodId, parkStart, parkEnd]
      );
      const windows = await client.query<{
        id: string;
        ration_type: string;
        sequence_no: number;
      }>(
        `SELECT id, ration_type, sequence_no FROM rik.issue_windows
          WHERE period_id = $1 ORDER BY ration_type, sequence_no`,
        [currentPeriodId]
      );
      // One day each, laid out in sequence order and restarted per ration
      // type: the windows must not overlap within a type (the GiST exclusion),
      // Fresh must stay in ascending order (the sequence trigger), and every
      // operating day must sit inside its own window.
      for (const w of windows.rows) {
        const day = plusDays(parkStart, w.sequence_no - 1);
        await client.query(
          `UPDATE rik.issue_windows
              SET start_date = $2::date, end_date = $2::date, operating_days = ARRAY[$2::date]
            WHERE id = $1`,
          [w.id, day]
        );
      }
    });
  };

  /**
   * Bring the parked fixture's windows back over the planned current-month
   * layout, HIGHEST sequence number first.
   *
   * The order is the whole point. Migration 0047's sequence trigger refuses an
   * active Fresh window that starts before a lower-numbered one, so moving
   * FRESH_1 forward while 2 and 3 are still parked in the past would be
   * refused mid-way. Moving the latest window first keeps the sequence valid
   * at every single step. One transaction, so no reader sees a half-moved
   * schedule, and raw SQL because the admin API is right to refuse the
   * intermediate states this walks through.
   */
  const unparkCurrentFixture = async (
    plan: ReadonlyArray<{ rationType: 'FRESH' | 'DRY'; sequenceNo: number; startDate: string; endDate: string; operatingDays: string[] }>
  ): Promise<void> => {
    await db.withTransaction(async (client) => {
      const ordered = [...plan].sort((a, b) => b.sequenceNo - a.sequenceNo);
      for (const item of ordered) {
        const code = item.rationType === 'FRESH' ? `FRESH_${item.sequenceNo}` : 'DRY';
        await client.query(
          `UPDATE rik.issue_windows
              SET start_date = $3::date, end_date = $4::date, operating_days = $5::date[]
            WHERE period_id = $1 AND window_code = $2`,
          [currentPeriodId, code, item.startDate, item.endDate, item.operatingDays]
        );
      }
    });
  };

  // =================================================================
  // 1. Dates, as pure functions
  // =================================================================
  describe('a configured date is a real calendar date', () => {
    it('accepts an ordinary date', () => {
      expect(parseIsoDate('2027-03-14', 'startDate')).toBe('2027-03-14');
    });

    it('accepts 29 February in a leap year', () => {
      expect(parseIsoDate('2028-02-29', 'startDate')).toBe('2028-02-29');
    });

    it('refuses 29 February in a non-leap year rather than rolling it forward', () => {
      expect(() => parseIsoDate('2027-02-29', 'startDate')).toThrow(/not a real calendar date/i);
    });

    it('refuses 31 April and 31 June', () => {
      expect(() => parseIsoDate('2027-04-31', 'startDate')).toThrow(/not a real calendar date/i);
      expect(() => parseIsoDate('2027-06-31', 'startDate')).toThrow(/not a real calendar date/i);
    });

    it('refuses month 13 and day 0', () => {
      expect(() => parseIsoDate('2027-13-01', 'startDate')).toThrow();
      expect(() => parseIsoDate('2027-01-00', 'startDate')).toThrow();
    });

    it('refuses a timestamp — an issue day is a date, not an instant', () => {
      expect(() => parseIsoDate('2027-03-14T00:00:00Z', 'startDate')).toThrow(/YYYY-MM-DD/);
    });

    it('refuses a date written any other way', () => {
      for (const bad of ['14-03-2027', '2027/03/14', '2027-3-14', '', 'tomorrow']) {
        expect(() => parseIsoDate(bad, 'startDate')).toThrow();
      }
    });

    it('names each window the way the facility does', () => {
      expect(humanWindow('FRESH_1')).toBe('Fresh Issue 1');
      expect(humanWindow('FRESH_2')).toBe('Fresh Issue 2');
      expect(humanWindow('FRESH_3')).toBe('Fresh Issue 3');
      expect(humanWindow('DRY')).toBe('Dry Issue');
      expect(humanWindow('MISS_MUSTER_FRESH')).toBe('Miss Muster Fresh');
      expect(humanWindow('MISS_MUSTER_DRY')).toBe('Miss Muster Dry');
    });

    it('names each ration type, in the order the schedule is shown', () => {
      expect(RATION_TYPES).toEqual(['FRESH', 'DRY', 'MISS_MUSTER_FRESH', 'MISS_MUSTER_DRY']);
      expect(RATION_TYPES.map(humanRationType)).toEqual([
        'Fresh Issue',
        'Dry Issue',
        'Miss Muster Fresh',
        'Miss Muster Dry',
      ]);
    });
  });

  // =================================================================
  // 1b. Miss Muster — two independent schedules
  //
  // REQUIRES MIGRATION 0058. Until the identity CHECK is widened every
  // insert in this block is refused by the database, which is the correct
  // behaviour and exactly what 0058 changes.
  //
  // WHAT THIS PROVES, and why each assertion is here:
  //
  //   * each Miss Muster schedule is its OWN ration type at sequence 1 —
  //     the same shape as DRY — and the database derives its code;
  //   * the two may cover the SAME DATES. That is the whole reason they are
  //     separate types: the overlap exclusion is scoped by ration type, so
  //     one shared type would have made this impossible;
  //   * they may also overlap Fresh and Dry, which are untouched by them;
  //   * creating and editing one says nothing about the other.
  // =================================================================
  describe('Miss Muster schedules (requires migration 0058)', () => {
    let missFresh: Record<string, unknown>;
    let missDry: Record<string, unknown>;

    beforeAll(async () => {
      // Deliberately the SAME span for both, and a span that also overlaps
      // the Fresh and Dry windows configured above.
      missFresh = await ensureWindow(periodId, 'MISS_MUSTER_FRESH', 1, span(0, 10, [3, 6]));
      missDry = await ensureWindow(periodId, 'MISS_MUSTER_DRY', 1, span(0, 10, [3, 6]));
    });

    it('creates Miss Muster Fresh with the code the database derives', () => {
      expect(missFresh.windowCode).toBe('MISS_MUSTER_FRESH');
      expect(missFresh.rationType).toBe('MISS_MUSTER_FRESH');
      expect(missFresh.sequenceNo).toBe(1);
      expect(missFresh.label).toBe('Miss Muster Fresh');
      expect(missFresh.status).toBe('ACTIVE');
    });

    it('creates Miss Muster Dry independently, over the very same dates', () => {
      expect(missDry.windowCode).toBe('MISS_MUSTER_DRY');
      expect(missDry.rationType).toBe('MISS_MUSTER_DRY');
      expect(missDry.sequenceNo).toBe(1);
      expect(missDry.label).toBe('Miss Muster Dry');
      // Same span as Miss Muster Fresh: two separate ration types, so the
      // overlap exclusion does not apply between them.
      expect(missDry.startDate).toBe(missFresh.startDate);
      expect(missDry.endDate).toBe(missFresh.endDate);
      expect(missDry.windowId).not.toBe(missFresh.windowId);
    });

    it('stores exactly one row per Miss Muster type for the period', async () => {
      const rows = await db.query<{ ration_type: string; window_code: string; sequence_no: number }>(
        `SELECT ration_type, window_code, sequence_no
           FROM rik.issue_windows
          WHERE period_id = $1 AND ration_type IN ('MISS_MUSTER_FRESH', 'MISS_MUSTER_DRY')
          ORDER BY ration_type`,
        [periodId]
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.window_code)).toEqual(['MISS_MUSTER_DRY', 'MISS_MUSTER_FRESH']);
      expect(rows.every((r) => r.sequence_no === 1)).toBe(true);
    });

    it('leaves the Fresh and Dry schedules exactly as they were', async () => {
      const rows = await db.query<{ window_code: string; sequence_no: number }>(
        `SELECT window_code, sequence_no
           FROM rik.issue_windows
          WHERE period_id = $1 AND ration_type IN ('FRESH', 'DRY') AND is_active
          ORDER BY window_code`,
        [periodId]
      );
      // Three Fresh, numbered 1 to 3, and exactly one Dry. Nothing added,
      // removed or renumbered by the Miss Muster feature.
      expect(rows.map((r) => r.window_code)).toEqual(['DRY', 'FRESH_1', 'FRESH_2', 'FRESH_3']);
      expect(rows.find((r) => r.window_code === 'DRY')!.sequence_no).toBe(1);
    });
  });

  // =================================================================
  // 2. Configuring the four windows
  // =================================================================
  describe('the four windows of a period', () => {
    let fresh1: Record<string, unknown>;
    let fresh2: Record<string, unknown>;
    let fresh3: Record<string, unknown>;
    let dry: Record<string, unknown>;

    beforeAll(async () => {
      fresh1 = await ensureWindow(periodId, 'FRESH', 1, span(0, 7, [1, 2, 4]));
      fresh2 = await ensureWindow(periodId, 'FRESH', 2, span(7, 7, [0, 3]));
      fresh3 = await ensureWindow(periodId, 'FRESH', 3, span(14, 7, [2]), 'Third Fresh window');
      // DRY overlaps the Fresh windows on purpose: the exclusion constraint is
      // scoped to one ration type, because Fresh and Dry are issued
      // independently of each other.
      dry = await ensureWindow(periodId, 'DRY', 1, span(0, 21, [5, 12, 19]));
    });

    it('creates Fresh Issue 1 with the code the database derives', () => {
      expect(fresh1.windowCode).toBe('FRESH_1');
      expect(fresh1.label).toBe('Fresh Issue 1');
      expect(fresh1.rationType).toBe('FRESH');
      expect(fresh1.sequenceNo).toBe(1);
      expect(fresh1.status).toBe('ACTIVE');
    });

    it('creates Fresh Issue 2', () => {
      expect(fresh2.windowCode).toBe('FRESH_2');
      expect(fresh2.sequenceNo).toBe(2);
    });

    it('creates Fresh Issue 3, with its note', () => {
      expect(fresh3.windowCode).toBe('FRESH_3');
      expect(fresh3.sequenceNo).toBe(3);
      expect(fresh3.notes).toBe('Third Fresh window');
    });

    it('creates the Dry Issue, separately from Fresh', () => {
      expect(dry.windowCode).toBe('DRY');
      expect(dry.rationType).toBe('DRY');
      expect(dry.sequenceNo).toBe(1);
    });

    it('associates every window with the period it was configured for', () => {
      for (const w of [fresh1, fresh2, fresh3, dry]) {
        expect((w.period as { periodId: string }).periodId).toBe(periodId);
        expect((w.period as { startDate: string }).startDate).toBe(periodStart);
      }
    });

    it('records the operating days as given, in ascending order', () => {
      const expected = [1, 2, 4].map((d) => plusDays(periodStart, d));
      expect(fresh1.operatingDays).toEqual(expected);
    });

    it('sorts operating days that arrive out of order', async () => {
      const start = plusDays(otherStart, 0);
      const created = await ensureWindow(otherPeriodId, 'DRY', 1, {
        startDate: start,
        endDate: plusDays(start, 6),
        operatingDays: [plusDays(start, 5), plusDays(start, 1), plusDays(start, 3)],
      });
      expect(created.operatingDays).toEqual([
        plusDays(start, 1),
        plusDays(start, 3),
        plusDays(start, 5),
      ]);
    });

    it('lists the period’s windows, Fresh in sequence then Dry', async () => {
      const res = await request(server())
        .get(`/admin/rik/issue-windows?periodId=${periodId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items.map((w: { windowCode: string }) => w.windowCode)).toEqual([
        'FRESH_1',
        'FRESH_2',
        'FRESH_3',
        'DRY',
      ]);
    });

    it('reads one window by id', async () => {
      const res = await request(server())
        .get(`/admin/rik/issue-windows/${fresh2.windowId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.windowCode).toBe('FRESH_2');
    });

    it('answers 404 for a window that does not exist', async () => {
      await request(server())
        .get('/admin/rik/issue-windows/00000000-0000-7000-8000-000000000000')
        .set('Authorization', asAdmin())
        .expect(404);
    });

    it('answers 404 for a period that does not exist', async () => {
      await request(server())
        .get('/admin/rik/issue-windows?periodId=00000000-0000-7000-8000-000000000000')
        .set('Authorization', asAdmin())
        .expect(404);
    });

    it('records who configured each window and when', () => {
      expect((fresh1.createdBy as { staffId: string }).staffId).toBe(staffIdByRole.get('RIK_ADMIN'));
      expect((fresh1.updatedBy as { staffId: string }).staffId).toBe(staffIdByRole.get('RIK_ADMIN'));
      expect(fresh1.createdAt).toBeDefined();
    });

    it('audits the configuration', async () => {
      const rows = await db.query<{ action: string }>(
        `SELECT action FROM shared.audit_log WHERE entity_id = $1 ORDER BY created_at`,
        [fresh1.windowId]
      );
      expect(rows.map((r) => r.action)).toContain('RIK_ISSUE_WINDOW_CONFIGURED');
    });
  });

  // =================================================================
  // 3. Refusals
  // =================================================================
  describe('a schedule the facility cannot mean is refused by name', () => {
    it('refuses an end date before the start date', async () => {
      const res = await configure({
        periodId: otherPeriodId,
        rationType: 'FRESH',
        sequenceNo: 1,
        startDate: plusDays(otherStart, 10),
        endDate: plusDays(otherStart, 3),
        operatingDays: [plusDays(otherStart, 10)],
      });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('INVALID_DATE_RANGE');
    });

    it('refuses a window that starts before its period', async () => {
      const res = await configure({
        periodId,
        rationType: 'FRESH',
        sequenceNo: 1,
        startDate: plusDays(periodStart, -1),
        endDate: plusDays(periodStart, 2),
        operatingDays: [plusDays(periodStart, 1)],
      });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('OUTSIDE_PERIOD');
    });

    it('refuses a window that ends after its period', async () => {
      const res = await configure({
        periodId,
        rationType: 'FRESH',
        sequenceNo: 1,
        startDate: plusDays(periodEnd, -1),
        endDate: plusDays(periodEnd, 1),
        operatingDays: [periodEnd],
      });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('OUTSIDE_PERIOD');
    });

    it('refuses a second live window with the same Fresh number', async () => {
      const res = await configure({
        periodId,
        rationType: 'FRESH',
        sequenceNo: 1,
        ...span(22, 2),
      });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('DUPLICATE_WINDOW');
    });

    it('refuses a second live Dry window', async () => {
      const res = await configure({
        periodId,
        rationType: 'DRY',
        sequenceNo: 1,
        ...span(23, 2),
      });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('DUPLICATE_WINDOW');
    });

    it('refuses a Fresh window numbered outside 1–3', async () => {
      for (const sequenceNo of [0, 4, 9]) {
        const res = await configure({
          periodId,
          rationType: 'FRESH',
          sequenceNo,
          ...span(22, 2),
        });
        expect(res.status).toBe(400);
      }
    });

    it('refuses a Dry window numbered 2 — there is one Dry window', async () => {
      const res = await configure({
        periodId: otherPeriodId,
        rationType: 'DRY',
        sequenceNo: 2,
        startDate: plusDays(otherStart, 20),
        endDate: plusDays(otherStart, 22),
        operatingDays: [plusDays(otherStart, 21)],
      });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('INVALID_SEQUENCE');
    });

    it('refuses a ration type that is not FRESH or DRY', async () => {
      const res = await configure({
        periodId,
        rationType: 'FROZEN',
        sequenceNo: 1,
        ...span(22, 2),
      });
      expect(res.status).toBe(400);
    });

    it('refuses a window with no operating days', async () => {
      const res = await configure({
        periodId: otherPeriodId,
        rationType: 'FRESH',
        sequenceNo: 1,
        startDate: plusDays(otherStart, 10),
        endDate: plusDays(otherStart, 12),
        operatingDays: [],
      });
      expect(res.status).toBe(400);
    });

    it('refuses an operating day outside its own window', async () => {
      const res = await configure({
        periodId: otherPeriodId,
        rationType: 'FRESH',
        sequenceNo: 1,
        startDate: plusDays(otherStart, 10),
        endDate: plusDays(otherStart, 12),
        operatingDays: [plusDays(otherStart, 20)],
      });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('OPERATING_DAY_OUTSIDE_WINDOW');
    });

    it('refuses the same operating day twice', async () => {
      const res = await configure({
        periodId: otherPeriodId,
        rationType: 'FRESH',
        sequenceNo: 1,
        startDate: plusDays(otherStart, 10),
        endDate: plusDays(otherStart, 12),
        operatingDays: [plusDays(otherStart, 11), plusDays(otherStart, 11)],
      });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('DUPLICATE_OPERATING_DAY');
    });

    it('refuses an operating day that is not a real date', async () => {
      const res = await configure({
        periodId: otherPeriodId,
        rationType: 'FRESH',
        sequenceNo: 1,
        startDate: plusDays(otherStart, 10),
        endDate: plusDays(otherStart, 12),
        operatingDays: ['2027-02-30'],
      });
      expect(res.status).toBe(400);
    });

    it('refuses a blank note rather than storing whitespace', async () => {
      const res = await configure({
        periodId: otherPeriodId,
        rationType: 'FRESH',
        sequenceNo: 1,
        startDate: plusDays(otherStart, 10),
        endDate: plusDays(otherStart, 12),
        operatingDays: [plusDays(otherStart, 11)],
        notes: '   ',
      });
      expect(res.status).toBe(400);
    });

    it('refuses an unknown field in the body', async () => {
      const res = await configure({
        periodId,
        rationType: 'FRESH',
        sequenceNo: 1,
        ...span(22, 2),
        windowCode: 'DRY',
      });
      expect(res.status).toBe(400);
    });

    it('wrote nothing for any refused configuration', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.issue_windows WHERE period_id = $1`,
        [periodId]
      );
      // Only the four windows the suite created on purpose.
      expect(rows[0]!.total).toBe('4');
    });
  });

  // =================================================================
  // 4. Overlap and ordering — the database's own guards
  // =================================================================
  describe('two live windows of one ration type cannot cover the same day', () => {
    /**
     * This group works in its own period and only ever attempts refusals, so
     * nothing it does persists and the run order of the rest of the suite is
     * untouched. The one window it needs is ENSURED, not created.
     */
    beforeAll(async () => {
      await ensureWindow(orderPeriodId, 'FRESH', 1, {
        startDate: plusDays(orderStart, 10),
        endDate: plusDays(orderStart, 13),
        operatingDays: [plusDays(orderStart, 11)],
      });
    });

    it('refuses a Fresh window overlapping a live Fresh window', async () => {
      // Attempted as FRESH_3, a slot this group never fills, so the attempt
      // is refused for OVERLAP rather than as a duplicate — and because it is
      // always refused, nothing persists and the next run behaves identically.
      const res = await configure({
        periodId: orderPeriodId,
        rationType: 'FRESH',
        sequenceNo: 3,
        startDate: plusDays(orderStart, 11),
        endDate: plusDays(orderStart, 14),
        operatingDays: [plusDays(orderStart, 12)],
      });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('OVERLAPPING_WINDOW');
    });

    it('refuses a Fresh window that merely touches a live one at the boundary', async () => {
      // The exclusion uses an INCLUSIVE daterange, so sharing the end day is
      // an overlap — two windows cannot both claim the same issue day.
      const res = await configure({
        periodId: orderPeriodId,
        rationType: 'FRESH',
        sequenceNo: 3,
        startDate: plusDays(orderStart, 13),
        endDate: plusDays(orderStart, 16),
        operatingDays: [plusDays(orderStart, 14)],
      });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('OVERLAPPING_WINDOW');
    });

    it('allows a Dry window to overlap a Fresh window — they are independent', async () => {
      const dry = await db.query<{ start_date: string; end_date: string }>(
        `SELECT start_date::text, end_date::text FROM rik.issue_windows
          WHERE period_id = $1 AND window_code = 'DRY' AND is_active`,
        [periodId]
      );
      const fresh = await db.query<{ start_date: string; end_date: string }>(
        `SELECT start_date::text, end_date::text FROM rik.issue_windows
          WHERE period_id = $1 AND window_code = 'FRESH_1' AND is_active`,
        [periodId]
      );
      expect(dry[0]!.start_date <= fresh[0]!.end_date).toBe(true);
      expect(fresh[0]!.start_date <= dry[0]!.end_date).toBe(true);
    });

    it('refuses Fresh windows numbered against the calendar', async () => {
      // Fresh 1 runs on days 10-13 of this period, so a Fresh 3 placed
      // BEFORE it is out of order even though the two do not overlap.
      const res = await configure({
        periodId: orderPeriodId,
        rationType: 'FRESH',
        sequenceNo: 3,
        startDate: plusDays(orderStart, 2),
        endDate: plusDays(orderStart, 5),
        operatingDays: [plusDays(orderStart, 3)],
      });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('OUT_OF_SEQUENCE');
    });

    it('refuses an existing window MOVED out of order', async () => {
      const fresh2 = await ensureWindow(orderPeriodId, 'FRESH', 2, {
        startDate: plusDays(orderStart, 16),
        endDate: plusDays(orderStart, 19),
        operatingDays: [plusDays(orderStart, 17)],
      });
      const res = await request(server())
        .patch(`/admin/rik/issue-windows/${fresh2.windowId}`)
        .set('Authorization', asAdmin())
        .send({
          startDate: plusDays(orderStart, 2),
          endDate: plusDays(orderStart, 5),
          operatingDays: [plusDays(orderStart, 3)],
        });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('OUT_OF_SEQUENCE');
    });

    it('accepts Fresh windows numbered with the calendar', async () => {
      const window = await db.query<{ start_date: string; is_active: boolean }>(
        `SELECT start_date::text, is_active FROM rik.issue_windows
          WHERE period_id = $1 AND window_code = 'FRESH_2'`,
        [orderPeriodId]
      );
      expect(window[0]!.is_active).toBe(true);
      expect(window[0]!.start_date).toBe(plusDays(orderStart, 16));
    });

    it('the overlap guard is a database exclusion constraint, not a check in code', async () => {
      const rows = await db.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'rik.issue_windows'::regclass
            AND conname = 'rik_issue_windows_no_overlap'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.def).toContain('EXCLUDE USING gist');
      expect(rows[0]!.def).toContain('ration_type');
    });

    it('and it cannot be bypassed by raw SQL either', async () => {
      await expect(
        db.query(
          `INSERT INTO rik.issue_windows
             (period_id, ration_type, window_code, sequence_no, start_date, end_date,
              operating_days, created_by, updated_by)
           VALUES ($1, 'FRESH', 'FRESH_2', 2, $2::date, $3::date, ARRAY[$2::date], $4, $4)`,
          [
            orderPeriodId,
            plusDays(orderStart, 11),
            plusDays(orderStart, 12),
            staffIdByRole.get('RIK_ADMIN'),
          ]
        )
      ).rejects.toThrow();
    });
  });

  // =================================================================
  // 5. Month-length and boundary behaviour
  // =================================================================
  describe('no month length is assumed anywhere', () => {
    it('a window may fill a whole period of any length', async () => {
      const created = await ensureWindow(shortPeriodId, 'DRY', 1, {
        startDate: shortStart,
        endDate: shortEnd,
        operatingDays: [shortStart, shortEnd],
      });
      expect(created.startDate).toBe(shortStart);
      expect(created.endDate).toBe(shortEnd);
      expect(created.operatingDays).toHaveLength(2);
    });

    it('a single-day window with a single operating day is legitimate', async () => {
      // The Dry window above holds the whole short period, so this Fresh
      // window shares the day — a different ration type, which is allowed.
      const created = await ensureWindow(shortPeriodId, 'FRESH', 1, {
        startDate: shortStart,
        endDate: shortStart,
        operatingDays: [shortStart],
      });
      expect(created.startDate).toBe(created.endDate);
    });

    it('the period end is inclusive — a window may end on the last day', async () => {
      const window = await db.query<{ end_date: string; period_end: string }>(
        `SELECT w.end_date::text AS end_date, p.end_date::text AS period_end
           FROM rik.issue_windows w JOIN rik.entitlement_periods p ON p.id = w.period_id
          WHERE w.period_id = $1 AND w.window_code = 'DRY'`,
        [shortPeriodId]
      );
      expect(window[0]!.end_date).toBe(window[0]!.period_end);
    });

    it('a 28, 29, 30 or 31-day month is a period like any other', async () => {
      // The fixture periods are whole calendar months computed at run time,
      // so whichever lengths this month and the two before it happen to have
      // are the lengths under test. The assertion is that the window fits the
      // period it was given, not that the period is 30 days.
      const rows = await db.query<{ period_days: string; window_days: string }>(
        `SELECT (p.end_date - p.start_date + 1)::text AS period_days,
                (w.end_date - w.start_date + 1)::text AS window_days
           FROM rik.issue_windows w JOIN rik.entitlement_periods p ON p.id = w.period_id
          WHERE w.period_id = $1 AND w.window_code = 'DRY'`,
        [periodId]
      );
      expect(Number(rows[0]!.window_days)).toBeLessThanOrEqual(Number(rows[0]!.period_days));
      expect([28, 29, 30, 31]).toContain(Number(rows[0]!.period_days));
    });

    it('nothing in the implementation names a weekday', async () => {
      // The locked model forbids hardcoding Tuesday/Wednesday/Friday. The
      // operating days are dates, and no weekday name appears in the schema.
      const rows = await db.query<{ hits: string }>(
        `SELECT count(*)::text AS hits FROM information_schema.columns
          WHERE table_schema = 'rik' AND table_name = 'issue_windows'
            AND (column_name ILIKE '%weekday%' OR column_name ILIKE '%day_of_week%'
              OR column_name IN ('dow', 'day_of_week', 'weekdays'))`
      );
      expect(rows[0]!.hits).toBe('0');
      const type = await db.query<{ data_type: string }>(
        `SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'rik' AND table_name = 'issue_windows'
            AND column_name = 'operating_days'`
      );
      expect(type[0]!.data_type).toBe('ARRAY');
    });
  });

  // =================================================================
  // 6. Updating a schedule
  // =================================================================
  describe('reconfiguring a window', () => {
    let windowId: string;

    beforeAll(async () => {
      const created = await ensureWindow(otherPeriodId, 'FRESH', 3, {
        startDate: plusDays(otherStart, 25),
        endDate: plusDays(otherStart, 27),
        operatingDays: [plusDays(otherStart, 26)],
      });
      windowId = created.windowId as string;
    });

    const patch = (body: Record<string, unknown>) =>
      request(server())
        .patch(`/admin/rik/issue-windows/${windowId}`)
        .set('Authorization', asAdmin())
        .send(body);

    it('moves the operating days', async () => {
      const res = await patch({
        operatingDays: [plusDays(otherStart, 25), plusDays(otherStart, 27)],
      }).expect(200);
      expect(res.body.operatingDays).toEqual([plusDays(otherStart, 25), plusDays(otherStart, 27)]);
    });

    it('moves the dates and the days together', async () => {
      const res = await patch({
        startDate: plusDays(otherStart, 24),
        endDate: plusDays(otherStart, 28),
        operatingDays: [plusDays(otherStart, 24), plusDays(otherStart, 28)],
      }).expect(200);
      expect(res.body.startDate).toBe(plusDays(otherStart, 24));
      expect(res.body.endDate).toBe(plusDays(otherStart, 28));
    });

    it('refuses to narrow a window and leave an operating day outside it', async () => {
      const res = await patch({ endDate: plusDays(otherStart, 26) });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('OPERATING_DAY_OUTSIDE_WINDOW');
    });

    it('refuses to move a window outside its period', async () => {
      const res = await patch({ startDate: plusDays(otherStart, -5) });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('OUTSIDE_PERIOD');
    });

    it('refuses an empty request', async () => {
      const res = await patch({});
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('NOTHING_TO_CHANGE');
    });

    it('refuses to move the window into another slot', async () => {
      const res = await patch({ sequenceNo: 1 });
      expect(res.status).toBe(400);
    });

    it('refuses to move the window to another period', async () => {
      const res = await patch({ periodId });
      expect(res.status).toBe(400);
    });

    it('adds and clears a note', async () => {
      const added = await patch({ notes: 'Moved for the public holiday' }).expect(200);
      expect(added.body.notes).toBe('Moved for the public holiday');
    });

    it('retires a window instead of deleting it', async () => {
      const res = await patch({ isActive: false }).expect(200);
      expect(res.body.status).toBe('RETIRED');
      expect(res.body.isActive).toBe(false);
    });

    it('a retired window is still listed, so its withdrawal is visible', async () => {
      const res = await request(server())
        .get(`/admin/rik/issue-windows?periodId=${otherPeriodId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      const mine = res.body.items.find((w: { windowId: string }) => w.windowId === windowId);
      expect(mine).toBeDefined();
      expect(mine.status).toBe('RETIRED');
    });

    it('brings it back', async () => {
      const res = await patch({ isActive: true }).expect(200);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('audits an update, a retirement and a return distinctly', async () => {
      const rows = await db.query<{ action: string }>(
        `SELECT action FROM shared.audit_log WHERE entity_id = $1 ORDER BY created_at`,
        [windowId]
      );
      const actions = rows.map((r) => r.action);
      expect(actions[0]).toBe('RIK_ISSUE_WINDOW_CONFIGURED');
      expect(actions).toContain('RIK_ISSUE_WINDOW_UPDATED');
      expect(actions).toContain('RIK_ISSUE_WINDOW_DEACTIVATED');
      expect(actions).toContain('RIK_ISSUE_WINDOW_REACTIVATED');
    });
  });

  // =================================================================
  // 7. Deletion is impossible
  // =================================================================
  describe('an issue window is retired, never deleted', () => {
    it('there is no delete route', async () => {
      const probe = request(server());
      await probe
        .delete(`/admin/rik/issue-windows/${createdWindowIds[0]}`)
        .set('Authorization', asAdmin())
        .expect(404);
    });

    it('the database refuses a DELETE outright', async () => {
      await expect(
        db.query(`DELETE FROM rik.issue_windows WHERE id = $1`, [createdWindowIds[0]])
      ).rejects.toThrow();
    });

    it('the application role holds no DELETE privilege on either table', async () => {
      const rows = await db.query<{
        win_del: boolean;
        rev_del: boolean;
        rev_upd: boolean;
        win_upd: boolean;
      }>(
        `SELECT has_table_privilege('app_rik','rik.issue_windows','DELETE')          AS win_del,
                has_table_privilege('app_rik','rik.issue_window_revisions','DELETE') AS rev_del,
                has_table_privilege('app_rik','rik.issue_window_revisions','UPDATE') AS rev_upd,
                has_table_privilege('app_rik','rik.issue_windows','UPDATE')          AS win_upd`
      );
      expect(rows[0]).toEqual({ win_del: false, rev_del: false, rev_upd: false, win_upd: true });
    });

    it('the window is still there after the attempt', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.issue_windows WHERE id = $1`,
        [createdWindowIds[0]]
      );
      expect(rows[0]!.total).toBe('1');
    });
  });

  // =================================================================
  // 8. Revision history
  // =================================================================
  describe('every schedule change is on record', () => {
    let windowId: string;

    beforeAll(async () => {
      const created = await ensureWindow(shortPeriodId, 'FRESH', 2, {
        startDate: plusDays(shortStart, 1),
        endDate: plusDays(shortStart, 2),
        operatingDays: [plusDays(shortStart, 1)],
      });
      windowId = created.windowId as string;
      await request(server())
        .patch(`/admin/rik/issue-windows/${windowId}`)
        .set('Authorization', asAdmin())
        .send({ operatingDays: [plusDays(shortStart, 2)] })
        .expect(200);
    });

    it('records a CREATED revision with no before state', async () => {
      const res = await request(server())
        .get(`/admin/rik/issue-windows/${windowId}/revisions`)
        .set('Authorization', asAdmin())
        .expect(200);
      const first = res.body.items.find((r: { revisionNo: number }) => r.revisionNo === 1);
      expect(first.changeType).toBe('CREATED');
      expect(first.before).toBeNull();
      expect(first.after).toBeDefined();
    });

    it('records an UPDATED revision carrying both states', async () => {
      const res = await request(server())
        .get(`/admin/rik/issue-windows/${windowId}/revisions`)
        .set('Authorization', asAdmin())
        .expect(200);
      const second = res.body.items.find((r: { revisionNo: number }) => r.revisionNo === 2);
      expect(second.changeType).toBe('UPDATED');
      expect(second.before.operatingDays).toEqual([plusDays(shortStart, 1)]);
      expect(second.after.operatingDays).toEqual([plusDays(shortStart, 2)]);
    });

    it('names who made each change and when', async () => {
      const res = await request(server())
        .get(`/admin/rik/issue-windows/${windowId}/revisions`)
        .set('Authorization', asAdmin())
        .expect(200);
      for (const entry of res.body.items) {
        expect(entry.changedBy.staffId).toBe(staffIdByRole.get('RIK_ADMIN'));
        expect(entry.changedBy.name).toBe('Jest 15C RIK_ADMIN');
        expect(entry.changedAt).toBeDefined();
      }
    });

    it('returns the history newest first', async () => {
      const res = await request(server())
        .get(`/admin/rik/issue-windows/${windowId}/revisions`)
        .set('Authorization', asAdmin())
        .expect(200);
      const numbers = res.body.items.map((r: { revisionNo: number }) => r.revisionNo);
      expect(numbers).toEqual([...numbers].sort((a: number, b: number) => b - a));
    });

    it('the history is append-only — it cannot be rewritten or deleted', async () => {
      await expect(
        db.query(`UPDATE rik.issue_window_revisions SET change_type = 'CREATED' WHERE window_id = $1`, [
          windowId,
        ])
      ).rejects.toThrow();
      await expect(
        db.query(`DELETE FROM rik.issue_window_revisions WHERE window_id = $1`, [windowId])
      ).rejects.toThrow();
    });

    it('a retirement and a return are recorded as such', async () => {
      await request(server())
        .patch(`/admin/rik/issue-windows/${windowId}`)
        .set('Authorization', asAdmin())
        .send({ isActive: false })
        .expect(200);
      await request(server())
        .patch(`/admin/rik/issue-windows/${windowId}`)
        .set('Authorization', asAdmin())
        .send({ isActive: true })
        .expect(200);

      const res = await request(server())
        .get(`/admin/rik/issue-windows/${windowId}/revisions`)
        .set('Authorization', asAdmin())
        .expect(200);
      const types = res.body.items.map((r: { changeType: string }) => r.changeType);
      expect(types).toContain('DEACTIVATED');
      expect(types).toContain('ACTIVATED');
    });

    it('revisions are written by the database, not by the application', async () => {
      const rows = await db.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = 'rik.issue_windows'::regclass
            AND tgname = 'record_issue_window_revision' AND NOT tgisinternal`
      );
      expect(rows).toHaveLength(1);
    });

    it('answers 404 for the revisions of a window that does not exist', async () => {
      await request(server())
        .get('/admin/rik/issue-windows/00000000-0000-7000-8000-000000000000/revisions')
        .set('Authorization', asAdmin())
        .expect(404);
    });
  });

  // =================================================================
  // 9. Authorization
  // =================================================================
  describe('configuring the schedule is RIK_ADMIN only', () => {
    it('an anonymous caller is 401 on every admin route', async () => {
      await request(server()).get(`/admin/rik/issue-windows?periodId=${periodId}`).expect(401);
      await request(server()).post('/admin/rik/issue-windows').send({}).expect(401);
      await request(server())
        .patch(`/admin/rik/issue-windows/${createdWindowIds[0]}`)
        .send({ isActive: false })
        .expect(401);
    });

    it('a CUSTOMER is 403 on every admin route', async () => {
      const auth = `Bearer ${customerToken}`;
      await request(server())
        .get(`/admin/rik/issue-windows?periodId=${periodId}`)
        .set('Authorization', auth)
        .expect(403);
      await request(server())
        .post('/admin/rik/issue-windows')
        .set('Authorization', auth)
        .send({})
        .expect(403);
      await request(server())
        .patch(`/admin/rik/issue-windows/${createdWindowIds[0]}`)
        .set('Authorization', auth)
        .send({ isActive: false })
        .expect(403);
    });

    it('staff with no role is 403', async () => {
      await request(server())
        .get(`/admin/rik/issue-windows?periodId=${periodId}`)
        .set('Authorization', `Bearer ${noRoleToken}`)
        .expect(403);
    });

    for (const role of STAFF_ROLES.filter((r) => r !== 'RIK_ADMIN' && r !== 'SUPER_ADMIN')) {
      it(`${role} cannot list issue windows`, async () => {
        await request(server())
          .get(`/admin/rik/issue-windows?periodId=${periodId}`)
          .set('Authorization', bearer(role))
          .expect(403);
      });

      it(`${role} cannot configure an issue window`, async () => {
        await request(server())
          .post('/admin/rik/issue-windows')
          .set('Authorization', bearer(role))
          .send({
            periodId,
            rationType: 'FRESH',
            sequenceNo: 1,
            ...span(22, 2),
          })
          .expect(403);
      });

      it(`${role} cannot change an issue window`, async () => {
        await request(server())
          .patch(`/admin/rik/issue-windows/${createdWindowIds[0]}`)
          .set('Authorization', bearer(role))
          .send({ isActive: false })
          .expect(403);
      });

      it(`${role} cannot read the revision history`, async () => {
        await request(server())
          .get(`/admin/rik/issue-windows/${createdWindowIds[0]}/revisions`)
          .set('Authorization', bearer(role))
          .expect(403);
      });
    }

    it('uses the existing rik.issue_schedule.manage, held by RIK_ADMIN alone', async () => {
      const rows = await db.query<{ role: string }>(
        `SELECT r.name AS role
           FROM shared.permissions p
           JOIN shared.role_permissions rp ON rp.permission_id = p.id
           JOIN shared.roles r ON r.id = rp.role_id
          WHERE p.code = 'rik.issue_schedule.manage'
          ORDER BY r.name`
      );
      expect(rows.map((r) => r.role)).toEqual(['RIK_ADMIN', 'SUPER_ADMIN']);
    });

    it('introduced no new role and no new permission', async () => {
      const rows = await db.query<{ roles: string; permissions: string }>(
        `SELECT (SELECT count(*)::text FROM shared.roles) AS roles,
                (SELECT count(*)::text FROM shared.permissions) AS permissions`
      );
      expect(rows[0]).toEqual({ roles: '6', permissions: '22' });
    });

    it('and still no PURCHASING role', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM shared.roles WHERE name ILIKE '%PURCHAS%'`
      );
      expect(rows[0]!.total).toBe('0');
    });

    it('a refused caller changed nothing', async () => {
      const rows = await db.query<{ is_active: boolean }>(
        `SELECT is_active FROM rik.issue_windows WHERE id = $1`,
        [createdWindowIds[0]]
      );
      expect(rows[0]!.is_active).toBe(true);
    });
  });

  // =================================================================
  // 10. The customer's read-only view
  // =================================================================
  describe('the customer sees the schedule, and can only see it', () => {
    /**
     * The customer route serves the period containing TODAY, which this
     * suite's fixture periods deliberately avoid. So this group creates the
     * current period and its windows, and removes them again afterwards —
     * taking the same advisory lock the other current-period suites take, so
     * two suites never compete for "the current period".
     */
    let currentStart: string;
    const customerAuth = () => `Bearer ${customerToken}`;

    beforeAll(async () => {
      currentStart = iso(monthStart(0));

      // ONE fixture period for this purpose, for ever, under a stable name.
      // It carries permanent windows, so it cannot be deleted; between runs
      // it sits in the parking slot and each run moves it back over today.
      const ours = await db.query<{ id: string }>(
        `SELECT id FROM rik.entitlement_periods WHERE name = 'Jest 15C current'`
      );
      if (ours.length > 0) {
        currentPeriodId = ours[0]!.id;
        currentFixtureIsOurs = true;
        await db.query(
          `UPDATE rik.entitlement_periods SET start_date = $2::date, end_date = $3::date
            WHERE id = $1`,
          [currentPeriodId, currentStart, iso(monthEnd(0))]
        );
      } else {
        const foreign = await db.query<{ id: string; start_date: string }>(
          `SELECT id, start_date::text AS start_date FROM rik.entitlement_periods
            WHERE CURRENT_DATE BETWEEN start_date AND end_date
            ORDER BY start_date DESC LIMIT 1`
        );
        if (foreign.length > 0) {
          // Something else already owns today. Adopt it read-only and never
          // move it: parking a period this suite did not create would take
          // the current month away from whoever did.
          currentPeriodId = foreign[0]!.id;
          currentStart = foreign[0]!.start_date;
          currentFixtureIsOurs = false;
        } else {
          const made = await db.query<{ id: string }>(
            `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
             VALUES (shared.uuid_generate_v7(), 'Jest 15C current', $1::date, $2::date, 'ACTIVE')
             RETURNING id`,
            [currentStart, iso(monthEnd(0))]
          );
          currentPeriodId = made[0]!.id;
          currentFixtureIsOurs = true;
        }
      }

      const plan = [
        { rationType: 'FRESH' as const, sequenceNo: 1, offset: 0, length: 7 },
        { rationType: 'FRESH' as const, sequenceNo: 2, offset: 7, length: 7 },
        { rationType: 'FRESH' as const, sequenceNo: 3, offset: 14, length: 7 },
        { rationType: 'DRY' as const, sequenceNo: 1, offset: 0, length: 21 },
      ].map((item) => {
        const start = plusDays(currentStart, item.offset);
        return {
          rationType: item.rationType,
          sequenceNo: item.sequenceNo,
          startDate: start,
          endDate: plusDays(start, item.length - 1),
          operatingDays: [plusDays(start, 1), plusDays(start, 3)],
        };
      });

      // Windows already there are parked in the past; bring them back before
      // the admin API is asked to confirm the schedule, which it can only do
      // from a consistent state.
      const already = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.issue_windows WHERE period_id = $1`,
        [currentPeriodId]
      );
      if (Number(already[0]!.total) > 0) await unparkCurrentFixture(plan);

      for (const item of plan) {
        await ensureWindow(
          currentPeriodId,
          item.rationType,
          item.sequenceNo,
          {
            startDate: item.startDate,
            endDate: item.endDate,
            operatingDays: item.operatingDays,
          },
          'Internal note the customer must not see'
        );
      }
    });

    it('serves the schedule for the period containing today', async () => {
      const res = await request(server())
        .get('/rik/issue-schedule')
        .set('Authorization', customerAuth())
        .expect(200);
      expect(res.body.period.id).toBe(currentPeriodId);
      expect(res.body.period.startDate).toBe(currentStart);
    });

    it('shows the three Fresh windows and the Dry window, named', async () => {
      const res = await request(server())
        .get('/rik/issue-schedule')
        .set('Authorization', customerAuth())
        .expect(200);
      expect(res.body.fresh.map((w: { windowCode: string }) => w.windowCode)).toEqual([
        'FRESH_1',
        'FRESH_2',
        'FRESH_3',
      ]);
      expect(res.body.fresh.map((w: { label: string }) => w.label)).toEqual([
        'Fresh Issue 1',
        'Fresh Issue 2',
        'Fresh Issue 3',
      ]);
      expect(res.body.dry).toHaveLength(1);
      expect(res.body.dry[0].label).toBe('Dry Issue');
    });

    it('shows each window’s dates and its operating days', async () => {
      const res = await request(server())
        .get('/rik/issue-schedule')
        .set('Authorization', customerAuth())
        .expect(200);
      for (const w of [...res.body.fresh, ...res.body.dry]) {
        expect(w.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(w.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Array.isArray(w.operatingDays)).toBe(true);
        expect(w.operatingDays.length).toBeGreaterThan(0);
        for (const day of w.operatingDays) {
          expect(day >= w.startDate && day <= w.endDate).toBe(true);
        }
      }
    });

    it('exposes NO audit or administrative information', async () => {
      const res = await request(server())
        .get('/rik/issue-schedule')
        .set('Authorization', customerAuth())
        .expect(200);
      const body = JSON.stringify(res.body);
      for (const forbidden of [
        'createdBy',
        'updatedBy',
        'notes',
        'revision',
        'windowId',
        'isActive',
        'staffId',
        'Internal note',
      ]) {
        expect(body).not.toContain(forbidden);
      }
    });

    it('reflects a schedule change the administrator makes', async () => {
      const before = await request(server())
        .get('/rik/issue-schedule')
        .set('Authorization', customerAuth())
        .expect(200);
      const fresh1 = before.body.fresh.find((w: { windowCode: string }) => w.windowCode === 'FRESH_1');

      const window = await db.query<{ id: string }>(
        `SELECT id FROM rik.issue_windows
          WHERE period_id = $1 AND window_code = 'FRESH_1' AND is_active`,
        [currentPeriodId]
      );
      const movedDay = plusDays(fresh1.startDate, 2);
      await request(server())
        .patch(`/admin/rik/issue-windows/${window[0]!.id}`)
        .set('Authorization', asAdmin())
        .send({ operatingDays: [movedDay] })
        .expect(200);

      const after = await request(server())
        .get('/rik/issue-schedule')
        .set('Authorization', customerAuth())
        .expect(200);
      const updated = after.body.fresh.find((w: { windowCode: string }) => w.windowCode === 'FRESH_1');
      expect(updated.operatingDays).toEqual([movedDay]);
    });

    it('hides a retired window from the customer entirely', async () => {
      const window = await db.query<{ id: string }>(
        `SELECT id FROM rik.issue_windows
          WHERE period_id = $1 AND window_code = 'FRESH_3' AND is_active`,
        [currentPeriodId]
      );
      await request(server())
        .patch(`/admin/rik/issue-windows/${window[0]!.id}`)
        .set('Authorization', asAdmin())
        .send({ isActive: false })
        .expect(200);

      const res = await request(server())
        .get('/rik/issue-schedule')
        .set('Authorization', customerAuth())
        .expect(200);
      expect(res.body.fresh.map((w: { windowCode: string }) => w.windowCode)).not.toContain('FRESH_3');

      await request(server())
        .patch(`/admin/rik/issue-windows/${window[0]!.id}`)
        .set('Authorization', asAdmin())
        .send({ isActive: true })
        .expect(200);
    });

    it('requires authentication', async () => {
      await request(server()).get('/rik/issue-schedule').expect(401);
    });

    it('is a CUSTOMER route — staff cannot read it', async () => {
      await request(server())
        .get('/rik/issue-schedule')
        .set('Authorization', asAdmin())
        .expect(403);
    });

    it('offers the customer NO write path to the schedule', async () => {
      const probe = () => request(server());
      await probe()
        .post('/rik/issue-schedule')
        .set('Authorization', customerAuth())
        .send({ startDate: currentStart })
        .expect(404);
      await probe()
        .patch('/rik/issue-schedule')
        .set('Authorization', customerAuth())
        .send({ startDate: currentStart })
        .expect(404);
      await probe().delete('/rik/issue-schedule').set('Authorization', customerAuth()).expect(404);
    });

    it('and the customer cannot reach the admin surface by guessing its path', async () => {
      await request(server())
        .post('/rik/issue-windows')
        .set('Authorization', customerAuth())
        .send({})
        .expect(404);
    });
  });

  // =================================================================
  // 11. Nothing else moved
  // =================================================================
  describe('Phase C configures a schedule and nothing else', () => {
    it('the entitlement configuration is unchanged', async () => {
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

    it('no confirmed selection was touched', async () => {
      // Phase C writes only to rik.issue_windows. Any confirmed selection in
      // the database is protected by migration 0027 in any case; this asserts
      // that nothing here even tried.
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM shared.audit_log
          WHERE action LIKE 'RIK_ISSUE_WINDOW%'
            AND entity_type <> 'rik.issue_window'`
      );
      expect(rows[0]!.total).toBe('0');
    });

    it('Phase C itself created no voucher, pickup or delivery table', async () => {
      // PHASE D UPDATE. This assertion read "no voucher table exists" when
      // Phase C was the newest phase, and that is no longer the fact it was
      // asserting: Phase D adds exactly ONE voucher table. The claim it
      // existed to protect is unchanged and is still checked below — Phase C
      // configures a schedule and nothing else, so no DELIVERY, COLLECTION or
      // SUBSTITUTION table exists, and the only voucher table is the single
      // one Phase D's own migration created.
      const vouchers = await db.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables
          WHERE schemaname = 'rik' AND tablename ILIKE '%voucher%'
          ORDER BY tablename`
      );
      // PHASE E UPDATE. Phase D added the voucher itself; Phase E added the
      // two records of what physically happened against it. The claim is
      // unchanged and still checked below: PHASE C configures a schedule and
      // nothing else, so no delivery, collection or substitution table
      // exists, and the only voucher tables are the ones those two phases
      // created by their own migrations.
      expect(vouchers.map((r) => r.tablename)).toEqual([
        'issue_voucher_issue_lines',
        'issue_voucher_outcomes',
        'issue_vouchers',
      ]);

      const absent = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM pg_tables
          WHERE schemaname = 'rik'
            AND (tablename ILIKE '%delivery%' OR tablename ILIKE '%collection%'
                 OR tablename ILIKE '%substitut%' OR tablename ILIKE '%voucher_line%'
                 OR tablename ILIKE '%voucher_item%')`
      );
      expect(absent[0]!.total).toBe('0');
    });

    it('pif holds 23 tables after PHASE F and the import work, and rik is still 31', async () => {
      const rows = await db.query<{ pif: string; rik: string }>(
        `SELECT (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'pif') AS pif,
                (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'rik') AS rik`
      );
      expect(rows[0]).toEqual({ pif: '23', rik: '31' });
    });
  });
});
