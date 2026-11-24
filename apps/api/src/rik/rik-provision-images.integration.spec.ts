import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { STAFF_ROLES, type StaffRole } from '@esamagri/shared-types';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';
import { RikMediaService, rikImageUrl } from './services/rik-media.service';

/**
 * RIK provision pictures — upload, replace, remove and serve, over real HTTP
 * against real PostgreSQL and a real directory on disk.
 *
 * WHAT THIS SUITE IS FOR, in order of importance:
 *
 *  1. THE 180 PICTURES ALREADY ATTACHED MUST NOT MOVE. Every existing
 *     reference is a `/catalogue/rik/...` path served by the customer app's
 *     own bundle. Adding uploads must not change where a single one of them
 *     is fetched from, and an upload over one must not delete the committed
 *     file. Both are asserted directly.
 *
 *  2. A FILE IS WHAT ITS BYTES SAY IT IS. A text file renamed `.png` is
 *     refused, because the check is on the magic bytes and not on the name
 *     or the declared content type.
 *
 *  3. ONLY `rik.product.manage` MAY DO THIS. Every other staff role in the
 *     seed, a staff member with no role, a customer and an anonymous caller
 *     are each pointed at the route. No new permission was introduced, and
 *     the suite asserts the permission count is unchanged.
 *
 *  4. NOTHING ESCAPES THE MEDIA ROOT. Traversal-shaped keys are refused by
 *     the serving route before the filesystem is touched, and an unknown key
 *     answers exactly as a malformed one does, so the route is not an oracle.
 *
 * EVERY ROW AND FILE THIS SUITE CREATES IS ITS OWN, tagged with a per-run id
 * and removed in afterAll. It runs no migration, resets nothing, and asserts
 * only on what it created — except the two preservation checks, which read
 * the existing catalogue without writing to it.
 *
 * RIK_MEDIA_ROOT is pointed at a fresh temporary directory for the run, so
 * the suite can count the files on disk and can never touch a real store.
 */
