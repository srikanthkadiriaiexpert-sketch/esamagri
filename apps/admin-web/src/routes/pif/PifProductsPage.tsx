import { useCallback, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useResource } from '../../lib/api/resource';
import { LoadingState, EmptyState, FailureState } from '../../design-system/States';
import {
  ConfigError,
  ConfigNotice,
  ConfigTable,
  FieldLabel,
  PrimaryButton,
  SecondaryButton,
  SelectInput,
  Td,
  TextInput,
  Th,
} from '../../design-system/ConfigUI';
import { ProductImage } from './ProductImage';
import {
  createProduct,
  fetchCategories,
  fetchProducts,
  fetchTaxRates,
  removeProductImage,
  rupees,
  setProductFlags,
  shopLabel,
  updateProduct,
  uploadProductImage,
  type PifCategory,
  type PifProduct,
  type PifTaxRate,
  type ProductInput,
} from '../../lib/api/pif-admin-api';

/**
 * The PIF product catalogue, managed by the client's own staff (PHASE F).
 *
 * THIS SCREEN IS THE REQUIREMENT. The facility must be able to add a
 * product, change its price, take it off the shelf for the day and put a
 * photograph on it — without a developer, a deployment or a migration. So
 * everything a grocery product needs is a field here: name, SKU, barcode,
 * brand, category, description, unit, pack size, price, GST rate, discount,
 * availability, order limits and variant labelling.
 *
 * NOTHING IS CALCULATED HERE. The price typed in is stored; what a customer
 * pays is computed by the server from that row at the moment they order. A
 * total shown anywhere in this console came from the server.
 *
 * THE IMAGE IS A REAL UPLOAD. The file is read from the administrator's
 * computer and posted as multipart to the API, which checks its magic bytes,
 * generates the filename and decides where it lands. No path, name or type
 * from this screen is trusted, and a product with no image shows a
 * placeholder rather than a broken picture.
 *
 * NO STOCK QUANTITY. "Available" is a switch the facility sets for the day;
 * "active" says the product exists at all. Neither is a counted balance, and
 * there is no field here for one, because PIF holds no inventory.
 */

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'UNAVAILABLE';

const EMPTY_FORM = {
  sku: '',
  name: '',
  barcode: '',
  brand: '',
  description: '',
  categoryId: '',
  unit: 'kg',
  packSize: '',
  packUnit: '',
  sellingPrice: '',
  taxRateId: '',
  discountPct: '',
  minOrderQty: '1',
  maxOrderQty: '',
  qtyStep: '1',
  variantGroup: '',
  variantLabel: '',
  active: true,
  available: true,
};

type FormState = typeof EMPTY_FORM;

