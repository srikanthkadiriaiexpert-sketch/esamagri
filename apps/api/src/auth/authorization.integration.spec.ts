import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { STAFF_ROLES, PERMISSION_CODES, type StaffRole } from '@esamagri/shared-types';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { AuthorizationService } from './services/authorization.service';
import { UserRolesRepository } from '../shared/repositories/user-roles.repository';

/**
 * Real-Postgres + real-HTTP integration test for STEP 7 (server-side
 * RBAC / authorization foundation). Boots the real AppModule (same DI
 * graph main.ts uses, including AuthorizationDemoController — see that
 * file's doc for why it exists) against `esamagri_test`, and exercises
 * JwtAuthGuard + AuthorizationGuard together over actual HTTP requests
 * wherever the STEP 7 kickoff's 26-item test list is naturally
 * HTTP-shaped, plus direct-service real-DB checks (permission
 * resolution) where a raw query proves the point more directly than
 * another HTTP round trip.
 *
 * Test data: two shared.customers rows and one shared.users row per
 * approved staff role (SUPER_ADMIN, RIK_ADMIN, PIF_ADMIN, PIF_CASHIER,
 * RIK_PICKUP_STAFF, DELIVERY_STAFF) plus one staff account with ZERO
 * role grants — all tagged with a random per-run suffix, all deleted
 * in afterAll (shared.user_roles rows first, for the FK; shared.
 * audit_log rows are left in place, same reasoning as
 * auth.integration.spec.ts's afterAll: the table is append-only by
 * design and no application role holds DELETE on it).
 *
 * PURCHASING is deliberately absent from every test below: the STEP 7
 * kickoff names a PURCHASING role, but no such role (or any
 * purchasing-specific permission set) exists anywhere in the approved
 * database (migrations 0003/0019/0023) — see the STEP 7 report's
 * AUTHORIZATION_CONTRACT_MISMATCH section. Fabricating one here would
 * be exactly the "invent a role" the kickoff itself forbids.
 */
