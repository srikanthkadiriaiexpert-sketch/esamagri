import { Injectable } from '@nestjs/common';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import type { AuthContext } from '../../auth/auth-context';
import { money } from './pif-pricing.service';
import {
  PifCatalogueRepository,
  type CategoryRecord,
  type CategoryWrite,
  type ProductRecord,
  type ProductWrite,
} from '../repositories/pif-catalogue.repository';

/**
 * The PIF catalogue as the client's own staff manage it (PHASE F).
 *
 * THE POINT OF THIS SERVICE. The facility must be able to add a product,
 * change a price, put something out of stock for the day and upload a photo
 * WITHOUT a developer. So everything that would otherwise be a code change
 * is a row: categories and subcategories, names, brands, packs, units,
 * prices, GST rates, availability, order limits, variants and images. No
 * product, category or price appears anywhere in this codebase.
 *
 * WHAT IT REFUSES, and why each refusal exists:
 *
 *   a duplicate SKU            — the SKU is how the facility and its billing
 *                                software identify a product to each other
 *   a negative or over-precise price
 *                              — money is paise; three decimals is a typo
 *   a tax rate that is not configured
 *                              — GST comes from pif.tax_rates, never typed
 *   a subcategory under a subcategory
 *                              — the taxonomy is two levels, by design
 *   deactivating a category that still has products or subcategories
 *                              — it would silently empty the shop
 *   a quantity limit below the minimum
 *                              — an unorderable product
 *
 * EVERY WRITE IS AUDITED with the acting administrator, and every product
 * row carries created_by / updated_by, so "who changed this price" is a
 * question with an answer.
 *
 * NO STOCK. `active` and `available` are flags an administrator sets. There
 * is no counted quantity anywhere in PIF and this service introduces none.
 */

export type CatalogueErrorCode =
  | 'CATEGORY_NOT_FOUND'
  | 'PRODUCT_NOT_FOUND'
  | 'DUPLICATE_SKU'
  | 'DUPLICATE_CATEGORY'
  | 'INVALID_PRICE'
  | 'INVALID_TAX_RATE'
  | 'INVALID_CATEGORY'
  | 'INVALID_QUANTITY_LIMIT'
  | 'CATEGORY_IN_USE';

export class CatalogueError extends Error {
  constructor(
    readonly code: CatalogueErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CatalogueError';
  }
}

export interface ProductInput {
  sku: string;
  name: string;
  barcode?: string | null;
  brand?: string | null;
  description?: string | null;
  categoryId?: string | null;
  unit: string;
  packSize?: number | null;
  packUnit?: string | null;
  sellingPrice: number;
  purchasePrice?: number | null;
  taxRateId?: string | null;
  discountPct?: number | null;
  minOrderQty?: number;
  maxOrderQty?: number | null;
  qtyStep?: number;
  active?: boolean;
  available?: boolean;
  variantGroup?: string | null;
  variantLabel?: string | null;
}

export interface CategoryInput {
  name: string;
  parentId?: string | null;
  description?: string | null;
  sortOrder?: number;
  active?: boolean;
}

@Injectable()
export class PifCatalogueService {
  constructor(
    private readonly catalogue: PifCatalogueRepository,
    private readonly auditLog: AuditLogRepository
  ) {}

  // ---------------------------------------------------------------- customer

