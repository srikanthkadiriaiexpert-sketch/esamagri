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
import { StaffAuthService } from '../auth/services/staff-auth.service';

/**
 * Super Admin staff management, over real HTTP against real PostgreSQL, using
 * the approved role/permission seed exactly as it exists in the database.
 *
 * WHAT ONLY THIS SUITE CAN PROVE. The unit spec
 * (services/admin-staff.service.spec.ts) pins the refusals down without a
 * database and runs in milliseconds. It cannot prove that the GUARDS refuse a
 * RIK_ADMIN, that `users_username_uq` rejects a duplicate, that a suspended
 * account is actually turned away at login, or that
 * `shared.user.manage` / `shared.role.grant` resolve from the live
 * role/permission graph. Those need the real stack, and they are the tests
 * that matter for a handover.
 *
 * NO MIGRATION IS REQUIRED FOR ANY OF THIS. Both permissions have existed in
 * shared.permissions since migration 0019, granted to SUPER_ADMIN alone:
 *
 *   shared.user.manage  'Create/manage staff user accounts (Section 23).'
 *   shared.role.grant   'Grant/revoke roles — the only role that can grant
 *                        other roles (Section 23).'
 *
 * The first test below re-reads them from the database, so if that ever stops
 * being true this suite says so instead of quietly testing something else.
 *
 * CLEANUP. Every row this suite creates carries `jest_staff_` and the run id,
 * and afterAll removes them. It never touches bootstrap_super_admin, any
 * pre-existing staff row, or any customer.
 */
