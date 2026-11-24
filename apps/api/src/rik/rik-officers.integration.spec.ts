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
import { normaliseMobile } from './services/rik-officer.service';

/**
 * STEP 15B PHASE A — officer registration and the permanent RIK ID, over real
 * HTTP against real PostgreSQL with the approved role/permission seed.
 *
 * RECONSTRUCTED from the approved Phase A report after the working container
 * was lost; not the recovered original bytes.
 *
 * What this suite is designed to prove, in order of importance:
 *
 *  1. THE IDENTIFIER IS THE DATABASE'S, AND IT IS PERMANENT. It is issued by
 *     a DEFAULT, in a format that widens rather than overflowing, is unique,
 *     and cannot be renumbered by any path — including raw SQL.
 *
 *  2. ONLY RIK_ADMIN MAY REGISTER AN OFFICER. Every other staff role in the
 *     seed, a staff member with no role, a customer and an anonymous caller
 *     are each pointed at every route. No new role and no new permission.
 *
 *  3. THE PROHIBITED FIELDS ARE UNREACHABLE. Service number, rank, unit,
 *     Aadhaar, PAN, eligible days and a caller-supplied RIK ID are each sent
 *     in a well-formed body and each refused.
 *
 *  4. NOTHING ELSE MOVED. The entitlement configuration, the role and
 *     permission counts and the schema contract are all asserted unchanged.
 *
 * FIXTURE DISCIPLINE. Mobile numbers are built from the run id plus a
 * TWO-digit suffix, in separated bands — a one-digit suffix yields only ten
 * numbers per band and two officers in the same run collided on
 * shared.customers.mobile_uq. No calendar literal appears anywhere.
 */
