import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../../lib/api/resource';
import { LoadingState, EmptyState, FailureState } from '../../design-system/States';
import {
  AddPanel,
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
import {
  createCategory,
  fetchCategories,
  shopLabel,
  updateCategory,
  type PifCategory,
} from '../../lib/api/pif-admin-api';

/**
 * PIF categories and subcategories — managed by the client (PHASE F).
 *
 * TWO LEVELS, deliberately: a category, and subcategories under it. The
 * server refuses a third level, and this screen only offers top-level
 * categories as parents, so the shape of the taxonomy is the same whether it
 * is typed here or posted by anything else.
 *
 * DEACTIVATE, NEVER DELETE. A category that still holds products or
 * subcategories cannot be switched off — the server refuses it, and the
 * refusal appears here in the facility's own words rather than as a failure.
 * Nothing on this screen deletes anything, because a deleted category would
 * strand the products filed under it and the orders that name them.
 */
export function PifCategoriesPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const categories = useResource<{ items: PifCategory[] }>(() => fetchCategories(), [reloadKey]);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  // Open by default: this screen exists to add and arrange categories, and a
  // collapsed form would hide the only thing on it that writes.
  const [addOpen, setAddOpen] = useState(true);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tops = categories.status === 'success' ? categories.data.items.filter((c) => c.parentId === null) : [];

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await createCategory({
        name: name.trim(),
        parentId: parentId === '' ? null : parentId,
        description: description.trim() === '' ? null : description.trim(),
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
      });
      setNotice(`"${name.trim()}" was added.`);
      setName('');
      setDescription('');
      reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (category: PifCategory) => {
    setError(null);
    setNotice(null);
    try {
      await updateCategory(category.id, {
        name: category.name,
        parentId: category.parentId,
        description: category.description,
        sortOrder: category.sortOrder,
        active: !category.active,
      });
      setNotice(`"${category.name}" is now ${category.active ? 'inactive' : 'active'}.`);
      reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Product categories</h1>
        <p className="mt-1 text-sm text-slate-600">
          Two levels: a category, and the subcategories under it. Customers browse these.
        </p>
      </header>

      {notice ? <ConfigNotice>{notice}</ConfigNotice> : null}
      {error ? <ConfigError error={error} /> : null}

      <AddPanel title="Add a category" open={addOpen} onToggle={() => setAddOpen((v) => !v)}>
        <p className="mb-3 text-sm text-slate-600">
          A subcategory needs a parent; leave the parent blank for a top-level category.
        </p>
        <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Name">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              placeholder="e.g. Pulses"
            />
          </FieldLabel>
          <FieldLabel label="Parent category" hint="Blank means this is a top-level category.">
            <SelectInput value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— none (top level) —</option>
              {tops.map((c) => (
                <option key={c.id} value={c.id}>
                  {/* The shop is a prefix, not a decoration: a category with
                      no shop shows its own name alone rather than a stray
                      separator. */}
                  {c.businessSlug === null || c.businessSlug === undefined
                    ? c.name
                    : `${shopLabel(c.businessSlug)} › ${c.name}`}
                </option>
              ))}
            </SelectInput>
          </FieldLabel>
          <FieldLabel label="Description" hint="Optional.">
            <TextInput
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </FieldLabel>
          <FieldLabel label="Sort order" hint="Lower numbers come first.">
            <TextInput
              type="number"
              min={0}
              max={9999}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </FieldLabel>
          <div className="sm:col-span-2">
            <PrimaryButton type="submit" disabled={busy || name.trim().length < 2}>
              {busy ? 'Adding…' : 'Add category'}
            </PrimaryButton>
          </div>
        </form>
      </AddPanel>

      {categories.status === 'loading' ? <LoadingState label="Loading categories…" /> : null}
      {categories.status === 'error' ? <FailureState error={categories.error} onRetry={reload} /> : null}
      {categories.status === 'not_implemented' ? (
        <EmptyState title="Not available" description="The PIF category route is not available." />
      ) : null}

      {categories.status === 'success' ? (
        categories.data.items.length === 0 ? (
          <EmptyState
            title="No categories yet"
            description="Add the first category above, then file products under it."
          />
        ) : (
          <ConfigTable
            caption="PIF categories"
            head={
              <>
                <Th>Shop</Th>
                <Th>Category</Th>
                <Th>Parent</Th>
                <Th>Products</Th>
                <Th>Order</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </>
            }
          >
            {categories.data.items.map((category) => (
              <tr key={category.id} className={category.active ? '' : 'bg-slate-50 text-slate-500'}>
                <Td>{shopLabel(category.businessSlug)}</Td>
                <Td>
                  <span className="font-semibold">{category.name}</span>
                  {category.description === null ? null : (
                    <span className="block text-xs text-slate-500">{category.description}</span>
                  )}
                </Td>
                <Td>{category.parentName ?? '—'}</Td>
                <Td numeric>{category.productCount}</Td>
                <Td numeric>{category.sortOrder}</Td>
                <Td>{category.active ? 'Active' : 'Inactive'}</Td>
                <Td>
                  <SecondaryButton type="button" onClick={() => void toggle(category)}>
                    {category.active ? 'Deactivate' : 'Activate'}
                  </SecondaryButton>
                </Td>
              </tr>
            ))}
          </ConfigTable>
        )
      ) : null}

      <p className="text-xs leading-relaxed text-slate-500">
        Categories are deactivated, never deleted — a product or a past order may still refer to
        one. A category holding products or subcategories cannot be deactivated until those are
        moved.
      </p>
    </div>
  );
}
