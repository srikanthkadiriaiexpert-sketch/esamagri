import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../../lib/api/resource';
import {
  createPool,
  fetchPools,
  setPoolActive,
  updatePool,
  type ConfigPool,
  type RationType,
} from '../../lib/api/rik-config-api';
import { LoadingState, EmptyState, FailureState } from '../../design-system/States';
import {
  AddPanel,
  ConfigError,
  ConfigNotice,
  ConfigTable,
  EffectiveWindow,
  FieldLabel,
  PrimaryButton,
  RuleStatus,
  SecondaryButton,
  SelectInput,
  Td,
  TextInput,
  Th,
  todayIso,
} from '../../design-system/ConfigUI';

/**
 * Entitlement pools — screen 1 of 7 (STEP 11C).
 *
 * A pool is a category of entitlement that is spent as a single
 * balance: everything drawn against it consumes the same allowance.
 * Two items that share a pool compete for it; two items in separate
 * pools do not. That is the whole of the rule, and it is expressed by
 * which pool a provision points at — never by code.
 *
 * Retired and future-dated pools are listed alongside live ones,
 * because an administrator's job includes reading the rule that is no
 * longer in force. The status column says which is which.
 *
 * STEP 14B added one presentation field: the category's cover picture,
 * shown to a customer on the Know Your Ration list. It is a picture of
 * the WHOLE allowance and is not a provision picture — those are managed
 * on the SKU master and neither stands in for the other. It is edited
 * here on its own, without opening the pool's rule-bearing fields: a
 * pool's name, unit and ration type decide what is calculated, and are
 * deliberately not editable from this row.
 */
const RATION_TYPES: readonly RationType[] = ['FRESH', 'DRY'];
const UNITS = ['g', 'ml', 'piece'] as const;