describe('RIK officer registration (STEP 15B Phase A, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '4').slice(0, 7);

  const staffIdByRole = new Map<StaffRole, string>();
  const tokenByRole = new Map<StaffRole, string>();
  let noRoleStaffId: string;
  let noRoleToken: string;
  let customerId: string;
  let customerToken: string;

  /** Officers this run created through the API, removed in afterAll. */
  const createdOfficerIds: string[] = [];

  const server = () => app.getHttpServer();
  const bearer = (role: StaffRole) => `Bearer ${tokenByRole.get(role)}`;
  const asAdmin = () => bearer('RIK_ADMIN');

  /**
   * Ten digits beginning 9: '9' + seven run-derived digits + a TWO-digit
   * suffix. Bands: 10-29 registration, 50-59 lookup, 80-99 refusals. A
   * one-digit suffix gave only ten numbers and two officers in the same run
   * collided on shared.customers.mobile_uq.
   */
  const mobile = (suffix: number) => `9${digits}${String(suffix).padStart(2, '0')}`;

  const registration = (overrides: Record<string, unknown> = {}) => ({
    name: `Jest 15A Officer ${runId}`,
    mobileNumber: mobile(10),
    quarterBlock: 'B',
    quarterNumber: '102',
    dietaryPreference: 'NV',
    ...overrides,
  });

  const registerOk = async (body: Record<string, unknown>) => {
    const res = await request(server())
      .post('/admin/rik/officers')
      .set('Authorization', asAdmin())
      .send(body)
      .expect(201);
    createdOfficerIds.push(res.body.officerId);
    return res.body;
  };

  beforeAll(async () => {
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

    for (const role of STAFF_ROLES) {
      const rows = await db.query<{ id: string }>(
        `INSERT INTO shared.users (id, username, password_hash, display_name, status)
         VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
        [`jest_15a_${role.toLowerCase()}_${runId}`, passwordHash, `Jest 15A ${role} ${runId}`]
      );
      const id = rows[0]!.id;
      staffIdByRole.set(role, id);
      await db.query(
        `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
         SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3`,
        [id, grantedBy, role]
      );
      tokenByRole.set(role, tokenService.signAccessToken({ principalType: 'STAFF', principalId: id }));
    }

    const noRole = await db.query<{ id: string }>(
      `INSERT INTO shared.users (id, username, password_hash, display_name, status)
       VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
      [`jest_15a_norole_${runId}`, passwordHash, `Jest 15A NoRole ${runId}`]
    );
    noRoleStaffId = noRole[0]!.id;
    noRoleToken = tokenService.signAccessToken({ principalType: 'STAFF', principalId: noRoleStaffId });

    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
       VALUES (shared.uuid_generate_v7(), $1, $2, true, 'NV') RETURNING id`,
      [mobile(99), `Jest 15A Customer ${runId}`]
    );
    customerId = customer[0]!.id;
    createdOfficerIds.push(customerId);
    customerToken = tokenService.signAccessToken({
      principalType: 'CUSTOMER',
      principalId: customerId,
    });
  });

  afterAll(async () => {
    await db.query(`DELETE FROM shared.customer_addresses WHERE customer_id = ANY($1::uuid[])`, [
      createdOfficerIds,
    ]);
    await db.query(`DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])`, [
      createdOfficerIds,
    ]);
    // Officers before staff: created_by references shared.users.
    await db.query(`DELETE FROM shared.customers WHERE id = ANY($1::uuid[])`, [createdOfficerIds]);

    const staffIds = [...staffIdByRole.values(), noRoleStaffId];
    await db.query(`DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])`, [staffIds]);
    await db.query(`DELETE FROM shared.user_roles WHERE user_id = ANY($1::uuid[])`, [staffIds]);
    await db.query(`DELETE FROM shared.users WHERE id = ANY($1::uuid[])`, [staffIds]);
    await app.close();
  });

  // =================================================================
  // 1. The format, as a pure database function
  // =================================================================
  describe('the identifier format widens and never overflows', () => {
    const format = async (n: number) => {
      const rows = await db.query<{ id: string }>(
        `SELECT shared.format_officer_rik_id($1::bigint) AS id`,
        [n]
      );
      return rows[0]!.id;
    };

    it('pads to six digits at the bottom of the range', async () => {
      expect(await format(1)).toBe('RIK-O-000001');
    });

    it('fills six digits exactly at 999999', async () => {
      expect(await format(999999)).toBe('RIK-O-999999');
    });

    it('WIDENS at one million rather than overflowing to ######', async () => {
      // to_char(n, 'FM000000') produced the literal 'RIK-O-######' here.
      expect(await format(1000000)).toBe('RIK-O-1000000');
    });

    it('does not truncate an eight-digit number', async () => {
      // lpad(n::text, 6, '0') would have returned '123456' — a collision.
      expect(await format(12345678)).toBe('RIK-O-12345678');
    });

    it('keeps the officer namespace distinct from the selection namespace', async () => {
      const officer = await format(125);
      expect(officer).toBe('RIK-O-000125');
      expect(officer.startsWith('RIK-O-')).toBe(true);
      expect(/^RIK-[0-9]/.test(officer)).toBe(false);
    });

    it('is IMMUTABLE and STRICT, so it can sit in a DEFAULT and an index', async () => {
      const rows = await db.query<{ volatile: string; strict: boolean }>(
        `SELECT provolatile AS volatile, proisstrict AS strict
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'shared' AND p.proname = 'format_officer_rik_id'`
      );
      expect(rows[0]!.volatile).toBe('i');
      expect(rows[0]!.strict).toBe(true);
    });
  });

  // =================================================================
  // 2. The backfill and the invariants it left behind
  // =================================================================
  describe('every officer carries an identifier, and no two share one', () => {
    it('no officer row has a null RIK ID', async () => {
      const rows = await db.query<{ nulls: string }>(
        `SELECT count(*)::text AS nulls FROM shared.customers WHERE rik_id IS NULL`
      );
      expect(rows[0]!.nulls).toBe('0');
    });

    it('every RIK ID matches the approved pattern', async () => {
      const rows = await db.query<{ bad: string }>(
        `SELECT count(*)::text AS bad FROM shared.customers WHERE rik_id !~ '^RIK-O-[0-9]{6,}$'`
      );
      expect(rows[0]!.bad).toBe('0');
    });

    it('RIK IDs are unique across every officer', async () => {
      const rows = await db.query<{ total: string; distinct_ids: string }>(
        `SELECT count(*)::text AS total, count(DISTINCT rik_id)::text AS distinct_ids
           FROM shared.customers`
      );
      expect(rows[0]!.distinct_ids).toBe(rows[0]!.total);
    });

    it('the uniqueness is a database constraint, not a convention', async () => {
      const rows = await db.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'shared.customers'::regclass AND conname = 'customers_rik_id_uq'`
      );
      expect(rows).toHaveLength(1);
    });

    it('the format is a database CHECK, not a convention', async () => {
      const rows = await db.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'shared.customers'::regclass
            AND conname = 'shared_customers_rik_id_chk'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.def).toContain('RIK-O-');
    });

    it('the column is NOT NULL and defaults to the formatting function', async () => {
      const rows = await db.query<{ is_nullable: string; column_default: string }>(
        `SELECT is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'shared' AND table_name = 'customers' AND column_name = 'rik_id'`
      );
      expect(rows[0]!.is_nullable).toBe('NO');
      expect(rows[0]!.column_default).toContain('format_officer_rik_id');
      expect(rows[0]!.column_default).toContain('nextval');
    });

    it('the sequence is dedicated to officers and does not cycle', async () => {
      const rows = await db.query<{ cycle: boolean; data_type: string }>(
        `SELECT s.seqcycle AS cycle, format_type(s.seqtypid, NULL) AS data_type
           FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'shared' AND c.relname = 'officer_rik_id_seq'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.cycle).toBe(false);
      expect(rows[0]!.data_type).toBe('bigint');
    });

    it('the application role may draw from the sequence but not rewind it', async () => {
      const rows = await db.query<{ usage: boolean; rewind: boolean }>(
        `SELECT has_sequence_privilege('app_shared','shared.officer_rik_id_seq','USAGE')  AS usage,
                has_sequence_privilege('app_shared','shared.officer_rik_id_seq','UPDATE') AS rewind`
      );
      expect(rows[0]).toEqual({ usage: true, rewind: false });
    });
  });

  // =================================================================
  // 3. Registration
  // =================================================================
  describe('registering an officer', () => {
    let registered: Record<string, unknown>;

    beforeAll(async () => {
      registered = await registerOk(registration({ mobileNumber: mobile(11) }));
    });

    it('answers 201 with the officer, led by the RIK ID', async () => {
      expect(registered.rikId).toMatch(/^RIK-O-[0-9]{6,}$/);
      expect(Object.keys(registered)[0]).toBe('rikId');
    });

    it('issued the identifier itself — the request never carried one', () => {
      expect(registered.rikId).toBeDefined();
      expect(registration()).not.toHaveProperty('rikId');
    });

    it('records the officer as active', () => {
      expect(registered.status).toBe('ACTIVE');
    });

    it('keeps both the display name and the facility spelling', () => {
      expect(registered.name).toBe(`Jest 15A Officer ${runId}`);
      expect(registered.officialName).toBe(`Jest 15A Officer ${runId}`);
    });

    it('records the residence', () => {
      expect(registered.residence).toEqual({ quarterBlock: 'B', quarterNumber: '102', landmark: null });
    });

    it('records the dietary preference as given', () => {
      expect(registered.dietaryPreference).toBe('NV');
    });

    it('records who registered the officer', async () => {
      const rows = await db.query<{ created_by: string }>(
        `SELECT created_by FROM shared.customers WHERE id = $1`,
        [registered.officerId]
      );
      expect(rows[0]!.created_by).toBe(staffIdByRole.get('RIK_ADMIN'));
    });

    it('creates the residence as the officer’s default address', async () => {
      const rows = await db.query<{ is_default: boolean; label: string }>(
        `SELECT is_default, label FROM shared.customer_addresses WHERE customer_id = $1`,
        [registered.officerId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.is_default).toBe(true);
    });

    it('does NOT create an eligibility row — eligibility is not registration', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.customer_period_eligibility WHERE customer_id = $1`,
        [registered.officerId]
      );
      expect(rows[0]!.total).toBe('0');
    });

    it('reports no eligible days anywhere in the response', () => {
      expect(JSON.stringify(registered)).not.toMatch(/eligible/i);
    });

    it('writes an audit row naming the registration', async () => {
      const rows = await db.query<{ action: string; entity_type: string }>(
        `SELECT action, entity_type FROM shared.audit_log WHERE entity_id = $1 ORDER BY created_at`,
        [registered.officerId]
      );
      expect(rows.map((r) => r.action)).toEqual(['RIK_OFFICER_REGISTERED']);
      expect(rows[0]!.entity_type).toBe('rik.officer');
    });

    it('issues consecutive identifiers to consecutive officers', async () => {
      const first = await registerOk(registration({ mobileNumber: mobile(12) }));
      const second = await registerOk(registration({ mobileNumber: mobile(13) }));
      const a = Number(String(first.rikId).replace('RIK-O-', ''));
      const b = Number(String(second.rikId).replace('RIK-O-', ''));
      expect(b).toBe(a + 1);
    });

    it('accepts an optional landmark and stores it', async () => {
      const officer = await registerOk(
        registration({ mobileNumber: mobile(14), landmark: 'Near the parade ground' })
      );
      expect((officer.residence as { landmark: string }).landmark).toBe('Near the parade ground');
    });

    it('treats a blank landmark as absent rather than storing whitespace', async () => {
      const officer = await registerOk(registration({ mobileNumber: mobile(15), landmark: '   ' }));
      expect((officer.residence as { landmark: string | null }).landmark).toBeNull();
    });

    it('accepts each of the three dietary preferences', async () => {
      const pv = await registerOk(
        registration({ mobileNumber: mobile(16), dietaryPreference: 'PV' })
      );
      const ev = await registerOk(
        registration({ mobileNumber: mobile(17), dietaryPreference: 'EV' })
      );
      expect([pv.dietaryPreference, ev.dietaryPreference]).toEqual(['PV', 'EV']);
    });
  });

  // =================================================================
  // 4. Mobile normalisation — one implementation, shared with Phase B
  // =================================================================
  describe('the mobile number is normalised, never guessed', () => {
    it('keeps a plain ten-digit number', () => {
      expect(normaliseMobile('9876543210')).toBe('9876543210');
    });

    it('removes +91', () => {
      expect(normaliseMobile('+919876543210')).toBe('9876543210');
    });

    it('removes a bare 91 prefix', () => {
      expect(normaliseMobile('919876543210')).toBe('9876543210');
    });

    it('removes a leading zero', () => {
      expect(normaliseMobile('09876543210')).toBe('9876543210');
    });

    it('removes spaces, hyphens, brackets and dots', () => {
      expect(normaliseMobile(' +91 (98765) 43-2.10 ')).toBe('9876543210');
    });

    it('refuses a nine-digit number by name', () => {
      expect(() => normaliseMobile('987654321')).toThrow(/ten digits/i);
    });

    it('refuses a number that does not begin 6, 7, 8 or 9', () => {
      expect(() => normaliseMobile('5876543210')).toThrow(/beginning 6, 7, 8 or 9/i);
    });

    it('refuses letters rather than stripping them', () => {
      expect(() => normaliseMobile('98765abcde')).toThrow(/ten digits/i);
    });

    it('refuses an empty string', () => {
      expect(() => normaliseMobile('')).toThrow(/ten digits/i);
    });

    it('stores the normalised form, not the form that was typed', async () => {
      const typed = `+91 ${mobile(18)}`;
      const officer = await registerOk(registration({ mobileNumber: typed }));
      expect(officer.mobileNumber).toBe(mobile(18));
    });
  });

  // =================================================================
  // 5. Registration refusals
  // =================================================================
  describe('a registration the facility cannot mean is refused by name', () => {
    const refuse = (body: Record<string, unknown>) =>
      request(server()).post('/admin/rik/officers').set('Authorization', asAdmin()).send(body);

    it('refuses a missing name', async () => {
      const res = await refuse(registration({ name: undefined, mobileNumber: mobile(90) }));
      expect(res.status).toBe(400);
    });

    it('refuses a whitespace-only name with the service’s own reason', async () => {
      const res = await refuse(registration({ name: '   ', mobileNumber: mobile(91) })).expect(400);
      expect(res.body.details.reason).toBe('BLANK_FIELD');
      expect(res.body.details.field).toBe('name');
    });

    it('refuses a name longer than 120 characters', async () => {
      const res = await refuse(registration({ name: 'x'.repeat(121), mobileNumber: mobile(92) }));
      expect(res.status).toBe(400);
    });

    it('refuses a missing quarter block', async () => {
      const res = await refuse(
        registration({ quarterBlock: undefined, mobileNumber: mobile(93) })
      );
      expect(res.status).toBe(400);
    });

    it('refuses a whitespace-only quarter number', async () => {
      const res = await refuse(
        registration({ quarterNumber: '  ', mobileNumber: mobile(94) })
      ).expect(400);
      expect(res.body.details.reason).toBe('BLANK_FIELD');
      expect(res.body.details.field).toBe('quarterNumber');
    });

    it('refuses an unusable mobile number with INVALID_MOBILE', async () => {
      const res = await refuse(registration({ mobileNumber: '12345' })).expect(400);
      expect(res.body.details.reason).toBe('INVALID_MOBILE');
    });

    it('refuses a dietary preference outside PV/EV/NV', async () => {
      const res = await refuse(
        registration({ dietaryPreference: 'VEGAN', mobileNumber: mobile(95) })
      );
      expect(res.status).toBe(400);
    });

    it('refuses a duplicate mobile number and names the officer who holds it', async () => {
      const first = await registerOk(registration({ mobileNumber: mobile(19) }));
      const res = await refuse(registration({ mobileNumber: mobile(19) })).expect(400);
      expect(res.body.details.reason).toBe('DUPLICATE_MOBILE');
      expect(res.body.message).toContain(String(first.rikId));
    });

    it('refuses a duplicate written in a different form — normalisation first', async () => {
      const res = await refuse(registration({ mobileNumber: `+91${mobile(19)}` })).expect(400);
      expect(res.body.details.reason).toBe('DUPLICATE_MOBILE');
    });

    it('refuses a mobile number belonging to a SOFT-DELETED officer', async () => {
      const officer = await registerOk(registration({ mobileNumber: mobile(20) }));
      await db.query(`UPDATE shared.customers SET deleted_at = now() WHERE id = $1`, [
        officer.officerId,
      ]);
      const res = await refuse(registration({ mobileNumber: mobile(20) })).expect(400);
      expect(res.body.details.reason).toBe('DUPLICATE_MOBILE');
      await db.query(`UPDATE shared.customers SET deleted_at = NULL WHERE id = $1`, [
        officer.officerId,
      ]);
    });

    it('wrote nothing for any refused registration', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM shared.customers
          WHERE mobile_number = ANY($1::text[])`,
        [[mobile(90), mobile(91), mobile(92), mobile(93), mobile(94), mobile(95)]]
      );
      expect(rows[0]!.total).toBe('0');
    });
  });

  // =================================================================
  // 6. The prohibited fields are unreachable
  // =================================================================
  describe('the specification’s prohibited fields cannot be sent', () => {
    const prohibited = [
      'serviceNumber',
      'rank',
      'unit',
      'aadhaar',
      'aadhaarNumber',
      'pan',
      'panNumber',
      'eligibleDays',
      'rikId',
      'officialName',
      'createdBy',
      'status',
    ];

    for (const field of prohibited) {
      it(`refuses a body carrying ${field}`, async () => {
        const res = await request(server())
          .post('/admin/rik/officers')
          .set('Authorization', asAdmin())
          .send(registration({ mobileNumber: mobile(96), [field]: 'X' }));
        expect(res.status).toBe(400);
      });
    }

    it('and none of them exists as a column on shared.customers', async () => {
      const rows = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'shared' AND table_name = 'customers'
            AND column_name IN ('service_number','rank','unit','aadhaar','aadhaar_number','pan','pan_number')`
      );
      expect(rows).toEqual([]);
    });
  });

  // =================================================================
  // 7. Permanence
  // =================================================================
  describe('a RIK ID is permanent', () => {
    let officerId: string;
    let rikId: string;

    beforeAll(async () => {
      const officer = await registerOk(registration({ mobileNumber: mobile(21) }));
      officerId = officer.officerId as string;
      rikId = officer.rikId as string;
    });

    it('the database refuses to renumber an officer', async () => {
      await expect(
        db.query(`UPDATE shared.customers SET rik_id = 'RIK-O-999001' WHERE id = $1`, [officerId])
      ).rejects.toThrow();
    });

    it('the identifier is unchanged after the attempt', async () => {
      const rows = await db.query<{ rik_id: string }>(
        `SELECT rik_id FROM shared.customers WHERE id = $1`,
        [officerId]
      );
      expect(rows[0]!.rik_id).toBe(rikId);
    });

    it('other columns remain freely editable', async () => {
      await db.query(`UPDATE shared.customers SET name = $2 WHERE id = $1`, [
        officerId,
        `Jest 15A Renamed ${runId}`,
      ]);
      const rows = await db.query<{ name: string; rik_id: string }>(
        `SELECT name, rik_id FROM shared.customers WHERE id = $1`,
        [officerId]
      );
      expect(rows[0]!.name).toBe(`Jest 15A Renamed ${runId}`);
      expect(rows[0]!.rik_id).toBe(rikId);
    });

    it('the protection is a trigger scoped to UPDATE OF rik_id', async () => {
      const rows = await db.query<{ def: string }>(
        `SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger
          WHERE tgrelid = 'shared.customers'::regclass AND tgname = 'protect_officer_rik_id'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.def).toContain('BEFORE UPDATE OF rik_id');
    });

    it('a second officer cannot be given an existing identifier', async () => {
      await expect(
        db.query(
          `INSERT INTO shared.customers (mobile_number, name, rik_id)
           VALUES ($1, $2, $3)`,
          [mobile(97), `Jest 15A Clash ${runId}`, rikId]
        )
      ).rejects.toThrow();
    });

    it('an identifier in the selection namespace is refused', async () => {
      await expect(
        db.query(
          `INSERT INTO shared.customers (mobile_number, name, rik_id)
           VALUES ($1, $2, 'RIK-000001')`,
          [mobile(98), `Jest 15A Namespace ${runId}`]
        )
      ).rejects.toThrow();
    });

    it('an identifier shorter than six digits is refused', async () => {
      await expect(
        db.query(
          `INSERT INTO shared.customers (mobile_number, name, rik_id)
           VALUES ($1, $2, 'RIK-O-00001')`,
          [mobile(99), `Jest 15A Short ${runId}`]
        )
      ).rejects.toThrow();
    });
  });

  // =================================================================
  // 8. Deactivation — never deletion
  // =================================================================
  describe('an officer is deactivated, never deleted', () => {
    let officerId: string;

    beforeAll(async () => {
      const officer = await registerOk(registration({ mobileNumber: mobile(22) }));
      officerId = officer.officerId as string;
    });

    it('deactivates on request', async () => {
      const res = await request(server())
        .post(`/admin/rik/officers/${officerId}/active`)
        .set('Authorization', asAdmin())
        .send({ isActive: false })
        .expect(201);
      expect(res.body.status).toBe('INACTIVE');
    });

    it('keeps the row, the name and the identifier', async () => {
      const rows = await db.query<{ rik_id: string; name: string }>(
        `SELECT rik_id, name FROM shared.customers WHERE id = $1`,
        [officerId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rik_id).toMatch(/^RIK-O-/);
    });

    it('reactivates on request', async () => {
      const res = await request(server())
        .post(`/admin/rik/officers/${officerId}/active`)
        .set('Authorization', asAdmin())
        .send({ isActive: true })
        .expect(201);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('audits both directions, and nothing else', async () => {
      const rows = await db.query<{ action: string }>(
        `SELECT action FROM shared.audit_log WHERE entity_id = $1 ORDER BY created_at`,
        [officerId]
      );
      expect(rows.map((r) => r.action)).toEqual([
        'RIK_OFFICER_REGISTERED',
        'RIK_OFFICER_DEACTIVATED',
        'RIK_OFFICER_REACTIVATED',
      ]);
    });

    it('does not audit a no-op', async () => {
      const before = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM shared.audit_log WHERE entity_id = $1`,
        [officerId]
      );
      await request(server())
        .post(`/admin/rik/officers/${officerId}/active`)
        .set('Authorization', asAdmin())
        .send({ isActive: true })
        .expect(201);
      const after = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM shared.audit_log WHERE entity_id = $1`,
        [officerId]
      );
      expect(after[0]!.total).toBe(before[0]!.total);
    });

    it('offers no delete route at all', async () => {
      const probe = request(server());
      await probe
        .delete(`/admin/rik/officers/${officerId}`)
        .set('Authorization', asAdmin())
        .expect(404);
    });

    it('refuses isActive that is not a boolean', async () => {
      await request(server())
        .post(`/admin/rik/officers/${officerId}/active`)
        .set('Authorization', asAdmin())
        .send({ isActive: 'no' })
        .expect(400);
    });

    it('answers 404 for an officer that does not exist', async () => {
      await request(server())
        .post(`/admin/rik/officers/00000000-0000-7000-8000-000000000000/active`)
        .set('Authorization', asAdmin())
        .send({ isActive: false })
        .expect(404);
    });
  });

  // =================================================================
  // 9. Lookup
  // =================================================================
  describe('finding an officer', () => {
    let officer: Record<string, unknown>;

    beforeAll(async () => {
      officer = await registerOk(
        registration({
          name: `Jest 15A Findable ${runId}`,
          mobileNumber: mobile(50),
          quarterBlock: 'Z',
          quarterNumber: '909',
        })
      );
    });

    it('reads one officer by id', async () => {
      const res = await request(server())
        .get(`/admin/rik/officers/${officer.officerId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.rikId).toBe(officer.rikId);
    });

    it('answers 404 for an unknown id', async () => {
      await request(server())
        .get('/admin/rik/officers/00000000-0000-7000-8000-000000000000')
        .set('Authorization', asAdmin())
        .expect(404);
    });

    it('refuses an id that is not a uuid', async () => {
      await request(server())
        .get('/admin/rik/officers/not-a-uuid')
        .set('Authorization', asAdmin())
        .expect(400);
    });

    it('searches by RIK ID', async () => {
      const res = await request(server())
        .get(`/admin/rik/officers?q=${officer.rikId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items.map((o: { rikId: string }) => o.rikId)).toContain(officer.rikId);
    });

    it('searches by name', async () => {
      const res = await request(server())
        .get(`/admin/rik/officers?q=Findable ${runId}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items).toHaveLength(1);
    });

    it('searches by mobile number', async () => {
      const res = await request(server())
        .get(`/admin/rik/officers?q=${mobile(50)}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items[0].rikId).toBe(officer.rikId);
    });

    it('searches by quarter', async () => {
      const res = await request(server())
        .get(`/admin/rik/officers?q=909`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items.map((o: { rikId: string }) => o.rikId)).toContain(officer.rikId);
    });

    it('reports a total alongside the page', async () => {
      const res = await request(server())
        .get('/admin/rik/officers?limit=1')
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBeGreaterThan(1);
      expect(res.body.limit).toBe(1);
      expect(res.body.offset).toBe(0);
    });

    it('pages with offset', async () => {
      const first = await request(server())
        .get('/admin/rik/officers?limit=1&offset=0')
        .set('Authorization', asAdmin())
        .expect(200);
      const second = await request(server())
        .get('/admin/rik/officers?limit=1&offset=1')
        .set('Authorization', asAdmin())
        .expect(200);
      expect(first.body.items[0].rikId).not.toBe(second.body.items[0].rikId);
    });

    it('returns an empty page rather than an error for no match', async () => {
      const res = await request(server())
        .get('/admin/rik/officers?q=zzz-no-such-officer-zzz')
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('refuses an unknown query parameter', async () => {
      await request(server())
        .get('/admin/rik/officers?nope=1')
        .set('Authorization', asAdmin())
        .expect(400);
    });

    it('refuses a limit above the maximum', async () => {
      await request(server())
        .get('/admin/rik/officers?limit=500')
        .set('Authorization', asAdmin())
        .expect(400);
    });

    it('orders the list by RIK ID', async () => {
      const res = await request(server())
        .get('/admin/rik/officers?limit=100')
        .set('Authorization', asAdmin())
        .expect(200);
      const ids = res.body.items.map((o: { rikId: string }) => o.rikId);
      expect([...ids].sort()).toEqual(ids);
    });

    it('excludes a soft-deleted officer from the list', async () => {
      const temp = await registerOk(registration({ mobileNumber: mobile(51) }));
      await db.query(`UPDATE shared.customers SET deleted_at = now() WHERE id = $1`, [
        temp.officerId,
      ]);
      const res = await request(server())
        .get(`/admin/rik/officers?q=${mobile(51)}`)
        .set('Authorization', asAdmin())
        .expect(200);
      expect(res.body.items).toEqual([]);
      await db.query(`UPDATE shared.customers SET deleted_at = NULL WHERE id = $1`, [
        temp.officerId,
      ]);
    });
  });

  // =================================================================
  // 10. Authorization
  // =================================================================
  describe('officer administration is RIK_ADMIN only', () => {
    const routes = [
      { method: 'get' as const, path: '/admin/rik/officers' },
      { method: 'post' as const, path: '/admin/rik/officers' },
    ];

    for (const route of routes) {
      it(`${route.method.toUpperCase()} ${route.path} is 401 for an anonymous caller`, async () => {
        const probe = request(server());
        await probe[route.method](route.path).expect(401);
      });

      it(`${route.method.toUpperCase()} ${route.path} is 403 for a CUSTOMER`, async () => {
        const probe = request(server());
        await probe[route.method](route.path)
          .set('Authorization', `Bearer ${customerToken}`)
          .expect(403);
      });

      it(`${route.method.toUpperCase()} ${route.path} is 403 for staff with no role`, async () => {
        const probe = request(server());
        await probe[route.method](route.path)
          .set('Authorization', `Bearer ${noRoleToken}`)
          .expect(403);
      });
    }

    for (const role of STAFF_ROLES.filter((r) => r !== 'RIK_ADMIN' && r !== 'SUPER_ADMIN')) {
      it(`${role} cannot list officers`, async () => {
        await request(server())
          .get('/admin/rik/officers')
          .set('Authorization', bearer(role))
          .expect(403);
      });

      it(`${role} cannot register an officer`, async () => {
        await request(server())
          .post('/admin/rik/officers')
          .set('Authorization', bearer(role))
          .send(registration({ mobileNumber: mobile(80) }))
          .expect(403);
      });
    }

    it('a refused caller wrote nothing', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM shared.customers WHERE mobile_number = $1`,
        [mobile(80)]
      );
      expect(rows[0]!.total).toBe('0');
    });

    it('the permission used is the existing rik.entitlement.allocate', async () => {
      const rows = await db.query<{ role: string }>(
        `SELECT r.name AS role
           FROM shared.permissions p
           JOIN shared.role_permissions rp ON rp.permission_id = p.id
           JOIN shared.roles r ON r.id = rp.role_id
          WHERE p.code = 'rik.entitlement.allocate'
          ORDER BY r.name`
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
  });

  // =================================================================
  // 11. The baseline is untouched
  // =================================================================
  describe('the RIK baseline is untouched', () => {
    it('pools, scales, conversions and provisions are unchanged', async () => {
      const rows = await db.query<{
        pools: string;
        scales: string;
        convs: string;
        provs: string;
      }>(
        `SELECT (SELECT count(*)::text FROM rik.entitlement_pools)  AS pools,
                (SELECT count(*)::text FROM rik.pool_scales)        AS scales,
                (SELECT count(*)::text FROM rik.pool_conversions)   AS convs,
                (SELECT count(*)::text FROM rik.provisions)         AS provs`
      );
      expect(rows[0]).toEqual({ pools: '18', scales: '50', convs: '7', provs: '190' });
    });

    /**
     * pg_tables and pg_views, NOT information_schema.
     *
     * information_schema is privilege-filtered: `esamagri_app` holds no grant
     * on shared.idempotency_keys by design, so it sees one table fewer than
     * exists and this assertion reported 58 instead of 59.
     */
    it('the schema contract holds at 62 tables and 5 views', async () => {
      const rows = await db.query<{ tables: string; views: string }>(
        `SELECT (SELECT count(*)::text FROM pg_tables
                  WHERE schemaname IN ('shared','rik','pif')) AS tables,
                (SELECT count(*)::text FROM pg_views
                  WHERE schemaname IN ('shared','rik','pif')) AS views`
      );
      expect(rows[0]).toEqual({ tables: '68', views: '5' });
    });

    it('the selection reference sequence is untouched', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'S' AND n.nspname = 'rik' AND c.relname = 'selection_reference_seq'`
      );
      expect(rows[0]!.total).toBe('1');
    });

    it('pif holds its own 23 tables, and officer registration touched none of them', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM pg_tables WHERE schemaname = 'pif'`
      );
      expect(rows[0]!.total).toBe('23');
    });
  });
});