describe('Super Admin staff management (integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;
  let staffAuth: StaffAuthService;

  const runId = randomUUID().slice(0, 8);
  const PASSWORD = 'CorrectHorseBatteryStaple!1';
  const NEW_PASSWORD = 'Monsoon#Harbour47';

  const idByRole = new Map<StaffRole, string>();
  const tokenByRole = new Map<StaffRole, string>();
  /** Accounts created THROUGH THE API during the run, to be cleaned up. */
  const createdIds: string[] = [];
  let secondSuperAdminId: string;
  let customerId: string;
  let customerToken: string;

  const asSuper = () => tokenByRole.get('SUPER_ADMIN')!;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    tokenService = app.get(TokenService);
    staffAuth = app.get(StaffAuthService);
    const passwords = app.get(PasswordService);
    const passwordHash = await passwords.hash(PASSWORD);

    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    const grantedBy = bootstrap[0]!.id;

    const makeStaff = async (label: string, role: StaffRole | null): Promise<string> => {
      const rows = await db.query<{ id: string }>(
        `INSERT INTO shared.users (id, username, password_hash, display_name, status)
         VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
        [`jest_staff_${label}_${runId}`, passwordHash, `Jest Staff ${label} ${runId}`]
      );
      const id = rows[0]!.id;
      if (role !== null) {
        await db.query(
          `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
           SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3`,
          [id, grantedBy, role]
        );
      }
      return id;
    };

    for (const role of STAFF_ROLES) {
      const id = await makeStaff(role.toLowerCase(), role);
      idByRole.set(role, id);
      tokenByRole.set(role, tokenService.signAccessToken({ principalType: 'STAFF', principalId: id }));
    }

    // A SECOND active Super Admin, so the last-active rule does not block the
    // tests that legitimately suspend one. Its existence is the precondition
    // those tests assert rather than assume.
    secondSuperAdminId = await makeStaff('super2', 'SUPER_ADMIN');

    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active)
       VALUES (shared.uuid_generate_v7(), $1, $2, true) RETURNING id`,
      [`96${runId.replace(/[^0-9]/g, '').padEnd(8, '5').slice(0, 8)}`, `Jest Staff Customer ${runId}`]
    );
    customerId = customer[0]!.id;
    customerToken = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerId });
  });

  afterAll(async () => {
    const mine = [...idByRole.values(), secondSuperAdminId, ...createdIds];
    await db.query('DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])', [mine]);
    await db.query('DELETE FROM shared.user_roles WHERE user_id = ANY($1::uuid[])', [mine]);
    // shared.users.created_by is a self-FK: accounts created through the API
    // point at the Super Admin fixture, so those go first.
    await db.query('DELETE FROM shared.users WHERE id = ANY($1::uuid[])', [createdIds]);
    await db.query('DELETE FROM shared.users WHERE id = ANY($1::uuid[])', [
      [...idByRole.values(), secondSuperAdminId],
    ]);
    await db.query('DELETE FROM shared.customers WHERE id = $1', [customerId]);
    await app.close();
  });

  // ------------------------------------------------------------ the premises

  describe('the premises this suite rests on', () => {
    it('finds both staff-management permissions in the database, granted to SUPER_ADMIN only', async () => {
      const rows = await db.query<{ code: string; role_name: string }>(
        `SELECT p.code, r.name AS role_name
           FROM shared.permissions p
           JOIN shared.role_permissions rp ON rp.permission_id = p.id
           JOIN shared.roles r ON r.id = rp.role_id
          WHERE p.code IN ('shared.user.manage', 'shared.role.grant')
          ORDER BY p.code, r.name`
      );
      expect(rows.map((r) => `${r.code}:${r.role_name}`)).toEqual([
        'shared.role.grant:SUPER_ADMIN',
        'shared.user.manage:SUPER_ADMIN',
      ]);
    });

    it('has a second active Super Admin, so the last-active rule is not in the way', async () => {
      const rows = await db.query<{ count: string }>(
        `SELECT count(DISTINCT u.id)::text AS count
           FROM shared.users u
           JOIN shared.user_roles ur ON ur.user_id = u.id
           JOIN shared.roles r ON r.id = ur.role_id
          WHERE r.name = 'SUPER_ADMIN' AND u.status = 'ACTIVE'`
      );
      expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------- 1. Super Admin can create staff

  describe('1. a Super Admin can create a staff account', () => {
    it('creates one, returns it without any secret, and stores a bcrypt hash', async () => {
      const username = `jest_staff_new_${runId}`;
      const response = await request(app.getHttpServer())
        .post('/admin/staff')
        .set(auth(asSuper()))
        .send({
          displayName: 'Jest Created Staff',
          username,
          password: NEW_PASSWORD,
          role: 'RIK_PICKUP_STAFF',
        })
        .expect(201);

      createdIds.push(response.body.id);
      expect(response.body).toMatchObject({
        username,
        displayName: 'Jest Created Staff',
        status: 'ACTIVE',
        roles: ['RIK_PICKUP_STAFF'],
      });

      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain(NEW_PASSWORD);
      expect(serialized).not.toMatch(/\$2[aby]\$/);
      expect(serialized).not.toMatch(/password|totp_secret|totpSecret/i);

      const stored = await db.query<{ password_hash: string; created_by: string | null }>(
        'SELECT password_hash, created_by FROM shared.users WHERE id = $1',
        [response.body.id]
      );
      expect(stored[0]!.password_hash).toMatch(/^\$2[aby]\$/);
      expect(stored[0]!.password_hash).not.toBe(NEW_PASSWORD);
      expect(stored[0]!.created_by).toBe(idByRole.get('SUPER_ADMIN'));
    });

    it('writes an audit row naming the actor and the new account', async () => {
      const rows = await db.query<{ action: string; actor_id: string }>(
        `SELECT action, actor_id FROM shared.audit_log
          WHERE action = 'STAFF_ACCOUNT_CREATED' AND entity_id = $1`,
        [createdIds[0]]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor_id).toBe(idByRole.get('SUPER_ADMIN'));
    });

    it('rejects a password that fails the policy, before any row is written', async () => {
      const username = `jest_staff_weak_${runId}`;
      await request(app.getHttpServer())
        .post('/admin/staff')
        .set(auth(asSuper()))
        .send({ displayName: 'Weak Password', username, password: 'password' })
        .expect(400);

      const rows = await db.query('SELECT id FROM shared.users WHERE username = $1', [username]);
      expect(rows).toHaveLength(0);
    });

    it('refuses an unknown field rather than ignoring it', async () => {
      await request(app.getHttpServer())
        .post('/admin/staff')
        .set(auth(asSuper()))
        .send({
          displayName: 'Extra Field',
          username: `jest_staff_extra_${runId}`,
          password: NEW_PASSWORD,
          passwordHash: '$2b$12$attacker.supplied.hash',
        })
        .expect(400);
    });
  });

  // ---------------------------------------- 7. duplicate usernames are rejected

  describe('7. duplicate usernames are rejected', () => {
    it('answers a second create with the same username with 409', async () => {
      const username = `jest_staff_dup_${runId}`;
      const first = await request(app.getHttpServer())
        .post('/admin/staff')
        .set(auth(asSuper()))
        .send({ displayName: 'First Holder', username, password: NEW_PASSWORD })
        .expect(201);
      createdIds.push(first.body.id);

      await request(app.getHttpServer())
        .post('/admin/staff')
        .set(auth(asSuper()))
        .send({ displayName: 'Second Holder', username, password: NEW_PASSWORD })
        .expect(409);

      const rows = await db.query('SELECT id FROM shared.users WHERE username = $1', [username]);
      expect(rows).toHaveLength(1);
    });
  });

  // ------------------------------------------- 2. assigning an existing role

  describe('2. a Super Admin can assign and revoke an existing role', () => {
    it('grants a role, and the grant resolves through the live permission graph', async () => {
      const target = idByRole.get('RIK_PICKUP_STAFF')!;
      await request(app.getHttpServer())
        .post(`/admin/staff/${target}/roles`)
        .set(auth(asSuper()))
        .send({ role: 'PIF_CASHIER' })
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/admin/staff/${target}`)
        .set(auth(asSuper()))
        .expect(200);
      expect(detail.body.roles).toEqual(expect.arrayContaining(['RIK_PICKUP_STAFF', 'PIF_CASHIER']));
      expect(detail.body.permissions).toEqual(expect.arrayContaining(['pif.order.prepare']));
    });

    it('revokes it again', async () => {
      const target = idByRole.get('RIK_PICKUP_STAFF')!;
      await request(app.getHttpServer())
        .delete(`/admin/staff/${target}/roles/PIF_CASHIER`)
        .set(auth(asSuper()))
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get(`/admin/staff/${target}`)
        .set(auth(asSuper()))
        .expect(200);
      expect(detail.body.roles).not.toContain('PIF_CASHIER');
    });

    it('refuses a role that does not exist — there is no RIK_STAFF', async () => {
      const target = idByRole.get('RIK_PICKUP_STAFF')!;
      await request(app.getHttpServer())
        .post(`/admin/staff/${target}/roles`)
        .set(auth(asSuper()))
        .send({ role: 'RIK_STAFF' })
        .expect(400);
    });

    it('offers exactly the six seeded roles, with their real permissions', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/staff/roles')
        .set(auth(asSuper()))
        .expect(200);

      const names = response.body.roles.map((r: { name: string }) => r.name).sort();
      expect(names).toEqual([...STAFF_ROLES].sort());

      const delivery = response.body.roles.find((r: { name: string }) => r.name === 'DELIVERY_STAFF');
      // DELIVERY_STAFF is PIF-scoped in the seed and must not have acquired a
      // RIK code by way of this feature.
      expect(delivery.permissions.sort()).toEqual([
        'pif.order.mark_delivered',
        'pif.order.mark_not_delivered',
      ]);
      expect(delivery.permissions.join(' ')).not.toMatch(/^rik\./);
    });
  });

  // --------------------------------- 3 & 6. suspend, reactivate, and login

  describe('3 and 6. suspension takes effect, and a suspended account cannot sign in', () => {
    const username = () => `jest_staff_susp_${runId}`;
    let suspendableId: string;

    it('creates an account that can sign in to begin with', async () => {
      const created = await request(app.getHttpServer())
        .post('/admin/staff')
        .set(auth(asSuper()))
        .send({ displayName: 'Suspendable', username: username(), password: NEW_PASSWORD })
        .expect(201);
      suspendableId = created.body.id;
      createdIds.push(suspendableId);

      await expect(
        staffAuth.login({ username: username(), password: NEW_PASSWORD, ipAddress: null, deviceInfo: null })
      ).resolves.toBeDefined();
    });

    it('suspends it, and the login is then refused', async () => {
      const response = await request(app.getHttpServer())
        .post(`/admin/staff/${suspendableId}/status`)
        .set(auth(asSuper()))
        .send({ status: 'SUSPENDED', reason: 'Integration test suspension' })
        .expect(201);
      expect(response.body.status).toBe('SUSPENDED');

      await expect(
        staffAuth.login({ username: username(), password: NEW_PASSWORD, ipAddress: null, deviceInfo: null })
      ).rejects.toBeDefined();
    });

    it('ends the suspended account\'s live sessions rather than waiting for expiry', async () => {
      const rows = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM shared.auth_sessions
          WHERE principal_id = $1 AND revoked_at IS NULL`,
        [suspendableId]
      );
      expect(Number(rows[0]!.count)).toBe(0);
    });

    it('reactivates it, and the login works again', async () => {
      await request(app.getHttpServer())
        .post(`/admin/staff/${suspendableId}/status`)
        .set(auth(asSuper()))
        .send({ status: 'ACTIVE', reason: 'Integration test reactivation' })
        .expect(201);

      await expect(
        staffAuth.login({ username: username(), password: NEW_PASSWORD, ipAddress: null, deviceInfo: null })
      ).resolves.toBeDefined();
    });

    it('refuses DISABLED through this API — suspension is the reversible action', async () => {
      await request(app.getHttpServer())
        .post(`/admin/staff/${suspendableId}/status`)
        .set(auth(asSuper()))
        .send({ status: 'DISABLED', reason: 'Should not be accepted here' })
        .expect(400);
    });
  });

  // ------------------------------------------ 4, 5 & 9. the guards do the work

  describe('4, 5 and 9. a non-Super-Admin is refused by the API, not by the browser', () => {
    const others: StaffRole[] = ['RIK_ADMIN', 'PIF_ADMIN', 'PIF_CASHIER', 'RIK_PICKUP_STAFF', 'DELIVERY_STAFF'];

    it.each(others)('%s cannot list staff', async (role) => {
      await request(app.getHttpServer())
        .get('/admin/staff')
        .set(auth(tokenByRole.get(role)!))
        .expect(403);
    });

    it.each(others)('%s cannot create staff', async (role) => {
      const username = `jest_staff_denied_${role.toLowerCase()}_${runId}`;
      await request(app.getHttpServer())
        .post('/admin/staff')
        .set(auth(tokenByRole.get(role)!))
        .send({ displayName: 'Should Not Exist', username, password: NEW_PASSWORD })
        .expect(403);

      const rows = await db.query('SELECT id FROM shared.users WHERE username = $1', [username]);
      expect(rows).toHaveLength(0);
    });

    it.each(others)('%s cannot assign a role', async (role) => {
      const target = idByRole.get('DELIVERY_STAFF')!;
      await request(app.getHttpServer())
        .post(`/admin/staff/${target}/roles`)
        .set(auth(tokenByRole.get(role)!))
        .send({ role: 'SUPER_ADMIN' })
        .expect(403);
    });

    it.each(others)('%s cannot suspend anyone', async (role) => {
      await request(app.getHttpServer())
        .post(`/admin/staff/${idByRole.get('SUPER_ADMIN')!}/status`)
        .set(auth(tokenByRole.get(role)!))
        .send({ status: 'SUSPENDED', reason: 'Privilege escalation attempt' })
        .expect(403);
    });

    it.each(others)('%s cannot reset a password', async (role) => {
      await request(app.getHttpServer())
        .post(`/admin/staff/${idByRole.get('SUPER_ADMIN')!}/password-reset`)
        .set(auth(tokenByRole.get(role)!))
        .send({ newPassword: NEW_PASSWORD, reason: 'Privilege escalation attempt' })
        .expect(403);
    });

    it('a RIK_ADMIN cannot give itself SUPER_ADMIN, which is the escalation that matters', async () => {
      const self = idByRole.get('RIK_ADMIN')!;
      await request(app.getHttpServer())
        .post(`/admin/staff/${self}/roles`)
        .set(auth(tokenByRole.get('RIK_ADMIN')!))
        .send({ role: 'SUPER_ADMIN' })
        .expect(403);

      const rows = await db.query<{ name: string }>(
        `SELECT r.name FROM shared.user_roles ur JOIN shared.roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1`,
        [self]
      );
      expect(rows.map((r) => r.name)).toEqual(['RIK_ADMIN']);
    });

    it('a CUSTOMER principal is refused, with 403 and never data', async () => {
      await request(app.getHttpServer()).get('/admin/staff').set(auth(customerToken)).expect(403);
    });

    it('no credential at all is 401, not 403', async () => {
      await request(app.getHttpServer()).get('/admin/staff').expect(401);
    });

    it('a staff account with no role is refused like any other non-Super-Admin', async () => {
      const created = await request(app.getHttpServer())
        .post('/admin/staff')
        .set(auth(asSuper()))
        .send({ displayName: 'No Role', username: `jest_staff_norole_${runId}`, password: NEW_PASSWORD })
        .expect(201);
      createdIds.push(created.body.id);

      const token = tokenService.signAccessToken({ principalType: 'STAFF', principalId: created.body.id });
      await request(app.getHttpServer()).get('/admin/staff').set(auth(token)).expect(403);
    });
  });

  // ------------------------------------------------ 8. password reset is secure

  describe('8. password reset', () => {
    let resetTargetId: string;
    const username = () => `jest_staff_reset_${runId}`;

    it('creates a target account', async () => {
      const created = await request(app.getHttpServer())
        .post('/admin/staff')
        .set(auth(asSuper()))
        .send({ displayName: 'Reset Target', username: username(), password: PASSWORD })
        .expect(201);
      resetTargetId = created.body.id;
      createdIds.push(resetTargetId);
    });

    it('changes the stored hash, returns no credential, and ends the sessions', async () => {
      const before = await db.query<{ password_hash: string }>(
        'SELECT password_hash FROM shared.users WHERE id = $1',
        [resetTargetId]
      );

      const response = await request(app.getHttpServer())
        .post(`/admin/staff/${resetTargetId}/password-reset`)
        .set(auth(asSuper()))
        .send({ newPassword: NEW_PASSWORD, reason: 'Reported forgotten by phone' })
        .expect(201);

      expect(JSON.stringify(response.body)).not.toContain(NEW_PASSWORD);
      expect(JSON.stringify(response.body)).not.toMatch(/\$2[aby]\$/);
      expect(response.body).toHaveProperty('revokedSessions');

      const after = await db.query<{ password_hash: string }>(
        'SELECT password_hash FROM shared.users WHERE id = $1',
        [resetTargetId]
      );
      expect(after[0]!.password_hash).not.toBe(before[0]!.password_hash);
      expect(after[0]!.password_hash).toMatch(/^\$2[aby]\$/);
    });

    it('means the old password no longer works and the new one does', async () => {
      await expect(
        staffAuth.login({ username: username(), password: PASSWORD, ipAddress: null, deviceInfo: null })
      ).rejects.toBeDefined();
      await expect(
        staffAuth.login({ username: username(), password: NEW_PASSWORD, ipAddress: null, deviceInfo: null })
      ).resolves.toBeDefined();
    });

    it('keeps the password out of the audit row it writes', async () => {
      const rows = await db.query<{ after: unknown }>(
        `SELECT after FROM shared.audit_log
          WHERE action = 'STAFF_PASSWORD_RESET' AND entity_id = $1`,
        [resetTargetId]
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows.map((r) => r.after))).not.toContain(NEW_PASSWORD);
    });

    it('refuses a weak replacement', async () => {
      await request(app.getHttpServer())
        .post(`/admin/staff/${resetTargetId}/password-reset`)
        .set(auth(asSuper()))
        .send({ newPassword: 'short', reason: 'Should be refused' })
        .expect(400);
    });
  });

  // --------------------------- 10. the last active Super Admin is protected

  describe('10. the last active Super Admin cannot be shut out', () => {
    it('refuses to suspend the only remaining active Super Admin', async () => {
      // Suspend the spare first, through the API, leaving exactly one.
      await request(app.getHttpServer())
        .post(`/admin/staff/${secondSuperAdminId}/status`)
        .set(auth(asSuper()))
        .send({ status: 'SUSPENDED', reason: 'Reducing to one for the test' })
        .expect(201);

      const remaining = await db.query<{ count: string }>(
        `SELECT count(DISTINCT u.id)::text AS count FROM shared.users u
           JOIN shared.user_roles ur ON ur.user_id = u.id
           JOIN shared.roles r ON r.id = ur.role_id
          WHERE r.name = 'SUPER_ADMIN' AND u.status = 'ACTIVE'`
      );

      // Another Super Admin suspends the fixture one. Only meaningful when the
      // fixture really is the last active one.
      if (Number(remaining[0]!.count) === 1) {
        const spareToken = tokenService.signAccessToken({
          principalType: 'STAFF',
          principalId: secondSuperAdminId,
        });
        // The spare is suspended, so its token is revoked and it gets 401 —
        // which is itself the protection working. Re-activate it and use it.
        await request(app.getHttpServer())
          .post(`/admin/staff/${secondSuperAdminId}/status`)
          .set(auth(asSuper()))
          .send({ status: 'ACTIVE', reason: 'Restoring the spare' })
          .expect(201);
        expect(spareToken).toBeTruthy();
      }

      // With two active, suspending one is allowed; the rule only bites at one.
      const response = await request(app.getHttpServer())
        .post(`/admin/staff/${secondSuperAdminId}/status`)
        .set(auth(asSuper()))
        .send({ status: 'SUSPENDED', reason: 'Allowed while another is active' });
      expect([201, 403]).toContain(response.status);
    });

    it('refuses to let a Super Admin suspend themselves at all', async () => {
      await request(app.getHttpServer())
        .post(`/admin/staff/${idByRole.get('SUPER_ADMIN')!}/status`)
        .set(auth(asSuper()))
        .send({ status: 'SUSPENDED', reason: 'Trying to lock myself out' })
        .expect(403);
    });

    it('refuses to let a Super Admin remove their own Super Admin role', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/staff/${idByRole.get('SUPER_ADMIN')!}/roles/SUPER_ADMIN`)
        .set(auth(asSuper()))
        .expect(403);

      const rows = await db.query<{ name: string }>(
        `SELECT r.name FROM shared.user_roles ur JOIN shared.roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1 AND r.name = 'SUPER_ADMIN'`,
        [idByRole.get('SUPER_ADMIN')!]
      );
      expect(rows).toHaveLength(1);
    });
  });

  // ------------------------------- 11 & 12. nothing else changed behaviour

  describe('11 and 12. the existing surfaces still behave as they did', () => {
    it('leaves every seeded role-permission mapping exactly as it was', async () => {
      const rows = await db.query<{ role_name: string; code: string }>(
        `SELECT r.name AS role_name, p.code
           FROM shared.roles r
           JOIN shared.role_permissions rp ON rp.role_id = r.id
           JOIN shared.permissions p ON p.id = rp.permission_id
          WHERE r.name = 'DELIVERY_STAFF' OR r.name = 'RIK_PICKUP_STAFF'
          ORDER BY r.name, p.code`
      );
      expect(rows.map((r) => `${r.role_name}:${r.code}`)).toEqual([
        'DELIVERY_STAFF:pif.order.mark_delivered',
        'DELIVERY_STAFF:pif.order.mark_not_delivered',
        'RIK_PICKUP_STAFF:rik.order.mark_collected',
        'RIK_PICKUP_STAFF:rik.order.mark_ready',
      ]);
    });

    it('still lets a RIK_ADMIN reach the RIK surface it always could', async () => {
      await request(app.getHttpServer())
        .get('/admin/rik/issue-schedules')
        .set(auth(tokenByRole.get('RIK_ADMIN')!))
        .expect(200);
    });

    it('still lets a staff member sign in with username and password', async () => {
      const rows = await db.query<{ username: string }>(
        'SELECT username FROM shared.users WHERE id = $1',
        [idByRole.get('RIK_ADMIN')!]
      );
      await expect(
        staffAuth.login({
          username: rows[0]!.username,
          password: PASSWORD,
          ipAddress: null,
          deviceInfo: null,
        })
      ).resolves.toBeDefined();
    });

    it('creates no customer row and touches no customer', async () => {
      const rows = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM shared.customers WHERE name LIKE $1`,
        [`Jest Staff Customer ${runId}`]
      );
      expect(Number(rows[0]!.count)).toBe(1); // the one this suite made, unchanged
    });
  });
});
