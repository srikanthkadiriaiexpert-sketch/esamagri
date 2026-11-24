import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { STAFF_ROLES, type StaffRole } from '@esamagri/shared-types';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';

/**
 * STEP 10 FINAL VERIFICATION — the complete role × route authorization
 * matrix, exercised over real HTTP against the real database.
 *
 * This file adds no product behaviour. It exists because "the navigation
 * hides it" is not evidence of anything: every principal below carries a
 * real signed access token and a real `shared.user_roles` grant, and every
 * request goes through the real guards to the real controller. The matrix
 * it prints is the authorization boundary as the server actually enforces
 * it — including the cases where the answer is uncomfortable (see
 * SUPER_ADMIN on the RIK issue-schedule route).
 *
 * Expected statuses are derived from the approved seed's grants, not from
 * what a role's NAME suggests it ought to be able to do.
 */

interface RouteSpec {
  label: string;
  method: 'get' | 'post';
  path: string;
  /** Permission the seed requires, or null for the staff-only routes. */
  permission: string | null;
  body?: Record<string, unknown>;
}

/**
 * The permissions each role holds in the approved seed, transcribed so the
 * expected status for every cell exists when Jest collects the tests. The
 * first test below re-reads shared.role_permissions and fails if this table
 * has drifted from the database, so it can never quietly become fiction.
 */
const SEEDED_GRANTS: Record<StaffRole, readonly string[]> = {
  // PHASE F: SUPER_ADMIN — "the overall boss of both entities" — now holds
  // both modules EXPLICITLY, as rows added by migration 0050. Until then it
  // held only shared.* codes and every rik.*/pif.* route refused it, which
  // was STEP 10's finding F-2. The four superseded codes (pif.pos.*,
  // pif.purchase_order.approve) are deliberately NOT granted: they govern a
  // point of sale and a purchasing workflow the corrected scope excludes.
  SUPER_ADMIN: [
    'shared.announcement.manage',
    'shared.audit_log.view',
    'shared.role.grant',
    'shared.settings.write',
    'shared.user.manage',
    'rik.entitlement.adjust',
    'rik.entitlement.allocate',
    'rik.issue_schedule.manage',
    'rik.order.manage',
    'rik.order.mark_collected',
    'rik.order.mark_ready',
    'rik.product.manage',
    'pif.order.manage',
    'pif.order.mark_delivered',
    'pif.order.mark_not_delivered',
    'pif.order.prepare',
    'pif.product.manage',
    'pif.report.view',
  ],
  RIK_ADMIN: [
    'rik.entitlement.adjust',
    'rik.entitlement.allocate',
    'rik.issue_schedule.manage',
    'rik.order.manage',
    'rik.product.manage',
    'shared.announcement.manage',
  ],
  // PHASE F added pif.order.manage and pif.order.prepare: the seed had no
  // permission that governed a PIF order at all.
  PIF_ADMIN: [
    'pif.order.manage',
    'pif.order.prepare',
    'pif.product.manage',
    'pif.purchase_order.approve',
    'pif.report.view',
    'shared.announcement.manage',
  ],
  // The authorized PIF staff member: picks and packs, and nothing else. The
  // three pos.* codes remain granted and remain unused by any route.
  PIF_CASHIER: [
    'pif.order.prepare',
    'pif.pos.finalize_bill',
    'pif.pos.open_bill',
    'pif.pos.return',
  ],
  RIK_PICKUP_STAFF: ['rik.order.mark_collected', 'rik.order.mark_ready'],
  DELIVERY_STAFF: ['pif.order.mark_delivered', 'pif.order.mark_not_delivered'],
};

const ROUTES: readonly RouteSpec[] = [
  { label: 'GET /admin/session', method: 'get', path: '/admin/session', permission: null },
  { label: 'GET /admin/dashboard', method: 'get', path: '/admin/dashboard', permission: null },
  { label: 'GET /admin/announcements', method: 'get', path: '/admin/announcements', permission: 'shared.announcement.manage' },
  {
    label: 'POST /admin/announcements',
    method: 'post',
    path: '/admin/announcements',
    permission: 'shared.announcement.manage',
    body: {
      title: 'RBAC matrix probe',
      body: 'This request exists to verify authorization only.',
      announcementType: 'GENERAL',
      targetAudience: 'ALL',
      priority: 'NORMAL',
      isPublished: false,
    },
  },
  { label: 'GET /admin/rik/issue-schedules', method: 'get', path: '/admin/rik/issue-schedules', permission: 'rik.issue_schedule.manage' },
  // Staff administration. Only the READS are in this matrix: a POST here would
  // create a real staff account that this spec's teardown does not know about,
  // so the write surface is authorized in staff.integration.spec.ts, which owns
  // its own fixtures. These two still prove the point that matters for the
  // matrix — `shared.user.manage` is held by SUPER_ADMIN alone, so every other
  // seeded role is refused the staff list and the role catalogue.
  { label: 'GET /admin/staff', method: 'get', path: '/admin/staff', permission: 'shared.user.manage' },
  { label: 'GET /admin/staff/roles', method: 'get', path: '/admin/staff/roles', permission: 'shared.user.manage' },
];