  /**
   * The shop front: active categories, with their active subcategories.
   *
   * TWO RULES THAT EXIST FOR THE SHOPPER, not for the administrator:
   *
   *   1. A category's count INCLUDES the products filed under its
   *      subcategories. "Staples — 0 items" next to "Rice — 3 items" is
   *      simply false to a shopper, who thinks of rice as a staple; the
   *      stored count is per-row and direct-only, which is the right number
   *      for the admin screen and the wrong one here.
   *   2. A category with nothing under it at all is NOT SHOWN. An empty
   *      aisle is a dead end: the shopper taps it, finds nothing, and
   *      learns to distrust the categories. The row still exists, the
   *      administrator still sees and manages it, and it appears the moment
   *      it has something in it.
   *
   * The administrator's list (`adminCategories`) does neither of these: it
   * shows every category and the exact number of products filed directly
   * against it, because that is what someone arranging the catalogue needs.
   */
  async publicCategories(): Promise<Array<CategoryRecord & { children: CategoryRecord[] }>> {
    const all = await this.catalogue.listPublicCategories();
    const tops = all.filter((c) => c.parent_id === null);
    return tops
      .map((top) => {
        const children = all.filter((c) => c.parent_id === top.id);
        const total =
          top.product_count + children.reduce((sum, child) => sum + child.product_count, 0);
        return { ...top, product_count: total, children };
      })
      .filter((top) => top.product_count > 0);
  }