export function PoolsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const pools = useResource(() => fetchPools(), [reloadKey]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const toggleActive = async (pool: ConfigPool) => {
    setRowError(null);
    setNotice(null);
    setBusyId(pool.id);
    try {
      await setPoolActive(pool.id, !pool.isActive);
      setNotice(`${pool.name} is now ${pool.isActive ? 'retired' : 'in force'}.`);
      reload();
    } catch (err: unknown) {
      setRowError(err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-slate-600">
        A pool is one entitlement balance. Every provision draws from exactly one pool, so two items sharing a pool
        share the allowance and two items in different pools do not.
      </p>

      <AddPanel title="Add an entitlement pool" open={adding} onToggle={() => setAdding((v) => !v)}>
        <CreatePoolForm
          onCreated={(pool) => {
            setAdding(false);
            setNotice(`Created ${pool.name}.`);
            reload();
          }}
        />
      </AddPanel>

      <ConfigNotice>{notice}</ConfigNotice>
      <ConfigError error={rowError} />

      {pools.status === 'loading' ? <LoadingState label="Loading entitlement pools…" /> : null}
      {pools.status === 'error' ? <FailureState error={pools.error} onRetry={reload} /> : null}
      {pools.status === 'not_implemented' ? <EmptyState title="Entitlement pools are not available yet." /> : null}

      {pools.status === 'success' ? (
        pools.data.items.length === 0 ? (
          <EmptyState
            title="No entitlement pools are configured"
            description="Add a pool before adding the daily scales and provisions that depend on it."
          />
        ) : (
          <ConfigTable
            caption="RIK entitlement pools"
            head={
              <>
                <Th>Pool</Th>
                <Th>Ration</Th>
                <Th>Unit</Th>
                <Th>Category image</Th>
                <Th>Effective</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </>
            }
          >
            {pools.data.items.map((pool) => (
              <tr key={pool.id} className="border-b border-slate-100 last:border-0">
                <Td>
                  <p className="font-semibold text-slate-800">{pool.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-slate-500">{pool.code}</p>
                </Td>
                <Td>{pool.rationType}</Td>
                <Td>{pool.unit}</Td>
                <Td>
                  {editingId === pool.id ? (
                    <CategoryImageEditor
                      pool={pool}
                      onCancel={() => setEditingId(null)}
                      onSaved={(message) => {
                        setEditingId(null);
                        setNotice(message);
                        reload();
                      }}
                      onError={setRowError}
                    />
                  ) : pool.imageRef ? (
                    <span className="font-mono text-xs text-slate-600">{pool.imageRef}</span>
                  ) : (
                    <span className="text-xs text-slate-400">No image</span>
                  )}
                </Td>
                <Td>
                  <EffectiveWindow from={pool.effectiveFrom} to={pool.effectiveTo} />
                </Td>
                <Td>
                  <RuleStatus
                    isActive={pool.isActive}
                    effectiveFrom={pool.effectiveFrom}
                    effectiveTo={pool.effectiveTo}
                  />
                </Td>
                <Td>
                  {editingId === pool.id ? null : (
                    <div className="flex flex-wrap gap-2">
                      <SecondaryButton
                        onClick={() => {
                          setRowError(null);
                          setNotice(null);
                          setEditingId(pool.id);
                        }}
                      >
                        Image
                      </SecondaryButton>
                      <SecondaryButton disabled={busyId === pool.id} onClick={() => void toggleActive(pool)}>
                        {pool.isActive ? 'Retire' : 'Restore'}
                      </SecondaryButton>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </ConfigTable>
        )
      ) : null}

      <p className="text-xs text-slate-500">
        A pool is retired, never deleted — a confirmed issue keeps a snapshot of the rules it was calculated under, and
        that record has to stay readable. Retiring removes the pool from every future calculation immediately.
      </p>
    </div>
  );
}

/**
 * The category picture, and nothing else.
 *
 * Deliberately narrow: this row edits one presentation field and leaves
 * the pool's rule-bearing fields — name, unit, ration type, dates —
 * alone. Those decide what is calculated for every officer on the pool,
 * and changing them is not something to offer beside a picture path.
 * Clearing the box removes the picture and the customer card falls back
 * to its placeholder, which is a legitimate state.
 */
function CategoryImageEditor({
  pool,
  onCancel,
  onSaved,
  onError,
}: {
  pool: ConfigPool;
  onCancel: () => void;
  onSaved: (message: string) => void;
  onError: (err: unknown) => void;
}) {
  const [imageRef, setImageRef] = useState(pool.imageRef ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const value = imageRef.trim() === '' ? null : imageRef.trim();
      await updatePool(pool.id, { imageRef: value });
      onSaved(value === null ? `Removed the category image for ${pool.name}.` : `Updated the category image for ${pool.name}.`);
    } catch (err: unknown) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-64 flex-col gap-2">
      <TextInput
        aria-label={`Category image for ${pool.code}`}
        placeholder="Leave blank for no image"
        value={imageRef}
        onChange={(e) => setImageRef(e.target.value)}
        maxLength={500}
      />
      <div className="flex gap-2">
        <SecondaryButton disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </SecondaryButton>
        <SecondaryButton disabled={busy} onClick={onCancel}>
          Cancel
        </SecondaryButton>
      </div>
    </div>
  );
}

function CreatePoolForm({ onCreated }: { onCreated: (pool: ConfigPool) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [rationType, setRationType] = useState<RationType>('DRY');
  const [unit, setUnit] = useState<string>('g');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [imageRef, setImageRef] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const pool = await createPool({
        code: code.trim(),
        name: name.trim(),
        rationType,
        unit,
        description: description.trim() === '' ? null : description.trim(),
        imageRef: imageRef.trim() === '' ? null : imageRef.trim(),
        effectiveFrom,
      });
      setCode('');
      setName('');
      setDescription('');
      onCreated(pool);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldLabel label="Code" hint="Letters, digits and underscores. Used by the engine, not shown to officers.">
          <TextInput value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={60} required />
        </FieldLabel>
        <FieldLabel label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </FieldLabel>
        <FieldLabel label="Ration type">
          <SelectInput value={rationType} onChange={(e) => setRationType(e.target.value as RationType)}>
            {RATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Unit">
          <SelectInput value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Effective from" hint="The pool is invisible to any calculation dated before this.">
          <TextInput type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
        </FieldLabel>
        <FieldLabel label="Description (optional)">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </FieldLabel>
        <FieldLabel label="Category image" hint="Shown on the customer's category list. Blank shows a placeholder.">
          <TextInput value={imageRef} onChange={(e) => setImageRef(e.target.value)} maxLength={500} />
        </FieldLabel>
      </div>

      <ConfigError error={error} />

      <div className="mt-4">
        <PrimaryButton disabled={busy}>{busy ? 'Saving…' : 'Add pool'}</PrimaryButton>
      </div>
    </form>
  );
}