export function PifProductsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(1);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  const products = useResource<{ items: PifProduct[]; total: number; page: number; pageSize: number }>(
    () => fetchProducts({ q: query, categoryId: categoryFilter, status: statusFilter, page }),
    [reloadKey, query, categoryFilter, statusFilter, page]
  );
  const categories = useResource<{ items: PifCategory[] }>(() => fetchCategories(), [reloadKey]);
  const taxRates = useResource<{ items: PifTaxRate[] }>(() => fetchTaxRates(), [reloadKey]);

  const [editing, setEditing] = useState<PifProduct | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const categoryOptions = useMemo(() => {
    if (categories.status !== 'success') return [];
    return categories.data.items.filter((c) => c.active);
  }, [categories]);

  /**
   * The same options, grouped by shop.
   *
   * 164 approved categories across two businesses is too many for a flat
   * list, and a name on its own does not say which shop it belongs to --
   * "Vegetables" could be either. The server already returns them in shop
   * order, so walking the list and starting a new group when the shop
   * changes preserves that order rather than imposing another.
   */
  const categoryGroups = useMemo(() => {
    const groups: Array<{ shop: string; items: PifCategory[] }> = [];
    for (const category of categoryOptions) {
      const shop = shopLabel(category.businessSlug);
      const last = groups[groups.length - 1];
      if (last !== undefined && last.shop === shop) last.items.push(category);
      else groups.push({ shop, items: [category] });
    }
    return groups;
  }, [categoryOptions]);

  const set = (patch: Partial<FormState>) => setForm((previous) => ({ ...previous, ...patch }));

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError(null);
    setNotice(null);
  };

  const openEdit = (product: PifProduct) => {
    setEditing(product);
    setForm({
      sku: product.sku,
      name: product.name,
      barcode: product.barcode ?? '',
      brand: product.brand ?? '',
      description: product.description ?? '',
      categoryId: product.categoryId ?? '',
      unit: product.unit,
      packSize: product.packSize === null ? '' : String(product.packSize),
      packUnit: product.packUnit ?? '',
      sellingPrice: String(product.price),
      taxRateId: product.taxRateId ?? '',
      discountPct: product.discountPct === null ? '' : String(product.discountPct),
      minOrderQty: String(product.minOrderQty),
      maxOrderQty: product.maxOrderQty === null ? '' : String(product.maxOrderQty),
      qtyStep: String(product.qtyStep),
      variantGroup: product.variantGroup ?? '',
      variantLabel: product.variantLabel ?? '',
      active: product.active,
      available: product.available,
    });
    setShowForm(true);
    setError(null);
    setNotice(null);
  };

  const payload = (): ProductInput => ({
    sku: form.sku.trim(),
    name: form.name.trim(),
    barcode: form.barcode.trim() === '' ? null : form.barcode.trim(),
    brand: form.brand.trim() === '' ? null : form.brand.trim(),
    description: form.description.trim() === '' ? null : form.description.trim(),
    categoryId: form.categoryId === '' ? null : form.categoryId,
    unit: form.unit.trim(),
    packSize: form.packSize === '' ? null : Number(form.packSize),
    packUnit: form.packUnit.trim() === '' ? null : form.packUnit.trim(),
    sellingPrice: Number(form.sellingPrice),
    taxRateId: form.taxRateId === '' ? null : form.taxRateId,
    discountPct: form.discountPct === '' ? null : Number(form.discountPct),
    minOrderQty: form.minOrderQty === '' ? 1 : Number(form.minOrderQty),
    maxOrderQty: form.maxOrderQty === '' ? null : Number(form.maxOrderQty),
    qtyStep: form.qtyStep === '' ? 1 : Number(form.qtyStep),
    active: form.active,
    available: form.available,
    variantGroup: form.variantGroup.trim() === '' ? null : form.variantGroup.trim(),
    variantLabel: form.variantLabel.trim() === '' ? null : form.variantLabel.trim(),
  });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (editing === null) {
        const created = await createProduct(payload());
        setNotice(`${created.sku} — "${form.name.trim()}" was added.`);
        setForm(EMPTY_FORM);
      } else {
        await updateProduct(editing.id, payload());
        setNotice(`"${form.name.trim()}" was saved.`);
      }
      setShowForm(editing !== null);
      reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const onToggle = async (product: PifProduct, flags: { active?: boolean; available?: boolean }) => {
    setError(null);
    setNotice(null);
    try {
      await setProductFlags(product.id, flags);
      setNotice(`"${product.name}" was updated.`);
      reload();
    } catch (err) {
      setError(err);
    }
  };

  const onPickImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || editing === null) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const uploaded = await uploadProductImage(editing.id, file);
      setNotice(`The picture was uploaded (${Math.round(uploaded.bytes / 1024)} KB).`);
      setEditing({ ...editing, imageUrl: uploaded.imageUrl, imageRef: uploaded.imageRef });
      reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onRemoveImage = async () => {
    if (editing === null) return;
    setError(null);
    try {
      await removeProductImage(editing.id);
      setEditing({ ...editing, imageUrl: null, imageRef: null });
      setNotice('The picture was removed.');
      reload();
    } catch (err) {
      setError(err);
    }
  };

  const total = products.status === 'success' ? products.data.total : 0;
  const pageSize = products.status === 'success' ? products.data.pageSize : 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Product catalogue</h1>
          <p className="mt-1 text-sm text-slate-600">
            Everything a customer can buy. Prices, GST and availability are set here.
          </p>
        </div>
        <PrimaryButton type="button" onClick={openNew}>
          Add a product
        </PrimaryButton>
      </header>

      {notice ? <ConfigNotice>{notice}</ConfigNotice> : null}
      {error ? <ConfigError error={error} /> : null}

      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3">
        <FieldLabel label="Search" hint="Name, brand, SKU or barcode.">
          <TextInput
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search the catalogue…"
          />
        </FieldLabel>
        <FieldLabel label="Category">
          <SelectInput
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All categories</option>
            {categoryGroups.map((group) => (
              <optgroup key={group.items[0]?.id ?? group.shop} label={group.shop}>
                {group.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentName === null ? c.name : `${c.parentName} › ${c.name}`}
                  </option>
                ))}
              </optgroup>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Status">
          <SelectInput
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
              setPage(1);
            }}
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">Active only</option>
            <option value="INACTIVE">Deactivated</option>
            <option value="UNAVAILABLE">Out of stock today</option>
          </SelectInput>
        </FieldLabel>
      </section>

      {showForm ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-slate-900">
            {editing === null ? 'New product' : `Editing ${editing.sku}`}
          </h2>

          <form onSubmit={onSubmit} className="mt-3 grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Product name">
              <TextInput value={form.name} onChange={(e) => set({ name: e.target.value })} required minLength={2} maxLength={160} />
            </FieldLabel>
            <FieldLabel label="SKU / product code" hint="The facility's own code; also how billing identifies it.">
              <TextInput value={form.sku} onChange={(e) => set({ sku: e.target.value })} required minLength={2} maxLength={60} />
            </FieldLabel>
            <FieldLabel label="Brand" hint="Optional.">
              <TextInput value={form.brand} onChange={(e) => set({ brand: e.target.value })} maxLength={80} />
            </FieldLabel>
            <FieldLabel label="Barcode" hint="Optional.">
              <TextInput value={form.barcode} onChange={(e) => set({ barcode: e.target.value })} maxLength={60} />
            </FieldLabel>
            <FieldLabel label="Category">
              <SelectInput value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                <option value="">— none —</option>
                {categoryGroups.map((group) => (
                  <optgroup key={group.items[0]?.id ?? group.shop} label={group.shop}>
                    {group.items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.parentName === null ? c.name : `${c.parentName} › ${c.name}`}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </SelectInput>
            </FieldLabel>
            <FieldLabel label="Unit of measure" hint="kg, l, packet, tin…">
              <TextInput value={form.unit} onChange={(e) => set({ unit: e.target.value })} required maxLength={20} />
            </FieldLabel>
            <FieldLabel label="Pack size" hint="Optional — e.g. 1 for a 1 kg pack.">
              <TextInput type="number" step="0.001" min="0.001" value={form.packSize} onChange={(e) => set({ packSize: e.target.value })} />
            </FieldLabel>
            <FieldLabel label="Pack unit" hint="Optional — the unit the pack size is in.">
              <TextInput value={form.packUnit} onChange={(e) => set({ packUnit: e.target.value })} maxLength={20} />
            </FieldLabel>
            <FieldLabel label="Selling price (₹)" hint="Rupees and paise.">
              <TextInput
                type="number"
                step="0.01"
                min="0"
                value={form.sellingPrice}
                onChange={(e) => set({ sellingPrice: e.target.value })}
                required
              />
            </FieldLabel>
            <FieldLabel label="GST rate" hint="Configured rates only.">
              <SelectInput value={form.taxRateId} onChange={(e) => set({ taxRateId: e.target.value })}>
                <option value="">— no tax —</option>
                {taxRates.status === 'success'
                  ? taxRates.data.items
                      .filter((rate) => rate.active)
                      .map((rate) => (
                        <option key={rate.id} value={rate.id}>
                          {rate.name} ({rate.ratePct}%)
                        </option>
                      ))
                  : null}
              </SelectInput>
            </FieldLabel>
            <FieldLabel label="Discount %" hint="Optional.">
              <TextInput type="number" step="0.01" min="0" max="100" value={form.discountPct} onChange={(e) => set({ discountPct: e.target.value })} />
            </FieldLabel>
            <FieldLabel label="Minimum order quantity">
              <TextInput type="number" step="0.001" min="0.001" value={form.minOrderQty} onChange={(e) => set({ minOrderQty: e.target.value })} />
            </FieldLabel>
            <FieldLabel label="Maximum per order" hint="Blank means no limit. NOT a stock level.">
              <TextInput type="number" step="0.001" min="0.001" value={form.maxOrderQty} onChange={(e) => set({ maxOrderQty: e.target.value })} />
            </FieldLabel>
            <FieldLabel label="Quantity step" hint="e.g. 0.5 to sell in half kilos.">
              <TextInput type="number" step="0.001" min="0.001" value={form.qtyStep} onChange={(e) => set({ qtyStep: e.target.value })} />
            </FieldLabel>
            <FieldLabel label="Variant group" hint="Same text on each size of one product.">
              <TextInput value={form.variantGroup} onChange={(e) => set({ variantGroup: e.target.value })} maxLength={80} />
            </FieldLabel>
            <FieldLabel label="Variant label" hint="e.g. 500 g, 1 kg.">
              <TextInput value={form.variantLabel} onChange={(e) => set({ variantLabel: e.target.value })} maxLength={60} />
            </FieldLabel>
            <FieldLabel label="Description" hint="Optional; shown on the product page.">
              <TextInput value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} />
            </FieldLabel>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
                In the catalogue (deactivate to hide it from customers entirely)
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.available} onChange={(e) => set({ available: e.target.checked })} />
                Available to order today
              </label>
            </div>

            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <PrimaryButton type="submit" disabled={busy}>
                {busy ? 'Saving…' : editing === null ? 'Add product' : 'Save changes'}
              </PrimaryButton>
              <SecondaryButton type="button" onClick={() => setShowForm(false)}>
                Close
              </SecondaryButton>
            </div>
          </form>

          {editing === null ? (
            <p className="mt-3 text-xs text-slate-500">
              Add the product first; its picture can be uploaded once it exists.
            </p>
          ) : (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-800">Product picture</h3>
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <ProductImage
                  url={editing.imageUrl}
                  alt={`${editing.name} picture`}
                  className="h-24 w-24 rounded-lg object-cover"
                  fallback={
                    <div
                      role="img"
                      aria-label="No picture"
                      className="flex h-24 w-24 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500"
                    >
                      No picture
                    </div>
                  }
                />
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="Choose a product picture"
                    onChange={(e) => void onPickImage(e)}
                    className="text-sm"
                  />
                  <p className="text-xs text-slate-500">PNG, JPEG or WebP. The file is checked by its contents.</p>
                  {editing.imageUrl === null ? null : (
                    <SecondaryButton type="button" onClick={() => void onRemoveImage()}>
                      Remove picture
                    </SecondaryButton>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {products.status === 'loading' ? <LoadingState label="Loading products…" /> : null}
      {products.status === 'error' ? <FailureState error={products.error} onRetry={reload} /> : null}
      {products.status === 'not_implemented' ? (
        <EmptyState title="Not available" description="The PIF product route is not available." />
      ) : null}

      {products.status === 'success' ? (
        products.data.items.length === 0 ? (
          <EmptyState
            title="No products match"
            description="Change the search or the filters, or add a product."
          />
        ) : (
          <>
            <ConfigTable
              caption="PIF products"
              head={
                <>
                  <Th>Picture</Th>
                  <Th>Product</Th>
                  <Th>Category</Th>
                  <Th>Price</Th>
                  <Th>GST</Th>
                  <Th>Limits</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </>
              }
            >
              {products.data.items.map((product) => (
                <tr key={product.id} className={product.active ? '' : 'bg-slate-50 text-slate-500'}>
                  <Td>
                    <ProductImage
                      url={product.imageUrl}
                      alt={`${product.name} picture`}
                      className="h-10 w-10 rounded object-cover"
                      fallback={
                        <span className="flex h-10 w-10 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-500">
                          none
                        </span>
                      }
                    />
                  </Td>
                  <Td>
                    <span className="font-semibold">{product.name}</span>
                    <span className="block text-xs text-slate-500">
                      {product.sku}
                      {product.brand === null ? '' : ` · ${product.brand}`}
                      {product.variantLabel === null ? '' : ` · ${product.variantLabel}`}
                    </span>
                  </Td>
                  <Td>
                    {product.categoryName ?? '—'}
                    {product.parentCategoryName === null ? null : (
                      <span className="block text-xs text-slate-500">{product.parentCategoryName}</span>
                    )}
                  </Td>
                  <Td numeric>
                    {rupees(product.price)}
                    <span className="block text-xs text-slate-500">per {product.unit}</span>
                    {product.discountPct === null ? null : (
                      <span className="block text-xs text-amber-700">−{product.discountPct}%</span>
                    )}
                  </Td>
                  <Td numeric>{product.taxRatePct}%</Td>
                  <Td numeric>
                    {product.minOrderQty}
                    {product.maxOrderQty === null ? '+' : `–${product.maxOrderQty}`}
                    <span className="block text-xs text-slate-500">step {product.qtyStep}</span>
                  </Td>
                  <Td>
                    <span className="block">{product.active ? 'In catalogue' : 'Deactivated'}</span>
                    <span className={product.available ? 'block text-xs text-emerald-700' : 'block text-xs text-amber-700'}>
                      {product.available ? 'Available' : 'Out of stock today'}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      <SecondaryButton type="button" onClick={() => openEdit(product)}>
                        Edit
                      </SecondaryButton>
                      <SecondaryButton
                        type="button"
                        onClick={() => void onToggle(product, { available: !product.available })}
                      >
                        {product.available ? 'Mark out of stock' : 'Mark available'}
                      </SecondaryButton>
                      <SecondaryButton
                        type="button"
                        onClick={() => void onToggle(product, { active: !product.active })}
                      >
                        {product.active ? 'Deactivate' : 'Activate'}
                      </SecondaryButton>
                    </div>
                  </Td>
                </tr>
              ))}
            </ConfigTable>

            <nav className="flex items-center justify-between gap-3" aria-label="Catalogue pages">
              <p className="text-sm text-slate-600">
                {total} product(s) · page {products.data.page} of {pages}
              </p>
              <div className="flex gap-2">
                <SecondaryButton type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </SecondaryButton>
                <SecondaryButton type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </SecondaryButton>
              </div>
            </nav>
          </>
        )
      ) : null}
    </div>
  );
}