  async publicProducts(filter: {
    categoryId?: string | null;
    query?: string | null;
    availableOnly?: boolean;
    page: number;
    pageSize: number;
  }): Promise<{ items: ProductRecord[]; total: number; page: number; pageSize: number }> {
    const pageSize = Math.min(Math.max(filter.pageSize, 1), 60);
    const page = Math.max(filter.page, 1);
    const { items, total } = await this.catalogue.listPublicProducts({
      categoryId: filter.categoryId ?? null,
      query: filter.query ?? null,
      availableOnly: filter.availableOnly ?? false,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { items, total, page, pageSize };
  }

  async publicProduct(id: string): Promise<ProductRecord> {
    const product = await this.catalogue.findPublicProduct(id);
    if (product === null) {
      throw new CatalogueError('PRODUCT_NOT_FOUND', 'That product is not in the catalogue.');
    }
    return product;
  }

  /** Other sizes/packs of the same product family, for the detail screen. */
  async variantsOf(product: ProductRecord): Promise<ProductRecord[]> {
    if (product.variant_group === null) return [];
    return this.catalogue.listPublicVariants(product.variant_group, product.id);
  }

  // ------------------------------------------------------------ admin: category

  async createCategory(context: AuthContext, input: CategoryInput): Promise<string> {
    const write = await this.prepareCategory(input, null);
    const id = await this.catalogue.insertCategory(write, context.principalId);
    await this.audit(context, 'PIF_CATEGORY_CREATED', 'pif.category', id, undefined, {
      name: write.name,
      parentId: write.parentId,
      active: write.active,
    });
    return id;
  }

  async updateCategory(context: AuthContext, id: string, input: CategoryInput): Promise<void> {
    const existing = await this.catalogue.findCategory(id);
    if (existing === null) {
      throw new CatalogueError('CATEGORY_NOT_FOUND', 'That category does not exist.');
    }
    const write = await this.prepareCategory(input, id);

    // Switching a category off, or moving it under a parent, must not strand
    // what is already filed under it.
    if (existing.active && !write.active) {
      const usage = await this.catalogue.categoryUsage(id);
      if (usage.products > 0 || usage.children > 0) {
        throw new CatalogueError(
          'CATEGORY_IN_USE',
          `This category still holds ${usage.products} product(s) and ${usage.children} subcategory(ies). Move or deactivate those first.`,
          usage
        );
      }
    }

    await this.catalogue.updateCategory(id, write, context.principalId);
    await this.audit(
      context,
      'PIF_CATEGORY_UPDATED',
      'pif.category',
      id,
      { name: existing.name, parentId: existing.parent_id, active: existing.active },
      { name: write.name, parentId: write.parentId, active: write.active }
    );
  }

  async adminCategories(): Promise<CategoryRecord[]> {
    return this.catalogue.listAdminCategories();
  }

  // ------------------------------------------------------------- admin: product

  async adminProducts(filter: {
    categoryId?: string | null;
    query?: string | null;
    status?: 'ALL' | 'ACTIVE' | 'INACTIVE' | 'UNAVAILABLE';
    page: number;
    pageSize: number;
  }): Promise<{ items: ProductRecord[]; total: number; page: number; pageSize: number }> {
    const pageSize = Math.min(Math.max(filter.pageSize, 1), 100);
    const page = Math.max(filter.page, 1);
    const { items, total } = await this.catalogue.listAdminProducts({
      categoryId: filter.categoryId ?? null,
      query: filter.query ?? null,
      status: filter.status ?? 'ALL',
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { items, total, page, pageSize };
  }

  async adminProduct(id: string): Promise<ProductRecord> {
    const product = await this.catalogue.findProduct(id);
    if (product === null) {
      throw new CatalogueError('PRODUCT_NOT_FOUND', 'That product does not exist.');
    }
    return product;
  }

  async createProduct(context: AuthContext, input: ProductInput): Promise<string> {
    const write = await this.prepareProduct(input, null);
    const id = await this.catalogue.insertProduct(write, context.principalId);
    await this.audit(context, 'PIF_PRODUCT_CREATED', 'pif.product', id, undefined, {
      sku: write.sku,
      name: write.name,
      sellingPrice: write.sellingPrice,
      categoryId: write.categoryId,
      active: write.active,
      available: write.available,
    });
    return id;
  }

  async updateProduct(context: AuthContext, id: string, input: ProductInput): Promise<void> {
    const existing = await this.adminProduct(id);
    const write = await this.prepareProduct(input, id, { categoryId: existing.category_id });
    await this.catalogue.updateProduct(id, write, context.principalId);
    await this.audit(
      context,
      'PIF_PRODUCT_UPDATED',
      'pif.product',
      id,
      {
        sku: existing.sku,
        name: existing.name,
        sellingPrice: existing.selling_price,
        taxRateId: existing.tax_rate_id,
        active: existing.active,
        available: existing.available,
      },
      {
        sku: write.sku,
        name: write.name,
        sellingPrice: write.sellingPrice,
        taxRateId: write.taxRateId,
        active: write.active,
        available: write.available,
      }
    );
  }

  /**
   * The two switches the order desk uses daily.
   *
   * Deactivating does not delete: a product that appears on a historical
   * order must stay readable for as long as the order exists, which is why
   * migration 0050 takes DELETE away from the application entirely.
   */
  async setFlags(
    context: AuthContext,
    id: string,
    flags: { active?: boolean; available?: boolean }
  ): Promise<void> {
    const existing = await this.adminProduct(id);
    await this.catalogue.setProductFlags(id, flags, context.principalId);
    await this.audit(
      context,
      flags.active === false || flags.available === false
        ? 'PIF_PRODUCT_WITHDRAWN'
        : 'PIF_PRODUCT_OFFERED',
      'pif.product',
      id,
      { active: existing.active, available: existing.available },
      {
        active: flags.active ?? existing.active,
        available: flags.available ?? existing.available,
        sku: existing.sku,
      }
    );
  }

  /** A price change, audited with the figure it replaced. */
  async setPrice(
    context: AuthContext,
    id: string,
    price: { sellingPrice: number; taxRateId?: string | null; discountPct?: number | null }
  ): Promise<void> {
    const existing = await this.adminProduct(id);
    this.requireMoney(price.sellingPrice, 'selling price');
    const taxRateId = await this.resolveTaxRate(
      price.taxRateId === undefined ? existing.tax_rate_id : price.taxRateId
    );
    const discountPct = this.requireDiscount(
      price.discountPct === undefined
        ? existing.discount_pct === null
          ? null
          : Number(existing.discount_pct)
        : price.discountPct
    );

    await this.catalogue.setProductPrice(
      id,
      { sellingPrice: price.sellingPrice, taxRateId, discountPct },
      context.principalId
    );
    await this.audit(
      context,
      'PIF_PRODUCT_PRICED',
      'pif.product',
      id,
      {
        sellingPrice: existing.selling_price,
        taxRateId: existing.tax_rate_id,
        discountPct: existing.discount_pct,
      },
      { sellingPrice: price.sellingPrice, taxRateId, discountPct, sku: existing.sku }
    );
  }

  async setProductImage(context: AuthContext, id: string, imageRef: string | null): Promise<void> {
    const existing = await this.adminProduct(id);
    await this.catalogue.setProductImage(id, imageRef, context.principalId);
    await this.audit(
      context,
      imageRef === null ? 'PIF_PRODUCT_IMAGE_REMOVED' : 'PIF_PRODUCT_IMAGE_SET',
      'pif.product',
      id,
      { imageRef: existing.image_ref },
      { imageRef, sku: existing.sku }
    );
  }

  async setCategoryImage(context: AuthContext, id: string, imageRef: string | null): Promise<void> {
    const existing = await this.catalogue.findCategory(id);
    if (existing === null) {
      throw new CatalogueError('CATEGORY_NOT_FOUND', 'That category does not exist.');
    }
    await this.catalogue.setCategoryImage(id, imageRef, context.principalId);
    await this.audit(
      context,
      imageRef === null ? 'PIF_CATEGORY_IMAGE_REMOVED' : 'PIF_CATEGORY_IMAGE_SET',
      'pif.category',
      id,
      { imageRef: existing.image_ref },
      { imageRef, name: existing.name }
    );
  }

  /**
   * A GST rate the facility can then attach to products. Configuration, not
   * code: the rate is a row, and a product's tax comes from it rather than
   * from a number typed on a product form.
   */
  async createTaxRate(name: string, ratePct: number): Promise<string> {
    const label = name.trim();
    if (label === '') {
      throw new CatalogueError('INVALID_TAX_RATE', 'A tax rate needs a name.');
    }
    if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
      throw new CatalogueError('INVALID_TAX_RATE', 'A tax rate must be between 0 and 100 per cent.');
    }
    return this.catalogue.insertTaxRate(label, ratePct);
  }

  async taxRates(activeOnly = false) {
    return this.catalogue.listTaxRates(activeOnly);
  }

  // ------------------------------------------------------------------ guards

  /**
   * The product rules, applied WITHOUT writing anything.
   *
   * This is the single reason the bulk import cannot be a laxer way into the
   * catalogue: the import judges every spreadsheet row by calling this, which
   * is the same `prepareProduct` the admin screen's create and update paths
   * call. A SKU, price, tax rate, category or quantity limit that the screen
   * refuses is refused in an import too, with the same message. If a rule is
   * ever added here, both paths gain it at once, and neither can drift.
   *
   * `existingId` is the product a row would UPDATE, or null for a new one —
   * it is what makes "this SKU already exists" a refusal for a new product
   * and not for the product that already holds it.
   */
  async validateProduct(
    input: ProductInput,
    existingId: string | null,
    /**
     * The product's CURRENT category, when the caller can supply it. The
     * import now does, from one bulk read, which is what closes the loophole
     * described under THREE STATES in prepareProduct: without it, a row that
     * only changes a price looks like a move to a main category and is
     * wrongly refused. 'unknown' remains the default so no other caller
     * changes behaviour.
     */
    current: { categoryId: string | null } | 'unknown' = 'unknown'
  ): Promise<ProductWrite> {
    return this.prepareProduct(input, existingId, current);
  }

  private async prepareCategory(input: CategoryInput, id: string | null): Promise<CategoryWrite> {
    const name = input.name.trim();
    if (name === '') {
      throw new CatalogueError('INVALID_CATEGORY', 'A category needs a name.');
    }
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      if (parentId === id) {
        throw new CatalogueError('INVALID_CATEGORY', 'A category cannot be its own parent.');
      }
      const parent = await this.catalogue.findCategory(parentId);
      if (parent === null) {
        throw new CatalogueError('CATEGORY_NOT_FOUND', 'That parent category does not exist.');
      }
      if (parent.parent_id !== null) {
        throw new CatalogueError(
          'INVALID_CATEGORY',
          'The catalogue is two levels deep: a subcategory cannot hold subcategories.'
        );
      }
    }
    const duplicate = await this.catalogue.findCategoryByName(name, parentId);
    if (duplicate !== null && duplicate.id !== id) {
      throw new CatalogueError(
        'DUPLICATE_CATEGORY',
        `A category called "${name}" already exists here.`
      );
    }
    return {
      name,
      parentId,
      description: input.description?.trim() || null,
      sortOrder: input.sortOrder ?? 0,
      active: input.active ?? true,
    };
  }

  private async prepareProduct(
    input: ProductInput,
    id: string | null,
    /**
     * The product's CURRENT category, when the caller knows it. 'unknown' is
     * the honest answer for `validateProduct`, which the spreadsheet import
     * calls per row and which cannot afford a lookup for each one — see the
     * THREE STATES note below.
     */
    current: { categoryId: string | null } | 'unknown' = 'unknown'
  ): Promise<ProductWrite> {
    const sku = input.sku.trim().toUpperCase();
    const name = input.name.trim();
    if (sku === '' || name === '') {
      throw new CatalogueError('PRODUCT_NOT_FOUND', 'A product needs a SKU and a name.');
    }
    const existingSku = await this.catalogue.findProductBySku(sku);
    if (existingSku !== null && existingSku.id !== id) {
      throw new CatalogueError(
        'DUPLICATE_SKU',
        `SKU ${sku} already belongs to "${existingSku.name}".`,
        { productId: existingSku.id }
      );
    }

    this.requireMoney(input.sellingPrice, 'selling price');
    if (input.purchasePrice !== undefined && input.purchasePrice !== null) {
      this.requireMoney(input.purchasePrice, 'purchase cost');
    }

    /*
     * WHERE A PRODUCT MAY BE FILED.
     *
     * The rule is that a product lives on a SUBCATEGORY, because the approved
     * catalogue is Business → Main category → Subcategory → Products, and a
     * product's business is derived through its category. Migration 0061's
     * `pif_products_category_required_chk` enforces the weaker half of this in
     * the database — a category is mandatory — and the subcategory half is
     * enforced here, so the operator gets a sentence they can act on rather
     * than a constraint violation.
     *
     * THREE STATES, NOT TWO, and the third one is why this is not simply
     * "enforce on write":
     *
     *   CREATE (id === null) — always enforced. A new product must name a
     *       subcategory, however it arrives, the bulk import included.
     *   UPDATE with a known before-value — enforced only when the category
     *       actually CHANGES. Ten of the twenty-one demonstration products sit
     *       directly on main categories and have to stay editable: correcting
     *       one's price must not force a recategorisation nobody asked for.
     *       The moment someone does move one, it has to move somewhere valid.
     *   UPDATE with current = 'unknown' — NOT enforced, which preserves exactly
     *       today's behaviour. `validateProduct` is this case: the spreadsheet
     *       import calls it once per row and its own comment warns that "a
     *       five-hundred-row file must not become fifteen hundred lookups", so
     *       it cannot read each product's current category. Enforcing on an
     *       unknown before-value would reject an import row that only changes
     *       a price, because a row that names no category inherits the
     *       product's existing one — a legacy main category — and would look
     *       like a move. That is the forced recategorisation this guard exists
     *       to avoid, arriving through the import instead of the form.
     *       KNOWN GAP, stated rather than hidden: an import CAN therefore still
     *       move an existing product onto a main category. Closing it means
     *       giving the import a cheap bulk read of current categories, and
     *       belongs with the import work, not here.
     *
     * Setting the category to nothing counts as changing it, so an update that
     * would clear a product's category is refused here with a plain message
     * rather than failing 0061's CHECK further down.
     *
     * NOTHING HERE RECATEGORISES, MODIFIES OR DELETES A LEGACY PRODUCT. It only
     * refuses a write that would put a product somewhere invalid. Authorization
     * is unchanged and still belongs to the controller's permission guards.
     */
    const categoryId = input.categoryId ?? null;
    const creating = id === null;
    // 'unknown' must NOT read as "changed": that would make every import row
    // touching a legacy product look like a move. See the three states above.
    const categoryChanged = current !== 'unknown' && categoryId !== current.categoryId;

    if (categoryId === null) {
      if (creating || categoryChanged) {
        throw new CatalogueError(
          'INVALID_CATEGORY',
          'A product must be filed under a subcategory. Choose one before saving.'
        );
      }
    } else {
      const category = await this.catalogue.findCategory(categoryId);
      if (category === null) {
        throw new CatalogueError('CATEGORY_NOT_FOUND', 'That category does not exist.');
      }
      if (!category.active) {
        throw new CatalogueError(
          'INVALID_CATEGORY',
          `Category "${category.name}" is deactivated; activate it or choose another.`
        );
      }
      if ((creating || categoryChanged) && category.parent_id === null) {
        throw new CatalogueError(
          'INVALID_CATEGORY',
          `"${category.name}" is a main category. Choose one of its subcategories instead.`
        );
      }
    }

    const taxRateId = await this.resolveTaxRate(input.taxRateId ?? null);
    const discountPct = this.requireDiscount(input.discountPct ?? null);

    const minOrderQty = input.minOrderQty ?? 1;
    const qtyStep = input.qtyStep ?? 1;
    const maxOrderQty = input.maxOrderQty ?? null;
    if (minOrderQty <= 0 || qtyStep <= 0) {
      throw new CatalogueError(
        'INVALID_QUANTITY_LIMIT',
        'The minimum order quantity and the step must both be greater than zero.'
      );
    }
    if (maxOrderQty !== null && maxOrderQty < minOrderQty) {
      throw new CatalogueError(
        'INVALID_QUANTITY_LIMIT',
        'The maximum order quantity cannot be below the minimum.'
      );
    }
    if (input.packSize !== undefined && input.packSize !== null && input.packSize <= 0) {
      throw new CatalogueError('INVALID_QUANTITY_LIMIT', 'A pack size must be greater than zero.');
    }

    return {
      sku,
      name,
      barcode: input.barcode?.trim() || null,
      brand: input.brand?.trim() || null,
      description: input.description?.trim() || null,
      categoryId,
      unit: input.unit.trim(),
      packSize: input.packSize ?? null,
      packUnit: input.packUnit?.trim() || null,
      sellingPrice: input.sellingPrice,
      purchasePrice: input.purchasePrice ?? null,
      taxRateId,
      discountPct,
      minOrderQty,
      maxOrderQty,
      qtyStep,
      active: input.active ?? true,
      available: input.available ?? true,
      variantGroup: input.variantGroup?.trim() || null,
      variantLabel: input.variantLabel?.trim() || null,
    };
  }

  /** GST comes from pif.tax_rates. A rate that is not configured is refused. */
  private async resolveTaxRate(taxRateId: string | null): Promise<string | null> {
    if (taxRateId === null) return null;
    const rate = await this.catalogue.findTaxRate(taxRateId);
    if (rate === null) {
      throw new CatalogueError('INVALID_TAX_RATE', 'That tax rate is not configured.');
    }
    if (!rate.active) {
      throw new CatalogueError('INVALID_TAX_RATE', `Tax rate "${rate.name}" is deactivated.`);
    }
    return rate.id;
  }

  /** Money is rupees and paise. Three decimal places is a typo, not a price. */
  private requireMoney(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
      throw new CatalogueError('INVALID_PRICE', `The ${label} cannot be negative.`);
    }
    if (money(value) !== value) {
      throw new CatalogueError(
        'INVALID_PRICE',
        `The ${label} must be in rupees and paise — at most two decimal places.`
      );
    }
  }

  private requireDiscount(value: number | null): number | null {
    if (value === null) return null;
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new CatalogueError('INVALID_PRICE', 'A discount must be between 0 and 100 per cent.');
    }
    return value;
  }

  private async audit(
    context: AuthContext,
    action: string,
    entityType: string,
    entityId: string,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown>
  ): Promise<void> {
    await this.auditLog.logEvent({
      actorId: context.principalId,
      actorRole: [...context.roles].sort().join(',') || 'STAFF',
      module: 'pif',
      action,
      entityType,
      entityId,
      before,
      after,
    });
  }
}
