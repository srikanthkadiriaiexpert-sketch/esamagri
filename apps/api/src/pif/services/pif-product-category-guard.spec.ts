import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import type { AuthContext } from '../../auth/auth-context';
import {
  CategoryRecord,
  PifCatalogueRepository,
  ProductRecord,
  ProductWrite,
} from '../repositories/pif-catalogue.repository';
import { CatalogueError, PifCatalogueService, ProductInput } from './pif-catalogue.service';

/**
 * Where a product may be filed — the asymmetric subcategory rule.
 *
 * WHY THIS IS A UNIT SPEC AND NOT AN INTEGRATION ONE. The rule is a decision
 * taken in PifCatalogueService before any SQL runs, so it can be tested with
 * two stubs and no database. That matters here: migration 0061 has not been
 * applied, the Jest database has not been prepared, and this guard must be
 * provable without either. It touches none of the columns 0061 adds.
 *
 * WHAT IS ASSERTED. Not only that the right calls are refused, but that a
 * refusal is a CatalogueError carrying 'INVALID_CATEGORY' — which is what
 * makes toHttp() answer 400 VALIDATION_FAILED rather than 404 or 409 — and
 * that an allowed update writes the product's category back UNCHANGED, which
 * is how "do not automatically recategorise a legacy product" is proved
 * rather than asserted.
 */

const MAIN: CategoryRecord = {
  id: '11111111-1111-7111-8111-111111111111',
  name: 'Oils & Ghee',
  parent_id: null,
  parent_name: null,
  description: null,
  image_ref: null,
  sort_order: 30,
  active: true,
  // A pre-business legacy row: migration 0061 added business_slug, and the 14
  // categories seeded before it carry NULL. That is what this fixture is —
  // "Oils & Ghee" is one of those 14 names, and these cases are about legacy
  // products filed directly on a main category. The guard under test reads
  // only name, parent_id and active, so this value changes no assertion.
  business_slug: null,
  // Same reason as business_slug above: a pre-0061 row carries no slug. The
  // guard under test reads only name, parent_id and active.
  slug: null,
  product_count: 3,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const OTHER_MAIN: CategoryRecord = { ...MAIN, id: '33333333-3333-7333-8333-333333333333', name: 'Dairy' };

const SUB: CategoryRecord = {
  ...MAIN,
  id: '22222222-2222-7222-8222-222222222222',
  name: 'Sunflower Oil',
  parent_id: MAIN.id,
  parent_name: MAIN.name,
  sort_order: 10,
};

const DEACTIVATED_SUB: CategoryRecord = {
  ...SUB,
  id: '44444444-4444-7444-8444-444444444444',
  name: 'Retired Shelf',
  active: false,
};

const CATEGORIES = [MAIN, OTHER_MAIN, SUB, DEACTIVATED_SUB];

/** A legacy demonstration product: filed directly on a MAIN category. */
function legacyProduct(): ProductRecord {
  return {
    id: '99999999-9999-7999-8999-999999999999',
    sku: 'DEMO-OIL-1',
    name: 'Sunflower Oil 1 L',
    category_id: MAIN.id,
  } as unknown as ProductRecord;
}

function input(over: Partial<ProductInput> = {}): ProductInput {
  return {
    sku: 'TEST-1',
    name: 'Test Product',
    unit: 'l',
    sellingPrice: 142,
    ...over,
  } as ProductInput;
}

const CONTEXT = { principalId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', roles: ['PIF_ADMIN'] } as unknown as AuthContext;

interface Harness {
  service: PifCatalogueService;
  inserted: ProductWrite[];
  updated: Array<{ id: string; write: ProductWrite }>;
}

function harness(product: ProductRecord | null = null): Harness {
  const inserted: ProductWrite[] = [];
  const updated: Array<{ id: string; write: ProductWrite }> = [];

  const repo = {
    findProductBySku: async () => null,
    findCategory: async (id: string) => CATEGORIES.find((c) => c.id === id) ?? null,
    findProduct: async () => product,
    insertProduct: async (write: ProductWrite) => {
      inserted.push(write);
      return 'new-product-id';
    },
    updateProduct: async (id: string, write: ProductWrite) => {
      updated.push({ id, write });
    },
    findTaxRate: async () => {
      throw new Error('findTaxRate must not be called: these cases pass no tax rate');
    },
  } as unknown as PifCatalogueRepository;

  const auditLog = { logEvent: async () => undefined } as unknown as AuditLogRepository;

  return { service: new PifCatalogueService(repo, auditLog), inserted, updated };
}

/** Asserts the rejection is the one toHttp() turns into 400 VALIDATION_FAILED. */
async function expectInvalidCategory(run: () => Promise<unknown>, fragment: string): Promise<void> {
  await expect(run()).rejects.toThrow(CatalogueError);
  await expect(run()).rejects.toMatchObject({ code: 'INVALID_CATEGORY' });
  await expect(run()).rejects.toThrow(new RegExp(fragment, 'i'));
}

describe('product category guard — CREATE', () => {
  it('accepts a subcategory', async () => {
    const h = harness();
    await h.service.createProduct(CONTEXT, input({ categoryId: SUB.id }));
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]!.categoryId).toBe(SUB.id);
  });

  it('refuses a main category', async () => {
    const h = harness();
    await expectInvalidCategory(
      () => h.service.createProduct(CONTEXT, input({ categoryId: MAIN.id })),
      'main category'
    );
    expect(h.inserted).toHaveLength(0);
  });

  it('refuses no category at all', async () => {
    const h = harness();
    await expectInvalidCategory(
      () => h.service.createProduct(CONTEXT, input()),
      'must be filed under a subcategory'
    );
    expect(h.inserted).toHaveLength(0);
  });

  it('still refuses a deactivated category, as before', async () => {
    const h = harness();
    await expectInvalidCategory(
      () => h.service.createProduct(CONTEXT, input({ categoryId: DEACTIVATED_SUB.id })),
      'deactivated'
    );
  });
});

