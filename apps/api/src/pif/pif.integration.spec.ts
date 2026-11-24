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
 * PHASE F — PIF as a working grocery module, over real HTTP against real
 * PostgreSQL.
 *
 * WHAT THIS SUITE IS DESIGNED TO PROVE
 *
 *  1. THE TWO MODULES ARE SEPARATE AUTHORITIES. RIK_ADMIN cannot reach PIF
 *     administration, PIF_ADMIN cannot reach RIK administration, and
 *     SUPER_ADMIN reaches both — because of the grants in the database, not
 *     because of what a menu shows or what a role is called.
 *  2. THE CLIENT MANAGES THE CATALOGUE. Categories, subcategories,
 *     products, prices, GST, availability, order limits and images are all
 *     rows an authorized administrator writes through the API.
 *  3. THE MONEY IS THE SERVER'S. A checkout that posts its own prices gets
 *     the catalogue's prices; an order's totals are recomputed and the
 *     database refuses a header that disagrees with its lines.
 *  4. A PLACED ORDER IS HISTORY. A later price change cannot move it, and
 *     the database refuses an UPDATE or DELETE of an order line.
 *  5. NOTHING COMPLETES BY ITSELF. Every status move is an event recorded by
 *     a named person holding the permission for that specific move, and the
 *     database refuses an illegal sequence even when the application is
 *     bypassed.
 *  6. A DOUBLE TAP MAKES ONE ORDER, and two staff members pressing the same
 *     button in the same instant produce one event, not two.
 *  7. RIK IS UNTOUCHED by all of it.
 *
 * FIXTURE DISCIPLINE. Everything this suite creates is prefixed with a
 * run-unique id, so repeated runs neither collide nor accumulate meaning.
 * Nothing here deletes a row: the application holds no DELETE on the PIF
 * catalogue or order tables at all, which is itself one of the assertions.
 */
