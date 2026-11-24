import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { TokenService } from '../auth/services/token.service';

/**
 * GET /announcements — the customer-facing board, over real HTTP against
 * real PostgreSQL (closes backlog NOT-1/NOT-2).
 *
 * WHY THIS SUITE IS AN INTEGRATION ONE. Most of what has to be true here
 * is true because of `shared.v_active_announcements`, not because of
 * TypeScript: a draft, a withdrawn notice, one whose run has not started
 * and one whose run has ended must all be invisible, and that is the
 * view's WHERE clause. A unit test with a fake repository could be made
 * to "pass" those cases while the real query returned drafts, which is
 * the one failure that would matter. So they are asserted against the
 * real view.
 *
 * EVERY ROW THIS SUITE CREATES IS ITS OWN, tagged with a per-run id, and
 * removed in afterAll. It seeds nothing, resets nothing and runs no
 * migration; it asserts only on rows it inserted, so a database with
 * other announcements in it does not change the result.
 */
describe('GET /announcements (customer-facing, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;

  const runId = randomUUID().slice(0, 8);
  const tag = (name: string) => `JEST-ANN-${runId} ${name}`;
  const createdIds: string[] = [];
  let customerToken: string;
  let customerId: string;

  /** Inserts one announcement directly, so each visibility rule can be posed exactly. */
  async function seed(opts: {
    name: string;
    audience: 'ALL' | 'RIK' | 'PIF';
    published?: boolean;
    startDate?: string;
    endDate?: string | null;
    priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    softDeleted?: boolean;
  }): Promise<string> {
    const rows = await db.query<{ id: string }>(
      `INSERT INTO shared.announcements
         (id, title, body, announcement_type, target_audience, priority,
          start_date, end_date, is_published, published_at, deleted_at)
       VALUES (shared.uuid_generate_v7(), $1, $2, 'GENERAL', $3, $4,
               $5::date, $6::date, $7, CASE WHEN $7 THEN now() ELSE NULL END,
               CASE WHEN $8 THEN now() ELSE NULL END)
       RETURNING id`,
      [
        tag(opts.name),
        `Body of ${opts.name}`,
        opts.audience,
        opts.priority ?? 'NORMAL',
        // A real date, never the literal 'CURRENT_DATE': that would be
        // passed as text and fail to cast. Every caller supplies one.
        opts.startDate ?? new Date().toISOString().slice(0, 10),
        opts.endDate ?? null,
        opts.published ?? true,
        opts.softDeleted ?? false,
      ]
    );
    const id = rows[0]!.id;
    createdIds.push(id);
    return id;
  }

  /** Only this run's announcements, so other data in the database is irrelevant. */
  const mine = (body: Array<{ title: string }>) =>
    body.filter((a) => a.title.startsWith(`JEST-ANN-${runId}`)).map((a) => a.title);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    tokenService = app.get(TokenService);

    const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '7').slice(0, 7);
    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active)
       VALUES (shared.uuid_generate_v7(), $1, $2, true) RETURNING id`,
      [`+91772${digits}`, `Jest ANN Customer ${runId}`]
    );
    customerId = customer[0]!.id;
    customerToken = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerId });

    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const lastWeek = new Date(today); lastWeek.setDate(today.getDate() - 7);

    await seed({ name: 'live-all', audience: 'ALL', startDate: iso(yesterday) });
    await seed({ name: 'live-rik', audience: 'RIK', startDate: iso(yesterday) });
    await seed({ name: 'live-pif', audience: 'PIF', startDate: iso(yesterday) });
    await seed({ name: 'urgent-all', audience: 'ALL', priority: 'URGENT', startDate: iso(yesterday) });
    await seed({ name: 'open-ended', audience: 'ALL', startDate: iso(lastWeek), endDate: null });
    await seed({ name: 'draft-all', audience: 'ALL', published: false, startDate: iso(yesterday) });
    await seed({ name: 'expired-all', audience: 'ALL', startDate: iso(lastWeek), endDate: iso(yesterday) });
    await seed({ name: 'future-all', audience: 'ALL', startDate: iso(tomorrow) });
    await seed({ name: 'deleted-all', audience: 'ALL', softDeleted: true, startDate: iso(yesterday) });
  });

  afterAll(async () => {
    // The app holds no DELETE grant on announcements by design; the test
    // owns these rows and removes them as the owner role.
    if (createdIds.length > 0) {
      await db.query('DELETE FROM shared.announcements WHERE id = ANY($1::uuid[])', [createdIds]);
    }
    if (customerId) {
      await db.query('DELETE FROM shared.customers WHERE id = $1', [customerId]);
    }
    await app.close();
  });

  const get = (query = '') =>
    request(app.getHttpServer()).get(`/announcements${query}`).set('Authorization', `Bearer ${customerToken}`);

  it('TEST 1 — audience=RIK returns RIK and ALL, never PIF', async () => {
    const res = await get('?audience=RIK').expect(200);
    const titles = mine(res.body);
    expect(titles).toEqual(expect.arrayContaining([tag('live-rik'), tag('live-all')]));
    expect(titles).not.toContain(tag('live-pif'));
  });

  it('TEST 2 — audience=PIF returns PIF and ALL, never RIK', async () => {
    const res = await get('?audience=PIF').expect(200);
    const titles = mine(res.body);
    expect(titles).toEqual(expect.arrayContaining([tag('live-pif'), tag('live-all')]));
    expect(titles).not.toContain(tag('live-rik'));
  });

  it('TEST 3 — no filter returns all three audiences', async () => {
    const titles = mine((await get().expect(200)).body);
    expect(titles).toEqual(
      expect.arrayContaining([tag('live-all'), tag('live-rik'), tag('live-pif')])
    );
  });

  it('TEST 4 — an UNPUBLISHED announcement never appears, under any filter', async () => {
    for (const q of ['', '?audience=RIK', '?audience=PIF']) {
      expect(mine((await get(q).expect(200)).body)).not.toContain(tag('draft-all'));
    }
  });

  it('TEST 5 — an EXPIRED announcement never appears', async () => {
    expect(mine((await get().expect(200)).body)).not.toContain(tag('expired-all'));
  });

  it('TEST 6 — an invalid audience is rejected with 400, not silently ignored', async () => {
    // Silently ignoring it would widen the result set, showing a PIF
    // reader the RIK notices — the exact failure this guards.
    for (const bad of ['STAFF', 'rik', 'ALL', '', 'RIK,PIF']) {
      await get(`?audience=${encodeURIComponent(bad)}`).expect(400);
    }
  });

  it('TEST 7 — a FUTURE-DATED announcement never appears', async () => {
    expect(mine((await get().expect(200)).body)).not.toContain(tag('future-all'));
  });

  it('TEST 8 — a SOFT-DELETED announcement never appears', async () => {
    expect(mine((await get().expect(200)).body)).not.toContain(tag('deleted-all'));
  });

  it('TEST 9 — URGENT sorts ahead of NORMAL', async () => {
    const titles = mine((await get().expect(200)).body);
    expect(titles.indexOf(tag('urgent-all'))).toBeLessThan(titles.indexOf(tag('live-all')));
  });

  it('TEST 10 — an open-ended announcement (no end date) does appear', async () => {
    expect(mine((await get().expect(200)).body)).toContain(tag('open-ended'));
  });

  it('TEST 11 — an unauthenticated request is refused', async () => {
    await request(app.getHttpServer()).get('/announcements').expect(401);
  });

  it('TEST 12 — the response shape is exactly what the customer app expects', async () => {
    const res = await get().expect(200);
    const one = res.body.find((a: { title: string }) => a.title === tag('live-all'));
    expect(one).toBeDefined();
    expect(Object.keys(one).sort()).toEqual(
      ['audience', 'dismissible', 'id', 'message', 'priority', 'publishedAt', 'title'].sort()
    );
    expect(one.message).toBe('Body of live-all');
    expect(one.audience).toBe('ALL');
    expect(one.dismissible).toBe(true);
    expect(Number.isNaN(Date.parse(one.publishedAt))).toBe(false);
  });

  it('TEST 13 — the route is read-only: writing is not offered here', async () => {
    // Each request is built AND awaited inside the loop. Building all
    // three first starts three ephemeral listeners, and the later ones
    // are already closed by the time they are awaited (ECONNREFUSED).
    const server = app.getHttpServer();
    const post = await request(server).post('/announcements').set('Authorization', `Bearer ${customerToken}`);
    expect(post.status).toBe(404);
    const patch = await request(server).patch('/announcements/x').set('Authorization', `Bearer ${customerToken}`);
    expect(patch.status).toBe(404);
    const del = await request(server).delete('/announcements/x').set('Authorization', `Bearer ${customerToken}`);
    expect(del.status).toBe(404);
  });
});