describe('product category guard — UPDATE', () => {
  it('lets a legacy main-category product be edited without recategorising it', async () => {
    const h = harness(legacyProduct());
    await h.service.updateProduct(
      CONTEXT,
      legacyProduct().id,
      input({ categoryId: MAIN.id, sellingPrice: 155, description: 'New blurb' })
    );
    expect(h.updated).toHaveLength(1);
    // The decisive assertion: the category written back is the one it had.
    expect(h.updated[0]!.write.categoryId).toBe(MAIN.id);
    expect(h.updated[0]!.write.sellingPrice).toBe(155);
  });

  it('refuses a move from a subcategory back to a main category', async () => {
    const onSub = { ...legacyProduct(), category_id: SUB.id } as ProductRecord;
    const h = harness(onSub);
    await expectInvalidCategory(
      () => h.service.updateProduct(CONTEXT, onSub.id, input({ categoryId: MAIN.id })),
      'main category'
    );
    expect(h.updated).toHaveLength(0);
  });

  it('refuses a move from one main category to another', async () => {
    const h = harness(legacyProduct());
    await expectInvalidCategory(
      () => h.service.updateProduct(CONTEXT, legacyProduct().id, input({ categoryId: OTHER_MAIN.id })),
      'main category'
    );
    expect(h.updated).toHaveLength(0);
  });

  it('allows a move from a main category to a subcategory', async () => {
    const h = harness(legacyProduct());
    await h.service.updateProduct(CONTEXT, legacyProduct().id, input({ categoryId: SUB.id }));
    expect(h.updated).toHaveLength(1);
    expect(h.updated[0]!.write.categoryId).toBe(SUB.id);
  });

  it('refuses clearing a product’s category', async () => {
    const h = harness(legacyProduct());
    await expectInvalidCategory(
      () => h.service.updateProduct(CONTEXT, legacyProduct().id, input()),
      'must be filed under a subcategory'
    );
    expect(h.updated).toHaveLength(0);
  });

  it('leaves a product already on a subcategory editable', async () => {
    const onSub = { ...legacyProduct(), category_id: SUB.id } as ProductRecord;
    const h = harness(onSub);
    await h.service.updateProduct(CONTEXT, onSub.id, input({ categoryId: SUB.id, sellingPrice: 150 }));
    expect(h.updated).toHaveLength(1);
    expect(h.updated[0]!.write.categoryId).toBe(SUB.id);
  });
});

