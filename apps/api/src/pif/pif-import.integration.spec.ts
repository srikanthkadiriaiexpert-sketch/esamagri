import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { Pool } from 'pg';
import { STAFF_ROLES, type StaffRole } from '@esamagri/shared-types';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';

/**
 * BULK PRODUCT IMPORT, over real HTTP against real PostgreSQL
 * (LAUNCH PREPARATION).
 *
 * WHAT THIS SUITE IS DESIGNED TO PROVE
 *
 *  1. THE PREVIEW IS HONEST. Uploading a file writes NOTHING to the
 *     catalogue. What the preview says a row will do is what applying it
 *     does, and a row the preview called invalid cannot be applied at all —
 *     the database refuses it even if the application is bypassed.
 *  2. THE IMPORT IS NOT A BACK DOOR. Every row is judged by the same
 *     catalogue rules the admin screen uses: a duplicate SKU, a price with
 *     three decimals, a GST rate that is not configured, a category that
 *     does not exist, a maximum below the minimum — all refused, with the
 *     same words.
 *  3. AN UPDATE CHANGES ONLY WHAT THE FILE CONTAINS. A two-column price
 *     file changes prices and nothing else; it does not blank the brands,
 *     categories and pack sizes it never mentioned.
 *  4. NOTHING IS DELETED OR WITHDRAWN. A product absent from the
 *     spreadsheet is left exactly as it was.
 *  5. NO STOCK SNEAKS IN. A `Stock` column is reported back as ignored,
 *     with the reason, and no quantity is stored anywhere.
 *  6. APPLYING IS SINGLE-SHOT. The same batch cannot be applied twice, and
 *     a discarded batch cannot be applied at all.
 *  7. AUTHORIZATION IS THE DATABASE'S. `pif.product.manage` governs every
 *     route: PIF_ADMIN and SUPER_ADMIN may import, PIF_CASHIER and
 *     DELIVERY_STAFF may not, RIK_ADMIN may not, and an unauthenticated
 *     caller gets nowhere.
 *  8. RIK IS UNTOUCHED by any of it.
 *
 * FIXTURE DISCIPLINE. Every SKU, category and file name is prefixed with a
 * run-unique id, so repeated runs neither collide nor accumulate meaning,
 * and nothing in this suite deletes a row.
 */
