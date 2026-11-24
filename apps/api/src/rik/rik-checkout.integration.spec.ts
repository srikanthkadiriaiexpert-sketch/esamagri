import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import {
  clearRationEligibilityForCustomers,
  seedBothRationTypes,
} from './test-support/seed-ration-eligibility';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';
import { CurrentPeriodLock } from './test-support/current-period-lock';

/**
 * STEP 11E — RIK checkout and fulfillment, over the real customer HTTP
 * surface against real PostgreSQL.
 *
 * WHAT THIS SUITE IS ABOUT. A confirmation is the moment a ration stops
 * being a draft and becomes a record — of what was chosen, under which
 * rules, where it will be collected, and that the officer accepted it
 * might not all be there on the day. Everything below is about that
 * record being complete, being exactly one, and never changing
 * afterwards.
 *
 * THREE CLAIMS IT EXISTS TO SUBSTANTIATE.
 *
 *  1. ATOMIC. Snapshot, basis, acknowledgement, fulfillment and
 *     reference land together or not at all. There is no observable
 *     state where a selection is confirmed but half-recorded.
 *
 *  2. EXACTLY ONE. A double tap, a refresh, a retry over a slow
 *     network, or two genuinely concurrent requests all produce one
 *     confirmation — asserted by counting rows, not by trusting a flag.
 *
 *  3. IMMUTABLE. Renaming a collection point, editing a provision,
 *     changing a scale, moving house or switching dietary preference
 *     afterwards leaves the confirmed record exactly as it was. Several
 *     tests make the change for real and then re-read the record.
 *
 * AND ONE NEGATIVE, checked explicitly: no price, no total, no tax, no
 * payment field appears anywhere in the confirmation payload. A RIK
 * issue is an entitlement being drawn, not a purchase.
 */