describe('Authorization / RBAC (STEP 7, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let passwordService: PasswordService;
  let tokenService: TokenService;
  let authorizationService: AuthorizationService;
  let userRolesRepository: UserRolesRepository;
  let jwt: JwtService;

  const runId = randomUUID().slice(0, 8);
  const staffPassword = 'CorrectHorseBatteryStaple!1';

  let bootstrapSuperAdminId: string;
  let customerAId: string;
  let customerBId: string;
  const staffIdByRole = new Map<StaffRole, string>();
  let noRoleStaffId: string;
  const tokenByPersona = new Map<string, string>();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    db = app.get(DatabaseService);
    passwordService = app.get(PasswordService);
    tokenService = app.get(TokenService);
    authorizationService = app.get(AuthorizationService);
    userRolesRepository = app.get(UserRolesRepository);
    jwt = app.get(JwtService);

    const bootstrapRows = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    bootstrapSuperAdminId = bootstrapRows[0].id;

    const customerRows = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active)
       VALUES (shared.uuid_generate_v7(), $1, $2, true),
              (shared.uuid_generate_v7(), $3, $4, true)
       RETURNING id`,
      [
        `+91903${runId.replace(/[^0-9]/g, '').padEnd(7, '1').slice(0, 7)}`,
        `Jest RBAC Customer A ${runId}`,
        `+91904${runId.replace(/[^0-9]/g, '').padEnd(7, '2').slice(0, 7)}`,
        `Jest RBAC Customer B ${runId}`,
      ]
    );
    customerAId = customerRows[0].id;
    customerBId = customerRows[1].id;
    tokenByPersona.set('customerA', tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerAId }));
    tokenByPersona.set('customerB', tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerBId }));

    const passwordHash = await passwordService.hash(staffPassword);

    for (const role of STAFF_ROLES) {
      const username = `jest_rbac_${role.toLowerCase()}_${runId}`;
      const rows = await db.query<{ id: string }>(
        `INSERT INTO shared.users (id, username, password_hash, display_name, status)
         VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
        [username, passwordHash, `Jest RBAC ${role} ${runId}`]
      );
      const userId = rows[0].id;
      staffIdByRole.set(role, userId);
      await db.query(
        `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
         SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3`,
        [userId, bootstrapSuperAdminId, role]
      );
      tokenByPersona.set(role, tokenService.signAccessToken({ principalType: 'STAFF', principalId: userId }));
    }

    const noRoleRows = await db.query<{ id: string }>(
      `INSERT INTO shared.users (id, username, password_hash, display_name, status)
       VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
      [`jest_rbac_no_role_${runId}`, passwordHash, `Jest RBAC No Role ${runId}`]
    );
    noRoleStaffId = noRoleRows[0].id;
    tokenByPersona.set('NO_ROLE', tokenService.signAccessToken({ principalType: 'STAFF', principalId: noRoleStaffId }));
  });

  afterAll(async () => {
    const allStaffIds = [...staffIdByRole.values(), noRoleStaffId];
    await db.query('DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])', [
      [...allStaffIds, customerAId, customerBId],
    ]);
    await db.query('DELETE FROM shared.user_roles WHERE user_id = ANY($1::uuid[])', [allStaffIds]);
    await db.query('DELETE FROM shared.users WHERE id = ANY($1::uuid[])', [allStaffIds]);
    await db.query('DELETE FROM shared.customers WHERE id = ANY($1::uuid[])', [[customerAId, customerBId]]);
    await app.close();
  });

  function bearer(persona: string): string {
    const token = tokenByPersona.get(persona);
    if (!token) throw new Error(`No token minted for persona "${persona}"`);
    return `Bearer ${token}`;
  }

  // --- #1, #17, #18: authentication failures stay 401, never 403 -----------
  describe('401 — authentication failures (JwtAuthGuard, unchanged from STEP 6)', () => {
    it('no Authorization header at all -> 401', async () => {
      await request(app.getHttpServer()).get('/demo/authz/admin/users').expect(401);
    });

    it('a syntactically-invalid bearer token -> 401', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/admin/users')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);
    });

    it('a well-formed but expired token -> 401 (never 403)', async () => {
      const expired = jwt.sign(
        { sub: staffIdByRole.get('SUPER_ADMIN'), type: 'STAFF' },
        { expiresIn: '-10s' }
      );
      await request(app.getHttpServer())
        .get('/demo/authz/admin/users')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
    });

    it('a token signed with the wrong secret (forged) -> 401', async () => {
      const foreignJwt = new JwtService({ secret: 'a-completely-different-secret-value-xx' });
      const forged = foreignJwt.sign({ sub: staffIdByRole.get('SUPER_ADMIN'), type: 'STAFF' });
      await request(app.getHttpServer())
        .get('/demo/authz/admin/users')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });
  });

  // --- #2, #4, #20, #25: customer self-access + horizontal escalation -----
  describe('customer ownership (own-resource vs horizontal privilege escalation)', () => {
    it('a customer may fetch their OWN profile', async () => {
      const res = await request(app.getHttpServer())
        .get(`/demo/authz/customer/${customerAId}/profile`)
        .set('Authorization', bearer('customerA'))
        .expect(200);
      expect(res.body.customerId).toBe(customerAId);
    });

    it('a customer may NOT fetch another customer\'s profile by changing the URL id -> 403', async () => {
      await request(app.getHttpServer())
        .get(`/demo/authz/customer/${customerBId}/profile`)
        .set('Authorization', bearer('customerA'))
        .expect(403);
    });

    it('a customer hitting an admin endpoint -> 403, not 401', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/admin/users')
        .set('Authorization', bearer('customerA'))
        .expect(403);
    });

    it('a STAFF principal cannot use the customer own-profile route at all, even with a matching id', async () => {
      await request(app.getHttpServer())
        .get(`/demo/authz/customer/${staffIdByRole.get('RIK_ADMIN')}/profile`)
        .set('Authorization', bearer('RIK_ADMIN'))
        .expect(403);
    });
  });

  // --- #5-#8, #21: cross-module isolation ---------------------------------
  describe('cross-module isolation (RIK vs PIF)', () => {
    it('RIK_ADMIN -> permitted RIK operation -> 200', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/rik/admin')
        .set('Authorization', bearer('RIK_ADMIN'))
        .expect(200);
    });

    it('RIK_ADMIN -> PIF administration -> 403', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/pif/admin')
        .set('Authorization', bearer('RIK_ADMIN'))
        .expect(403);
    });

    it('PIF_ADMIN -> permitted PIF operation -> 200', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/pif/admin')
        .set('Authorization', bearer('PIF_ADMIN'))
        .expect(200);
    });

    it('PIF_ADMIN -> RIK administration -> 403', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/rik/admin')
        .set('Authorization', bearer('PIF_ADMIN'))
        .expect(403);
    });
  });

  // --- #9-#12, #24, #26: CASHIER / DELIVERY, permitted + restricted -------
  describe('PIF_CASHIER and DELIVERY_STAFF — narrow permitted scope, no admin inheritance', () => {
    it('PIF_CASHIER -> permitted POS operation -> 200', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/pif/pos')
        .set('Authorization', bearer('PIF_CASHIER'))
        .expect(200);
    });

    it('PIF_CASHIER -> restricted admin operation -> 403 (no automatic PIF_ADMIN/SUPER_ADMIN inheritance)', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/admin/users')
        .set('Authorization', bearer('PIF_CASHIER'))
        .expect(403);
      await request(app.getHttpServer())
        .get('/demo/authz/pif/admin')
        .set('Authorization', bearer('PIF_CASHIER'))
        .expect(403);
    });

    it('DELIVERY_STAFF -> permitted delivery operation -> 200', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/pif/delivery')
        .set('Authorization', bearer('DELIVERY_STAFF'))
        .expect(200);
    });

    it('DELIVERY_STAFF -> restricted operation -> 403', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/pif/admin')
        .set('Authorization', bearer('DELIVERY_STAFF'))
        .expect(403);
    });

    it('RIK_PICKUP_STAFF -> permitted pickup operation -> 200, and -> PIF POS -> 403 (cross-module)', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/rik/pickup')
        .set('Authorization', bearer('RIK_PICKUP_STAFF'))
        .expect(200);
      await request(app.getHttpServer())
        .get('/demo/authz/pif/pos')
        .set('Authorization', bearer('RIK_PICKUP_STAFF'))
        .expect(403);
    });
  });

  // --- #15: SUPER_ADMIN — approved authority, but NOT a bypass ------------
  describe('SUPER_ADMIN — approved administrative authority, still gated by real permission grants (no blanket bypass)', () => {
    it('SUPER_ADMIN -> its own approved operation (shared.user.manage) -> 200', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/admin/users')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .expect(200);
    });

    it('SUPER_ADMIN passes rik./pif.product.manage because it was GRANTED them, and still fails a permission it was not', async () => {
      // The model is still non-hierarchical: nothing about the name
      // "SUPER_ADMIN" passes a check. PHASE F granted it rik.product.manage
      // and pif.product.manage as rows (migration 0050), so those two now
      // succeed — and pif.pos.open_bill, which was deliberately NOT granted
      // because the corrected PIF scope has no point of sale, still fails.
      // That contrast is the point of this test.
      await request(app.getHttpServer())
        .get('/demo/authz/rik/admin')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .expect(200);
      await request(app.getHttpServer())
        .get('/demo/authz/pif/admin')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .expect(200);
      await request(app.getHttpServer())
        .get('/demo/authz/pif/pos')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .expect(403);
    });
  });

  // --- #16, #24, #26: missing permission / vertical privilege escalation --
  describe('a staff account with zero role grants (vertical privilege escalation baseline)', () => {
    it('is rejected (403, not 401 — it IS authenticated) from every permission-gated route', async () => {
      for (const path of ['/demo/authz/rik/admin', '/demo/authz/pif/admin', '/demo/authz/pif/pos', '/demo/authz/admin/users']) {
        await request(app.getHttpServer()).get(path).set('Authorization', bearer('NO_ROLE')).expect(403);
      }
    });
  });

  // --- #19: role spoofing is rejected (server never trusts client-asserted role) --
  describe('role spoofing attempts are ignored entirely', () => {
    it('a spoofed "role" field in the request body has zero effect on a 403', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/admin/users')
        .set('Authorization', bearer('NO_ROLE'))
        .send({ role: 'SUPER_ADMIN', permissions: ['shared.user.manage'] })
        .expect(403);
    });

    it('a spoofed x-role header has zero effect on a 403', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/admin/users')
        .set('Authorization', bearer('NO_ROLE'))
        .set('x-role', 'SUPER_ADMIN')
        .set('x-permissions', 'shared.user.manage')
        .expect(403);
    });

    it('a JWT payload naming a role/permissions claim directly is ignored — access tokens carry only sub/type (see TokenService)', async () => {
      // Same secret as the app (so the signature itself is valid) but
      // with extra claims a naive implementation might read instead of
      // querying the database — AuthorizationGuard never looks at the
      // JWT payload for anything beyond what JwtAuthGuard already
      // extracted (principalType/principalId), so this must still 403.
      const tamperedButValidlySigned = jwt.sign({
        sub: noRoleStaffId,
        type: 'STAFF',
        role: 'SUPER_ADMIN',
        permissions: ['shared.user.manage'],
      });
      await request(app.getHttpServer())
        .get('/demo/authz/admin/users')
        .set('Authorization', `Bearer ${tamperedButValidlySigned}`)
        .expect(403);
    });
  });

  // --- #22: announcement audience restriction (module-scope mechanism) ----
  describe('announcement audience module-scope check (Section 16 mechanism, no announcement CRUD)', () => {
    it('RIK_ADMIN may act on the rik audience but not the pif audience', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/announcements/rik')
        .set('Authorization', bearer('RIK_ADMIN'))
        .expect(200);
      await request(app.getHttpServer())
        .get('/demo/authz/announcements/pif')
        .set('Authorization', bearer('RIK_ADMIN'))
        .expect(403);
    });

    it('PIF_ADMIN may act on the pif audience but not the rik audience', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/announcements/pif')
        .set('Authorization', bearer('PIF_ADMIN'))
        .expect(200);
      await request(app.getHttpServer())
        .get('/demo/authz/announcements/rik')
        .set('Authorization', bearer('PIF_ADMIN'))
        .expect(403);
    });

    it('SUPER_ADMIN may act on any audience (ANY module scope)', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/announcements/rik')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .expect(200);
      await request(app.getHttpServer())
        .get('/demo/authz/announcements/pif')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .expect(200);
      await request(app.getHttpServer())
        .get('/demo/authz/announcements/shared')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .expect(200);
    });

    it('a role without shared.announcement.manage at all is rejected before the audience is even considered', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/announcements/pif')
        .set('Authorization', bearer('PIF_CASHIER'))
        .expect(403);
    });

    it('an invalid audience value is a 400, not a 500 or a silent pass', async () => {
      await request(app.getHttpServer())
        .get('/demo/authz/announcements/not-a-real-module')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .expect(400);
    });
  });

  // --- #23: permission lookup behavior (real DB, no mocking) --------------
  describe('permission lookup behavior — direct, real-database resolution', () => {
    it('RIK_PICKUP_STAFF resolves to exactly its two seeded permissions, nothing more', async () => {
      const resolved = await userRolesRepository.resolveForUser(staffIdByRole.get('RIK_PICKUP_STAFF')!);
      expect(new Set(resolved.permissions)).toEqual(new Set(['rik.order.mark_ready', 'rik.order.mark_collected']));
      expect(resolved.roles).toEqual(['RIK_PICKUP_STAFF']);
    });

    it('a staff account with zero role grants resolves to empty roles/permissions, not an error', async () => {
      const resolved = await userRolesRepository.resolveForUser(noRoleStaffId);
      expect(resolved.roles).toEqual([]);
      expect(resolved.permissions).toEqual([]);
    });

    it('AuthorizationService.resolveContext for a CUSTOMER never touches shared.user_roles and is always empty', async () => {
      const context = await authorizationService.resolveContext({ principalType: 'CUSTOMER', principalId: customerAId });
      expect(context.roles.size).toBe(0);
      expect(context.permissions.size).toBe(0);
    });

    it('the @esamagri/shared-types role/permission mirrors match the live database exactly (drift guard)', async () => {
      const dbRoles = await db.query<{ name: string }>('SELECT name FROM shared.roles ORDER BY name');
      expect(new Set(dbRoles.map((r) => r.name))).toEqual(new Set(STAFF_ROLES));

      const dbPermissions = await db.query<{ code: string }>('SELECT code FROM shared.permissions ORDER BY code');
      expect(new Set(dbPermissions.map((p) => p.code))).toEqual(new Set(PERMISSION_CODES));
    });
  });

  // --- #3, #13/#14 (PURCHASING — documented absence, not fabricated) ------
  describe('PURCHASING role — AUTHORIZATION_CONTRACT_MISMATCH, not implemented', () => {
    it('no role named PURCHASING (or any variant) exists in the approved database', async () => {
      const rows = await db.query<{ name: string }>(`SELECT name FROM shared.roles WHERE name ILIKE '%purchas%'`);
      expect(rows).toEqual([]);
    });

    it('no permission code for a dedicated purchasing role exists — only pif.purchase_order.approve, granted to PIF_ADMIN', async () => {
      const rows = await db.query<{ code: string; role_name: string }>(
        `SELECT p.code, r.name AS role_name
         FROM shared.role_permissions rp
         JOIN shared.permissions p ON p.id = rp.permission_id
         JOIN shared.roles r ON r.id = rp.role_id
         WHERE p.code ILIKE '%purchas%'`
      );
      expect(rows).toEqual([{ code: 'pif.purchase_order.approve', role_name: 'PIF_ADMIN' }]);
    });
  });
});
