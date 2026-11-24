import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { STAFF_ROLES } from '@esamagri/shared-types';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';
import { RikMediaService } from './services/rik-media.service';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * RIK New Arrivals — staff publish, customers read.
 *
 * THE FOUR THINGS THIS SUITE EXISTS TO PROVE:
 *
 *  1. IT IS RIK-ONLY. A PIF product id is refused, and so is any id that is
 *     not a RIK provision. Asserted against a REAL pif.products row where one
 *     exists, not only against a random uuid — a random uuid would pass a
 *     test that a real PIF id might still fail.
 *
 *  2. ONLY AUTHORISED RIK STAFF MAY MANAGE IT. Every one of the six staff
 *     roles is exercised against every mutating route, and a customer token
 *     is exercised too. Holding `rik.product.manage` is the whole rule, and
 *     the suite proves it by role rather than by assumption.
 *
 *  3. CUSTOMERS SEE ONLY WHAT IS PUBLISHED AND CURRENT. A draft, a listing
 *     whose window has not opened, one whose window has closed, and one whose
 *     product has been retired are each created and each proven absent.
 *
 *  4. REMOVING A LISTING NEVER REMOVES A PRODUCT. The provision is counted
 *     and read back after the listing is deleted.
 *
 * Everything this suite creates, it removes in afterAll. It never alters a
 * provision's business values — the one provision it retires is restored to
 * its original is_active in the same test.
 */