describe('PIF bulk product import (integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;
  /**
   * A SECOND connection, as the application's own database role, used only
   * for the bypass probes below.
   *
   * DatabaseService deliberately replaces a driver error with a safe,
   * generic message, which is right for a response to a caller but useless
   * for proving WHICH constraint refused a write. These probes connect
   * directly, with the same credentials and therefore the same privileges,
   * so the assertion can name the constraint that did the refusing.
   */
  let raw: Pool;

  const runId = randomUUID().slice(0, 8).toUpperCase();
  const sku = (name: string) => `IMP-${runId}-${name}`;
  const server = () => app.getHttpServer();

  const staffIdByRole = new Map<StaffRole, string>();
  const tokenByRole = new Map<StaffRole, string>();
  const bearer = (role: StaffRole) => `Bearer ${tokenByRole.get(role)}`;
  const asPifAdmin = () => bearer('PIF_ADMIN');
  const asSuperAdmin = () => bearer('SUPER_ADMIN');
  const asRikAdmin = () => bearer('RIK_ADMIN');
  const asCashier = () => bearer('PIF_CASHIER');
  const asDelivery = () => bearer('DELIVERY_STAFF');

  let categoryName: string;
  let subcategoryName: string;
  let categoryId: string;
  let subcategoryId: string;
  let existingProductId: string;

  /** Upload a CSV body as a file, exactly as the browser's form does. */
  const uploadCsv = (body: string, filename = `import-${runId}.csv`, auth = asPifAdmin()) =>
    request(server())
      .post('/admin/pif/products/import/preview')
      .set('Authorization', auth)
      .attach('file', Buffer.from(body, 'utf8'), filename);

  const previewOf = async (body: string, filename?: string) => {
    const res = await uploadCsv(body, filename).expect(201);
    return res.body;
  };

  const rowsOf = async (batchId: string, verdict?: string) => {
    const res = await request(server())
      .get(`/admin/pif/products/import/${batchId}/rows`)
      .query(verdict ? { verdict } : {})
      .set('Authorization', asPifAdmin())
      .expect(200);
    return res.body.items as Array<{
      rowNo: number;
      verdict: string;
      sku: string | null;
      problems: string[];
      sellingPrice: number | null;
    }>;
  };

  const productBySku = async (code: string) => {
    const rows = await db.query<{
      id: string;
      name: string;
      brand: string | null;
      selling_price: string;
      unit: string;
      category_id: string | null;
      pack_size: string | null;
      available: boolean;
      active: boolean;
      tax_rate_id: string | null;
      max_order_qty: string | null;
    }>(
      `SELECT id, name, brand, selling_price, unit, category_id, pack_size,
              available, active, tax_rate_id, max_order_qty
         FROM pif.products WHERE sku = $1 AND deleted_at IS NULL`,
      [code]
    );
    return rows[0] ?? null;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    );
    await app.init();

    db = app.get(DatabaseService);
    tokenService = app.get(TokenService);
    raw = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

    const passwordHash = await app.get(PasswordService).hash('CorrectHorseBatteryStaple!1');
    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    const grantedBy = bootstrap[0]!.id;

    for (const role of STAFF_ROLES) {
      const username = `jest_imp_${role.toLowerCase()}`;
      const found = await db.query<{ id: string }>(
        `SELECT id FROM shared.users WHERE username = $1`,
        [username]
      );
      const id =
        found.length > 0
          ? found[0]!.id
          : (
              await db.query<{ id: string }>(
                `INSERT INTO shared.users (id, username, password_hash, display_name, status)
                 VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
                [username, passwordHash, `Jest Import ${role}`]
              )
            )[0]!.id;
      staffIdByRole.set(role, id);
      await db.query(
        `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
         SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3 ON CONFLICT DO NOTHING`,
        [id, grantedBy, role]
      );
      tokenByRole.set(role, tokenService.signAccessToken({ principalType: 'STAFF', principalId: id }));
    }

    // The catalogue the spreadsheet will refer to BY NAME, created through
    // the API exactly as the client would create it.
    categoryName = `Jest Import Staples ${runId}`;
    subcategoryName = `Jest Import Pulses ${runId}`;
    categoryId = (
      await request(server())
        .post('/admin/pif/categories')
        .set('Authorization', asPifAdmin())
        .send({ name: categoryName, sortOrder: 5 })
        .expect(201)
    ).body.id;
    subcategoryId = (
      await request(server())
        .post('/admin/pif/categories')
        .set('Authorization', asPifAdmin())
        .send({ name: subcategoryName, parentId: categoryId })
        .expect(201)
    ).body.id;

    await request(server())
      .post('/admin/pif/tax-rates')
      .set('Authorization', asPifAdmin())
      .send({ name: `Jest Import GST 5% ${runId}`, ratePct: 5 })
      .expect(201);

    // One product that already exists, so an import can be seen to UPDATE
    // rather than duplicate it. It has a brand, a category, a pack size and
    // an order limit — all of which a two-column file must leave alone.
    existingProductId = (
      await request(server())
        .post('/admin/pif/products')
        .set('Authorization', asPifAdmin())
        .send({
          sku: sku('EXIST'),
          name: `Jest Import Existing Atta ${runId}`,
          brand: 'Yard Mills',
          categoryId: subcategoryId,
          unit: 'kg',
          packSize: 5,
          packUnit: 'kg',
          sellingPrice: 210,
          maxOrderQty: 4,
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await raw?.end();
    await app?.close();
  });

  // =====================================================================
  // 1. The template
  // =====================================================================
  describe('the template the client fills in', () => {
    it('downloads as a real Excel workbook with the documented headings', async () => {
      const res = await request(server())
        .get('/admin/pif/products/import/template')
        .set('Authorization', asPifAdmin())
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('.xlsx');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as unknown as ArrayBuffer);
      const sheet = workbook.getWorksheet('Products')!;
      const headings = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
      expect(headings).toContain('SKU');
      expect(headings).toContain('Selling Price');
      expect(headings).toContain('GST %');
      expect(headings).toContain('Available');
      // There is NO stock column in the template, because there is no stock.
      expect(headings.join(' ').toLowerCase()).not.toContain('stock');
      expect(workbook.getWorksheet('How to fill this in')).toBeDefined();
    });

    it('is refused to a role without pif.product.manage', async () => {
      await request(server())
        .get('/admin/pif/products/import/template')
        .set('Authorization', asCashier())
        .expect(403);
    });
  });

  // =====================================================================
  // 2. The preview writes nothing
  // =====================================================================
  describe('a preview judges the file and writes nothing', () => {
    it('reports creates, updates and problems — and the catalogue is unchanged', async () => {
      const before = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pif.products`
      );

      const body = [
        'SKU,Name,Category,Subcategory,Unit,Selling Price,GST %,Available',
        `${sku('DAL')},Jest Import Toor Dal ${runId},${categoryName},${subcategoryName},kg,142.50,5,Yes`,
        `${sku('EXIST')},Jest Import Existing Atta ${runId},${categoryName},${subcategoryName},kg,215.00,5,Yes`,
        `,Nameless row,${categoryName},,kg,10,5,Yes`,
      ].join('\n');

      const preview = await previewOf(body);
      expect(preview.batch.status).toBe('PREVIEW');
      expect(preview.batch.totalRows).toBe(3);
      expect(preview.batch.createRows).toBe(1);
      expect(preview.batch.updateRows).toBe(1);
      expect(preview.batch.invalidRows).toBe(1);
      expect(preview.batch.appliedRows).toBe(0);
      expect(preview.batch.uploadedBy).toContain('PIF_ADMIN');

      const after = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM pif.products`);
      expect(after[0]!.n).toBe(before[0]!.n);
      expect(await productBySku(sku('DAL'))).toBeNull();

      const rows = await rowsOf(preview.batch.id);
      expect(rows.map((row) => row.verdict)).toEqual(['CREATE', 'UPDATE', 'INVALID']);
      // The row number is the one the operator sees in the spreadsheet.
      expect(rows[0]!.rowNo).toBe(2);
      expect(rows[2]!.problems.join(' ')).toMatch(/No SKU/i);
    });

    it('lists only the problem rows when asked to', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price',
        `${sku('OK1')},Jest Import Fine ${runId},${categoryName},kg,50`,
        `${sku('BAD1')},Jest Import Odd ${runId},${categoryName},kg,12.345`,
      ].join('\n');
      const preview = await previewOf(body);
      const invalid = await rowsOf(preview.batch.id, 'INVALID');
      expect(invalid).toHaveLength(1);
      expect(invalid[0]!.sku).toBe(sku('BAD1'));
      expect(invalid[0]!.problems.join(' ')).toMatch(/rupees and paise/i);
    });
  });

  // =====================================================================
  // 3. The catalogue's own rules, reused
  // =====================================================================
  describe('every catalogue rule applies to an imported row', () => {
    it('refuses a SKU used twice in the same file, naming the earlier row', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price',
        `${sku('TWICE')},Jest Import First ${runId},${categoryName},kg,10`,
        `${sku('TWICE')},Jest Import Second ${runId},${categoryName},kg,20`,
      ].join('\n');
      const preview = await previewOf(body);
      expect(preview.batch.invalidRows).toBe(1);
      const invalid = await rowsOf(preview.batch.id, 'INVALID');
      expect(invalid[0]!.rowNo).toBe(3);
      expect(invalid[0]!.problems.join(' ')).toMatch(/already used by row 2/i);
    });

    it('refuses a category that does not exist, and names it for the operator', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price',
        `${sku('NOCAT')},Jest Import Orphan ${runId},Aisle That Does Not Exist,kg,10`,
      ].join('\n');
      const preview = await previewOf(body);
      expect(preview.batch.invalidRows).toBe(1);
      expect(preview.missingCategories).toEqual(['Aisle That Does Not Exist']);
      const invalid = await rowsOf(preview.batch.id, 'INVALID');
      expect(invalid[0]!.problems.join(' ')).toMatch(/no category called/i);
    });

    it('refuses a GST rate that is not configured, rather than inventing one', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price,GST %',
        `${sku('ODDGST')},Jest Import Odd GST ${runId},${categoryName},kg,10,17`,
      ].join('\n');
      const preview = await previewOf(body);
      expect(preview.batch.invalidRows).toBe(1);
      expect(preview.unknownTaxRates).toEqual(['17']);
      const invalid = await rowsOf(preview.batch.id, 'INVALID');
      expect(invalid[0]!.problems.join(' ')).toMatch(/No active tax rate of 17%/i);
    });

    it('refuses a maximum order quantity below the minimum', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price,Min Order Qty,Max Order Qty',
        `${sku('BADLIMIT')},Jest Import Bad Limit ${runId},${categoryName},kg,10,5,2`,
      ].join('\n');
      const preview = await previewOf(body);
      const invalid = await rowsOf(preview.batch.id, 'INVALID');
      expect(invalid[0]!.problems.join(' ')).toMatch(/maximum order quantity cannot be below/i);
    });

    it('refuses a new product with no unit and no price', async () => {
      const body = [
        'SKU,Name,Category',
        `${sku('BARE')},Jest Import Bare ${runId},${categoryName}`,
      ].join('\n');
      const preview = await previewOf(body);
      const invalid = await rowsOf(preview.batch.id, 'INVALID');
      expect(invalid[0]!.problems.join(' ')).toMatch(/No unit/i);
      expect(invalid[0]!.problems.join(' ')).toMatch(/No selling price/i);
    });

    it('refuses a price that is not a number at all', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price',
        `${sku('WORDS')},Jest Import Words ${runId},${categoryName},kg,on request`,
      ].join('\n');
      const preview = await previewOf(body);
      const invalid = await rowsOf(preview.batch.id, 'INVALID');
      expect(invalid[0]!.problems.join(' ')).toMatch(/not a number/i);
    });

    it('reads a price written the way a spreadsheet writes it', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price',
        `${sku('RUPEE')},Jest Import Rupee ${runId},${categoryName},kg,"₹ 1,250.50"`,
      ].join('\n');
      const preview = await previewOf(body);
      expect(preview.batch.createRows).toBe(1);
      const rows = await rowsOf(preview.batch.id);
      expect(rows[0]!.sellingPrice).toBe(1250.5);
    });
  });

  // =====================================================================
  // 4. Columns that are not imported
  // =====================================================================
  describe('columns that are deliberately not imported', () => {
    it('reports a Stock column as ignored, with the reason, and stores no quantity', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price,Stock,Supplier,HSN',
        `${sku('STOCKCOL')},Jest Import Stock Column ${runId},${categoryName},kg,30,500,Acme Traders,1006`,
      ].join('\n');
      const preview = await previewOf(body);
      expect(preview.batch.createRows).toBe(1);
      const headings = preview.ignoredColumns.map((column: { heading: string }) => column.heading);
      expect(headings).toContain('Stock');
      expect(headings).toContain('Supplier');
      expect(headings).toContain('HSN');
      expect(
        preview.ignoredColumns
          .map((column: { reason: string }) => column.reason)
          .join(' ')
      ).toMatch(/no stock count/i);

      // And the schema still has nowhere to put a quantity.
      const columns = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'pif' AND table_name = 'products'
            AND column_name IN ('stock_qty','on_hand','quantity_available','supplier_id')`
      );
      expect(columns).toHaveLength(0);
    });

    it('reports a heading it does not recognise at all', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price,Shelf Position',
        `${sku('ODDCOL')},Jest Import Odd Column ${runId},${categoryName},kg,30,A4`,
      ].join('\n');
      const preview = await previewOf(body);
      expect(preview.unknownColumns).toEqual(['Shelf Position']);
      expect(preview.batch.createRows).toBe(1);
    });

    it('refuses a file with no SKU or Name column, pointing at the template', async () => {
      const res = await uploadCsv('Price,Unit\n10,kg').expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.message).toMatch(/template/i);
    });
  });

  // =====================================================================
  // 5. Applying
  // =====================================================================
  describe('applying a previewed file', () => {
    it('creates the new products and updates the existing one', async () => {
      const body = [
        'SKU,Name,Category,Subcategory,Unit,Pack Size,Pack Unit,Selling Price,GST %,Available',
        `${sku('APPLY1')},Jest Import Applied Rice ${runId},${categoryName},${subcategoryName},kg,1,kg,99.50,5,Yes`,
        `${sku('APPLY2')},Jest Import Applied Oil ${runId},${categoryName},,l,1,l,180.00,5,No`,
      ].join('\n');
      const preview = await previewOf(body);

      const applied = await request(server())
        .post(`/admin/pif/products/import/${preview.batch.id}/apply`)
        .set('Authorization', asPifAdmin())
        .expect(201);

      expect(applied.body.batch.status).toBe('APPLIED');
      expect(applied.body.batch.appliedRows).toBe(2);
      expect(applied.body.batch.decidedBy).toContain('PIF_ADMIN');

      const rice = await productBySku(sku('APPLY1'));
      expect(rice).not.toBeNull();
      expect(rice!.selling_price).toBe('99.50');
      expect(rice!.category_id).toBe(subcategoryId);
      expect(rice!.available).toBe(true);
      expect(rice!.tax_rate_id).not.toBeNull();

      const oil = await productBySku(sku('APPLY2'));
      expect(oil!.category_id).toBe(categoryId);
      // "Available: No" is an availability flag, not a stock count.
      expect(oil!.available).toBe(false);
      expect(oil!.active).toBe(true);

      // Each applied row now points at the product it produced.
      const rows = await db.query<{ row_no: number; target_product_id: string | null }>(
        `SELECT row_no, target_product_id FROM pif.product_import_rows
          WHERE batch_id = $1 ORDER BY row_no`,
        [preview.batch.id]
      );
      expect(rows.every((row) => row.target_product_id !== null)).toBe(true);
    });

    it('changes ONLY the columns the file contains', async () => {
      const beforeRow = await productBySku(sku('EXIST'));
      expect(beforeRow!.brand).toBe('Yard Mills');

      // A two-column price file: no brand, no category, no pack, no limits.
      const body = ['SKU,Selling Price,Name', `${sku('EXIST')},225.00,${beforeRow!.name}`].join('\n');
      const preview = await previewOf(body, `price-update-${runId}.csv`);
      expect(preview.batch.updateRows).toBe(1);

      await request(server())
        .post(`/admin/pif/products/import/${preview.batch.id}/apply`)
        .set('Authorization', asPifAdmin())
        .expect(201);

      const afterRow = await productBySku(sku('EXIST'));
      expect(afterRow!.selling_price).toBe('225.00');
      // Everything the file did not mention is exactly as it was.
      expect(afterRow!.brand).toBe('Yard Mills');
      expect(afterRow!.category_id).toBe(subcategoryId);
      expect(afterRow!.pack_size).toBe(beforeRow!.pack_size);
      expect(afterRow!.max_order_qty).toBe(beforeRow!.max_order_qty);
      expect(afterRow!.unit).toBe('kg');
      expect(afterRow!.id).toBe(existingProductId);
    });

    it('clears a field when the file HAS that column and leaves it empty', async () => {
      const code = sku('CLEARBRAND');
      await request(server())
        .post('/admin/pif/products')
        .set('Authorization', asPifAdmin())
        .send({
          sku: code,
          name: `Jest Import Clearable ${runId}`,
          brand: 'Temporary Brand',
          categoryId,
          unit: 'kg',
          sellingPrice: 60,
        })
        .expect(201);

      const body = [
        'SKU,Name,Brand,Selling Price',
        `${code},Jest Import Clearable ${runId},,60`,
      ].join('\n');
      const preview = await previewOf(body);
      await request(server())
        .post(`/admin/pif/products/import/${preview.batch.id}/apply`)
        .set('Authorization', asPifAdmin())
        .expect(201);

      expect((await productBySku(code))!.brand).toBeNull();
    });

    it('leaves a product that the file never mentions completely alone', async () => {
      const untouched = await productBySku(sku('APPLY1'));
      const body = [
        'SKU,Name,Category,Unit,Selling Price',
        `${sku('ELSEWHERE')},Jest Import Elsewhere ${runId},${categoryName},kg,15`,
      ].join('\n');
      const preview = await previewOf(body);
      await request(server())
        .post(`/admin/pif/products/import/${preview.batch.id}/apply`)
        .set('Authorization', asPifAdmin())
        .expect(201);

      const after = await productBySku(sku('APPLY1'));
      expect(after).toEqual(untouched);
    });

    it('applies nothing when every row has a problem', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price',
        `${sku('ALLBAD')},Jest Import All Bad ${runId},No Such Aisle,kg,10`,
      ].join('\n');
      const preview = await previewOf(body);
      const res = await request(server())
        .post(`/admin/pif/products/import/${preview.batch.id}/apply`)
        .set('Authorization', asPifAdmin())
        .expect(400);
      expect(res.body.details.reason).toBe('NOTHING_TO_APPLY');
      // The batch is still awaiting a decision, not silently finished.
      expect((await db.query<{ status: string }>(
        `SELECT status FROM pif.product_import_batches WHERE id = $1`,
        [preview.batch.id]
      ))[0]!.status).toBe('PREVIEW');
    });

    it('cannot be applied twice', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price',
        `${sku('ONCE')},Jest Import Once ${runId},${categoryName},kg,45`,
      ].join('\n');
      const preview = await previewOf(body);
      await request(server())
        .post(`/admin/pif/products/import/${preview.batch.id}/apply`)
        .set('Authorization', asPifAdmin())
        .expect(201);

      const again = await request(server())
        .post(`/admin/pif/products/import/${preview.batch.id}/apply`)
        .set('Authorization', asPifAdmin())
        .expect(409);
      expect(again.body.details.reason).toBe('BATCH_ALREADY_DECIDED');

      // And exactly one product exists for that SKU.
      const rows = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pif.products WHERE sku = $1`,
        [sku('ONCE')]
      );
      expect(rows[0]!.n).toBe('1');
    });

    it('two administrators pressing Apply at the same moment produce one import', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price',
        `${sku('RACE')},Jest Import Race ${runId},${categoryName},kg,33`,
      ].join('\n');
      const preview = await previewOf(body);

      const results = await Promise.all([
        request(server())
          .post(`/admin/pif/products/import/${preview.batch.id}/apply`)
          .set('Authorization', asPifAdmin()),
        request(server())
          .post(`/admin/pif/products/import/${preview.batch.id}/apply`)
          .set('Authorization', asSuperAdmin()),
      ]);
      const statuses = results.map((res) => res.status).sort();
      expect(statuses).toEqual([201, 409]);
      const rows = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pif.products WHERE sku = $1`,
        [sku('RACE')]
      );
      expect(rows[0]!.n).toBe('1');
    });

    it('a discarded batch cannot be applied', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price',
        `${sku('TRASH')},Jest Import Discarded ${runId},${categoryName},kg,12`,
      ].join('\n');
      const preview = await previewOf(body);

      const discarded = await request(server())
        .post(`/admin/pif/products/import/${preview.batch.id}/discard`)
        .set('Authorization', asPifAdmin())
        .expect(201);
      expect(discarded.body.batch.status).toBe('DISCARDED');

      await request(server())
        .post(`/admin/pif/products/import/${preview.batch.id}/apply`)
        .set('Authorization', asPifAdmin())
        .expect(409);
      expect(await productBySku(sku('TRASH'))).toBeNull();
    });

    it('answers 404 for an import that does not exist', async () => {
      await request(server())
        .get(`/admin/pif/products/import/${randomUUID()}`)
        .set('Authorization', asPifAdmin())
        .expect(404);
    });
  });

  // =====================================================================
  // 6. Excel, not just CSV
  // =====================================================================
  describe('an Excel workbook', () => {
    it('is read with the same rules, including numeric and formula cells', async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Products');
      sheet.addRow(['SKU', 'Name', 'Category', 'Unit', 'Selling Price', 'GST %', 'Available']);
      sheet.addRow([
        sku('XLSX1'),
        `Jest Import Workbook ${runId}`,
        categoryName,
        'kg',
        75.25,
        5,
        'Yes',
      ]);
      // A price written as a formula: the RESULT is imported, never the text.
      const formulaRow = sheet.addRow([
        sku('XLSX2'),
        `Jest Import Formula ${runId}`,
        categoryName,
        'kg',
        null,
        5,
        'No',
      ]);
      formulaRow.getCell(5).value = { formula: 'ROUND(100/4,2)', result: 25 };
      const buffer = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);

      const res = await request(server())
        .post('/admin/pif/products/import/preview')
        .set('Authorization', asPifAdmin())
        .attach('file', buffer, `workbook-${runId}.xlsx`)
        .expect(201);

      expect(res.body.batch.format).toBe('XLSX');
      expect(res.body.batch.createRows).toBe(2);
      const rows = await rowsOf(res.body.batch.id);
      expect(rows.map((row) => row.sellingPrice)).toEqual([75.25, 25]);

      await request(server())
        .post(`/admin/pif/products/import/${res.body.batch.id}/apply`)
        .set('Authorization', asPifAdmin())
        .expect(201);
      expect((await productBySku(sku('XLSX2')))!.selling_price).toBe('25.00');
    });

    it('refuses an old .xls file with an instruction instead of a stack trace', async () => {
      const res = await request(server())
        .post('/admin/pif/products/import/preview')
        .set('Authorization', asPifAdmin())
        .attach('file', Buffer.from('\xd0\xcf\x11\xe0 old binary', 'binary'), 'legacy.xls')
        .expect(400);
      expect(res.body.message).toMatch(/Save As/i);
      expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|node_modules/);
    });

    it('refuses a file that is not a spreadsheet at all', async () => {
      const res = await request(server())
        .post('/admin/pif/products/import/preview')
        .set('Authorization', asPifAdmin())
        .attach('file', Buffer.from('%PDF-1.4 this is a pdf', 'utf8'), 'catalogue.pdf')
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('refuses an upload with no file', async () => {
      const res = await request(server())
        .post('/admin/pif/products/import/preview')
        .set('Authorization', asPifAdmin())
        .expect(400);
      expect(res.body.details.reason).toBe('FILE_MISSING');
    });
  });

  // =====================================================================
  // 7. Authorization — the database's, not the menu's
  // =====================================================================
  describe('authorization', () => {
    const routes = (batchId: string) => [
      { method: 'get' as const, path: '/admin/pif/products/import' },
      { method: 'get' as const, path: '/admin/pif/products/import/template' },
      { method: 'post' as const, path: '/admin/pif/products/import/preview' },
      { method: 'get' as const, path: `/admin/pif/products/import/${batchId}` },
      { method: 'post' as const, path: `/admin/pif/products/import/${batchId}/apply` },
      { method: 'post' as const, path: `/admin/pif/products/import/${batchId}/discard` },
    ];

    let batchId: string;
    beforeAll(async () => {
      const preview = await previewOf(
        [
          'SKU,Name,Category,Unit,Selling Price',
          `${sku('AUTHZ')},Jest Import Authz ${runId},${categoryName},kg,19`,
        ].join('\n')
      );
      batchId = preview.batch.id;
    });

    it('refuses RIK_ADMIN on every import route', async () => {
      for (const route of routes(batchId)) {
        const res = await request(server())[route.method](route.path).set(
          'Authorization',
          asRikAdmin()
        );
        expect(res.status).toBe(403);
      }
    });

    it('refuses PIF_CASHIER and DELIVERY_STAFF, who hold no pif.product.manage', async () => {
      for (const auth of [asCashier(), asDelivery()]) {
        for (const route of routes(batchId)) {
          const res = await request(server())[route.method](route.path).set('Authorization', auth);
          expect(res.status).toBe(403);
        }
      }
    });

    it('refuses an unauthenticated caller', async () => {
      for (const route of routes(batchId)) {
        const res = await request(server())[route.method](route.path);
        expect(res.status).toBe(401);
      }
    });

    it('allows SUPER_ADMIN, who holds both modules explicitly', async () => {
      await request(server())
        .get('/admin/pif/products/import')
        .set('Authorization', asSuperAdmin())
        .expect(200);
      const res = await request(server())
        .get(`/admin/pif/products/import/${batchId}`)
        .set('Authorization', asSuperAdmin())
        .expect(200);
      expect(res.body.batch.id).toBe(batchId);
    });

    it('still holds pif.product.manage in the database, not in this file', async () => {
      const rows = await db.query<{ role: string }>(
        `SELECT r.name AS role
           FROM shared.roles r
           JOIN shared.role_permissions rp ON rp.role_id = r.id
           JOIN shared.permissions p ON p.id = rp.permission_id
          WHERE p.code = 'pif.product.manage'
          ORDER BY r.name`
      );
      expect(rows.map((row) => row.role)).toEqual(['PIF_ADMIN', 'SUPER_ADMIN']);
    });
  });

  // =====================================================================
  // 8. The database's own guards, with the application bypassed
  // =====================================================================
  describe('the database refuses what the application must never do', () => {
    it('will not let the application delete an import record', async () => {
      const preview = await previewOf(
        [
          'SKU,Name,Category,Unit,Selling Price',
          `${sku('NODELETE')},Jest Import No Delete ${runId},${categoryName},kg,11`,
        ].join('\n')
      );
      await expect(
        raw.query(`DELETE FROM pif.product_import_rows WHERE batch_id = $1`, [preview.batch.id])
      ).rejects.toThrow(/permission denied/i);
      await expect(
        raw.query(`DELETE FROM pif.product_import_batches WHERE id = $1`, [preview.batch.id])
      ).rejects.toThrow(/permission denied/i);
      // Still there, which is the point of taking DELETE away.
      const still = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pif.product_import_batches WHERE id = $1`,
        [preview.batch.id]
      );
      expect(still[0]!.n).toBe('1');
    });

    it('will not record an invalid row as applied, even by direct SQL', async () => {
      const preview = await previewOf(
        [
          'SKU,Name,Category,Unit,Selling Price',
          `${sku('FORCED')},Jest Import Forced ${runId},No Such Aisle,kg,11`,
        ].join('\n')
      );
      const rows = await db.query<{ id: string }>(
        `SELECT id FROM pif.product_import_rows WHERE batch_id = $1 AND verdict = 'INVALID'`,
        [preview.batch.id]
      );
      expect(rows).toHaveLength(1);
      await expect(
        raw.query(`UPDATE pif.product_import_rows SET applied_at = now() WHERE id = $1`, [
          rows[0]!.id,
        ])
      ).rejects.toThrow(/pif_import_rows_applied_chk/);
    });

    it('will not accept a row that claims to update nothing', async () => {
      const preview = await previewOf(
        [
          'SKU,Name,Category,Unit,Selling Price',
          `${sku('NOTARGET')},Jest Import No Target ${runId},${categoryName},kg,11`,
        ].join('\n')
      );
      await expect(
        raw.query(
          `INSERT INTO pif.product_import_rows (batch_id, row_no, verdict, parsed)
           VALUES ($1, 9999, 'UPDATE', '{}'::jsonb)`,
          [preview.batch.id]
        )
      ).rejects.toThrow(/pif_import_rows_target_chk/);
    });

    it('will not accept counts that do not add up', async () => {
      await expect(
        raw.query(
          `INSERT INTO pif.product_import_batches
             (source_filename, source_format, byte_size, total_rows, create_rows, uploaded_by)
           VALUES ('bogus.csv', 'CSV', 10, 5, 1, $1)`,
          [staffIdByRole.get('PIF_ADMIN')]
        )
      ).rejects.toThrow(/pif_import_batch_counts_chk/);
    });

    it('will not accept a decided batch with nobody who decided it', async () => {
      await expect(
        raw.query(
          `INSERT INTO pif.product_import_batches
             (source_filename, source_format, byte_size, status, decided_at, uploaded_by)
           VALUES ('bogus2.csv', 'CSV', 10, 'APPLIED', now(), $1)`,
          [staffIdByRole.get('PIF_ADMIN')]
        )
      ).rejects.toThrow(/pif_import_batch_decider_chk/);
    });
  });

  // =====================================================================
  // 9. The audit trail, and RIK
  // =====================================================================
  describe('what the import leaves behind', () => {
    it('records who previewed and who applied, and each product it wrote', async () => {
      const body = [
        'SKU,Name,Category,Unit,Selling Price',
        `${sku('AUDIT')},Jest Import Audited ${runId},${categoryName},kg,88`,
      ].join('\n');
      const preview = await previewOf(body);
      await request(server())
        .post(`/admin/pif/products/import/${preview.batch.id}/apply`)
        .set('Authorization', asSuperAdmin())
        .expect(201);

      const events = await db.query<{ action: string; actor_id: string }>(
        `SELECT action, actor_id FROM shared.audit_log
          WHERE entity_id = $1 ORDER BY created_at`,
        [preview.batch.id]
      );
      expect(events.map((event) => event.action)).toEqual([
        'PIF_PRODUCT_IMPORT_PREVIEWED',
        'PIF_PRODUCT_IMPORT_APPLIED',
      ]);
      expect(events[0]!.actor_id).toBe(staffIdByRole.get('PIF_ADMIN'));
      expect(events[1]!.actor_id).toBe(staffIdByRole.get('SUPER_ADMIN'));

      // The product itself is audited individually, exactly as if it had
      // been typed into the admin screen.
      const product = await productBySku(sku('AUDIT'));
      const productEvents = await db.query<{ action: string }>(
        `SELECT action FROM shared.audit_log WHERE entity_id = $1`,
        [product!.id]
      );
      expect(productEvents.map((event) => event.action)).toContain('PIF_PRODUCT_CREATED');
    });

    it('lists recent imports, newest first', async () => {
      const res = await request(server())
        .get('/admin/pif/products/import')
        .query({ limit: 5 })
        .set('Authorization', asPifAdmin())
        .expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items.length).toBeLessThanOrEqual(5);
      const times = res.body.items.map((item: { uploadedAt: string }) => item.uploadedAt);
      expect([...times].sort().reverse()).toEqual(times);
    });

    it('touched no RIK table and added no permission or role', async () => {
      const counts = await db.query<{ pools: string; permissions: string; roles: string }>(
        `SELECT (SELECT count(*) FROM rik.entitlement_pools)::text AS pools,
                (SELECT count(*) FROM shared.permissions)::text    AS permissions,
                (SELECT count(*) FROM shared.roles)::text          AS roles`
      );
      expect(counts[0]).toEqual({ pools: '18', permissions: '22', roles: '6' });
    });

    it('the schema is 68 tables and 5 views, with pif at 23', async () => {
      const rows = await db.query<{ tables: string; views: string; pif: string }>(
        `SELECT (SELECT count(*)::text FROM information_schema.tables
                  WHERE table_schema IN ('shared','rik','pif') AND table_type = 'BASE TABLE') AS tables,
                (SELECT count(*)::text FROM information_schema.views
                  WHERE table_schema IN ('shared','rik','pif')) AS views,
                (SELECT count(*)::text FROM information_schema.tables
                  WHERE table_schema = 'pif' AND table_type = 'BASE TABLE') AS pif`
      );
      expect(rows[0]).toEqual({ tables: '68', views: '5', pif: '23' });
    });
  });
});