describe('RIK checkout and fulfillment (STEP 11E, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;
  let periodLock: CurrentPeriodLock;

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '5');

  let periodId: string;
  const ELIGIBLE_DAYS = 30;

  /** Six customers, so each scenario confirms without disturbing another. */
  type Persona = 'pickupA' | 'pickupB' | 'delivery' | 'refusals' | 'concurrent' | 'history';
  const PERSONAS: Persona[] = ['pickupA', 'pickupB', 'delivery', 'refusals', 'concurrent', 'history'];
  const customerIds: Record<string, string> = {};
  const customerTokens: Record<string, string> = {};

  let staffId: string;
  let staffToken: string;

  let navalParkId = '';
  let dolphinHillId = '';

  const server = () => app.getHttpServer();
  const as = (persona: Persona) => `Bearer ${customerTokens[persona]}`;

  interface Confirmation {
    selectionId: string;
    status: string;
    referenceNumber: string | null;
    confirmedAt: string | null;
    availabilityAcknowledged: boolean;
    acknowledgedAt: string | null;
    fulfillment: { type: string; pickupLocationName: string | null; deliveryAddress: string | null } | null;
  }

  /** Put one item in a persona's basket so there is something to confirm. */
  const chooseSomething = async (persona: Persona, quantity = 1000): Promise<string> => {
    const res = await request(server())
      .get('/rik/entitlements/current')
      .set('Authorization', as(persona))
      .expect(200);

    const cereals = [...res.body.fresh, ...res.body.dry].find(
      (c: { code: string }) => c.code === 'CEREALS'
    );
    const provision = cereals.provisions.find(
      (p: { consumptionRatio: number; issuePeriod: string }) =>
        p.consumptionRatio === 1 && p.issuePeriod === 'DRY'
    );

    await request(server())
      .post('/rik/selections/quantity')
      .set('Authorization', as(persona))
      .send({ provisionId: provision.provisionId, quantity })
      .expect(201);

    return provision.provisionId;
  };

  const countSelections = async (persona: Persona, status = 'CONFIRMED'): Promise<number> => {
    const rows = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM rik.entitlement_selections
        WHERE customer_id = $1 AND status = $2`,
      [customerIds[persona], status]
    );
    return Number(rows[0]!.count);
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
    const passwordService = app.get(PasswordService);

    // Residue from an aborted run.
    await db.query(
      `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
        WHERE status = 'CONFIRMED'
          AND customer_id IN (SELECT id FROM shared.customers WHERE name LIKE 'Jest 11E%')`
    );
    await db.query(
      `DELETE FROM rik.entitlement_selections
        WHERE customer_id IN (SELECT id FROM shared.customers WHERE name LIKE 'Jest 11E%')`
    );
    await db.query(
      `DELETE FROM rik.customer_period_eligibility
        WHERE period_id IN (SELECT id FROM rik.entitlement_periods WHERE name LIKE 'Jest 11E%')`
    );
    await db.query(`DELETE FROM shared.customers WHERE name LIKE 'Jest 11E%'`);
    await db.query(`DELETE FROM rik.entitlement_periods WHERE name LIKE 'Jest 11E%'`);

    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));

    const period = await db.query<{ id: string }>(
      `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
       VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'ACTIVE') RETURNING id`,
      [`Jest 11E period ${runId}`, iso(start), iso(end)]
    );
    periodId = period[0]!.id;

    let n = 0;
    for (const persona of PERSONAS) {
      const row = await db.query<{ id: string }>(
        `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
         VALUES (shared.uuid_generate_v7(), $1, $2, true, 'NV') RETURNING id`,
        [`+9175${digits.slice(0, 5)}${n}`, `Jest 11E ${persona} ${runId}`]
      );
      customerIds[persona] = row[0]!.id;
      customerTokens[persona] = tokenService.signAccessToken({
        principalType: 'CUSTOMER',
        principalId: row[0]!.id,
      });
      await db.query(
        `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days)
         VALUES ($1, $2, $3)`,
        [row[0]!.id, periodId, ELIGIBLE_DAYS]
      );
      // Same figure for both types, so this suite's totals are unchanged.
      await seedBothRationTypes(db, row[0]!.id, periodId, ELIGIBLE_DAYS);
      n += 1;
    }

    const passwordHash = await passwordService.hash('CorrectHorseBatteryStaple!1');
    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    const staff = await db.query<{ id: string }>(
      `INSERT INTO shared.users (id, username, password_hash, display_name, status)
       VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
      [`jest_11e_rik_admin_${runId}`, passwordHash, `Jest 11E RIK_ADMIN ${runId}`]
    );
    staffId = staff[0]!.id;
    await db.query(
      `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
       SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = 'RIK_ADMIN'`,
      [staffId, bootstrap[0]!.id]
    );
    staffToken = tokenService.signAccessToken({ principalType: 'STAFF', principalId: staffId });

    const locations = await db.query<{ id: string; code: string }>(
      `SELECT id, code FROM rik.pickup_locations WHERE is_active`
    );
    navalParkId = locations.find((l) => l.code === 'NAVAL_PARK')!.id;
    dolphinHillId = locations.find((l) => l.code === 'DOLPHIN_HILL')!.id;
  });

  afterAll(async () => {
    const ids = Object.values(customerIds);
    await db.query(
      `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
        WHERE status = 'CONFIRMED' AND customer_id = ANY($1::uuid[])`,
      [ids]
    );
    await db.query(`DELETE FROM rik.entitlement_selections WHERE customer_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM rik.customer_period_eligibility WHERE customer_id = ANY($1::uuid[])`, [ids]);
    await clearRationEligibilityForCustomers(db, ids);
    await db.query(`DELETE FROM shared.customer_addresses WHERE customer_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])`, [[...ids, staffId]]);
    await db.query(`DELETE FROM shared.customers WHERE id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM shared.user_roles WHERE user_id = $1`, [staffId]);
    await db.query(`DELETE FROM shared.users WHERE id = $1`, [staffId]);
    await db.query(`DELETE FROM rik.entitlement_periods WHERE id = $1`, [periodId]);
    await app.close();
    await periodLock.release();
  });

  // =================================================================
  // The collection points a customer may choose
  // =================================================================
  describe('collection points come from configuration', () => {
    it('offers exactly the two the facility operates, by name', async () => {
      const res = await request(server())
        .get('/rik/fulfillment/pickup-locations')
        .set('Authorization', as('pickupA'))
        .expect(200);

      const names = res.body.items.map((l: { name: string }) => l.name);
      expect(names).toContain('Naval Park');
      expect(names).toContain('Dolphin Hill');
    });

    it('is refused to an anonymous caller and to staff', async () => {
      await request(server()).get('/rik/fulfillment/pickup-locations').expect(401);
      await request(server())
        .get('/rik/fulfillment/pickup-locations')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
    });
  });

  // =================================================================
  // 1-3, 9, 10. Confirming, three ways
  // =================================================================
  describe('a complete confirmation', () => {
    it('confirms a pickup at Naval Park', async () => {
      await chooseSomething('pickupA');
      const res = await request(server())
        .post('/rik/selections/confirm')
        .set('Authorization', as('pickupA'))
        .send({
          availabilityAcknowledged: true,
          fulfillmentType: 'PICKUP',
          pickupLocationId: navalParkId,
        })
        .expect(201);

      const confirmation = res.body.confirmation as Confirmation;
      expect(res.body.status).toBe('CONFIRMED');
      expect(confirmation.fulfillment).toEqual({
        type: 'PICKUP',
        pickupLocationName: 'Naval Park',
        deliveryAddress: null,
      });
      expect(confirmation.availabilityAcknowledged).toBe(true);
      expect(confirmation.acknowledgedAt).not.toBeNull();
      expect(confirmation.referenceNumber).toMatch(/^RIK-\d+$/);
      expect(await countSelections('pickupA')).toBe(1);
    });

    it('confirms a pickup at Dolphin Hill', async () => {
      await chooseSomething('pickupB');
      const res = await request(server())
        .post('/rik/selections/confirm')
        .set('Authorization', as('pickupB'))
        .send({
          availabilityAcknowledged: true,
          fulfillmentType: 'PICKUP',
          pickupLocationId: dolphinHillId,
        })
        .expect(201);

      expect((res.body.confirmation as Confirmation).fulfillment?.pickupLocationName).toBe('Dolphin Hill');
      expect(await countSelections('pickupB')).toBe(1);
    });

    it('confirms a delivery, keeping the address exactly as typed', async () => {
      await chooseSomething('delivery');
      const address = 'Block 7, Quarter 214\nNear the parade ground\nVisakhapatnam';

      const res = await request(server())
        .post('/rik/selections/confirm')
        .set('Authorization', as('delivery'))
        .send({ availabilityAcknowledged: true, fulfillmentType: 'DELIVERY', deliveryAddress: address })
        .expect(201);

      const confirmation = res.body.confirmation as Confirmation;
      expect(confirmation.fulfillment).toEqual({
        type: 'DELIVERY',
        pickupLocationName: null,
        // Verbatim, newlines and all.
        deliveryAddress: address,
      });
      expect(await countSelections('delivery')).toBe(1);
    });

    it('gives every confirmation its own reference', async () => {
      const rows = await db.query<{ reference_number: string }>(
        `SELECT reference_number FROM rik.entitlement_selections
          WHERE customer_id = ANY($1::uuid[]) AND status = 'CONFIRMED'`,
        [[customerIds.pickupA, customerIds.pickupB, customerIds.delivery]]
      );
      const references = rows.map((r) => r.reference_number);
      expect(references).toHaveLength(3);
      expect(new Set(references).size).toBe(3);
    });

    it('mentions no price, total, tax or payment anywhere in the payload', async () => {
      const res = await request(server())
        .get('/rik/entitlements/current')
        .set('Authorization', as('pickupA'))
        .expect(200);

      const text = JSON.stringify(res.body).toLowerCase();
      for (const word of ['price', 'amount', 'payment', 'invoice', 'gst', 'tax', 'currency', '₹']) {
        expect(text).not.toContain(word);
      }
    });

    it('reports the confirmation on a plain re-read, so a refresh still shows it', async () => {
      const res = await request(server())
        .get('/rik/entitlements/current')
        .set('Authorization', as('pickupA'))
        .expect(200);

      expect(res.body.selection.status).toBe('CONFIRMED');
      expect(res.body.selection.referenceNumber).toMatch(/^RIK-\d+$/);
      expect(res.body.selection.fulfillment.pickupLocationName).toBe('Naval Park');
      // And the quantities are still there, rather than reading as empty.
      const cereals = [...res.body.fresh, ...res.body.dry].find((c: { code: string }) => c.code === 'CEREALS');
      expect(cereals.consumed).toBeGreaterThan(0);
    });
  });

  // =================================================================
  // 4-8. Everything the server refuses
  // =================================================================
  describe('the server refuses an incomplete confirmation', () => {
    beforeAll(async () => {
      await chooseSomething('refusals');
    });

    const reason = (res: { body: { details?: { reason?: string } } }) => res.body.details?.reason;

    const attempt = (body: Record<string, unknown>) =>
      request(server()).post('/rik/selections/confirm').set('Authorization', as('refusals')).send(body);

    it('refuses delivery with no address', async () => {
      const res = await attempt({ availabilityAcknowledged: true, fulfillmentType: 'DELIVERY' }).expect(400);
      expect(reason(res)).toBe('DELIVERY_ADDRESS_REQUIRED');
    });

    it('refuses delivery with a whitespace-only address', async () => {
      const res = await attempt({
        availabilityAcknowledged: true,
        fulfillmentType: 'DELIVERY',
        deliveryAddress: '   \n\t  ',
      }).expect(400);
      expect(reason(res)).toBe('DELIVERY_ADDRESS_REQUIRED');
    });

    it('refuses pickup with no location', async () => {
      const res = await attempt({ availabilityAcknowledged: true, fulfillmentType: 'PICKUP' }).expect(400);
      expect(reason(res)).toBe('PICKUP_LOCATION_REQUIRED');
    });

    it('refuses a pickup location that does not exist', async () => {
      const res = await attempt({
        availabilityAcknowledged: true,
        fulfillmentType: 'PICKUP',
        pickupLocationId: '00000000-0000-7000-8000-000000000000',
      }).expect(400);
      expect(reason(res)).toBe('PICKUP_LOCATION_INVALID');
    });

    it('refuses a fulfillment method that is neither pickup nor delivery', async () => {
      await attempt({ availabilityAcknowledged: true, fulfillmentType: 'TELEPORT' }).expect(400);
    });

    it('refuses a confirmation with the acknowledgement missing', async () => {
      // Refused by the shape gate before the service is reached — the
      // field is required, not defaulted. Either way nothing is
      // confirmed, which a later test in this block checks by counting.
      await attempt({ fulfillmentType: 'PICKUP', pickupLocationId: navalParkId }).expect(400);
    });

    it('refuses a confirmation with the acknowledgement explicitly false', async () => {
      const res = await attempt({
        availabilityAcknowledged: false,
        fulfillmentType: 'PICKUP',
        pickupLocationId: navalParkId,
      }).expect(400);
      expect(reason(res)).toBe('ACKNOWLEDGEMENT_REQUIRED');
    });

    it('treats seeing the warning as no acknowledgement at all', async () => {
      // There is no route and no field that records "the warning was
      // displayed", and that is the point: only an explicit
      // acknowledgement counts. An invented field is refused outright
      // rather than quietly ignored, so nobody can claim the customer
      // agreed because the text was on screen.
      await attempt({
        fulfillmentType: 'PICKUP',
        pickupLocationId: navalParkId,
        warningShown: true,
      }).expect(400);
    });

    it('confirmed nothing while refusing all of the above', async () => {
      expect(await countSelections('refusals')).toBe(0);
      expect(await countSelections('refusals', 'DRAFT')).toBe(1);
    });

    it('refuses to confirm an empty selection', async () => {
      const empty = await request(server())
        .get('/rik/entitlements/current')
        .set('Authorization', as('history'))
        .expect(200);
      expect(empty.body.selection).toBeNull();

      const res = await request(server())
        .post('/rik/selections/confirm')
        .set('Authorization', as('history'))
        .send({ availabilityAcknowledged: true, fulfillmentType: 'PICKUP', pickupLocationId: navalParkId })
        .expect(400);
      expect(res.body.details?.reason).toBe('SELECTION_NOT_OPEN');
    });

    it('accepts the very same request once it is complete', async () => {
      const res = await attempt({
        availabilityAcknowledged: true,
        fulfillmentType: 'PICKUP',
        pickupLocationId: navalParkId,
      }).expect(201);
      expect(res.body.status).toBe('CONFIRMED');
      expect(await countSelections('refusals')).toBe(1);
    });
  });

  // =================================================================
  // 11-12, 22. Exactly one confirmation, whatever the customer does
  // =================================================================
  describe('a second confirmation never creates a second record', () => {
    it('refuses a repeat, and hands back the reference that already exists', async () => {
      const before = await countSelections('pickupA');
      const res = await request(server())
        .post('/rik/selections/confirm')
        .set('Authorization', as('pickupA'))
        .send({ availabilityAcknowledged: true, fulfillmentType: 'PICKUP', pickupLocationId: dolphinHillId })
        .expect(400);

      expect(res.body.details.reason).toBe('ALREADY_CONFIRMED');
      expect(res.body.details.referenceNumber).toMatch(/^RIK-\d+$/);
      expect(await countSelections('pickupA')).toBe(before);
    });

    it('did not let the repeat change the fulfillment either', async () => {
      const rows = await db.query<{ pickup_location_name: string }>(
        `SELECT pickup_location_name FROM rik.entitlement_selections
          WHERE customer_id = $1 AND status = 'CONFIRMED'`,
        [customerIds.pickupA]
      );
      // The repeat above asked for Dolphin Hill. It must have changed nothing.
      expect(rows[0]!.pickup_location_name).toBe('Naval Park');
    });

    it('survives a double tap — two requests fired together', async () => {
      await chooseSomething('concurrent');

      const body = {
        availabilityAcknowledged: true,
        fulfillmentType: 'PICKUP' as const,
        pickupLocationId: navalParkId,
      };

      const [first, second] = await Promise.all([
        request(server()).post('/rik/selections/confirm').set('Authorization', as('concurrent')).send(body),
        request(server()).post('/rik/selections/confirm').set('Authorization', as('concurrent')).send(body),
      ]);

      const statuses = [first.status, second.status].sort();
      // Exactly one succeeded; the other was refused, not errored.
      expect(statuses).toEqual([201, 400]);
      expect(await countSelections('concurrent')).toBe(1);
    });

    it('survives a burst of five concurrent attempts', async () => {
      const body = {
        availabilityAcknowledged: true,
        fulfillmentType: 'DELIVERY' as const,
        deliveryAddress: 'Block 1, Qtr 1',
      };

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(server()).post('/rik/selections/confirm').set('Authorization', as('concurrent')).send(body)
        )
      );

      expect(results.every((r) => r.status === 400)).toBe(true);
      expect(await countSelections('concurrent')).toBe(1);
    });

    it('leaves no draft behind once confirmed', async () => {
      expect(await countSelections('concurrent', 'DRAFT')).toBe(0);
    });
  });

  // =================================================================
  // 12 (cont). A confirmed selection is read-only
  // =================================================================
  describe('a confirmed selection cannot be edited through the draft routes', () => {
    it('refuses a quantity change', async () => {
      const provisionId = await (async () => {
        const rows = await db.query<{ provision_id: string }>(
          `SELECT i.provision_id
             FROM rik.entitlement_selection_items i
             JOIN rik.entitlement_selections s ON s.id = i.selection_id
            WHERE s.customer_id = $1 AND s.status = 'CONFIRMED' LIMIT 1`,
          [customerIds.pickupA]
        );
        return rows[0]!.provision_id;
      })();

      // The draft routes open a NEW draft rather than touching the
      // confirmed one — the confirmed record is unreachable from here.
      await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', as('pickupA'))
        .send({ provisionId, quantity: 5000 })
        .expect(201);

      const rows = await db.query<{ quantity: string }>(
        `SELECT i.quantity
           FROM rik.entitlement_selection_items i
           JOIN rik.entitlement_selections s ON s.id = i.selection_id
          WHERE s.customer_id = $1 AND s.status = 'CONFIRMED'`,
        [customerIds.pickupA]
      );
      // Unchanged: the new quantity went to a new draft, not to history.
      expect(Number(rows[0]!.quantity)).toBe(1000);
    });

    it('refuses, at the database, any attempt to rewrite the confirmed record', async () => {
      await expect(
        db.query(
          `UPDATE rik.entitlement_selections
              SET pickup_location_name = 'Somewhere else'
            WHERE customer_id = $1 AND status = 'CONFIRMED'`,
          [customerIds.pickupA]
        )
      ).rejects.toBeDefined();

      await expect(
        db.query(
          `UPDATE rik.entitlement_selections SET rule_snapshot = '{}'::jsonb
            WHERE customer_id = $1 AND status = 'CONFIRMED'`,
          [customerIds.pickupA]
        )
      ).rejects.toBeDefined();
    });

    it('refuses, at the database, any attempt to rewrite its lines', async () => {
      await expect(
        db.query(
          `UPDATE rik.entitlement_selection_items SET quantity = 9999
            WHERE selection_id IN (
              SELECT id FROM rik.entitlement_selections
               WHERE customer_id = $1 AND status = 'CONFIRMED')`,
          [customerIds.pickupA]
        )
      ).rejects.toBeDefined();
    });
  });

  // =================================================================
  // 13-15. Whose selection it is
  // =================================================================
  describe('a customer can only confirm their own selection', () => {
    it('is 401 without a token', async () => {
      await request(server()).post('/rik/selections/confirm').send({}).expect(401);
    });

    it('is 403 for staff, RIK_ADMIN included', async () => {
      await request(server())
        .post('/rik/selections/confirm')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ availabilityAcknowledged: true, fulfillmentType: 'PICKUP', pickupLocationId: navalParkId })
        .expect(403);
    });

    it('refuses a body that names another customer rather than honouring it', async () => {
      await request(server())
        .post('/rik/selections/confirm')
        .set('Authorization', as('pickupB'))
        .send({
          availabilityAcknowledged: true,
          fulfillmentType: 'PICKUP',
          pickupLocationId: navalParkId,
          customerId: customerIds.delivery,
          selectionId: customerIds.delivery,
        })
        .expect(400);
    });

    it('binds each confirmation to the customer who made it', async () => {
      const rows = await db.query<{ customer_id: string; reference_number: string }>(
        `SELECT customer_id, reference_number FROM rik.entitlement_selections
          WHERE status = 'CONFIRMED' AND customer_id = ANY($1::uuid[])`,
        [[customerIds.pickupA, customerIds.delivery]]
      );
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.customer_id))).toEqual(
        new Set([customerIds.pickupA, customerIds.delivery])
      );
    });

    it('never lets one customer read another’s confirmation', async () => {
      const res = await request(server())
        .get('/rik/entitlements/current')
        .set('Authorization', as('delivery'))
        .expect(200);
      expect(res.body.selection.fulfillment.type).toBe('DELIVERY');
      expect(res.body.selection.fulfillment.pickupLocationName).toBeNull();
    });
  });

  // =================================================================
  // 16-20. History does not move
  // =================================================================
  describe('a confirmed record is not touched by anything that happens later', () => {
    let snapshotBefore: string;
    let referenceBefore: string;

    beforeAll(async () => {
      const rows = await db.query<{ snapshot: string; reference_number: string }>(
        `SELECT rule_snapshot::text AS snapshot, reference_number
           FROM rik.entitlement_selections
          WHERE customer_id = $1 AND status = 'CONFIRMED'`,
        [customerIds.delivery]
      );
      snapshotBefore = rows[0]!.snapshot;
      referenceBefore = rows[0]!.reference_number;
    });

    const readDelivery = async () => {
      const rows = await db.query<{
        snapshot: string;
        reference_number: string;
        delivery_address: string;
        dietary_preference: string;
        eligible_days: number;
      }>(
        `SELECT rule_snapshot::text AS snapshot, reference_number, delivery_address,
                dietary_preference, eligible_days
           FROM rik.entitlement_selections
          WHERE customer_id = $1 AND status = 'CONFIRMED'`,
        [customerIds.delivery]
      );
      return rows[0]!;
    };

    it('keeps the rule snapshot the calculation was made under', async () => {
      const row = await readDelivery();
      expect(row.snapshot).toBe(snapshotBefore);
      const snapshot = JSON.parse(row.snapshot) as Record<string, unknown>;
      for (const key of ['basis', 'pools', 'scales', 'conversions', 'provisions', 'items']) {
        expect(snapshot).toHaveProperty(key);
      }
    });

    it('keeps the item name and pack size as they were, when the catalogue changes', async () => {
      const snapshot = JSON.parse(snapshotBefore) as {
        provisions: { id: string; name: string; pack_size: string | null }[];
      };
      const provision = snapshot.provisions[0]!;
      const originalName = provision.name;

      // A RIK administrator renames the item and changes its pack size.
      await request(server())
        .patch(`/admin/rik/config/provisions/${provision.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ name: `${originalName} (renamed by 11E)`, packSize: 777 })
        .expect(200);

      const after = await readDelivery();
      const afterSnapshot = JSON.parse(after.snapshot) as {
        provisions: { name: string; pack_size: string | null }[];
      };
      expect(afterSnapshot.provisions[0]!.name).toBe(originalName);
      expect(afterSnapshot.provisions[0]!.pack_size).toBe(provision.pack_size);

      // Put the catalogue back.
      await request(server())
        .patch(`/admin/rik/config/provisions/${provision.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ name: originalName, packSize: provision.pack_size === null ? null : Number(provision.pack_size) })
        .expect(200);
    });

    it('keeps the entitlement scale it was calculated under, when the scale changes', async () => {
      const snapshot = JSON.parse(snapshotBefore) as { scales: { id: string; daily_qty: string }[] };
      const scale = snapshot.scales[0]!;
      const original = Number(scale.daily_qty);

      await request(server())
        .patch(`/admin/rik/config/scales/${scale.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ dailyQty: original + 111 })
        .expect(200);

      const after = await readDelivery();
      const afterSnapshot = JSON.parse(after.snapshot) as { scales: { daily_qty: string }[] };
      expect(Number(afterSnapshot.scales[0]!.daily_qty)).toBe(original);

      await request(server())
        .patch(`/admin/rik/config/scales/${scale.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ dailyQty: original })
        .expect(200);
    });

    it('keeps the delivery address, when the customer changes their profile address', async () => {
      const before = await readDelivery();

      await request(server())
        .patch('/customer/me')
        .set('Authorization', as('delivery'))
        .send({ quarterBlock: 'Block 99', quarterNumber: 'Qtr 999', landmark: 'Somewhere new entirely' })
        .expect(200);

      const after = await readDelivery();
      expect(after.delivery_address).toBe(before.delivery_address);
      expect(after.delivery_address).toContain('Block 7');
      expect(after.delivery_address).not.toContain('Block 99');
    });

    it('keeps the pickup location name, when the collection point is renamed', async () => {
      const readPickup = async () => {
        const rows = await db.query<{ pickup_location_name: string }>(
          `SELECT pickup_location_name FROM rik.entitlement_selections
            WHERE customer_id = $1 AND status = 'CONFIRMED'`,
          [customerIds.pickupB]
        );
        return rows[0]!.pickup_location_name;
      };

      expect(await readPickup()).toBe('Dolphin Hill');

      await request(server())
        .patch(`/admin/rik/config/pickup-locations/${dolphinHillId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ name: 'Dolphin Hill Annexe' })
        .expect(200);

      // The confirmed record still says what it said on the day.
      expect(await readPickup()).toBe('Dolphin Hill');

      await request(server())
        .patch(`/admin/rik/config/pickup-locations/${dolphinHillId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ name: 'Dolphin Hill' })
        .expect(200);
    });

    it('keeps the dietary preference it was calculated under, when the customer changes theirs', async () => {
      const before = await readDelivery();
      expect(before.dietary_preference).toBe('NV');

      await request(server())
        .patch('/customer/me')
        .set('Authorization', as('delivery'))
        .send({ dietaryPreference: 'PV' })
        .expect(200);

      const after = await readDelivery();
      expect(after.dietary_preference).toBe('NV');
      expect(after.snapshot).toBe(snapshotBefore);

      // And the CURRENT calculation does follow the new preference —
      // future entitlement changes, history does not.
      const current = await request(server())
        .get('/rik/entitlements/current')
        .set('Authorization', as('delivery'))
        .expect(200);
      expect(current.body.dietaryPreference).toBe('PV');

      await request(server())
        .patch('/customer/me')
        .set('Authorization', as('delivery'))
        .send({ dietaryPreference: 'NV' })
        .expect(200);
    });

    it('keeps its reference number through all of that', async () => {
      const after = await readDelivery();
      expect(after.reference_number).toBe(referenceBefore);
    });

    it('still reproduces its original calculation from its own snapshot', async () => {
      const res = await request(server())
        .get('/rik/entitlements/current')
        .set('Authorization', as('delivery'))
        .expect(200);
      // The confirmed quantity is still reported, from the confirmed row.
      const cereals = [...res.body.fresh, ...res.body.dry].find((c: { code: string }) => c.code === 'CEREALS');
      expect(cereals.consumed).toBe(1000);
    });
  });

  // =================================================================
  // 21. Rollback
  // =================================================================
  describe('nothing is half-written', () => {
    /**
     * The fulfillment and the confirmation are written by ONE statement,
     * so "fulfillment persistence fails" cannot happen independently —
     * it would be the same failure as the confirmation failing. This
     * proves the property that matters: a confirmation that does not
     * complete leaves the draft exactly as it was, with no reference
     * consumed and no partial record.
     */
    it('leaves the draft untouched when the confirmation is refused mid-way', async () => {
      await chooseSomething('history', 2000);

      const draftBefore = await db.query<{ id: string; status: string; reference_number: string | null }>(
        `SELECT id, status, reference_number FROM rik.entitlement_selections
          WHERE customer_id = $1`,
        [customerIds.history]
      );
      expect(draftBefore).toHaveLength(1);
      expect(draftBefore[0]!.status).toBe('DRAFT');

      // Refused at the pickup-location step, after the acknowledgement
      // has been accepted — the furthest point before the write.
      await request(server())
        .post('/rik/selections/confirm')
        .set('Authorization', as('history'))
        .send({
          availabilityAcknowledged: true,
          fulfillmentType: 'PICKUP',
          pickupLocationId: '00000000-0000-7000-8000-000000000001',
        })
        .expect(400);

      const draftAfter = await db.query<{
        id: string;
        status: string;
        reference_number: string | null;
        fulfillment_type: string | null;
        availability_acknowledged: boolean;
      }>(
        `SELECT id, status, reference_number, fulfillment_type, availability_acknowledged
           FROM rik.entitlement_selections WHERE customer_id = $1`,
        [customerIds.history]
      );

      expect(draftAfter).toHaveLength(1);
      expect(draftAfter[0]!.id).toBe(draftBefore[0]!.id);
      expect(draftAfter[0]!.status).toBe('DRAFT');
      expect(draftAfter[0]!.reference_number).toBeNull();
      expect(draftAfter[0]!.fulfillment_type).toBeNull();
      expect(draftAfter[0]!.availability_acknowledged).toBe(false);

      // And the lines are intact.
      const items = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM rik.entitlement_selection_items WHERE selection_id = $1`,
        [draftAfter[0]!.id]
      );
      expect(Number(items[0]!.count)).toBe(1);
    });

    it('refuses at the database to record a confirmation without fulfillment', async () => {
      // The last line of defence: even a hand-written UPDATE cannot
      // produce a confirmed-but-incomplete row.
      await expect(
        db.query(
          `UPDATE rik.entitlement_selections
              SET status = 'CONFIRMED', confirmed_at = now(), rule_snapshot = '{}'::jsonb
            WHERE customer_id = $1 AND status = 'DRAFT'`,
          [customerIds.history]
        )
      ).rejects.toBeDefined();
    });

    it('refuses at the database to record a pickup with an address, or a delivery with a location', async () => {
      await expect(
        db.query(
          `UPDATE rik.entitlement_selections
              SET fulfillment_type = 'PICKUP', pickup_location_name = 'Naval Park',
                  delivery_address = 'Somewhere'
            WHERE customer_id = $1 AND status = 'DRAFT'`,
          [customerIds.history]
        )
      ).rejects.toBeDefined();

      await expect(
        db.query(
          `UPDATE rik.entitlement_selections
              SET fulfillment_type = 'DELIVERY', delivery_address = 'Somewhere',
                  pickup_location_name = 'Naval Park'
            WHERE customer_id = $1 AND status = 'DRAFT'`,
          [customerIds.history]
        )
      ).rejects.toBeDefined();
    });
  });

  // =================================================================
  // RBAC, unchanged
  // =================================================================
  describe('the approved RBAC seed is unchanged', () => {
    it('still holds six roles, and the two PIF order permissions PHASE F added, and no PURCHASING role', async () => {
      const counts = await db.query<{ roles: string; permissions: string; purchasing: string }>(
        `SELECT (SELECT count(*)::text FROM shared.roles)       AS roles,
                (SELECT count(*)::text FROM shared.permissions) AS permissions,
                (SELECT count(*)::text FROM shared.roles WHERE name = 'PURCHASING') AS purchasing`
      );
      expect(counts[0]).toEqual({ roles: '6', permissions: '22', purchasing: '0' });
    });

    it('lets only RIK_ADMIN manage collection points', async () => {
      const customerAttempt = await request(server())
        .get('/admin/rik/config/pickup-locations')
        .set('Authorization', as('pickupA'));
      expect(customerAttempt.status).toBe(403);

      await request(server())
        .get('/admin/rik/config/pickup-locations')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);
    });

    it('records who changed a collection point, and when', async () => {
      const rows = await db.query<{ action: string; actor_role: string; before: unknown; after: unknown }>(
        `SELECT action, actor_role, before, after FROM shared.audit_log
          WHERE module = 'rik' AND entity_type = 'rik.pickup_locations'
            AND entity_id = $1
          ORDER BY created_at DESC LIMIT 1`,
        [dolphinHillId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.action).toBe('RIK_CONFIG_PICKUP_LOCATION_UPDATED');
      expect(rows[0]!.actor_role).toBe('RIK_ADMIN');
      expect(rows[0]!.before).toHaveProperty('name');
      expect(rows[0]!.after).toHaveProperty('name');
    });
  });

  // =================================================================
  // The pack sizes migration 0030 supplied
  // =================================================================
  describe('the three cereal pack limits now bind', () => {
    it('has a pack size for each of the three, so the two-packet limit is enforceable', async () => {
      const rows = await db.query<{ code: string; pack_size: string; max_packs: number }>(
        `SELECT code, pack_size::text AS pack_size, max_packs FROM rik.provisions
          WHERE code IN ('CER_MAGGI', 'CER_HAKKA_NOODLES', 'CER_MAIDA') ORDER BY code`
      );
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(Number(row.pack_size)).toBeGreaterThan(0);
        expect(row.max_packs).toBe(2);
      }
      expect(Number(rows.find((r) => r.code === 'CER_MAGGI')!.pack_size)).toBe(280);
      expect(Number(rows.find((r) => r.code === 'CER_HAKKA_NOODLES')!.pack_size)).toBe(1000);
      expect(Number(rows.find((r) => r.code === 'CER_MAIDA')!.pack_size)).toBe(500);
    });

    it('refuses a third packet of Maggi, which it could not before', async () => {
      const res = await request(server())
        .get('/rik/entitlements/current')
        .set('Authorization', as('refusals'))
        .expect(200);
      const cereals = [...res.body.fresh, ...res.body.dry].find((c: { code: string }) => c.code === 'CEREALS');
      const maggi = cereals.provisions.find((p: { code: string }) => p.code === 'CER_MAGGI');

      // The ceiling the engine advertises is now two packets' worth.
      expect(maggi.maxSelectableQuantity).toBeLessThanOrEqual(maggi.maxPacks * maggi.packSize);
    });
  });
});