/**
 * THE IMPORT PATH, now that the loophole is closed.
 *
 * `validateProduct` is what the spreadsheet import calls for every row. It now
 * receives the product's CURRENT category: the preview pass already holds the
 * record it read by SKU, and the apply pass gets it from ONE bulk read
 * (PifCatalogueRepository.findProductCategories) taken before its loop. These
 * are the six cases the rule has to get right.
 */
describe('product category guard \u2014 import path (before-value supplied)', () => {
  const PRODUCT = legacyProduct();

  it('1. legacy main-category product, price-only row: ALLOWED', async () => {
    const h = harness(PRODUCT);
    const write = await h.service.validateProduct(
      input({ categoryId: MAIN.id, sellingPrice: 150 }),
      PRODUCT.id,
      { categoryId: MAIN.id }
    );
    expect(write.categoryId).toBe(MAIN.id);
    expect(write.sellingPrice).toBe(150);
  });

  it('2. legacy main-category product moved to a subcategory: ALLOWED', async () => {
    const h = harness(PRODUCT);
    const write = await h.service.validateProduct(
      input({ categoryId: SUB.id }),
      PRODUCT.id,
      { categoryId: MAIN.id }
    );
    expect(write.categoryId).toBe(SUB.id);
  });

  it('3. legacy main-category product moved to another main category: REJECTED', async () => {
    const h = harness(PRODUCT);
    await expectInvalidCategory(
      () => h.service.validateProduct(input({ categoryId: OTHER_MAIN.id }), PRODUCT.id, {
        categoryId: MAIN.id,
      }),
      'main category'
    );
  });

  it('4. subcategory product moved to a main category: REJECTED', async () => {
    const h = harness(PRODUCT);
    await expectInvalidCategory(
      () => h.service.validateProduct(input({ categoryId: MAIN.id }), PRODUCT.id, {
        categoryId: SUB.id,
      }),
      'main category'
    );
  });

  it('5. new product assigned to a main category: REJECTED', async () => {
    const h = harness();
    await expectInvalidCategory(
      () => h.service.validateProduct(input({ categoryId: MAIN.id }), null),
      'main category'
    );
  });

  it('6. new product assigned to a subcategory: ALLOWED', async () => {
    const h = harness();
    const write = await h.service.validateProduct(input({ categoryId: SUB.id }), null);
    expect(write.categoryId).toBe(SUB.id);
  });

  it('validates without writing anything', async () => {
    const h = harness(PRODUCT);
    await h.service.validateProduct(input({ categoryId: SUB.id }), PRODUCT.id, {
      categoryId: MAIN.id,
    });
    expect(h.inserted).toHaveLength(0);
    expect(h.updated).toHaveLength(0);
  });

  it('still refuses a deactivated category', async () => {
    const h = harness(PRODUCT);
    await expectInvalidCategory(
      () => h.service.validateProduct(input({ categoryId: DEACTIVATED_SUB.id }), PRODUCT.id, {
        categoryId: MAIN.id,
      }),
      'deactivated'
    );
  });

  it("keeps the lax reading when the caller cannot supply a before-value", async () => {
    // No third argument: 'unknown'. Used by any caller that has not been
    // updated; the import no longer relies on it.
    const h = harness(PRODUCT);
    const write = await h.service.validateProduct(input({ categoryId: MAIN.id }), PRODUCT.id);
    expect(write.categoryId).toBe(MAIN.id);
  });
});