describe('STEP 10 verification — role × route authorization matrix (real HTTP, real database)', () => {
  let app: INestApplication;
  let db: DatabaseService;

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '5');

  const staffIdByRole = new Map<StaffRole, string>();
  const tokenByRole = new Map<StaffRole, string>();
  const permissionsByRole = new Map<StaffRole, Set<string>>();
  const createdAnnouncementIds: string[] = [];
  let customerId: string;
  let customerToken: string;

  const observed: { principal: string; route: string; status: number; expected: number }[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    const tokenService = app.get(TokenService);
    const passwordHash = await app.get(PasswordService).hash('CorrectHorseBatteryStaple!1');

    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    const grantedBy = bootstrap[0]!.id;

    for (const role of STAFF_ROLES) {
      const rows = await db.query<{ id: string }>(
        `INSERT INTO shared.users (id, username, password_hash, display_name, status)
         VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
        [`jest_rbacm_${role.toLowerCase()}_${runId}`, passwordHash, `RBAC matrix ${role} ${runId}`]
      );
      const id = rows[0]!.id;
      staffIdByRole.set(role, id);
      await db.query(
        `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
         SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3`,
        [id, grantedBy, role]
      );
      tokenByRole.set(role, tokenService.signAccessToken({ principalType: 'STAFF', principalId: id }));

      // The permissions this role ACTUALLY holds, read back from the seed.
      const grants = await db.query<{ code: string }>(
        `SELECT p.code
           FROM shared.roles r
           JOIN shared.role_permissions rp ON rp.role_id = r.id
           JOIN shared.permissions p ON p.id = rp.permission_id
          WHERE r.name = $1`,
        [role]
      );
      permissionsByRole.set(role, new Set(grants.map((g) => g.code)));
    }

    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active)
       VALUES (shared.uuid_generate_v7(), $1, $2, true) RETURNING id`,
      [`+91779${digits.slice(0, 7)}`, `RBAC matrix customer ${runId}`]
    );
    customerId = customer[0]!.id;
    customerToken = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerId });
  });

  afterAll(async () => {
    const staffIds = [...staffIdByRole.values()];
    if (createdAnnouncementIds.length > 0) {
      await db.query(
        `UPDATE shared.announcements
            SET deleted_at = now(), created_by = NULL, updated_by = NULL
          WHERE id = ANY($1::uuid[])`,
        [createdAnnouncementIds]
      );
    }
    await db.query('DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])', [[...staffIds, customerId]]);
    await db.query('DELETE FROM shared.user_roles WHERE user_id = ANY($1::uuid[])', [staffIds]);
    await db.query('DELETE FROM shared.users WHERE id = ANY($1::uuid[])', [staffIds]);
    await db.query('DELETE FROM shared.customers WHERE id = $1', [customerId]);
    await app.close();

    // The matrix, printed so the closure report quotes measurements rather
    // than assertions about measurements.
    const width = Math.max(...observed.map((o) => o.principal.length));
    // eslint-disable-next-line no-console
    console.log('\n--- STEP 10 authorization matrix (observed HTTP status) ---');
    for (const route of ROUTES) {
      // eslint-disable-next-line no-console
      console.log(`\n${route.label}`);
      for (const row of observed.filter((o) => o.route === route.label)) {
        // eslint-disable-next-line no-console
        console.log(`  ${row.principal.padEnd(width)}  ${row.status}${row.status === row.expected ? '' : `  (EXPECTED ${row.expected})`}`);
      }
    }
  });

  async function probe(principal: string, authorization: string | null, route: RouteSpec, expected: number) {
    const agent = request(app.getHttpServer());
    const req = route.method === 'post' ? agent.post(route.path).send(route.body ?? {}) : agent.get(route.path);
    if (authorization) req.set('Authorization', authorization);
    const res = await req;
    observed.push({ principal, route: route.label, status: res.status, expected });
    if (route.method === 'post' && res.status === 201 && res.body?.id) {
      createdAnnouncementIds.push(res.body.id as string);
    }
    expect({ principal, route: route.label, status: res.status }).toEqual({
      principal,
      route: route.label,
      status: expected,
    });
  }

  // ------------------------------------------------- the table is not fiction
  describe('the transcribed seed matches the live database', () => {
    for (const role of STAFF_ROLES) {
      it(`${role} holds exactly the permissions this file claims`, () => {
        expect([...permissionsByRole.get(role)!].sort()).toEqual([...SEEDED_GRANTS[role]].sort());
      });
    }
  });

  // ------------------------------------------------------------ 401 layer
  describe('unauthenticated -> 401 on every admin route', () => {
    for (const route of ROUTES) {
      it(`${route.label} with no credential -> 401`, async () => {
        await probe('(no credential)', null, route, 401);
      });
    }
  });

  // ------------------------------------------------------- CUSTOMER layer
  describe('CUSTOMER principal -> 403 on every staff route (never 401, never data)', () => {
    for (const route of ROUTES) {
      it(`${route.label} as CUSTOMER -> 403`, async () => {
        await probe('CUSTOMER', `Bearer ${customerToken}`, route, 403);
      });
    }
  });

  // ---------------------------------------------------------- staff layer
  describe('each staff role against every admin route, expectation derived from the seed', () => {
    for (const role of STAFF_ROLES) {
      for (const route of ROUTES) {
        const expected = expectedStatusFor(role, route);
        it(`${route.label} as ${role} -> ${expected}`, async () => {
          await probe(role, `Bearer ${tokenByRole.get(role)!}`, route, expected);
        });
      }
    }
  });

  /**
   * A staff principal reaches a permission-free route (200); a
   * permission-gated route needs the seed's grant (200/201), otherwise 403.
   * POST /admin/announcements additionally carries the ALL audience, which
   * the module-scope rule reserves to an 'ANY'-scoped role — so a module
   * admin holding the permission is still refused, and that refusal is part
   * of the matrix rather than an exception to it.
   */
  function expectedStatusFor(role: StaffRole, route: RouteSpec): number {
    if (route.permission === null) return 200;
    const held = SEEDED_GRANTS[role].includes(route.permission);
    if (!held) return 403;
    if (route.method === 'post') return role === 'SUPER_ADMIN' ? 201 : 403;
    return 200;
  }
});
