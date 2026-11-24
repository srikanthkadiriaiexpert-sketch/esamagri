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

/**
 * STEP 10 — admin/staff API foundation, over real HTTP against real
 * PostgreSQL, using the approved role/permission seed exactly as it
 * exists in the frozen database.
 *
 * The point of this suite is role ISOLATION proven by direct API calls,
 * not by UI navigation: every persona below holds a genuinely-signed
 * token for a real staff row with real role grants, and each is pointed
 * at endpoints it should and should not reach.
 *
 * PURCHASING is absent throughout, deliberately: no such role exists in
 * the approved seed (shared.roles holds SUPER_ADMIN, RIK_ADMIN,
 * PIF_ADMIN, PIF_CASHIER, RIK_PICKUP_STAFF, DELIVERY_STAFF). Inventing
 * one to satisfy a test would be inventing a role — reported instead.
 */
describe('Admin/staff API (STEP 10, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '7');

  const staffIdByRole = new Map<StaffRole, string>();
  const tokenByRole = new Map<StaffRole, string>();
  let customerId: string;
  let customerToken: string;
  let noRoleStaffId: string;
  let noRoleToken: string;
  const createdAnnouncementIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    tokenService = app.get(TokenService);
    const passwordService = app.get(PasswordService);
    const passwordHash = await passwordService.hash('CorrectHorseBatteryStaple!1');

    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    const grantedBy = bootstrap[0].id;

    for (const role of STAFF_ROLES) {
      const rows = await db.query<{ id: string }>(
        `INSERT INTO shared.users (id, username, password_hash, display_name, status)
         VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
        [`jest_step10_${role.toLowerCase()}_${runId}`, passwordHash, `Jest STEP10 ${role} ${runId}`]
      );
      const id = rows[0].id;
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
      [`jest_step10_norole_${runId}`, passwordHash, `Jest STEP10 NoRole ${runId}`]
    );
    noRoleStaffId = noRole[0].id;
    noRoleToken = tokenService.signAccessToken({ principalType: 'STAFF', principalId: noRoleStaffId });

    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active)
       VALUES (shared.uuid_generate_v7(), $1, $2, true) RETURNING id`,
      [`+91771${digits.slice(0, 7)}`, `Jest STEP10 Customer ${runId}`]
    );
    customerId = customer[0].id;
    customerToken = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerId });
  });

  afterAll(async () => {
    const staffIds = [...staffIdByRole.values(), noRoleStaffId];
    if (createdAnnouncementIds.length > 0) {
      // The app holds no DELETE grant on announcements (soft-delete by
      // design), so test rows are soft-deleted the same way production
      // would. created_by/updated_by are also cleared first: they are FK
      // references to shared.users, and the test staff rows below cannot
      // be removed while an announcement still points at them.
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
  });

  const bearer = (role: StaffRole) => `Bearer ${tokenByRole.get(role)}`;

  // ---------------------------------------------------------------- 401
  describe('unauthenticated access is 401, never 403', () => {
    for (const path of ['/admin/session', '/admin/dashboard', '/admin/announcements', '/admin/rik/issue-schedules']) {
      it(`GET ${path} without a token -> 401`, async () => {
        await request(app.getHttpServer()).get(path).expect(401);
      });
    }

    it('POST /admin/announcements without a token -> 401', async () => {
      await request(app.getHttpServer()).post('/admin/announcements').send({}).expect(401);
    });
  });

  // ------------------------------------------------- customers are not staff
  describe('a CUSTOMER cannot reach staff routes', () => {
    for (const path of ['/admin/session', '/admin/dashboard', '/admin/announcements', '/admin/rik/issue-schedules']) {
      it(`customer GET ${path} -> 403`, async () => {
        await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${customerToken}`).expect(403);
      });
    }

    it('a customer cannot create an announcement', async () => {
      await request(app.getHttpServer())
        .post('/admin/announcements')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          title: 'Customer attempt',
          body: 'should never be written',
          announcementType: 'GENERAL',
          targetAudience: 'ALL',
          priority: 'NORMAL',
          isPublished: true,
        })
        .expect(403);
    });
  });

  // -------------------------------------------------------- staff session
  describe('staff session', () => {
    it('reports the signed-in staff member with their real roles', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/session')
        .set('Authorization', bearer('RIK_ADMIN'))
        .expect(200);
      expect(res.body.roles).toEqual(['RIK_ADMIN']);
      expect(res.body.permissions).toContain('shared.announcement.manage');
      expect(res.body.username).toContain('jest_step10_rik_admin');
    });

    it('never returns a password hash or TOTP secret', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/session')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .expect(200);
      const body = JSON.stringify(res.body).toLowerCase();
      for (const secret of ['password', 'hash', 'totp', 'secret']) {
        expect(body).not.toContain(secret);
      }
    });

    it('a staff member with no roles gets an empty permission set, not an error', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/session')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .expect(200);
      expect(res.body.roles).toEqual([]);
      expect(res.body.permissions).toEqual([]);
    });
  });

  // ------------------------------------------------------------ dashboard
  describe('dashboard foundation', () => {
    it('returns only tiles the role holds permission for, and fabricates no figures', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/dashboard')
        .set('Authorization', bearer('RIK_ADMIN'))
        .expect(200);

      const tiles: Array<{ key: string; status: string; value?: number; reason?: string }> = res.body.tiles;
      expect(tiles.length).toBeGreaterThan(0);

      for (const tile of tiles) {
        if (tile.status === 'available') {
          // An available tile carries a real, queried number.
          expect(typeof tile.value).toBe('number');
        } else {
          expect(tile.status).toBe('unavailable');
          expect(tile.value).toBeUndefined();
          expect(typeof tile.reason).toBe('string');
        }
      }
      // RIK_ADMIN holds no PIF permission, so no PIF tile may appear.
      expect(tiles.some((t) => t.key.startsWith('pif-'))).toBe(false);
    });

    it('a role with no permissions sees no tiles rather than invented ones', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/dashboard')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .expect(200);
      expect(res.body.tiles).toEqual([]);
    });

    it('PIF_ADMIN sees PIF tiles and no RIK tiles', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/dashboard')
        .set('Authorization', bearer('PIF_ADMIN'))
        .expect(200);
      const keys: string[] = res.body.tiles.map((t: { key: string }) => t.key);
      expect(keys.some((k) => k.startsWith('pif-'))).toBe(true);
      expect(keys.some((k) => k.startsWith('rik-'))).toBe(false);
    });
  });

  // ----------------------------------------------- permission-gated routes
  describe('permission gating by role (direct API access)', () => {
    const announcementManagers: StaffRole[] = ['SUPER_ADMIN', 'RIK_ADMIN', 'PIF_ADMIN'];
    const nonManagers: StaffRole[] = ['PIF_CASHIER', 'RIK_PICKUP_STAFF', 'DELIVERY_STAFF'];

    for (const role of announcementManagers) {
      it(`${role} may list announcements`, async () => {
        await request(app.getHttpServer()).get('/admin/announcements').set('Authorization', bearer(role)).expect(200);
      });
    }

    for (const role of nonManagers) {
      it(`${role} may NOT list or create announcements`, async () => {
        await request(app.getHttpServer()).get('/admin/announcements').set('Authorization', bearer(role)).expect(403);
        await request(app.getHttpServer())
          .post('/admin/announcements')
          .set('Authorization', bearer(role))
          .send({
            title: 'x',
            body: 'y',
            announcementType: 'GENERAL',
            targetAudience: 'ALL',
            priority: 'NORMAL',
            isPublished: false,
          })
          .expect(403);
      });
    }

    it('RIK_ADMIN and SUPER_ADMIN reach the RIK issue-schedule foundation; no PIF role does', async () => {
      // PHASE F: SUPER_ADMIN holds rik.issue_schedule.manage as an explicit
      // row (migration 0050), because the one admin portal must serve "the
      // overall boss of both entities". It is still a grant and not a
      // bypass, which is what the rest of this test demonstrates: the PIF
      // and the operational roles are refused exactly as before.
      for (const role of ['RIK_ADMIN', 'SUPER_ADMIN'] as StaffRole[]) {
        await request(app.getHttpServer())
          .get('/admin/rik/issue-schedules')
          .set('Authorization', bearer(role))
          .expect(200);
      }

      for (const role of ['PIF_ADMIN', 'PIF_CASHIER', 'DELIVERY_STAFF', 'RIK_PICKUP_STAFF'] as StaffRole[]) {
        await request(app.getHttpServer())
          .get('/admin/rik/issue-schedules')
          .set('Authorization', bearer(role))
          .expect(403);
      }
    });

    it('the issue-schedule foundation is read-only and honest when empty', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/rik/issue-schedules')
        .set('Authorization', bearer('RIK_ADMIN'))
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.canCreate).toBe(false);
    });
  });

  // --------------------------------------- announcement audience isolation
  describe('announcement audience isolation (kickoff Section 7)', () => {
    it('RIK_ADMIN may create a RIK announcement', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/announcements')
        .set('Authorization', bearer('RIK_ADMIN'))
        .send({
          title: `RIK notice ${runId}`,
          body: 'Visible to RIK customers.',
          announcementType: 'GENERAL',
          targetAudience: 'RIK',
          priority: 'NORMAL',
          isPublished: true,
        })
        .expect(201);
      expect(res.body.targetAudience).toBe('RIK');
      createdAnnouncementIds.push(res.body.id);
    });

    it('RIK_ADMIN may NOT create a PIF-targeted announcement', async () => {
      await request(app.getHttpServer())
        .post('/admin/announcements')
        .set('Authorization', bearer('RIK_ADMIN'))
        .send({
          title: `Cross-module attempt ${runId}`,
          body: 'should be refused',
          announcementType: 'GENERAL',
          targetAudience: 'PIF',
          priority: 'NORMAL',
          isPublished: true,
        })
        .expect(403);
    });

    it('PIF_ADMIN may NOT create a RIK-targeted announcement', async () => {
      await request(app.getHttpServer())
        .post('/admin/announcements')
        .set('Authorization', bearer('PIF_ADMIN'))
        .send({
          title: `Cross-module attempt 2 ${runId}`,
          body: 'should be refused',
          announcementType: 'GENERAL',
          targetAudience: 'RIK',
          priority: 'NORMAL',
          isPublished: true,
        })
        .expect(403);
    });

    it('a module admin may NOT create an ALL-audience announcement (it would reach the other module)', async () => {
      for (const role of ['RIK_ADMIN', 'PIF_ADMIN'] as StaffRole[]) {
        await request(app.getHttpServer())
          .post('/admin/announcements')
          .set('Authorization', bearer(role))
          .send({
            title: `ALL attempt ${runId}`,
            body: 'should be refused',
            announcementType: 'GENERAL',
            targetAudience: 'ALL',
            priority: 'NORMAL',
            isPublished: false,
          })
          .expect(403);
      }
    });

    it('SUPER_ADMIN may create an ALL-audience announcement', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/announcements')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .send({
          title: `Facility-wide notice ${runId}`,
          body: 'Applies to everyone.',
          announcementType: 'GENERAL',
          targetAudience: 'ALL',
          priority: 'HIGH',
          isPublished: true,
        })
        .expect(201);
      expect(res.body.targetAudience).toBe('ALL');
      createdAnnouncementIds.push(res.body.id);
    });

    it('PIF_ADMIN cannot edit an existing RIK announcement, even by omitting the audience', async () => {
      const created = await request(app.getHttpServer())
        .post('/admin/announcements')
        .set('Authorization', bearer('RIK_ADMIN'))
        .send({
          title: `RIK editable ${runId}`,
          body: 'owned by RIK',
          announcementType: 'GENERAL',
          targetAudience: 'RIK',
          priority: 'LOW',
          isPublished: false,
        })
        .expect(201);
      createdAnnouncementIds.push(created.body.id);

      await request(app.getHttpServer())
        .patch(`/admin/announcements/${created.body.id}`)
        .set('Authorization', bearer('PIF_ADMIN'))
        .send({ title: 'hijacked' })
        .expect(403);

      // And the row is untouched.
      const reread = await request(app.getHttpServer())
        .get('/admin/announcements')
        .set('Authorization', bearer('RIK_ADMIN'))
        .expect(200);
      const row = reread.body.items.find((i: { id: string }) => i.id === created.body.id);
      expect(row.title).toBe(`RIK editable ${runId}`);
    });

    it('the audience of an existing announcement cannot be changed at all', async () => {
      const created = await request(app.getHttpServer())
        .post('/admin/announcements')
        .set('Authorization', bearer('RIK_ADMIN'))
        .send({
          title: `RIK fixed-audience ${runId}`,
          body: 'audience is immutable',
          announcementType: 'GENERAL',
          targetAudience: 'RIK',
          priority: 'LOW',
          isPublished: false,
        })
        .expect(201);
      createdAnnouncementIds.push(created.body.id);

      await request(app.getHttpServer())
        .patch(`/admin/announcements/${created.body.id}`)
        .set('Authorization', bearer('RIK_ADMIN'))
        .send({ targetAudience: 'PIF' })
        .expect(400);
    });

    it('a module admin sees their own audience plus ALL, never the other module’s', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/announcements')
        .set('Authorization', bearer('RIK_ADMIN'))
        .expect(200);

      const audiences: string[] = res.body.items.map((i: { targetAudience: string }) => i.targetAudience);
      expect(audiences).not.toContain('PIF');
      expect(res.body.manageableAudiences).toEqual(['RIK']);
    });

    it('reports SUPER_ADMIN as able to manage every audience', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/announcements')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .expect(200);
      expect(res.body.manageableAudiences).toEqual(['ALL', 'RIK', 'PIF']);
    });
  });

  // ------------------------------------------------------------- auditing
  it('writes an audit record for an administrative create, using the existing audit log', async () => {
    const created = await request(app.getHttpServer())
      .post('/admin/announcements')
      .set('Authorization', bearer('RIK_ADMIN'))
      .send({
        title: `Audited ${runId}`,
        body: 'audit check',
        announcementType: 'GENERAL',
        targetAudience: 'RIK',
        priority: 'NORMAL',
        isPublished: false,
      })
      .expect(201);
    createdAnnouncementIds.push(created.body.id);

    const rows = await db.query<{ action: string; actor_id: string }>(
      `SELECT action, actor_id FROM shared.audit_log
        WHERE entity_id = $1 AND action = 'ANNOUNCEMENT_CREATED'`,
      [created.body.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(staffIdByRole.get('RIK_ADMIN'));
  });

  // ----------------------------------------------------------- validation
  describe('input validation', () => {
    it('rejects an audience outside the approved set', async () => {
      await request(app.getHttpServer())
        .post('/admin/announcements')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .send({
          title: 'bad audience',
          body: 'x',
          announcementType: 'GENERAL',
          targetAudience: 'EVERYONE',
          priority: 'NORMAL',
          isPublished: false,
        })
        .expect(400);
    });

    it('rejects a priority outside LOW/NORMAL/HIGH/URGENT', async () => {
      await request(app.getHttpServer())
        .post('/admin/announcements')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .send({
          title: 'bad priority',
          body: 'x',
          announcementType: 'GENERAL',
          targetAudience: 'ALL',
          priority: 'CRITICAL',
          isPublished: false,
        })
        .expect(400);
    });

    it('never leaks database or stack detail on a validation failure', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/announcements')
        .set('Authorization', bearer('SUPER_ADMIN'))
        .send({ title: '', body: '', announcementType: 'NOPE', targetAudience: 'ALL', priority: 'NORMAL', isPublished: false })
        .expect(400);
      const body = JSON.stringify(res.body).toLowerCase();
      for (const leak of ['insert into', 'select ', 'pg_', 'postgres', '.ts:', 'at object.']) {
        expect(body).not.toContain(leak);
      }
    });
  });
});