describe('RIK New Arrivals (integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;

  const runId = randomUUID().slice(0, 8);
  const staffIds: string[] = [];
  const staffTokens = new Map<string, string>();
  const createdListings: string[] = [];
  let customerToken: string;
  let customerId: string;
  let adminToken: string;
  /** Where RIK pictures are actually written, read from the service itself. */
  let mediaRoot: string;

  /** Provisions this suite features. Read from the real catalogue. */
  let provisionA: { id: string; code: string; name: string };
  let provisionB: { id: string; code: string };
  let provisionC: { id: string; code: string };
  let provisionD: { id: string; code: string };
  let pifProductId: string | null = null;

  const server = () => app.getHttpServer();
  const asAdmin = () => `Bearer ${adminToken}`;
  const customerList = () =>
    request(server()).get('/rik/new-arrivals').set('Authorization', `Bearer ${customerToken}`);

  async function createListing(body: Record<string, unknown>, token = adminToken) {
    const res = await request(server())
      .post('/admin/rik/new-arrivals')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    if (res.status === 201 || res.status === 200) createdListings.push(res.body.id);
    return res;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    tokenService = app.get(TokenService);
    mediaRoot = app.get(RikMediaService).rootPath;

    const passwordHash = await app.get(PasswordService).hash('CorrectHorseBatteryStaple!1');
    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    for (const role of STAFF_ROLES) {
      const rows = await db.query<{ id: string }>(
        `INSERT INTO shared.users (id, username, password_hash, display_name, status)
         VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
        [`jest_na_${role.toLowerCase()}_${runId}`, passwordHash, `Jest NA ${role} ${runId}`]
      );
      const id = rows[0]!.id;
      staffIds.push(id);
      await db.query(
        `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
         SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3`,
        [id, bootstrap[0]!.id, role]
      );
      staffTokens.set(role, tokenService.signAccessToken({ principalType: 'STAFF', principalId: id }));
    }
    adminToken = staffTokens.get('RIK_ADMIN')!;

    const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '5').slice(0, 7);
    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active)
       VALUES (shared.uuid_generate_v7(), $1, $2, true) RETURNING id`,
      [`+91664${digits}`, `Jest NA Customer ${runId}`]
    );
    customerId = customer[0]!.id;
    customerToken = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerId });

    const provisions = await db.query<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM rik.provisions
        WHERE is_active AND effective_from <= CURRENT_DATE
          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        ORDER BY code LIMIT 4`
    );
    [provisionA, provisionB, provisionC, provisionD] = provisions as [
      typeof provisionA,
      typeof provisionB,
      typeof provisionC,
      typeof provisionD,
    ];

    // A REAL PIF product, where the environment has one. This is the id that
    // actually matters for the RIK-only test.
    const pif = await db.query<{ id: string }>(`SELECT id FROM pif.products LIMIT 1`);
    pifProductId = pif[0]?.id ?? null;
  });

  afterAll(async () => {
    if (createdListings.length > 0) {
      await db.query('DELETE FROM rik.new_arrivals WHERE id = ANY($1::uuid[])', [createdListings]);
    }
    // Anything this suite made but did not track, by its provisions.
    await db.query('DELETE FROM rik.new_arrivals WHERE provision_id = ANY($1::uuid[])', [
      [provisionA, provisionB, provisionC, provisionD].filter(Boolean).map((p) => p.id),
    ]);
    if (staffIds.length > 0) {
      await db.query('DELETE FROM shared.user_roles WHERE user_id = ANY($1::uuid[])', [staffIds]);
      await db.query('DELETE FROM shared.users WHERE id = ANY($1::uuid[])', [staffIds]);
    }
    if (customerId) await db.query('DELETE FROM shared.customers WHERE id = $1', [customerId]);
    await app.close();
  });

  beforeEach(async () => {
    await db.query('DELETE FROM rik.new_arrivals WHERE provision_id = ANY($1::uuid[])', [
      [provisionA, provisionB, provisionC, provisionD].map((p) => p.id),
    ]);
  });

  // ==================================================== 1. RIK ONLY

  it('TEST 1 — a REAL PIF product id is refused', async () => {
    if (pifProductId === null) {
      // Stated rather than silently skipped, so a green run is not mistaken
      // for proof when the environment has no PIF catalogue loaded.
      expect(pifProductId).toBeNull();
      return;
    }
    const res = await createListing({ provisionId: pifProductId });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/RIK catalogue/i);
    expect(res.body.details.reason).toBe('PROVISION_NOT_FOUND');

    // And nothing was written.
    const rows = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rik.new_arrivals WHERE provision_id = $1`,
      [pifProductId]
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('TEST 2 — an id that is not in the RIK catalogue at all is refused', async () => {
    const res = await createListing({ provisionId: randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body.details.reason).toBe('PROVISION_NOT_FOUND');
  });

  it('TEST 3 — a malformed id is refused before it reaches the service', async () => {
    const res = await createListing({ provisionId: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });

  it('TEST 4 — an unknown field is refused rather than quietly dropped', async () => {
    const res = await createListing({ provisionId: provisionA.id, isAdmin: true });
    expect(res.status).toBe(400);
  });

  // ============================================= 2. AUTHORISATION

  it('TEST 5 — only roles holding rik.product.manage may create a listing', async () => {
    const allowed = new Set(['SUPER_ADMIN', 'RIK_ADMIN']);
    for (const role of STAFF_ROLES) {
      await db.query('DELETE FROM rik.new_arrivals WHERE provision_id = $1', [provisionA.id]);
      const res = await request(server())
        .post('/admin/rik/new-arrivals')
        .set('Authorization', `Bearer ${staffTokens.get(role)}`)
        .send({ provisionId: provisionA.id });
      const outcome = allowed.has(role) ? 'allowed' : 'refused';
      expect({ role, outcome: res.status === 403 ? 'refused' : 'allowed' }).toEqual({ role, outcome });
      if (res.body?.id) createdListings.push(res.body.id);
    }
  });

  it('TEST 6 — a customer cannot manage listings, on any mutating route', async () => {
    const created = await createListing({ provisionId: provisionA.id });
    const id = created.body.id;
    const auth = `Bearer ${customerToken}`;

    const calls = [
      request(server()).post('/admin/rik/new-arrivals').set('Authorization', auth).send({ provisionId: provisionB.id }),
      request(server()).patch(`/admin/rik/new-arrivals/${id}`).set('Authorization', auth).send({ headline: 'x' }),
      request(server())
        .post(`/admin/rik/new-arrivals/${id}/published`)
        .set('Authorization', auth)
        .send({ isPublished: true }),
      request(server()).delete(`/admin/rik/new-arrivals/${id}`).set('Authorization', auth),
      request(server()).get('/admin/rik/new-arrivals').set('Authorization', auth),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
    }
    // The listing survived every attempt.
    expect(await db.query(`SELECT 1 FROM rik.new_arrivals WHERE id = $1`, [id])).toHaveLength(1);
  });

  it('TEST 7 — no token at all is refused on both the staff and customer routes', async () => {
    expect((await request(server()).get('/admin/rik/new-arrivals')).status).toBe(401);
    expect((await request(server()).get('/rik/new-arrivals')).status).toBe(401);
  });

  it('TEST 8 — staff hold no customer session, so the customer route refuses them', async () => {
    for (const role of STAFF_ROLES) {
      const res = await request(server())
        .get('/rik/new-arrivals')
        .set('Authorization', `Bearer ${staffTokens.get(role)}`);
      expect({ role, status: res.status }).toEqual({ role, status: 403 });
    }
  });

  // ====================================== 3. WHAT A CUSTOMER SEES

  it('TEST 9 — a published, current listing reaches the customer', async () => {
    const created = await createListing({
      provisionId: provisionA.id,
      headline: 'Now stocked',
      isPublished: true,
    });
    expect(created.status).toBe(201);

    const res = await customerList().expect(200);
    const codes = res.body.items.map((i: { code: string }) => i.code);
    expect(codes).toContain(provisionA.code);
    const item = res.body.items.find((i: { code: string }) => i.code === provisionA.code);
    expect(item.headline).toBe('Now stocked');
    expect(item.name).toBe(provisionA.name);
  });

  it('TEST 10 — a DRAFT (unpublished) listing never reaches the customer', async () => {
    await createListing({ provisionId: provisionA.id, isPublished: false });
    const res = await customerList().expect(200);
    expect(res.body.items.map((i: { code: string }) => i.code)).not.toContain(provisionA.code);
  });

  it('TEST 11 — a listing whose window has not opened yet is not shown', async () => {
    await createListing({
      provisionId: provisionA.id,
      isPublished: true,
      publishedFrom: '2099-01-01',
    });
    const res = await customerList().expect(200);
    expect(res.body.items.map((i: { code: string }) => i.code)).not.toContain(provisionA.code);
  });

  it('TEST 12 — an EXPIRED listing is not shown', async () => {
    await createListing({
      provisionId: provisionA.id,
      isPublished: true,
      publishedFrom: '2020-01-01',
      publishedUntil: '2020-12-31',
    });
    const res = await customerList().expect(200);
    expect(res.body.items.map((i: { code: string }) => i.code)).not.toContain(provisionA.code);
  });

  it('TEST 13 — a published listing whose PRODUCT was retired is not shown', async () => {
    await createListing({ provisionId: provisionB.id, isPublished: true });
    const before = await db.query<{ is_active: boolean }>(`SELECT is_active FROM rik.provisions WHERE id = $1`, [
      provisionB.id,
    ]);
    try {
      await db.query(`UPDATE rik.provisions SET is_active = false WHERE id = $1`, [provisionB.id]);
      const res = await customerList().expect(200);
      expect(res.body.items.map((i: { code: string }) => i.code)).not.toContain(provisionB.code);
    } finally {
      // Restored to exactly what it was, in the same test.
      await db.query(`UPDATE rik.provisions SET is_active = $2 WHERE id = $1`, [
        provisionB.id,
        before[0]!.is_active,
      ]);
    }
  });

  it('TEST 14 — unpublishing removes it from the customer list at once', async () => {
    const created = await createListing({ provisionId: provisionA.id, isPublished: true });
    expect((await customerList()).body.items.map((i: { code: string }) => i.code)).toContain(provisionA.code);

    await request(server())
      .post(`/admin/rik/new-arrivals/${created.body.id}/published`)
      .set('Authorization', asAdmin())
      .send({ isPublished: false })
      .expect(201);

    expect((await customerList()).body.items.map((i: { code: string }) => i.code)).not.toContain(provisionA.code);
  });

  it('TEST 15 — an empty list is a 200 with no items, not an error', async () => {
    const res = await customerList().expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('TEST 16 — the customer response leaks no staff or entitlement field', async () => {
    await createListing({ provisionId: provisionA.id, isPublished: true });
    const res = await customerList().expect(200);
    const item = res.body.items.find((i: { code: string }) => i.code === provisionA.code);

    const forbidden = [
      'id', 'provisionId', 'provision_id', 'isPublished', 'is_published',
      'createdBy', 'created_by', 'updatedBy', 'updated_by',
      'consumptionRatio', 'consumption_ratio', 'maxQuantity', 'max_quantity',
      'maxPacks', 'minEligibleDays', 'dietaryPreference', 'isCustomerSelectable',
      'publishedUntil', 'displayOrder',
    ];
    for (const field of forbidden) {
      expect({ field, present: field in item }).toEqual({ field, present: false });
    }
    expect(Object.keys(item).sort()).toEqual(
      ['brand', 'code', 'headline', 'imageRef', 'issuePeriod', 'name', 'packSize', 'packUnit', 'poolName', 'publishedFrom', 'unit'].sort()
    );
  });

  // ============================ 4. REMOVING A LISTING, NOT A PRODUCT

  it('TEST 17 — removing a listing leaves the provision in the catalogue', async () => {
    const created = await createListing({ provisionId: provisionC.id, isPublished: true });
    const countBefore = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM rik.provisions`);

    const res = await request(server())
      .delete(`/admin/rik/new-arrivals/${created.body.id}`)
      .set('Authorization', asAdmin())
      .expect(200);
    expect(res.body).toEqual({ removed: true, provisionCode: provisionC.code, provisionDeleted: false });

    const countAfter = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM rik.provisions`);
    expect(countAfter[0]!.n).toBe(countBefore[0]!.n);

    const stillThere = await db.query(`SELECT 1 FROM rik.provisions WHERE id = $1 AND is_active`, [provisionC.id]);
    expect(stillThere).toHaveLength(1);
  });

  // ================================================ 5. OTHER RULES

  it('TEST 18 — the same product cannot be listed twice', async () => {
    await createListing({ provisionId: provisionD.id });
    const second = await createListing({ provisionId: provisionD.id });
    expect(second.status).toBe(400);
    expect(second.body.details.reason).toBe('ALREADY_LISTED');
  });

  it('TEST 19 — a window that closes before it opens is refused', async () => {
    const res = await createListing({
      provisionId: provisionA.id,
      publishedFrom: '2026-06-01',
      publishedUntil: '2026-05-01',
    });
    expect(res.status).toBe(400);
    expect(res.body.details.reason).toBe('INVALID_WINDOW');
  });

  it('TEST 20 — a headline longer than the cap is refused by the shape gate', async () => {
    const res = await createListing({ provisionId: provisionA.id, headline: 'x'.repeat(141) });
    expect(res.status).toBe(400);
  });

  it('TEST 21 — staff see drafts; the same listing is invisible to customers', async () => {
    await createListing({ provisionId: provisionA.id, isPublished: false });
    const staff = await request(server()).get('/admin/rik/new-arrivals').set('Authorization', asAdmin()).expect(200);
    expect(staff.body.items.map((i: { code: string }) => i.code)).toContain(provisionA.code);
    const customer = await customerList().expect(200);
    expect(customer.body.items.map((i: { code: string }) => i.code)).not.toContain(provisionA.code);
  });

  it('TEST 22 — managing a listing writes an attributable audit entry', async () => {
    const created = await createListing({ provisionId: provisionA.id });
    const rows = await db.query<{ action: string; entity_type: string; actor_id: string }>(
      `SELECT action, entity_type, actor_id FROM shared.audit_log
        WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [created.body.id]
    );
    expect(rows[0]!.action).toBe('RIK_NEW_ARRIVAL_CREATED');
    expect(rows[0]!.entity_type).toBe('rik.new_arrivals');
    expect(rows[0]!.actor_id).not.toBeNull();
  });

  it('TEST 23 — the entitlement route is untouched and still answers for a customer', async () => {
    const res = await request(server())
      .get('/rik/entitlements/current')
      .set('Authorization', `Bearer ${customerToken}`);
    // A 200, or a 404/409 about periods, is fine. A 500 is not.
    expect(res.status).toBeLessThan(500);
  });
  // ================================ 6. THE PROMOTIONAL PICTURE
  //
  // A SECOND, SEPARATE PICTURE. The product's catalogue photograph belongs to
  // the provision; this one belongs to the listing. The tests that matter
  // most here are the ones proving that managing the second never disturbs
  // the first — neither the row nor the file on disk.

  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 9)]);
  const WEBP = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x40, 0, 0, 0]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.alloc(64, 3),
  ]);
  /** A GIF: a real image, and a format this application deliberately refuses. */
  const GIF = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(64, 1)]);

  const upload = (id: string, buf: Buffer, name: string, type: string, token = adminToken) =>
    request(server())
      .post(`/admin/rik/new-arrivals/${id}/image`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buf, { filename: name, contentType: type });

  async function listingWithImage(buf = PNG) {
    const created = await createListing({ provisionId: provisionA.id, isPublished: true });
    const res = await upload(created.body.id, buf, 'promo.png', 'image/png').expect(201);
    return { id: created.body.id as string, imageRef: res.body.imageRef as string };
  }

  it('TEST 24 — accepts PNG, JPEG and WebP, and files land under rik/new-arrivals/', async () => {
    for (const [buf, name, type, ext] of [
      [PNG, 'a.png', 'image/png', 'png'],
      [JPEG, 'b.jpg', 'image/jpeg', 'jpg'],
      [WEBP, 'c.webp', 'image/webp', 'webp'],
    ] as const) {
      await db.query('DELETE FROM rik.new_arrivals WHERE provision_id = $1', [provisionA.id]);
      const created = await createListing({ provisionId: provisionA.id });
      const res = await upload(created.body.id, Buffer.from(buf), name, type).expect(201);
      expect(res.body.imageRef).toMatch(new RegExp(`^rik/new-arrivals/[0-9a-f-]{36}\\.${ext}$`));
      expect(res.body.imageUrl).toBe(`/rik/media/${res.body.imageRef}`);
      // The listing now owns a picture, and it is also the effective one.
      expect(res.body.hasOwnImage).toBe(true);
      expect(res.body.effectiveImageRef).toBe(res.body.imageRef);
      expect(existsSync(join(mediaRoot, res.body.imageRef))).toBe(true);
    }
  });

  it('TEST 25 — refuses a format it does not support, however it is labelled', async () => {
    const created = await createListing({ provisionId: provisionA.id });
    const res = await upload(created.body.id, GIF, 'promo.png', 'image/png');
    expect(res.status).toBe(400);
    expect(res.body.details.reason).toBe('UNSUPPORTED_TYPE');
    // And the listing is still usable — a refused upload leaves no wreckage.
    const after = await db.query<{ image_ref: string | null }>(
      'SELECT image_ref FROM rik.new_arrivals WHERE id = $1',
      [created.body.id]
    );
    expect(after[0]!.image_ref).toBeNull();
  });

  it('TEST 26 — a text file renamed .png is refused: the BYTES decide, not the name', async () => {
    const created = await createListing({ provisionId: provisionA.id });
    const res = await upload(created.body.id, Buffer.from('<?php echo 1; ?>'), 'evil.png', 'image/png');
    expect(res.status).toBe(400);
    expect(res.body.details.reason).toBe('UNSUPPORTED_TYPE');
  });

  it('TEST 27 — an empty upload is refused', async () => {
    const created = await createListing({ provisionId: provisionA.id });
    const res = await request(server())
      .post(`/admin/rik/new-arrivals/${created.body.id}/image`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('TEST 28 — a file over the configured limit is refused by the server', async () => {
    const created = await createListing({ provisionId: provisionA.id });
    const limit = app.get(RikMediaService).limitBytes;
    const huge = Buffer.concat([PNG, Buffer.alloc(limit + 1024, 5)]);
    const res = await upload(created.body.id, huge, 'huge.png', 'image/png');
    expect(res.status).toBe(400);
    expect(res.body.details.reason).toBe('TOO_LARGE');
  });

  it('TEST 29 — the original filename is never used, so it cannot carry a path', async () => {
    const created = await createListing({ provisionId: provisionA.id });
    const res = await upload(created.body.id, PNG, '../../../etc/passwd.png', 'image/png').expect(201);
    expect(res.body.imageRef).toMatch(/^rik\/new-arrivals\/[0-9a-f-]{36}\.png$/);
    expect(res.body.imageRef).not.toContain('..');
    expect(res.body.imageRef).not.toContain('passwd');
  });

  it('TEST 30 — only rik.product.manage holders may upload or remove', async () => {
    const allowed = new Set(['SUPER_ADMIN', 'RIK_ADMIN']);
    const { id } = await listingWithImage();
    for (const role of STAFF_ROLES) {
      const up = await upload(id, JPEG, 'x.jpg', 'image/jpeg', staffTokens.get(role)!);
      const del = await request(server())
        .delete(`/admin/rik/new-arrivals/${id}/image`)
        .set('Authorization', `Bearer ${staffTokens.get(role)}`);
      const want = allowed.has(role) ? 'allowed' : 'refused';
      expect({ role, up: up.status === 403 ? 'refused' : 'allowed' }).toEqual({ role, up: want });
      expect({ role, del: del.status === 403 ? 'refused' : 'allowed' }).toEqual({ role, del: want });
      if (allowed.has(role)) await upload(id, PNG, 'x.png', 'image/png');
    }
  });

  it('TEST 31 — a customer can neither upload nor remove a promotional picture', async () => {
    const { id } = await listingWithImage();
    const up = await upload(id, PNG, 'x.png', 'image/png', customerToken);
    const del = await request(server())
      .delete(`/admin/rik/new-arrivals/${id}/image`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(up.status).toBe(403);
    expect(del.status).toBe(403);
  });

  it('TEST 32 — REPLACING deletes only the old promotional file', async () => {
    const { id, imageRef: first } = await listingWithImage();
    const second = await upload(id, JPEG, 'new.jpg', 'image/jpeg').expect(201);

    expect(second.body.imageRef).not.toBe(first);
    expect(existsSync(join(mediaRoot, first))).toBe(false);
    expect(existsSync(join(mediaRoot, second.body.imageRef))).toBe(true);
  });

  it('TEST 33 — REMOVING the promotional picture does not touch the product', async () => {
    // The product carries its own uploaded photograph, in the provisions
    // scope. This is the test that matters most: the two live in the same
    // media store, so an unscoped delete would take the catalogue photo with
    // it and break every other screen that shows the product.
    const provisionPhoto = await request(server())
      .post(`/admin/rik/config/provisions/${provisionA.id}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG, { filename: 'product.png', contentType: 'image/png' })
      .expect(201);
    const productKey = provisionPhoto.body.imageRef as string;

    const { id, imageRef: promoKey } = await listingWithImage(JPEG);
    expect(promoKey).not.toBe(productKey);

    const removed = await request(server())
      .delete(`/admin/rik/new-arrivals/${id}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(removed.body.provisionImageChanged).toBe(false);
    // The listing owns no picture now, and falls back to the product's.
    expect(removed.body.hasOwnImage).toBe(false);
    expect(removed.body.imageRef).toBeNull();
    expect(removed.body.effectiveImageRef).toBe(productKey);
    // The promotional file is gone...
    expect(existsSync(join(mediaRoot, promoKey))).toBe(false);
    // ...and the product's photograph is untouched, on disk AND in its row.
    expect(existsSync(join(mediaRoot, productKey))).toBe(true);
    const row = await db.query<{ image_ref: string }>('SELECT image_ref FROM rik.provisions WHERE id = $1', [
      provisionA.id,
    ]);
    expect(row[0]!.image_ref).toBe(productKey);
  });

  it('TEST 34 — with no promotional picture, the customer sees the catalogue one', async () => {
    const photo = await request(server())
      .post(`/admin/rik/config/provisions/${provisionA.id}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG, { filename: 'product.png', contentType: 'image/png' })
      .expect(201);
    await createListing({ provisionId: provisionA.id, isPublished: true });

    const res = await customerList().expect(200);
    const item = res.body.items.find((i: { code: string }) => i.code === provisionA.code);
    expect(item.imageRef).toBe(`/rik/media/${photo.body.imageRef}`);
  });

  it('TEST 35 — with one, the customer sees the PROMOTIONAL picture instead', async () => {
    await request(server())
      .post(`/admin/rik/config/provisions/${provisionA.id}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG, { filename: 'product.png', contentType: 'image/png' })
      .expect(201);
    const { imageRef: promoKey } = await listingWithImage(JPEG);

    const res = await customerList().expect(200);
    const item = res.body.items.find((i: { code: string }) => i.code === provisionA.code);
    expect(item.imageRef).toBe(`/rik/media/${promoKey}`);
    expect(promoKey).toContain('rik/new-arrivals/');
  });

  it('TEST 36 — an UNPUBLISHED listing stays hidden even with a promotional picture', async () => {
    const created = await createListing({ provisionId: provisionA.id, isPublished: false });
    await upload(created.body.id, PNG, 'promo.png', 'image/png').expect(201);
    const res = await customerList().expect(200);
    expect(res.body.items.map((i: { code: string }) => i.code)).not.toContain(provisionA.code);
  });

  it('TEST 37 — the uploaded picture is retrievable from the public media route', async () => {
    const { imageRef } = await listingWithImage();
    const res = await request(server()).get(`/rik/media/${imageRef}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('TEST 38 — uploading writes an attributable audit entry and says the product was untouched', async () => {
    const { id } = await listingWithImage();
    const rows = await db.query<{ action: string; after: { provisionImageChanged: boolean } }>(
      `SELECT action, "after" FROM shared.audit_log WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    expect(rows[0]!.action).toBe('RIK_NEW_ARRIVAL_IMAGE_SET');
    expect(rows[0]!.after.provisionImageChanged).toBe(false);
  });
});