describe('PIF grocery module (PHASE F, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(4, '7').slice(0, 4);
  const mobile = (suffix: number) => `9716${digits}${String(suffix).padStart(2, '0')}`;
  const sku = (name: string) => `JF-${runId.toUpperCase()}-${name}`;

  const staffIdByRole = new Map<StaffRole, string>();
  const tokenByRole = new Map<StaffRole, string>();

  interface Shopper {
    customerId: string;
    token: string;
    addressId: string;
  }
  const shoppers = new Map<string, Shopper>();

  /** Catalogue fixtures, created once for the whole suite. */
  let categoryId: string;
  let subcategoryId: string;
  let gstRateId: string;
  let riceId: string; // 100.00, 5% GST
  let oilId: string; // 250.50, 5% GST, 10% discount
  let saltId: string; // 20.00, no tax rate
  let unavailableId: string;
  let inactiveId: string;
  let limitedId: string; // min 1, max 3, step 1

  const server = () => app.getHttpServer();
  const bearer = (role: StaffRole) => `Bearer ${tokenByRole.get(role)}`;
  const asPifAdmin = () => bearer('PIF_ADMIN');
  const asRikAdmin = () => bearer('RIK_ADMIN');
  const asSuperAdmin = () => bearer('SUPER_ADMIN');
  const asCashier = () => bearer('PIF_CASHIER');
  const asDelivery = () => bearer('DELIVERY_STAFF');
  const asShopper = (key: string) => `Bearer ${shoppers.get(key)!.token}`;

  /** A shopper, with one saved address — a delivery order needs one. */
  const registerShopper = async (key: string, suffix: number): Promise<void> => {
    const rows = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, dietary_preference)
       VALUES (shared.uuid_generate_v7(), $1, $2, 'NV')
       RETURNING id`,
      [mobile(suffix), `Jest 15F ${key} ${runId}`]
    );
    const customerId = rows[0]!.id;
    const address = await db.query<{ id: string }>(
      `INSERT INTO shared.customer_addresses
         (customer_id, label, quarter_block, quarter_number, landmark, is_default)
       VALUES ($1, 'Home', 'F', $2, 'Near the water tank', true)
       RETURNING id`,
      [customerId, String(400 + suffix)]
    );
    shoppers.set(key, {
      customerId,
      addressId: address[0]!.id,
      token: tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerId }),
    });
  };

  const createProduct = async (
    body: Record<string, unknown>,
    auth: string = asPifAdmin()
  ): Promise<string> => {
    const res = await request(server())
      .post('/admin/pif/products')
      .set('Authorization', auth)
      .send(body)
      .expect(201);
    return res.body.id as string;
  };

  /** Not `async`: the supertest Test object is returned so callers can
   *  chain `.expect(...)` exactly as they do everywhere else. */
  const checkout = (
    key: string,
    lines: Array<{ productId: string; qty: number }>,
    extra: Record<string, unknown> = {}
  ) =>
    request(server())
      .post('/pif/checkout')
      .set('Authorization', asShopper(key))
      .send({ lines, fulfillmentMode: 'DELIVERY', ...extra });

  /** Walk an order to a given status with the right authority for each step. */
  const advanceTo = async (orderId: string, target: string): Promise<void> => {
    const path: Array<{ status: string; auth: string; reason?: string }> = [
      { status: 'ACCEPTED', auth: asPifAdmin() },
      { status: 'PREPARING', auth: asCashier() },
      { status: 'READY_PICKED', auth: asCashier() },
      { status: 'OUT_FOR_DELIVERY', auth: asPifAdmin() },
      { status: 'DELIVERED', auth: asDelivery() },
      { status: 'COD_COLLECTED', auth: asPifAdmin() },
    ];
    for (const step of path) {
      await request(server())
        .post(`/admin/pif/orders/${orderId}/status`)
        .set('Authorization', step.auth)
        .send({ status: step.status })
        .expect(201);
      if (step.status === target) return;
    }
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
      const id = await staffAccount(`jest_15f_${role.toLowerCase()}`, `Jest 15F ${role}`);
      staffIdByRole.set(role, id);
      await db.query(
        `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
         SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3 ON CONFLICT DO NOTHING`,
        [id, grantedBy, role]
      );
      tokenByRole.set(role, tokenService.signAccessToken({ principalType: 'STAFF', principalId: id }));
    }

    for (const [index, key] of ['buyer', 'repeat', 'race', 'other', 'pickup'].entries()) {
      await registerShopper(key, index + 1);
    }

    // --- the catalogue, created THROUGH THE API, as the client would ------
    const category = await request(server())
      .post('/admin/pif/categories')
      .set('Authorization', asPifAdmin())
      .send({ name: `Jest 15F Staples ${runId}`, sortOrder: 10 })
      .expect(201);
    categoryId = category.body.id;

    const subcategory = await request(server())
      .post('/admin/pif/categories')
      .set('Authorization', asPifAdmin())
      .send({ name: `Jest 15F Rice ${runId}`, parentId: categoryId })
      .expect(201);
    subcategoryId = subcategory.body.id;

    const gst = await request(server())
      .post('/admin/pif/tax-rates')
      .set('Authorization', asPifAdmin())
      .send({ name: `Jest 15F GST 5% ${runId}`, ratePct: 5 })
      .expect(201);
    gstRateId = gst.body.id;

    riceId = await createProduct({
      sku: sku('RICE'),
      name: `Jest 15F Sona Masoori ${runId}`,
      brand: 'Jest Mills',
      categoryId: subcategoryId,
      unit: 'kg',
      packSize: 1,
      packUnit: 'kg',
      sellingPrice: 100,
      taxRateId: gstRateId,
      variantGroup: `jest-rice-${runId}`,
      variantLabel: '1 kg',
    });
    oilId = await createProduct({
      sku: sku('OIL'),
      name: `Jest 15F Sunflower Oil ${runId}`,
      categoryId: categoryId,
      unit: 'l',
      sellingPrice: 250.5,
      taxRateId: gstRateId,
      discountPct: 10,
    });
    saltId = await createProduct({
      sku: sku('SALT'),
      name: `Jest 15F Salt ${runId}`,
      categoryId: categoryId,
      unit: 'kg',
      sellingPrice: 20,
    });
    unavailableId = await createProduct({
      sku: sku('TOMATO'),
      name: `Jest 15F Tomato ${runId}`,
      categoryId: categoryId,
      unit: 'kg',
      sellingPrice: 40,
      available: false,
    });
    inactiveId = await createProduct({
      sku: sku('OLDJAM'),
      name: `Jest 15F Discontinued Jam ${runId}`,
      categoryId: categoryId,
      unit: 'jar',
      sellingPrice: 150,
      active: false,
    });
    limitedId = await createProduct({
      sku: sku('GHEE'),
      name: `Jest 15F Ghee ${runId}`,
      categoryId: categoryId,
      unit: 'tin',
      sellingPrice: 600,
      minOrderQty: 1,
      maxOrderQty: 3,
      qtyStep: 1,
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // =================================================================
  // 1. One portal, two modules, and the wall between them
  // =================================================================
  describe('1 — the admin portal separates RIK from PIF by GRANT, not by menu', () => {
    it('SUPER_ADMIN reaches PIF administration', async () => {
      await request(server())
        .get('/admin/pif/products')
        .set('Authorization', asSuperAdmin())
        .expect(200);
    });

    it('SUPER_ADMIN reaches RIK administration too — the same portal, both modules', async () => {
      await request(server())
        .get('/admin/rik/issue-schedules')
        .set('Authorization', asSuperAdmin())
        .expect(200);
    });

    it('RIK_ADMIN cannot reach PIF administration', async () => {
      for (const path of ['/admin/pif/products', '/admin/pif/categories', '/admin/pif/orders', '/admin/pif/dashboard']) {
        await request(server()).get(path).set('Authorization', asRikAdmin()).expect(403);
      }
    });

    it('PIF_ADMIN cannot reach RIK administration', async () => {
      for (const path of ['/admin/rik/issue-schedules', '/admin/rik/officers']) {
        await request(server()).get(path).set('Authorization', asPifAdmin()).expect(403);
      }
    });

    it('PIF_CASHIER may work the order desk and nothing in the catalogue', async () => {
      await request(server()).get('/admin/pif/orders').set('Authorization', asCashier()).expect(200);
      await request(server()).get('/admin/pif/products').set('Authorization', asCashier()).expect(403);
      await request(server())
        .post('/admin/pif/products')
        .set('Authorization', asCashier())
        .send({ sku: sku('NOPE'), name: 'Not allowed', unit: 'kg', sellingPrice: 1 })
        .expect(403);
    });

    it('DELIVERY_STAFF may open an order and cannot price or accept one', async () => {
      await request(server()).get('/admin/pif/orders').set('Authorization', asDelivery()).expect(200);
      await request(server()).get('/admin/pif/products').set('Authorization', asDelivery()).expect(403);
    });

    it('a customer cannot reach any PIF administration route', async () => {
      await request(server())
        .get('/admin/pif/products')
        .set('Authorization', asShopper('buyer'))
        .expect(403);
      await request(server())
        .get('/admin/pif/orders')
        .set('Authorization', asShopper('buyer'))
        .expect(403);
    });

    it('an anonymous caller is refused everywhere', async () => {
      await request(server()).get('/admin/pif/products').expect(401);
      await request(server()).get('/pif/categories').expect(401);
      await request(server()).post('/pif/checkout').send({ lines: [], fulfillmentMode: 'PICKUP' }).expect(401);
    });

    it('the grants are what the database actually says, and no role was added', async () => {
      const rows = await db.query<{ role: string; perms: string }>(
        `SELECT r.name AS role,
                coalesce(string_agg(p.code, ',' ORDER BY p.code) FILTER (WHERE p.module <> 'shared'), '') AS perms
           FROM shared.roles r
           LEFT JOIN shared.role_permissions rp ON rp.role_id = r.id
           LEFT JOIN shared.permissions p ON p.id = rp.permission_id
          GROUP BY r.name ORDER BY r.name`
      );
      const byRole = new Map(rows.map((row) => [row.role, row.perms.split(',').filter(Boolean)]));

      expect(byRole.get('RIK_ADMIN')!.some((code) => code.startsWith('pif.'))).toBe(false);
      expect(byRole.get('PIF_ADMIN')!.some((code) => code.startsWith('rik.'))).toBe(false);
      expect(byRole.get('PIF_ADMIN')).toContain('pif.order.manage');
      expect(byRole.get('PIF_CASHIER')).toContain('pif.order.prepare');
      expect(byRole.get('DELIVERY_STAFF')).toContain('pif.order.mark_delivered');
      // SUPER_ADMIN holds both modules EXPLICITLY.
      expect(byRole.get('SUPER_ADMIN')!.filter((c) => c.startsWith('rik.')).length).toBe(7);
      expect(byRole.get('SUPER_ADMIN')!.filter((c) => c.startsWith('pif.')).length).toBe(6);

      const counts = await db.query<{ roles: string; perms: string }>(
        `SELECT (SELECT count(*)::text FROM shared.roles) AS roles,
                (SELECT count(*)::text FROM shared.permissions) AS perms`
      );
      expect(counts[0]).toEqual({ roles: '6', perms: '22' });
      const purchasing = await db.query(`SELECT 1 FROM shared.roles WHERE name = 'PURCHASING'`);
      expect(purchasing).toEqual([]);
    });
  });

  // =================================================================
  // 2. The client manages the catalogue
  // =================================================================
  describe('2 — categories, products and prices are rows, not code', () => {
    it('created a two-level taxonomy, and refuses a third level', async () => {
      const res = await request(server())
        .post('/admin/pif/categories')
        .set('Authorization', asPifAdmin())
        .send({ name: `Jest 15F Too deep ${runId}`, parentId: subcategoryId });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/two levels/i);
    });

    it('refuses a duplicate category name in the same place', async () => {
      const res = await request(server())
        .post('/admin/pif/categories')
        .set('Authorization', asPifAdmin())
        .send({ name: `Jest 15F Rice ${runId}`, parentId: categoryId });
      expect(res.status).toBe(409);
      expect(res.body.details.reason).toBe('DUPLICATE_CATEGORY');
    });

    it('refuses deactivating a category that still holds products', async () => {
      const res = await request(server())
        .patch(`/admin/pif/categories/${subcategoryId}`)
        .set('Authorization', asPifAdmin())
        .send({ name: `Jest 15F Rice ${runId}`, parentId: categoryId, active: false });
      expect(res.status).toBe(409);
      expect(res.body.details.reason).toBe('CATEGORY_IN_USE');
    });

    it('refuses a duplicate SKU', async () => {
      const res = await request(server())
        .post('/admin/pif/products')
        .set('Authorization', asPifAdmin())
        .send({ sku: sku('RICE'), name: 'Another rice', unit: 'kg', sellingPrice: 90 });
      expect(res.status).toBe(409);
      expect(res.body.details.reason).toBe('DUPLICATE_SKU');
    });

    it('refuses a negative price and a price in fractions of a paisa', async () => {
      const negative = await request(server())
        .post('/admin/pif/products')
        .set('Authorization', asPifAdmin())
        .send({ sku: sku('NEG'), name: 'Negative', unit: 'kg', sellingPrice: -5 });
      expect(negative.status).toBe(400);

      const tooPrecise = await request(server())
        .post('/admin/pif/products')
        .set('Authorization', asPifAdmin())
        .send({ sku: sku('PREC'), name: 'Too precise', unit: 'kg', sellingPrice: 10.555 });
      expect(tooPrecise.status).toBe(400);
    });

    it('refuses a tax rate that is not configured', async () => {
      const res = await request(server())
        .post('/admin/pif/products')
        .set('Authorization', asPifAdmin())
        .send({
          sku: sku('TAXLESS'),
          name: 'Phantom tax',
          unit: 'kg',
          sellingPrice: 10,
          taxRateId: '01a11a22-0000-7000-8000-0000000000ff',
        });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('INVALID_TAX_RATE');
    });

    it('refuses a maximum order quantity below the minimum', async () => {
      const res = await request(server())
        .post('/admin/pif/products')
        .set('Authorization', asPifAdmin())
        .send({
          sku: sku('BADLIMIT'),
          name: 'Impossible limits',
          unit: 'kg',
          sellingPrice: 10,
          minOrderQty: 5,
          maxOrderQty: 2,
        });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('INVALID_QUANTITY_LIMIT');
    });

    it('refuses a body carrying a field the catalogue does not have', async () => {
      // A posted "stockQty" must be a visible mistake, not a silent one:
      // PIF holds no stock quantity at all.
      const res = await request(server())
        .post('/admin/pif/products')
        .set('Authorization', asPifAdmin())
        .send({ sku: sku('STOCK'), name: 'Stocked', unit: 'kg', sellingPrice: 10, stockQty: 50 });
      expect(res.status).toBe(400);
    });

    it('edits a product, and records who did it', async () => {
      await request(server())
        .patch(`/admin/pif/products/${saltId}`)
        .set('Authorization', asPifAdmin())
        .send({
          sku: sku('SALT'),
          name: `Jest 15F Iodised Salt ${runId}`,
          unit: 'kg',
          sellingPrice: 22,
          categoryId,
        })
        .expect(200);

      const res = await request(server())
        .get(`/admin/pif/products/${saltId}`)
        .set('Authorization', asPifAdmin())
        .expect(200);
      expect(res.body.name).toContain('Iodised');
      expect(res.body.price).toBe(22);
      expect(res.body.updatedBy).toBe(staffIdByRole.get('PIF_ADMIN'));
    });

    it('activation and availability are two separate switches', async () => {
      await request(server())
        .patch(`/admin/pif/products/${unavailableId}/flags`)
        .set('Authorization', asPifAdmin())
        .send({ available: true })
        .expect(200);
      let res = await request(server())
        .get(`/admin/pif/products/${unavailableId}`)
        .set('Authorization', asPifAdmin())
        .expect(200);
      expect(res.body.active).toBe(true);
      expect(res.body.available).toBe(true);

      await request(server())
        .patch(`/admin/pif/products/${unavailableId}/flags`)
        .set('Authorization', asPifAdmin())
        .send({ available: false })
        .expect(200);
      res = await request(server())
        .get(`/admin/pif/products/${unavailableId}`)
        .set('Authorization', asPifAdmin())
        .expect(200);
      expect(res.body.active).toBe(true);
      expect(res.body.available).toBe(false);
    });

    it('every catalogue write is in the audit log, with the administrator named', async () => {
      const rows = await db.query<{ action: string; actor: string }>(
        `SELECT action, actor_id AS actor FROM shared.audit_log
          WHERE module = 'pif' AND entity_id = $1 ORDER BY created_at`,
        [saltId]
      );
      expect(rows.map((r) => r.action)).toContain('PIF_PRODUCT_CREATED');
      expect(rows.map((r) => r.action)).toContain('PIF_PRODUCT_UPDATED');
      expect(new Set(rows.map((r) => r.actor))).toEqual(new Set([staffIdByRole.get('PIF_ADMIN')]));
    });

    it('the application CANNOT delete a product or a category, by privilege', async () => {
      const privileges = await db.query<{ table_name: string; privilege_type: string }>(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'pif' AND grantee = 'app_pif'
            AND table_name IN ('products', 'categories') AND privilege_type = 'DELETE'`
      );
      expect(privileges).toEqual([]);
    });
  });

  // =================================================================
  // 3. The shop, as a customer sees it
  // =================================================================
  describe('3 — browsing, searching and reading a product', () => {
    it('lists categories with their subcategories', async () => {
      const res = await request(server())
        .get('/pif/categories')
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      const mine = res.body.find((c: { id: string }) => c.id === categoryId);
      expect(mine).toBeDefined();
      expect(mine.subcategories.map((s: { id: string }) => s.id)).toContain(subcategoryId);
    });

    it('a category listing includes its subcategories’ products', async () => {
      const res = await request(server())
        .get(`/pif/categories/${categoryId}/products?pageSize=50`)
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      const ids = res.body.items.map((p: { id: string }) => p.id);
      expect(ids).toContain(riceId); // filed under the subcategory
      expect(ids).toContain(oilId);
    });


    it('counts a category’s subcategory products in the number the shopper sees', async () => {
      // The suite's own fixture is the case: every product lives under the
      // SUBcategory, so a direct-only count would show "0 items" against a
      // category whose aisle is full. The administrator's list keeps the
      // direct count; this one is for the person shopping.
      const res = await request(server())
        .get('/pif/categories')
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      const mine = res.body.find((c: { id: string }) => c.id === categoryId);
      const sub = mine.subcategories.find((c: { id: string }) => c.id === subcategoryId);
      expect(sub.productCount).toBeGreaterThan(0);
      expect(mine.productCount).toBeGreaterThanOrEqual(sub.productCount);
    });

    it('does not offer the shopper a category with nothing in it', async () => {
      const emptyName = `Jest 15F Empty Aisle ${runId}`;
      const created = await request(server())
        .post('/admin/pif/categories')
        .set('Authorization', asPifAdmin())
        .send({ name: emptyName, sortOrder: 99 })
        .expect(201);

      // The administrator sees it, because they have to manage it...
      const adminList = await request(server())
        .get('/admin/pif/categories')
        .set('Authorization', asPifAdmin())
        .expect(200);
      expect(adminList.body.items.map((c: { id: string }) => c.id)).toContain(created.body.id);

      // ...and the shopper does not, because tapping it would find nothing.
      const shopperList = await request(server())
        .get('/pif/categories')
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      expect(shopperList.body.map((c: { id: string }) => c.id)).not.toContain(created.body.id);
    });

    it('NEVER shows a deactivated product', async () => {
      const res = await request(server())
        .get(`/pif/search?q=${runId}&pageSize=50`)
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      const ids = res.body.items.map((p: { id: string }) => p.id);
      expect(ids).not.toContain(inactiveId);
      expect(ids).toContain(riceId);

      await request(server())
        .get(`/pif/products/${inactiveId}`)
        .set('Authorization', asShopper('buyer'))
        .expect(404);
    });

    it('shows an unavailable product, marked — the shopper learns it exists', async () => {
      const res = await request(server())
        .get(`/pif/products/${unavailableId}`)
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      expect(res.body.available).toBe(false);
      expect(res.body.price).toBe(40);
    });

    it('searches by name, by brand and by SKU', async () => {
      for (const query of ['Sona Masoori', 'Jest Mills', sku('RICE')]) {
        const res = await request(server())
          .get(`/pif/search?q=${encodeURIComponent(query)}&pageSize=50`)
          .set('Authorization', asShopper('buyer'))
          .expect(200);
        expect(res.body.items.map((p: { id: string }) => p.id)).toContain(riceId);
      }
    });

    it('a product carries what the shopper needs to decide', async () => {
      const res = await request(server())
        .get(`/pif/products/${oilId}`)
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      expect(res.body.price).toBe(250.5);
      expect(res.body.discountPct).toBe(10);
      expect(res.body.taxRatePct).toBe(5);
      expect(res.body.unit).toBe('l');
      expect(res.body.available).toBe(true);
    });

    it('pages server-side rather than handing over the whole catalogue', async () => {
      const res = await request(server())
        .get(`/pif/search?q=${runId}&page=1&pageSize=2`)
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      expect(res.body.total).toBeGreaterThan(2);
    });
  });

  // =================================================================
  // 4. The cart's arithmetic is the server's
  // =================================================================
  describe('4 — quoting a cart', () => {
    it('computes line totals, discount and GST from the catalogue', async () => {
      const res = await request(server())
        .post('/pif/quote')
        .set('Authorization', asShopper('buyer'))
        .send({ lines: [{ productId: riceId, qty: 2 }, { productId: oilId, qty: 1 }] })
        .expect(201);

      const rice = res.body.lines.find((l: { productId: string }) => l.productId === riceId);
      expect(rice.lineSubtotal).toBe(200);
      expect(rice.lineDiscount).toBe(0);
      expect(rice.lineTax).toBe(10); // 5% of 200
      expect(rice.lineTotal).toBe(210);

      const oil = res.body.lines.find((l: { productId: string }) => l.productId === oilId);
      expect(oil.lineSubtotal).toBe(250.5);
      expect(oil.lineDiscount).toBe(25.05); // 10%
      expect(oil.lineTax).toBe(11.27); // 5% of 225.45, to paise
      expect(oil.lineTotal).toBe(236.72);

      expect(res.body.subtotal).toBe(450.5);
      expect(res.body.discountTotal).toBe(25.05);
      expect(res.body.taxTotal).toBe(21.27);

      /*
       * THE GOODS, AND THEN THE DELIVERY CHARGE.
       *
       * `merchandiseTotal` is the figure this test always asserted — subtotal
       * minus discount plus GST — and it has not moved: 450.50 - 25.05 +
       * 21.27 = 446.72. What changed is that it is no longer the END of the
       * arithmetic. 446.72 is below the 499 threshold, so home delivery is
       * charged at 20 and the ORDER total is 466.72.
       *
       * The quote carries no `fulfillmentMode`, and the service defaults to
       * DELIVERY — the charged case — which is deliberate: a shopper who
       * later chooses pickup watches the charge disappear, rather than
       * meeting a fee for the first time at checkout.
       *
       * The threshold is tested on merchandise and never on the total, so
       * the charge cannot push an order over its own threshold. The fee and
       * the threshold are asserted here as VALUES THE SERVER SENT, which is
       * what lets the screens print "₹20" and "₹499" without hard-coding
       * either number.
       */
      expect(res.body.merchandiseTotal).toBe(446.72);
      expect(res.body.deliveryTotal).toBe(20);
      expect(res.body.freeDelivery).toBe(false);
      expect(res.body.deliveryFee).toBe(20);
      expect(res.body.deliveryThreshold).toBe(499);
      expect(res.body.amountToFreeDelivery).toBe(52.28); // 499 - 446.72
      expect(res.body.total).toBe(466.72); // 446.72 + 20
      expect(res.body.paymentMethod).toBe('COD');
    });

    it('a product with no tax rate is quoted with no tax', async () => {
      const res = await request(server())
        .post('/pif/quote')
        .set('Authorization', asShopper('buyer'))
        .send({ lines: [{ productId: saltId, qty: 3 }] })
        .expect(201);
      expect(res.body.lines[0].lineTax).toBe(0);
      expect(res.body.taxTotal).toBe(0);
      // The no-tax claim belongs to the GOODS, so it is asserted there:
      // 3 x 22.00, nothing added.
      expect(res.body.merchandiseTotal).toBe(66); // 3 × 22
      // ...and the order total differs from it by the delivery charge alone,
      // which is what proves the 20 is delivery and not a tax that crept in.
      expect(res.body.deliveryTotal).toBe(20);
      expect(res.body.total).toBe(86); // 66 + 20
    });

    it('reports what it refuses instead of failing silently', async () => {
      const res = await request(server())
        .post('/pif/quote')
        .set('Authorization', asShopper('buyer'))
        .send({
          lines: [
            { productId: riceId, qty: 1 },
            { productId: unavailableId, qty: 1 },
            { productId: inactiveId, qty: 1 },
          ],
        })
        .expect(201);
      expect(res.body.lines).toHaveLength(1);
      expect(res.body.refused).toHaveLength(2);
      expect(res.body.refused.map((r: { reason: string }) => r.reason)).toEqual([
        'PRODUCT_UNAVAILABLE',
        'PRODUCT_UNAVAILABLE',
      ]);
    });

    it('refuses a quote that tries to send its own prices', async () => {
      const res = await request(server())
        .post('/pif/quote')
        .set('Authorization', asShopper('buyer'))
        .send({ lines: [{ productId: riceId, qty: 1, unitPrice: 1 }] });
      expect(res.status).toBe(400);
    });

    it('refuses a quote that tries to send its own DELIVERY charge', async () => {
      /*
       * The delivery rule introduced three new money fields, and a client
       * must be no more able to post one of those than to post a price. The
       * only thing a cart may contribute to the charge is the MODE, which is
       * not money: it selects a rule, and the fee and the threshold stay in
       * PifPricingService.
       */
      for (const body of [
        { lines: [{ productId: riceId, qty: 1 }], deliveryTotal: 0 },
        { lines: [{ productId: riceId, qty: 1 }], deliveryFee: 0 },
        { lines: [{ productId: riceId, qty: 1 }], freeDelivery: true },
      ]) {
        const res = await request(server())
          .post('/pif/quote')
          .set('Authorization', asShopper('buyer'))
          .send(body);
        expect(res.status).toBe(400);
      }

      // The mode itself IS accepted, so the refusals above are about the
      // money and not about the gate refusing everything new.
      await request(server())
        .post('/pif/quote')
        .set('Authorization', asShopper('buyer'))
        .send({ lines: [{ productId: riceId, qty: 1 }], fulfillmentMode: 'PICKUP' })
        .expect(201);
    });

    it('quotes store pickup as free, on the same basket', async () => {
      /*
       * The identical cart as the first test in this section, quoted for
       * collection. Everything about the GOODS is unchanged — which is the
       * point: the mode selects a delivery rule and touches nothing else.
       */
      const res = await request(server())
        .post('/pif/quote')
        .set('Authorization', asShopper('buyer'))
        .send({
          lines: [{ productId: riceId, qty: 2 }, { productId: oilId, qty: 1 }],
          fulfillmentMode: 'PICKUP',
        })
        .expect(201);

      expect(res.body.merchandiseTotal).toBe(446.72);
      expect(res.body.deliveryTotal).toBe(0);
      expect(res.body.freeDelivery).toBe(true);
      // Nothing to unlock: there is no charge to remove.
      expect(res.body.amountToFreeDelivery).toBe(0);
      expect(res.body.total).toBe(446.72);
      // Free for pickup REGARDLESS of size — this basket is under the
      // threshold and still pays nothing.
      expect(res.body.merchandiseTotal).toBeLessThan(res.body.deliveryThreshold);
    });

    it('quotes home delivery as free once the merchandise reaches the threshold', async () => {
      /*
       * Ghee at 600.00 with no tax rate: 600 of merchandise, which is at or
       * above 499, so a HOME DELIVERY is free and the total is the goods.
       *
       * The exact boundary — 498.99, 499.00, 499.01 — is asserted in
       * pif-pricing.spec.ts, where a basket can be built to the paise. These
       * fixtures are real catalogue rows at real prices, so what is proved
       * here is that the rule the unit tests pin down is the one actually
       * reaching a customer over HTTP.
       */
      const res = await request(server())
        .post('/pif/quote')
        .set('Authorization', asShopper('buyer'))
        .send({ lines: [{ productId: limitedId, qty: 1 }], fulfillmentMode: 'DELIVERY' })
        .expect(201);

      expect(res.body.merchandiseTotal).toBe(600);
      expect(res.body.merchandiseTotal).toBeGreaterThanOrEqual(res.body.deliveryThreshold);
      expect(res.body.deliveryTotal).toBe(0);
      expect(res.body.freeDelivery).toBe(true);
      expect(res.body.amountToFreeDelivery).toBe(0);
      expect(res.body.total).toBe(600);
    });
  });

  // =================================================================
  // 5. Checkout — cash on delivery, server-priced
  // =================================================================
  describe('5 — placing an order', () => {
    let orderId: string;
    let orderNumber: string;

    it('places the order and answers with its number and total', async () => {
      const res = await checkout('buyer', [
        { productId: riceId, qty: 2 },
        { productId: saltId, qty: 1 },
      ]).expect(201);

      orderId = res.body.orderId;
      orderNumber = res.body.orderNumber;
      expect(orderNumber).toMatch(/^PIF-\d{8}-\d{4}$/);
      expect(res.body.status).toBe('PLACED');
      expect(res.body.paymentMethod).toBe('COD');
      // 210 rice + 22 salt = 232 of merchandise, which is below 499, so
      // the order total carries the 20 charge as well.
      expect(res.body.total).toBe(252); // 232 + 20 delivery
      expect(res.body.duplicate).toBe(false);
    });

    it('froze the catalogue onto the order lines', async () => {
      const rows = await db.query<{
        sku: string;
        product_name: string;
        unit_price: string;
        tax_rate_pct: string;
        line_total: string;
      }>(
        `SELECT sku, product_name, unit_price::text, tax_rate_pct::text, line_total::text
           FROM pif.order_items WHERE order_id = $1 ORDER BY product_name`,
        [orderId]
      );
      expect(rows).toHaveLength(2);
      const rice = rows.find((r) => r.sku === sku('RICE'))!;
      expect(rice.product_name).toContain('Sona Masoori');
      expect(Number(rice.unit_price)).toBe(100);
      expect(Number(rice.tax_rate_pct)).toBe(5);
      expect(Number(rice.line_total)).toBe(210);
    });

    it('recorded the placement as the first event, by the CUSTOMER', async () => {
      const rows = await db.query<{ sequence_no: number; event_type: string; status: string; role: string }>(
        `SELECT sequence_no, event_type, status, recorded_by_role AS role
           FROM pif.order_events WHERE order_id = $1 ORDER BY sequence_no`,
        [orderId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ sequence_no: 1, event_type: 'PLACEMENT', status: 'PLACED', role: 'CUSTOMER' });
    });

    it('snapshotted the delivery address, and the COD amount to collect', async () => {
      const res = await request(server())
        .get(`/admin/pif/orders/${orderId}`)
        .set('Authorization', asPifAdmin())
        .expect(200);
      expect(res.body.deliveryAddress).toMatch(/Home, F-401/);
      /*
       * THE CASH THE DRIVER COLLECTS INCLUDES THE DELIVERY CHARGE.
       *
       * 232 of merchandise, 20 of delivery, 252 to collect. This is the
       * assertion the approved requirement turns on, and it holds by
       * construction rather than by arithmetic repeated in a second place:
       * the insert binds ONE parameter to both `total` and `cod_amount`, so
       * a cash figure that disagreed with the order total could not be
       * written at all.
       */
      expect(res.body.deliveryTotal).toBe(20);
      expect(res.body.total).toBe(252);
      expect(res.body.codAmount).toBe(252);
      expect(res.body.codAmount).toBe(res.body.total);
      expect(res.body.paymentMethod).toBe('COD');
    });

    it('IGNORES a price, total or product name sent by the client', async () => {
      // The body is refused outright by the shape gate — the client cannot
      // even express a price. This is the first of the two defences; the
      // second is that nothing in the service reads one.
      const res = await request(server())
        .post('/pif/checkout')
        .set('Authorization', asShopper('buyer'))
        .send({
          lines: [{ productId: riceId, qty: 1 }],
          fulfillmentMode: 'DELIVERY',
          total: 1,
          subtotal: 1,
        });
      expect(res.status).toBe(400);

      // The same gate, over the fields the delivery rule added. A client
      // that cannot post a price must not be able to post a charge either.
      for (const extra of [
        { deliveryTotal: 0 },
        { deliveryFee: 0 },
        { freeDelivery: true },
        { codAmount: 1 },
      ]) {
        const attempt = await request(server())
          .post('/pif/checkout')
          .set('Authorization', asShopper('buyer'))
          .send({
            lines: [{ productId: riceId, qty: 1 }],
            fulfillmentMode: 'DELIVERY',
            ...extra,
          });
        expect(attempt.status).toBe(400);
      }
    });

    it('refuses an unavailable product, naming it', async () => {
      const res = await checkout('buyer', [{ productId: unavailableId, qty: 1 }]);
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('PRODUCT_UNAVAILABLE');
      expect(res.body.message).toMatch(/out of stock today/i);
    });

    it('refuses a deactivated product', async () => {
      const res = await checkout('buyer', [{ productId: inactiveId, qty: 1 }]);
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('PRODUCT_UNAVAILABLE');
    });

    it('refuses an empty cart', async () => {
      const res = await checkout('buyer', []);
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('EMPTY_CART');
    });

    it('refuses a quantity over the configured limit, and one off the step', async () => {
      const over = await checkout('buyer', [{ productId: limitedId, qty: 4 }]);
      expect(over.status).toBe(400);
      expect(over.body.details.reason).toBe('INVALID_QUANTITY');
      expect(over.body.message).toMatch(/limited to 3/);

      const fractional = await checkout('buyer', [{ productId: limitedId, qty: 1.5 }]);
      expect(fractional.status).toBe(400);
      expect(fractional.body.details.reason).toBe('INVALID_QUANTITY');
    });

    it('refuses zero and negative quantities at the shape gate', async () => {
      for (const qty of [0, -1]) {
        const res = await checkout('buyer', [{ productId: riceId, qty }]);
        expect(res.status).toBe(400);
      }
    });

    it('collapses a repeated product into one line with the summed quantity', async () => {
      const res = await checkout('buyer', [
        { productId: saltId, qty: 1 },
        { productId: saltId, qty: 2 },
      ]).expect(201);
      const rows = await db.query<{ qty: string; lines: string }>(
        `SELECT qty::text, (SELECT count(*)::text FROM pif.order_items WHERE order_id = $1) AS lines
           FROM pif.order_items WHERE order_id = $1`,
        [res.body.orderId]
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.qty)).toBe(3);
      // 3 x 22.00 of salt, plus the one delivery charge. ONE charge: the two
      // posted lines collapsed into a single line, and the charge is per
      // ORDER, so it is applied once either way.
      expect(res.body.total).toBe(86); // 66 + 20
    });

    it('a PICKUP order carries no address, and needs none', async () => {
      const res = await request(server())
        .post('/pif/checkout')
        .set('Authorization', asShopper('pickup'))
        .send({ lines: [{ productId: saltId, qty: 1 }], fulfillmentMode: 'PICKUP' })
        .expect(201);
      const rows = await db.query<{ mode: string; address: string | null }>(
        `SELECT fulfillment_mode AS mode, delivery_address_id::text AS address
           FROM pif.orders WHERE id = $1`,
        [res.body.orderId]
      );
      expect(rows[0]).toEqual({ mode: 'PICKUP', address: null });

      /*
       * AND IT CARRIES NO CHARGE, in the row itself. A pickup order with a
       * delivery charge is refused by the database as well as by the pricing
       * service (pif_orders_delivery_mode_chk), so this reads the stored
       * figure rather than trusting the response: 22.00 of salt, nothing
       * added, and the cash to collect is the same number.
       */
      const money = await db.query<{ delivery: string; total: string; cod: string | null }>(
        `SELECT delivery_total::text AS delivery, total::text AS total, cod_amount::text AS cod
           FROM pif.orders WHERE id = $1`,
        [res.body.orderId]
      );
      expect(Number(money[0]!.delivery)).toBe(0);
      expect(Number(money[0]!.total)).toBe(22);
      expect(Number(money[0]!.cod)).toBe(22);
    });

    it('refuses an address belonging to someone else', async () => {
      const res = await request(server())
        .post('/pif/checkout')
        .set('Authorization', asShopper('buyer'))
        .send({
          lines: [{ productId: saltId, qty: 1 }],
          fulfillmentMode: 'DELIVERY',
          deliveryAddressId: shoppers.get('other')!.addressId,
        });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('ADDRESS_NOT_FOUND');
    });

    it('the DATABASE refuses an order whose header disagrees with its lines', async () => {
      await expect(
        db.query(
          `DO $$
           DECLARE oid uuid;
           BEGIN
             INSERT INTO pif.orders (order_number, customer_id, fulfillment_mode, payment_method,
                                     delivery_address_id, delivery_address_snapshot,
                                     subtotal, discount_total, tax_total, total)
             VALUES ('PIF-BYPASS-0001', $1, 'PICKUP', 'COD', NULL, NULL, 999, 0, 0, 999)
             RETURNING id INTO oid;
             INSERT INTO pif.order_items (order_id, product_id, sku, product_name, unit, qty, unit_price,
                                          line_subtotal, line_discount, line_tax, line_total)
             VALUES (oid, $2, 'X', 'X', 'kg', 1, 10, 10, 0, 0, 10);
           END $$;`.replace('$1', `'${shoppers.get('buyer')!.customerId}'`).replace('$2', `'${saltId}'`)
        )
      ).rejects.toThrow();
    });

    it('the DATABASE refuses an order with no lines at all', async () => {
      await expect(
        db.query(
          `INSERT INTO pif.orders (order_number, customer_id, fulfillment_mode, payment_method,
                                   subtotal, discount_total, tax_total, total)
           VALUES ('PIF-BYPASS-0002', $1, 'PICKUP', 'COD', 0, 0, 0, 0)`,
          [shoppers.get('buyer')!.customerId]
        )
      ).rejects.toThrow();
    });
  });

  // =================================================================
  // 6. A double tap makes one order
  // =================================================================
  describe('6 — duplicate and simultaneous checkouts', () => {
    it('the SAME idempotency key twice places ONE order', async () => {
      const key = `jest-15f-${runId}-single`;
      const first = await checkout('repeat', [{ productId: riceId, qty: 1 }], {
        idempotencyKey: key,
      }).expect(201);
      const second = await checkout('repeat', [{ productId: riceId, qty: 1 }], {
        idempotencyKey: key,
      }).expect(201);

      expect(second.body.orderId).toBe(first.body.orderId);
      expect(second.body.duplicate).toBe(true);

      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM pif.orders WHERE customer_id = $1`,
        [shoppers.get('repeat')!.customerId]
      );
      expect(rows[0]!.total).toBe('1');
    });

    it('TWO AT ONCE with the same key still places ONE order', async () => {
      const key = `jest-15f-${runId}-race`;
      const results = await Promise.all([
        checkout('race', [{ productId: saltId, qty: 1 }], { idempotencyKey: key }),
        checkout('race', [{ productId: saltId, qty: 1 }], { idempotencyKey: key }),
      ]);
      const created = results.filter((r) => r.status === 201);
      expect(created.length).toBeGreaterThanOrEqual(1);

      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM pif.orders WHERE customer_id = $1`,
        [shoppers.get('race')!.customerId]
      );
      expect(rows[0]!.total).toBe('1');
    });

    it('without a key, two checkouts are two orders — as they should be', async () => {
      await checkout('other', [{ productId: saltId, qty: 1 }]).expect(201);
      await checkout('other', [{ productId: saltId, qty: 1 }]).expect(201);
      const rows = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM pif.orders WHERE customer_id = $1`,
        [shoppers.get('other')!.customerId]
      );
      expect(Number(rows[0]!.total)).toBe(2);
    });
  });

  // =================================================================
  // 7. The order desk
  // =================================================================
  describe('7 — the lifecycle, and who may move it', () => {
    let orderId: string;

    beforeAll(async () => {
      const res = await checkout('buyer', [{ productId: riceId, qty: 1 }]).expect(201);
      orderId = res.body.orderId;
    });

    it('a new order is PLACED and appears on the desk', async () => {
      const res = await request(server())
        .get('/admin/pif/orders?open=true&pageSize=100')
        .set('Authorization', asCashier())
        .expect(200);
      const mine = res.body.items.find((o: { id: string }) => o.id === orderId);
      expect(mine).toBeDefined();
      expect(mine.status).toBe('PLACED');
    });

    it('the dashboard counts it as a new order', async () => {
      const res = await request(server())
        .get('/admin/pif/dashboard')
        .set('Authorization', asPifAdmin())
        .expect(200);
      expect(res.body.newOrders).toBeGreaterThan(0);
      expect(res.body.openOrders).toBeGreaterThan(0);
    });

    it('cannot jump the sequence: PREPARING before ACCEPTED is refused', async () => {
      const res = await request(server())
        .post(`/admin/pif/orders/${orderId}/status`)
        .set('Authorization', asCashier())
        .send({ status: 'PREPARING' });
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('ILLEGAL_TRANSITION');
    });

    it('the PACKER cannot accept an order — that is the order desk’s authority', async () => {
      const res = await request(server())
        .post(`/admin/pif/orders/${orderId}/status`)
        .set('Authorization', asCashier())
        .send({ status: 'ACCEPTED' });
      expect(res.status).toBe(403);
      expect(res.body.details.reason).toBe('NOT_PERMITTED');
    });

    it('the order desk accepts it', async () => {
      const res = await request(server())
        .post(`/admin/pif/orders/${orderId}/status`)
        .set('Authorization', asPifAdmin())
        .send({ status: 'ACCEPTED' })
        .expect(201);
      expect(res.body.status).toBe('ACCEPTED');
    });

    it('the packer prepares and packs it', async () => {
      for (const status of ['PREPARING', 'READY_PICKED']) {
        await request(server())
          .post(`/admin/pif/orders/${orderId}/status`)
          .set('Authorization', asCashier())
          .send({ status })
          .expect(201);
      }
      const rows = await db.query<{ status: string }>(`SELECT status FROM pif.orders WHERE id = $1`, [orderId]);
      expect(rows[0]!.status).toBe('READY_PICKED');
    });

    it('DELIVERY_STAFF cannot send it out, and CAN complete it', async () => {
      const refused = await request(server())
        .post(`/admin/pif/orders/${orderId}/status`)
        .set('Authorization', asDelivery())
        .send({ status: 'OUT_FOR_DELIVERY' });
      expect(refused.status).toBe(403);

      await request(server())
        .post(`/admin/pif/orders/${orderId}/status`)
        .set('Authorization', asPifAdmin())
        .send({ status: 'OUT_FOR_DELIVERY' })
        .expect(201);

      await request(server())
        .post(`/admin/pif/orders/${orderId}/status`)
        .set('Authorization', asDelivery())
        .send({ status: 'DELIVERED' })
        .expect(201);
    });

    it('records the cash collected at handover — and nothing resembling a bill', async () => {
      await request(server())
        .post(`/admin/pif/orders/${orderId}/status`)
        .set('Authorization', asPifAdmin())
        .send({ status: 'COD_COLLECTED' })
        .expect(201);

      const rows = await db.query<{
        status: string;
        cod_collected_at: string | null;
        cod_amount: string;
        finalized: string | null;
      }>(
        `SELECT status, cod_collected_at::text, cod_amount::text, finalized_at::text AS finalized
           FROM pif.orders WHERE id = $1`,
        [orderId]
      );
      expect(rows[0]!.status).toBe('COD_COLLECTED');
      expect(rows[0]!.cod_collected_at).not.toBeNull();
      // 1 kg of rice at 100.00 plus 5% GST is 105 of merchandise — below
      // the threshold, so 20 of delivery was charged and the cash handed
      // over at the door is 125. The driver collects the charge too.
      expect(Number(rows[0]!.cod_amount)).toBe(125);
      // SALE_FINALIZED belongs to the facility's own billing software, and
      // this application never claims it happened.
      expect(rows[0]!.finalized).toBeNull();
      const bills = await db.query<{ total: string }>(
        `SELECT (SELECT count(*) FROM pif.pos_bills) + (SELECT count(*) FROM pif.pos_bill_items)
              + (SELECT count(*) FROM pif.cash_movements) AS total`
      );
      expect(Number(bills[0]!.total)).toBe(0);
    });

    it('every step is in the history with its actor, and in the audit log', async () => {
      const res = await request(server())
        .get(`/admin/pif/orders/${orderId}`)
        .set('Authorization', asPifAdmin())
        .expect(200);
      expect(res.body.history.map((h: { status: string }) => h.status)).toEqual([
        'PLACED',
        'ACCEPTED',
        'PREPARING',
        'READY_PICKED',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'COD_COLLECTED',
      ]);
      const delivered = res.body.history.find((h: { status: string }) => h.status === 'DELIVERED');
      expect(delivered.recordedBy.staffId).toBe(staffIdByRole.get('DELIVERY_STAFF'));
      expect(delivered.recordedAt).toBeTruthy();

      const audit = await db.query<{ action: string }>(
        `SELECT action FROM shared.audit_log WHERE entity_id = $1 AND module = 'pif' ORDER BY created_at`,
        [orderId]
      );
      expect(audit.map((a) => a.action)).toEqual([
        'PIF_ORDER_PLACED',
        'PIF_ORDER_ACCEPTED',
        'PIF_ORDER_PREPARING',
        'PIF_ORDER_READY_PICKED',
        'PIF_ORDER_OUT_FOR_DELIVERY',
        'PIF_ORDER_DELIVERED',
        'PIF_ORDER_COD_COLLECTED',
      ]);
    });

    it('nothing more can happen to a finished order', async () => {
      const res = await request(server())
        .post(`/admin/pif/orders/${orderId}/status`)
        .set('Authorization', asPifAdmin())
        .send({ status: 'CANCELLED', reason: 'changed my mind' });
      expect(res.status).toBe(409);
      expect(res.body.details.reason).toBe('ALREADY_FINISHED');
    });

    it('an explicit failure needs a reason, in words', async () => {
      const fresh = await checkout('buyer', [{ productId: saltId, qty: 1 }]).expect(201);
      const noReason = await request(server())
        .post(`/admin/pif/orders/${fresh.body.orderId}/status`)
        .set('Authorization', asPifAdmin())
        .send({ status: 'CANCELLED' });
      expect(noReason.status).toBe(400);
      expect(noReason.body.details.reason).toBe('REASON_REQUIRED');

      const cancelled = await request(server())
        .post(`/admin/pif/orders/${fresh.body.orderId}/status`)
        .set('Authorization', asPifAdmin())
        .send({ status: 'CANCELLED', reason: 'Customer called to cancel' })
        .expect(201);
      expect(cancelled.body.status).toBe('CANCELLED');

      const rows = await db.query<{ reason: string; cancelled_at: string | null }>(
        `SELECT e.reason, o.cancelled_at::text
           FROM pif.order_events e JOIN pif.orders o ON o.id = e.order_id
          WHERE e.order_id = $1 AND e.status = 'CANCELLED'`,
        [fresh.body.orderId]
      );
      expect(rows[0]!.reason).toBe('Customer called to cancel');
      expect(rows[0]!.cancelled_at).not.toBeNull();
    });

    it('a delivery that did not happen is recorded as NOT_DELIVERED, with its reason', async () => {
      const fresh = await checkout('buyer', [{ productId: saltId, qty: 1 }]).expect(201);
      await advanceTo(fresh.body.orderId, 'OUT_FOR_DELIVERY');
      const res = await request(server())
        .post(`/admin/pif/orders/${fresh.body.orderId}/status`)
        .set('Authorization', asDelivery())
        .send({ status: 'NOT_DELIVERED', reason: 'Nobody at the quarter' })
        .expect(201);
      expect(res.body.status).toBe('NOT_DELIVERED');

      const rows = await db.query<{ status: string; not_delivered_at: string | null }>(
        `SELECT status, not_delivered_at::text FROM pif.orders WHERE id = $1`,
        [fresh.body.orderId]
      );
      expect(rows[0]!.status).toBe('NOT_DELIVERED');
      expect(rows[0]!.not_delivered_at).not.toBeNull();
    });

    it('a note records words without touching the status', async () => {
      const fresh = await checkout('buyer', [{ productId: saltId, qty: 1 }]).expect(201);
      await request(server())
        .post(`/admin/pif/orders/${fresh.body.orderId}/notes`)
        .set('Authorization', asCashier())
        .send({ note: 'Customer asked for the morning slot' })
        .expect(201);
      const rows = await db.query<{ status: string; notes: string; event_type: string }>(
        `SELECT o.status, e.notes, e.event_type
           FROM pif.order_events e JOIN pif.orders o ON o.id = e.order_id
          WHERE e.order_id = $1 AND e.event_type = 'NOTE'`,
        [fresh.body.orderId]
      );
      expect(rows[0]!.status).toBe('PLACED');
      expect(rows[0]!.notes).toMatch(/morning slot/);
    });
  });

  // =================================================================
  // 8. The database is the enforcer
  // =================================================================
  describe('8 — the guards hold with the application bypassed', () => {
    let orderId: string;

    beforeAll(async () => {
      const res = await checkout('buyer', [{ productId: riceId, qty: 1 }]).expect(201);
      orderId = res.body.orderId;
    });

    it('refuses an illegal status transition written directly', async () => {
      await expect(
        db.query(
          `INSERT INTO pif.order_events (order_id, order_number, sequence_no, event_type, status,
                                         recorded_by, recorded_by_role)
           SELECT id, order_number, 2, 'STATUS', 'DELIVERED', $2, 'RIK_ADMIN'
             FROM pif.orders WHERE id = $1`,
          [orderId, staffIdByRole.get('PIF_ADMIN')]
        )
      ).rejects.toThrow();
    });

    it('refuses a second event at the same sequence number', async () => {
      await db.query(
        `INSERT INTO pif.order_events (order_id, order_number, sequence_no, event_type, status,
                                       recorded_by, recorded_by_role)
         SELECT id, order_number, 2, 'STATUS', 'ACCEPTED', $2, 'PIF_ADMIN'
           FROM pif.orders WHERE id = $1`,
        [orderId, staffIdByRole.get('PIF_ADMIN')]
      );
      await expect(
        db.query(
          `INSERT INTO pif.order_events (order_id, order_number, sequence_no, event_type, status,
                                         recorded_by, recorded_by_role)
           SELECT id, order_number, 2, 'STATUS', 'CANCELLED', $2, 'PIF_ADMIN'
             FROM pif.orders WHERE id = $1`,
          [orderId, staffIdByRole.get('PIF_ADMIN')]
        )
      ).rejects.toThrow();
    });

    it('the event moved the order’s status — and the application never wrote it', async () => {
      const rows = await db.query<{ status: string; accepted: string | null }>(
        `SELECT status, accepted_at::text AS accepted FROM pif.orders WHERE id = $1`,
        [orderId]
      );
      expect(rows[0]!.status).toBe('ACCEPTED');
      expect(rows[0]!.accepted).not.toBeNull();

      const privileges = await db.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'pif' AND table_name = 'orders' AND grantee = 'app_pif'
            AND privilege_type IN ('UPDATE', 'DELETE')`
      );
      expect(privileges).toEqual([]);
    });

    it('refuses an UPDATE or a DELETE of a fulfilment event', async () => {
      await expect(
        db.query(`UPDATE pif.order_events SET status = 'DELIVERED' WHERE order_id = $1`, [orderId])
      ).rejects.toThrow();
      await expect(
        db.query(`DELETE FROM pif.order_events WHERE order_id = $1`, [orderId])
      ).rejects.toThrow();
    });

    it('refuses an UPDATE or a DELETE of an order line — a placed order is history', async () => {
      await expect(
        db.query(`UPDATE pif.order_items SET unit_price = 1 WHERE order_id = $1`, [orderId])
      ).rejects.toThrow();
      await expect(
        db.query(`DELETE FROM pif.order_items WHERE order_id = $1`, [orderId])
      ).rejects.toThrow();
    });

    it('refuses a line whose total does not follow from its own quantity and price', async () => {
      await expect(
        db.query(
          `INSERT INTO pif.order_items (order_id, product_id, sku, product_name, unit, qty, unit_price,
                                        line_subtotal, line_discount, line_tax, line_total)
           VALUES ($1, $2, 'X', 'X', 'kg', 2, 100, 999, 0, 0, 999)`,
          [orderId, saltId]
        )
      ).rejects.toThrow();
    });

    it('refuses a payment method that is not cash on delivery', async () => {
      await expect(
        db.query(
          `INSERT INTO pif.orders (order_number, customer_id, fulfillment_mode, payment_method,
                                   subtotal, discount_total, tax_total, total)
           VALUES ('PIF-BYPASS-0003', $1, 'PICKUP', 'UPI', 0, 0, 0, 0)`,
          [shoppers.get('buyer')!.customerId]
        )
      ).rejects.toThrow();
    });

    it('refuses a delivery order with no address', async () => {
      await expect(
        db.query(
          `INSERT INTO pif.orders (order_number, customer_id, fulfillment_mode, payment_method,
                                   subtotal, discount_total, tax_total, total)
           VALUES ('PIF-BYPASS-0004', $1, 'DELIVERY', 'COD', 0, 0, 0, 0)`,
          [shoppers.get('buyer')!.customerId]
        )
      ).rejects.toThrow();
    });
  });

  // =================================================================
  // 9. A price change does not reach a placed order
  // =================================================================
  describe('9 — historical amounts are immutable', () => {
    it('re-pricing the catalogue leaves the placed order exactly as it was', async () => {
      const placed = await checkout('buyer', [{ productId: riceId, qty: 2 }]).expect(201);
      const before = placed.body.total;
      // 2 × 100.00 plus 5% GST is 210 of merchandise, and 20 of delivery
      // below the threshold.
      expect(before).toBe(230); // 210 + 20

      await request(server())
        .patch(`/admin/pif/products/${riceId}/price`)
        .set('Authorization', asPifAdmin())
        .send({ sellingPrice: 150 })
        .expect(200);

      const after = await request(server())
        .get(`/pif/orders/${placed.body.orderId}`)
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      expect(after.body.total).toBe(before);
      expect(after.body.items[0].unitPrice).toBe(100);

      // …while a NEW order gets the new price.
      const fresh = await checkout('buyer', [{ productId: riceId, qty: 1 }]).expect(201);
      // 150.00 plus 5% GST is 157.50 of merchandise — still below 499, so
      // the new order is charged for delivery exactly as the old one was.
      // The POLICY did not change here; only the price did.
      expect(fresh.body.total).toBe(177.5); // 157.50 + 20

      // Put it back, so the fixtures stay as the rest of the suite expects.
      await request(server())
        .patch(`/admin/pif/products/${riceId}/price`)
        .set('Authorization', asPifAdmin())
        .send({ sellingPrice: 100, taxRateId: gstRateId })
        .expect(200);
    });

    it('the price change itself is audited, with the figure it replaced', async () => {
      const rows = await db.query<{ before: string; after: string }>(
        `SELECT before::text, after::text FROM shared.audit_log
          WHERE module = 'pif' AND action = 'PIF_PRODUCT_PRICED' AND entity_id = $1
          ORDER BY created_at DESC LIMIT 1`,
        [riceId]
      );
      expect(rows[0]!.before).toMatch(/150/);
      expect(rows[0]!.after).toMatch(/100/);
    });
  });

  // =================================================================
  // 10. The shopper's own orders, read only
  // =================================================================
  describe('10 — the customer sees their order and cannot steer it', () => {
    let orderId: string;

    beforeAll(async () => {
      const res = await checkout('buyer', [{ productId: saltId, qty: 2 }]).expect(201);
      orderId = res.body.orderId;
    });

    it('lists their own orders, newest first', async () => {
      const res = await request(server())
        .get('/pif/orders')
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      expect(res.body.items[0].id).toBe(orderId);
      expect(res.body.items[0].paymentMethod).toBe('COD');
    });

    it('shows the status timeline as it actually happened', async () => {
      await advanceTo(orderId, 'PREPARING');
      const res = await request(server())
        .get(`/pif/orders/${orderId}`)
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      expect(res.body.status).toBe('PREPARING');
      expect(res.body.timeline.map((t: { status: string }) => t.status)).toEqual([
        'PLACED',
        'ACCEPTED',
        'PREPARING',
      ]);
    });

    it('sends the shopper NO staff identity and no internal note', async () => {
      await request(server())
        .post(`/admin/pif/orders/${orderId}/notes`)
        .set('Authorization', asCashier())
        .send({ note: 'Internal: short on the 1 kg packs' })
        .expect(201);

      const res = await request(server())
        .get(`/pif/orders/${orderId}`)
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('Internal: short');
      expect(body).not.toContain('recordedBy');
      expect(body).not.toContain(staffIdByRole.get('PIF_CASHIER'));
      expect(body).not.toContain('PIF_CASHIER');
    });

    it('another shopper’s order answers 404, not 403', async () => {
      await request(server())
        .get(`/pif/orders/${orderId}`)
        .set('Authorization', asShopper('other'))
        .expect(404);
    });

    it('offers the customer no way to change an order', async () => {
      for (const method of ['patch', 'put', 'delete'] as const) {
        const agent = request(server());
        const res = await agent[method](`/pif/orders/${orderId}`)
          .set('Authorization', asShopper('buyer'))
          .send({ status: 'DELIVERED' });
        expect([404, 405]).toContain(res.status);
      }
      const post = await request(server())
        .post(`/pif/orders/${orderId}/status`)
        .set('Authorization', asShopper('buyer'))
        .send({ status: 'DELIVERED' });
      expect([403, 404]).toContain(post.status);
    });
  });

  // =================================================================
  // 11. Product images
  // =================================================================
  describe('11 — an administrator uploads a product photo', () => {
    /** A real 1×1 PNG, so the magic-byte check is exercised, not mocked. */
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64'
    );

    it('uploads, stores and serves the image', async () => {
      const res = await request(server())
        .post(`/admin/pif/products/${riceId}/image`)
        .set('Authorization', asPifAdmin())
        .attach('file', png, 'rice.png')
        .expect(201);

      expect(res.body.imageRef).toMatch(/^pif\/products\/[0-9a-f-]{36}\.png$/);
      expect(res.body.contentType).toBe('image/png');

      const served = await request(server()).get(res.body.imageUrl).expect(200);
      expect(served.headers['content-type']).toContain('image/png');
      expect(Buffer.from(served.body).length).toBe(png.length);
    });

    it('the image shows up in BOTH the admin and the customer catalogue', async () => {
      const admin = await request(server())
        .get(`/admin/pif/products/${riceId}`)
        .set('Authorization', asPifAdmin())
        .expect(200);
      const customer = await request(server())
        .get(`/pif/products/${riceId}`)
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      expect(admin.body.imageUrl).toBe(customer.body.imageUrl);
      expect(customer.body.imageUrl).toMatch(/^\/pif\/media\/pif\/products\//);
    });

    it('a product with no image reports none, rather than a broken link', async () => {
      const res = await request(server())
        .get(`/pif/products/${saltId}`)
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      expect(res.body.imageUrl).toBeNull();
    });

    it('refuses a file that is not an image, however it is named', async () => {
      const res = await request(server())
        .post(`/admin/pif/products/${saltId}/image`)
        .set('Authorization', asPifAdmin())
        .attach('file', Buffer.from('<svg onload="alert(1)"></svg>'), 'innocent.png');
      expect(res.status).toBe(400);
      expect(res.body.details.reason).toBe('UNSUPPORTED_TYPE');
    });

    it('refuses an empty upload', async () => {
      const res = await request(server())
        .post(`/admin/pif/products/${saltId}/image`)
        .set('Authorization', asPifAdmin())
        .attach('file', Buffer.alloc(0), 'empty.png');
      expect(res.status).toBe(400);
    });

    it('a staff member without the catalogue permission cannot upload', async () => {
      await request(server())
        .post(`/admin/pif/products/${saltId}/image`)
        .set('Authorization', asCashier())
        .attach('file', png, 'nope.png')
        .expect(403);
      await request(server())
        .post(`/admin/pif/products/${saltId}/image`)
        .set('Authorization', asRikAdmin())
        .attach('file', png, 'nope.png')
        .expect(403);
    });

    it('refuses a key that tries to escape the media directory', async () => {
      for (const path of [
        '/pif/media/pif/products/../../../etc/passwd',
        '/pif/media/pif/products/not-a-uuid.png',
        '/pif/media/pif/elsewhere/00000000-0000-0000-0000-000000000000.png',
      ]) {
        const res = await request(server()).get(path);
        expect([400, 404]).toContain(res.status);
      }
    });

    it('replacing an image leaves no orphan behind', async () => {
      const first = await request(server())
        .post(`/admin/pif/products/${oilId}/image`)
        .set('Authorization', asPifAdmin())
        .attach('file', png, 'oil.png')
        .expect(201);
      const second = await request(server())
        .post(`/admin/pif/products/${oilId}/image`)
        .set('Authorization', asPifAdmin())
        .attach('file', png, 'oil2.png')
        .expect(201);

      expect(second.body.imageRef).not.toBe(first.body.imageRef);
      await request(server()).get(first.body.imageUrl).expect(404);
      await request(server()).get(second.body.imageUrl).expect(200);
    });

    it('removing an image clears the row and the file', async () => {
      const uploaded = await request(server())
        .post(`/admin/pif/products/${limitedId}/image`)
        .set('Authorization', asPifAdmin())
        .attach('file', png, 'ghee.png')
        .expect(201);
      await request(server())
        .delete(`/admin/pif/products/${limitedId}/image`)
        .set('Authorization', asPifAdmin())
        .expect(200);

      await request(server()).get(uploaded.body.imageUrl).expect(404);
      const res = await request(server())
        .get(`/pif/products/${limitedId}`)
        .set('Authorization', asShopper('buyer'))
        .expect(200);
      expect(res.body.imageUrl).toBeNull();
    });
  });

  // =================================================================
  // 12. RIK is untouched
  // =================================================================
  describe('12 — the approved RIK baseline is untouched', () => {
    it('the schema is 68 tables and 5 views, with pif at 23', async () => {
      const rows = await db.query<{ tables: string; views: string; pif: string }>(
        `SELECT (SELECT count(*)::text FROM pg_catalog.pg_tables WHERE schemaname IN ('shared','rik','pif')) AS tables,
                (SELECT count(*)::text FROM pg_catalog.pg_views  WHERE schemaname IN ('shared','rik','pif')) AS views,
                (SELECT count(*)::text FROM pg_catalog.pg_tables WHERE schemaname = 'pif') AS pif`
      );
      expect(rows[0]).toEqual({ tables: '68', views: '5', pif: '23' });
    });

    it('the RIK catalogue, scales and covers are exactly as they were', async () => {
      const rows = await db.query<{ pools: string; provisions: string; scales: string; covers: string }>(
        `SELECT (SELECT count(*)::text FROM rik.entitlement_pools) AS pools,
                (SELECT count(*)::text FROM rik.provisions) AS provisions,
                (SELECT count(*)::text FROM rik.pool_scales) AS scales,
                (SELECT count(image_ref)::text FROM rik.entitlement_pools) AS covers`
      );
      expect(rows[0]).toEqual({ pools: '18', provisions: '190', scales: '50', covers: '18' });
    });

    it('RIK voucher privileges and confirmed selections are as Phase E left them', async () => {
      const privileges = await db.query(
        `SELECT 1 FROM information_schema.role_table_grants
          WHERE table_schema = 'rik' AND table_name = 'issue_vouchers'
            AND grantee = 'app_rik' AND privilege_type IN ('UPDATE', 'DELETE')`
      );
      expect(privileges).toEqual([]);

      const snapshots = await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM rik.entitlement_selections
          WHERE status = 'CONFIRMED' AND rule_snapshot IS NULL`
      );
      expect(snapshots[0]!.total).toBe('0');
    });

    it('no PIF stock quantity was introduced anywhere', async () => {
      const columns = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'pif' AND table_name IN ('products', 'orders', 'order_items')
            AND column_name IN ('stock_qty', 'on_hand', 'quantity_available', 'reserved_qty')`
      );
      expect(columns).toEqual([]);

      const legacy = await db.query<{ total: string }>(
        `SELECT ((SELECT count(*) FROM pif.inventory) + (SELECT count(*) FROM pif.inventory_transactions))::text AS total`
      );
      expect(legacy[0]!.total).toBe('0');
    });

    it('the superseded PIF tables are still empty and unused', async () => {
      const rows = await db.query<{ total: string }>(
        `SELECT ((SELECT count(*) FROM pif.purchase_orders) + (SELECT count(*) FROM pif.suppliers)
               + (SELECT count(*) FROM pif.goods_receipts) + (SELECT count(*) FROM pif.returns)
               + (SELECT count(*) FROM pif.cashier_shifts))::text AS total`
      );
      expect(rows[0]!.total).toBe('0');
    });
  });
});