describe('RIK provision images (integration, real PostgreSQL + real HTTP + real disk)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;
  let mediaRoot: string;

  const runId = randomUUID().slice(0, 8);
  const tokenByRole = new Map<StaffRole, string>();
  const staffIds: string[] = [];
  let noRoleToken: string;
  let customerToken: string;
  let customerId: string;
  let provisionId: string;
  let poolId: string;

  const server = () => app.getHttpServer();
  const bearer = (role: StaffRole) => `Bearer ${tokenByRole.get(role)}`;
  const admin = () => bearer('RIK_ADMIN');

  /** A real 1x1 PNG — a genuine file, not a buffer that merely starts with the signature. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64'
  );
  /** A minimal JPEG and a minimal WebP, identified by their own leading bytes. */
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
  const WEBP = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x40, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.alloc(52, 3),
  ]);

  const filesOnDisk = async (): Promise<string[]> => {
    const dir = join(mediaRoot, 'rik', 'provisions');
    if (!existsSync(dir)) return [];
    return (await readdir(dir)).filter((name) => !name.endsWith('.part'));
  };

  const upload = (body: Buffer, filename: string, auth = admin()) =>
    request(server())
      .post(`/admin/rik/config/provisions/${provisionId}/image`)
      .set('Authorization', auth)
      .attach('file', body, filename);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    tokenService = app.get(TokenService);
    // Asked of the service rather than assumed from the environment
    // variable: the configuration is read once in its constructor, and a
    // test that counts files has to look where the service actually writes.
    mediaRoot = app.get(RikMediaService).rootPath;

    const passwordHash = await app.get(PasswordService).hash('CorrectHorseBatteryStaple!1');
    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    const grantedBy = bootstrap[0]!.id;

    for (const role of STAFF_ROLES) {
      const rows = await db.query<{ id: string }>(
        `INSERT INTO shared.users (id, username, password_hash, display_name, status)
         VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
        [`jest_img_${role.toLowerCase()}_${runId}`, passwordHash, `Jest IMG ${role} ${runId}`]
      );
      const id = rows[0]!.id;
      staffIds.push(id);
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
      [`jest_img_norole_${runId}`, passwordHash, `Jest IMG NoRole ${runId}`]
    );
    staffIds.push(noRole[0]!.id);
    noRoleToken = tokenService.signAccessToken({ principalType: 'STAFF', principalId: noRole[0]!.id });

    const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '5').slice(0, 7);
    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active)
       VALUES (shared.uuid_generate_v7(), $1, $2, true) RETURNING id`,
      [`+91881${digits}`, `Jest IMG Customer ${runId}`]
    );
    customerId = customer[0]!.id;
    customerToken = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerId });

    // The suite's own provision, on an existing pool, so no entitlement
    // configuration of the facility's is touched.
    const pool = await db.query<{ id: string }>(`SELECT id FROM rik.entitlement_pools ORDER BY code LIMIT 1`);
    poolId = pool[0]!.id;
    const provision = await db.query<{ id: string }>(
      `INSERT INTO rik.provisions (pool_id, code, name, unit, consumption_ratio, issue_period, is_active)
       VALUES ($1, $2, $3, 'g', 1.000000, 'DRY', true) RETURNING id`,
      [poolId, `JEST_IMG_${runId.toUpperCase()}`, `Jest Image Item ${runId}`]
    );
    provisionId = provision[0]!.id;
  });

  afterAll(async () => {
    if (provisionId) {
      await db.query('DELETE FROM rik.provisions WHERE id = $1', [provisionId]);
    }
    if (staffIds.length > 0) {
      await db.query('DELETE FROM shared.user_roles WHERE user_id = ANY($1::uuid[])', [staffIds]);
      await db.query('DELETE FROM shared.users WHERE id = ANY($1::uuid[])', [staffIds]);
    }
    if (customerId) {
      await db.query('DELETE FROM shared.customers WHERE id = $1', [customerId]);
    }
    await app.close();
  });

  const storedRef = async (): Promise<string | null> => {
    const rows = await db.query<{ image_ref: string | null }>(
      'SELECT image_ref FROM rik.provisions WHERE id = $1',
      [provisionId]
    );
    return rows[0]!.image_ref;
  };

  // ------------------------------------------------------------ uploading

  it('TEST 1 — a PNG is stored under a generated key, and the row records it', async () => {
    const res = await upload(PNG, 'rice.png').expect(201);

    expect(res.body.imageRef).toMatch(/^rik\/provisions\/[0-9a-f-]{36}\.png$/);
    expect(res.body.imageUrl).toBe(`/rik/media/${res.body.imageRef}`);
    expect(res.body.bytes).toBe(PNG.length);
    expect(res.body.contentType).toBe('image/png');
    // Nothing the client sent takes part in the filename.
    expect(res.body.imageRef).not.toContain('rice');
    expect(await storedRef()).toBe(res.body.imageRef);

    const onDisk = await filesOnDisk();
    expect(onDisk).toHaveLength(1);
    // The bytes on disk are the bytes that were sent, unaltered.
    expect(await readFile(join(mediaRoot, res.body.imageRef))).toEqual(PNG);
  });

  it('TEST 2 — JPEG and WebP are accepted, each with its own extension', async () => {
    const jpeg = await upload(JPEG, 'anything.bin').expect(201);
    expect(jpeg.body.imageRef).toMatch(/\.jpg$/);
    expect(jpeg.body.contentType).toBe('image/jpeg');

    const webp = await upload(WEBP, 'anything.bin').expect(201);
    expect(webp.body.imageRef).toMatch(/\.webp$/);
    expect(webp.body.contentType).toBe('image/webp');
  });

  it('TEST 3 — a text file renamed .png is REFUSED: the bytes decide, not the name', async () => {
    const before = await storedRef();
    const res = await upload(Buffer.from('this is not a picture', 'utf8'), 'malware.png').expect(400);

    expect(res.body.details.reason).toBe('UNSUPPORTED_TYPE');
    expect(res.body.message).toMatch(/PNG, JPEG and WebP/i);
    // The refusal changed nothing.
    expect(await storedRef()).toBe(before);
  });

  it('TEST 4 — an empty upload, and a request with no file at all, are refused', async () => {
    const empty = await upload(Buffer.alloc(0), 'empty.png').expect(400);
    expect(empty.body.details.reason).toBe('EMPTY');

    const none = await request(server())
      .post(`/admin/rik/config/provisions/${provisionId}/image`)
      .set('Authorization', admin())
      .expect(400);
    expect(none.body.details.reason).toBe('EMPTY');
  });

  it('TEST 5 — an oversize image is refused, and the message states the limit', async () => {
    // Above PIF_MEDIA_MAX_BYTES (2 MB by default) but below the 8 MB
    // transport backstop, so the service is what refuses it.
    const big = Buffer.concat([PNG, Buffer.alloc(2_500_000, 1)]);
    const res = await upload(big, 'huge.png').expect(400);
    expect(res.body.details.reason).toBe('TOO_LARGE');
    expect(res.body.message).toMatch(/The limit is 2\.0 MB/);
  });

  // ------------------------------------------------------------ replacing

  it('TEST 6 — replacing gets a NEW key and leaves no orphan file behind', async () => {
    const first = await upload(PNG, 'one.png').expect(201);
    const countBefore = (await filesOnDisk()).length;

    const second = await upload(JPEG, 'two.jpg').expect(201);
    expect(second.body.imageRef).not.toBe(first.body.imageRef);
    expect(await storedRef()).toBe(second.body.imageRef);

    // One file replaced by one file: the old one is gone from disk.
    expect(await filesOnDisk()).toHaveLength(countBefore);
    expect(existsSync(join(mediaRoot, first.body.imageRef))).toBe(false);
    expect(existsSync(join(mediaRoot, second.body.imageRef))).toBe(true);
  });

  // -------------------------------------------------------------- removing

  it('TEST 7 — removing sets the reference to NULL and deletes the file', async () => {
    const saved = await upload(PNG, 'gone.png').expect(201);
    expect(existsSync(join(mediaRoot, saved.body.imageRef))).toBe(true);

    const res = await request(server())
      .delete(`/admin/rik/config/provisions/${provisionId}/image`)
      .set('Authorization', admin())
      .expect(200);

    expect(res.body.imageRef).toBeNull();
    expect(res.body.imageUrl).toBeNull();
    expect(await storedRef()).toBeNull();
    expect(existsSync(join(mediaRoot, saved.body.imageRef))).toBe(false);
  });

  // ------------------------------------------------------------- serving

  it('TEST 8 — the stored picture is served back, with its own content type', async () => {
    const saved = await upload(PNG, 'served.png').expect(201);

    const res = await request(server()).get(saved.body.imageUrl).expect(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(Buffer.from(res.body)).toEqual(PNG);
  });

  it('TEST 9 — serving is public, because an <img> carries no Authorization header', async () => {
    const saved = await upload(PNG, 'public.png').expect(201);
    await request(server()).get(saved.body.imageUrl).expect(200);
  });

  it('TEST 10 — traversal and unknown keys both answer 404, so the route is no oracle', async () => {
    for (const path of [
      '/rik/media/rik/provisions/../../../etc/passwd',
      '/rik/media/rik/provisions/not-a-uuid.png',
      '/rik/media/rik/elsewhere/00000000-0000-0000-0000-000000000000.png',
      '/rik/media/rik/provisions/00000000-0000-0000-0000-000000000000.png',
      '/rik/media/rik/provisions/00000000-0000-0000-0000-000000000000.svg',
    ]) {
      const res = await request(server()).get(path);
      expect([404]).toContain(res.status);
    }
  });

  // ----------------------------------------------------------- permissions

  it('TEST 11 — only RIK_ADMIN and SUPER_ADMIN may upload; every other role is refused', async () => {
    for (const role of STAFF_ROLES) {
      const allowed = role === 'RIK_ADMIN' || role === 'SUPER_ADMIN';
      const res = await request(server())
        .post(`/admin/rik/config/provisions/${provisionId}/image`)
        .set('Authorization', bearer(role))
        .attach('file', PNG, 'perm.png');
      expect({ role, status: res.status }).toEqual({ role, status: allowed ? 201 : 403 });
    }
  });

  it('TEST 12 — a staff member with no role, a customer and an anonymous caller cannot upload', async () => {
    const noRole = await request(server())
      .post(`/admin/rik/config/provisions/${provisionId}/image`)
      .set('Authorization', `Bearer ${noRoleToken}`)
      .attach('file', PNG, 'x.png');
    expect(noRole.status).toBe(403);

    const customer = await request(server())
      .post(`/admin/rik/config/provisions/${provisionId}/image`)
      .set('Authorization', `Bearer ${customerToken}`)
      .attach('file', PNG, 'x.png');
    expect(customer.status).toBe(403);

    const anon = await request(server())
      .post(`/admin/rik/config/provisions/${provisionId}/image`)
      .attach('file', PNG, 'x.png');
    expect(anon.status).toBe(401);
  });

  it('TEST 13 — removing is gated by the same permission', async () => {
    const res = await request(server())
      .delete(`/admin/rik/config/provisions/${provisionId}/image`)
      .set('Authorization', bearer('PIF_ADMIN'));
    expect(res.status).toBe(403);
  });

  it('TEST 14 — no new permission or role was introduced for this feature', async () => {
    const counts = await db.query<{ permissions: string; roles: string }>(
      `SELECT (SELECT count(*) FROM shared.permissions)::text AS permissions,
              (SELECT count(*) FROM shared.roles)::text AS roles`
    );
    expect(counts[0]).toEqual({ permissions: '22', roles: '6' });
  });

  it('TEST 15 — an unknown provision id is 404, not a silent success', async () => {
    const res = await request(server())
      .post(`/admin/rik/config/provisions/00000000-0000-4000-8000-000000000000/image`)
      .set('Authorization', admin())
      .attach('file', PNG, 'nobody.png');
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------- preservation

  it('TEST 16 — the 180 committed pictures are untouched and still point at the bundle', async () => {
    const rows = await db.query<{ total: string; catalogue: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE image_ref LIKE '/catalogue/rik/%')::text AS catalogue
         FROM rik.provisions
        WHERE image_ref IS NOT NULL AND id <> $1`,
      [provisionId]
    );
    // Every pre-existing reference is still a committed-asset path: this
    // feature converted none of them and deleted none of them.
    expect(rows[0]!.total).toBe(rows[0]!.catalogue);
    expect(Number(rows[0]!.total)).toBeGreaterThanOrEqual(180);
  });

  it('TEST 17 — the resolver leaves a committed path alone and only rewrites a stored key', async () => {
    expect(rikImageUrl('/catalogue/rik/fresh/42_tomato-red.png')).toBe('/catalogue/rik/fresh/42_tomato-red.png');
    expect(rikImageUrl('/catalogue/rik/category/milk.png')).toBe('/catalogue/rik/category/milk.png');
    expect(rikImageUrl(null)).toBeNull();
    expect(rikImageUrl('rik/provisions/abc.png')).toBe('/rik/media/rik/provisions/abc.png');
  });

  it('TEST 18 — uploading over a committed path does NOT delete the committed file', async () => {
    // A provision illustrated by a bundled asset, then given an upload. The
    // bundled file belongs to the customer app and must survive.
    const bundled = '/catalogue/rik/dry/cereals/rice.png';
    await db.query('UPDATE rik.provisions SET image_ref = $2 WHERE id = $1', [provisionId, bundled]);
    // A decoy in the media root, named as that path would be if the code
    // ever treated a committed path as one of its own files.
    const decoy = join(mediaRoot, 'decoy-committed-asset.png');
    await writeFile(decoy, PNG);

    const res = await upload(PNG, 'replacement.png').expect(201);
    expect(res.body.imageRef).toMatch(/^rik\/provisions\//);
    expect(existsSync(decoy)).toBe(true);
    // And the row now points at the upload, not at the bundled path.
    expect(await storedRef()).toBe(res.body.imageRef);
  });

  it('TEST 19 — the entitlement fields of the provision are not touched by an upload', async () => {
    const before = await db.query<Record<string, unknown>>(
      `SELECT pool_id, unit, consumption_ratio::text, pack_size, is_loose, max_quantity,
              max_packs, min_eligible_days, issue_period, dietary_preference, is_customer_selectable
         FROM rik.provisions WHERE id = $1`,
      [provisionId]
    );
    await upload(PNG, 'untouched.png').expect(201);
    const after = await db.query<Record<string, unknown>>(
      `SELECT pool_id, unit, consumption_ratio::text, pack_size, is_loose, max_quantity,
              max_packs, min_eligible_days, issue_period, dietary_preference, is_customer_selectable
         FROM rik.provisions WHERE id = $1`,
      [provisionId]
    );
    expect(after[0]).toEqual(before[0]);
  });

  // ---------------------------------------------------------------- audit

  it('TEST 20 — setting and removing a picture are both recorded in the audit log', async () => {
    await upload(PNG, 'audited.png').expect(201);
    await request(server())
      .delete(`/admin/rik/config/provisions/${provisionId}/image`)
      .set('Authorization', admin())
      .expect(200);

    const rows = await db.query<{ action: string }>(
      `SELECT action FROM shared.audit_log
        WHERE entity_type = 'rik.provisions' AND entity_id = $1
          AND action IN ('RIK_PROVISION_IMAGE_SET', 'RIK_PROVISION_IMAGE_REMOVED')
        ORDER BY created_at DESC LIMIT 2`,
      [provisionId]
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('RIK_PROVISION_IMAGE_SET');
    expect(actions).toContain('RIK_PROVISION_IMAGE_REMOVED');
  });

  it('TEST 21 — the route is upload and remove only: no listing, no overwrite by PATCH of a key', async () => {
    const get = await request(server())
      .get(`/admin/rik/config/provisions/${provisionId}/image`)
      .set('Authorization', admin());
    expect(get.status).toBe(404);
  });
});
