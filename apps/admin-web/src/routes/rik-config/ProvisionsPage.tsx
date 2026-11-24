import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../../lib/api/resource';
import {
  createProvision,
  fetchPoolsForProvisions,
  fetchProvisions,
  removeProvisionImage,
  setProvisionActive,
  updateProvision,
  uploadProvisionImage,
  type ConfigPool,
  type ConfigProvision,
  type DietaryPreference,
  type PackUnit,
  type RationType,
  PACK_UNITS,
} from '../../lib/api/rik-config-api';
import { ImageUploadField, Thumbnail } from '../../design-system/ImageUploadField';
import { mediaUrl, isCatalogueAsset } from '../../lib/api/media-url';
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
 * Provisions — the SKU master, screen 4 of 7 (STEP 11C).
 *
 * A provision is an item an officer can actually take, and its
 * consumption ratio is the only number that connects it to entitlement:
 *
 *     pool units consumed = quantity taken x consumption ratio
 *
 * A ratio of 1 means one unit of the item spends one unit of the pool.
 * A ratio of 4.5 means the item is rich — one unit spends four and a
 * half. A ratio below 1 means the opposite. Every "1 kg of X equals
 * 4.5 kg of Y" rule in the specification is one of these numbers, which
 * is why none of them appears anywhere in the calculation code.
 *
 * The pool a provision points at decides what it competes with. Two
 * provisions on one pool share a balance; move one to another pool and
 * they stop competing. That is a data change, not a code change.
 *
 * Screens 5 and 6 edit other columns of this same table. They are
 * separate screens because they answer different questions, not because
 * there is another table behind them — and each says so.
 *
 * STEP 12A added three catalogue fields to this screen. They describe
 * the item; none of them reaches the calculation:
 *
 *   Brand        who makes it. A field of its own, so Paneer stocked
 *                from two dairies is two rows of one provision name
 *                rather than two differently-named provisions. Never
 *                write the brand into the name.
 *   Pack unit    what the container is called — packet, tin, box and
 *                so on. This is NOT the unit beside it: that one is the
 *                entitlement unit the ratio is applied in, and only g,
 *                ml and piece can be calculated with.
 *   Image        a reference to a picture held in storage. Blank is
 *                normal and the customer screen shows a placeholder;
 *                nothing invents a picture.
 */
const UNITS = ['g', 'ml', 'piece'] as const;
const RATION_TYPES: readonly RationType[] = ['FRESH', 'DRY'];
const DIETS: readonly DietaryPreference[] = ['PV', 'EV', 'NV'];

export function ProvisionsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [poolFilter, setPoolFilter] = useState('');
  const pools = useResource(() => fetchPoolsForProvisions(), []);
  const provisions = useResource(() => fetchProvisions(poolFilter || null), [reloadKey, poolFilter]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const poolOptions: ConfigPool[] = pools.status === 'success' ? pools.data.items : [];

  const toggle = async (provision: ConfigProvision) => {
    setRowError(null);
    setNotice(null);
    setBusyId(provision.id);
    try {
      await setProvisionActive(provision.id, !provision.isActive);
      setNotice(`${provision.name} is now ${provision.isActive ? 'retired' : 'in force'}.`);
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
        The items entitlement is spent on. The{' '}
        <strong className="font-semibold text-slate-800">consumption ratio</strong> is how many pool units one unit of
        the item costs — 1 for a like-for-like item, 4.5 where one unit of the item is worth four and a half of the
        pool.
      </p>

      <AddPanel title="Add a provision" open={adding} onToggle={() => setAdding((v) => !v)}>
        <CreateProvisionForm
          pools={poolOptions}
          onCreated={(provision) => {
            setAdding(false);
            setNotice(`Created ${provision.name}.`);
            reload();
          }}
        />
      </AddPanel>

      <FieldLabel label="Show one pool only">
        <SelectInput value={poolFilter} onChange={(e) => setPoolFilter(e.target.value)}>
          <option value="">All pools</option>
          {poolOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectInput>
      </FieldLabel>

      <ConfigNotice>{notice}</ConfigNotice>
      <ConfigError error={rowError} />

      {provisions.status === 'loading' ? <LoadingState label="Loading provisions…" /> : null}
      {provisions.status === 'error' ? <FailureState error={provisions.error} onRetry={reload} /> : null}
      {provisions.status === 'not_implemented' ? <EmptyState title="Provisions are not available yet." /> : null}

      {provisions.status === 'success' ? (
        provisions.data.items.length === 0 ? (
          <EmptyState
            title="No provisions are configured"
            description="An officer sees nothing to choose until a pool has at least one provision."
          />
        ) : (
          <ConfigTable
            caption="RIK provisions (SKU master)"
            head={
              <>
                <Th>Provision</Th>
                <Th>Image</Th>
                <Th>Brand</Th>
                <Th>Pool</Th>
                <Th>Unit</Th>
                <Th>Ratio</Th>
                <Th>Effective</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </>
            }
          >
            {provisions.data.items.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 align-top last:border-0">
                <Td>
                  <p className="font-semibold text-slate-800">{p.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-slate-500">{p.code}</p>
                </Td>
                <Td>
                  {editingId === p.id ? (
                    <div className="w-60">
                      <ImageUploadField
                        label={p.code}
                        imageRef={p.imageRef}
                        imageUrl={p.imageUrl}
                        onUpload={async (file) => {
                          setRowError(null);
                          try {
                            const saved = await uploadProvisionImage(p.id, file);
                            setNotice(`Saved a picture for ${p.name} (${Math.round(saved.bytes / 1024)} KB).`);
                            reload();
                          } catch (err: unknown) {
                            setRowError(err);
                          }
                        }}
                        onRemove={async () => {
                          setRowError(null);
                          try {
                            await removeProvisionImage(p.id);
                            setNotice(`Removed the picture for ${p.name}.`);
                            reload();
                          } catch (err: unknown) {
                            setRowError(err);
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <Thumbnail
                      size="sm"
                      // A committed catalogue file belongs to the customer
                      // app's bundle; this origin cannot serve it, so the
                      // cell says where it is instead of pointing at a 404.
                      src={isCatalogueAsset(p.imageUrl ?? p.imageRef) ? null : mediaUrl(p.imageUrl ?? p.imageRef)}
                      alt={`Picture for ${p.name}`}
                      placeholder={isCatalogueAsset(p.imageUrl ?? p.imageRef) ? 'In bundle' : 'No image'}
                    />
                  )}
                </Td>
                <Td>{p.brand ?? 'Unbranded'}</Td>
                <Td>{p.poolName}</Td>
                <Td>{p.unit}</Td>
                <Td numeric>
                  {editingId === p.id ? (
                    <RatioEditor
                      provision={p}
                      pools={poolOptions}
                      onCancel={() => setEditingId(null)}
                      onSaved={(message) => {
                        setEditingId(null);
                        setNotice(message);
                        reload();
                      }}
                      onError={setRowError}
                    />
                  ) : (
                    p.consumptionRatio
                  )}
                </Td>
                <Td>
                  <EffectiveWindow from={p.effectiveFrom} to={p.effectiveTo} />
                </Td>
                <Td>
                  <RuleStatus isActive={p.isActive} effectiveFrom={p.effectiveFrom} effectiveTo={p.effectiveTo} />
                </Td>
                <Td>
                  {editingId === p.id ? null : (
                    <div className="flex flex-wrap gap-2">
                      <SecondaryButton
                        onClick={() => {
                          setRowError(null);
                          setNotice(null);
                          setEditingId(p.id);
                        }}
                      >
                        Edit
                      </SecondaryButton>
                      <SecondaryButton disabled={busyId === p.id} onClick={() => void toggle(p)}>
                        {p.isActive ? 'Retire' : 'Restore'}
                      </SecondaryButton>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </ConfigTable>
        )
      ) : null}
    </div>
  );
}

function RatioEditor({
  provision,
  pools,
  onCancel,
  onSaved,
  onError,
}: {
  provision: ConfigProvision;
  pools: ConfigPool[];
  onCancel: () => void;
  onSaved: (message: string) => void;
  onError: (err: unknown) => void;
}) {
  const [ratio, setRatio] = useState(provision.consumptionRatio);
  const [poolId, setPoolId] = useState(provision.poolId);
  const [name, setName] = useState(provision.name);
  const [brand, setBrand] = useState(provision.brand ?? '');
  const [packUnit, setPackUnit] = useState(provision.packUnit ?? '');
  const [imageRef, setImageRef] = useState(provision.imageRef ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateProvision(provision.id, {
        consumptionRatio: Number(ratio),
        poolId,
        name: name.trim(),
        brand: brand.trim() === '' ? null : brand.trim(),
        packUnit: packUnit === '' ? null : (packUnit as PackUnit),
        imageRef: imageRef.trim() === '' ? null : imageRef.trim(),
      });
      onSaved(`Updated ${name.trim()}.`);
    } catch (err: unknown) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-56 flex-col gap-2 text-left">
      <TextInput aria-label={`Name for ${provision.code}`} value={name} onChange={(e) => setName(e.target.value)} />
      <TextInput
        aria-label={`Brand for ${provision.code}`}
        placeholder="Brand (leave blank if unbranded)"
        value={brand}
        onChange={(e) => setBrand(e.target.value)}
        maxLength={120}
      />
      <SelectInput
        aria-label={`Pack unit for ${provision.code}`}
        value={packUnit}
        onChange={(e) => setPackUnit(e.target.value)}
      >
        <option value="">No pack unit</option>
        {PACK_UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </SelectInput>
      <TextInput
        aria-label={`Image reference for ${provision.code}`}
        placeholder="Image reference (optional)"
        value={imageRef}
        onChange={(e) => setImageRef(e.target.value)}
        maxLength={500}
      />
      <SelectInput aria-label={`Pool for ${provision.code}`} value={poolId} onChange={(e) => setPoolId(e.target.value)}>
        {pools.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectInput>
      <TextInput
        aria-label={`Consumption ratio for ${provision.code}`}
        value={ratio}
        onChange={(e) => setRatio(e.target.value)}
        inputMode="decimal"
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

function CreateProvisionForm({
  pools,
  onCreated,
}: {
  pools: ConfigPool[];
  onCreated: (provision: ConfigProvision) => void;
}) {
  const [poolId, setPoolId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [packUnit, setPackUnit] = useState('');
  const [imageRef, setImageRef] = useState('');
  const [unit, setUnit] = useState<string>('g');
  const [ratio, setRatio] = useState('1');
  const [issuePeriod, setIssuePeriod] = useState<RationType>('DRY');
  const [diet, setDiet] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const provision = await createProvision({
        poolId,
        code: code.trim(),
        name: name.trim(),
        brand: brand.trim() === '' ? null : brand.trim(),
        packUnit: packUnit === '' ? null : (packUnit as PackUnit),
        imageRef: imageRef.trim() === '' ? null : imageRef.trim(),
        unit,
        consumptionRatio: Number(ratio),
        issuePeriod,
        dietaryPreference: diet === '' ? null : (diet as DietaryPreference),
        effectiveFrom,
      });
      setCode('');
      setName('');
      setBrand('');
      setImageRef('');
      onCreated(provision);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldLabel label="Pool" hint="Everything on one pool competes for the same balance.">
          <SelectInput value={poolId} onChange={(e) => setPoolId(e.target.value)} required>
            <option value="">Choose a pool</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.unit})
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Code">
          <TextInput value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={60} required />
        </FieldLabel>
        <FieldLabel label="Name" hint="The item itself. Keep the brand and the pack size out of it.">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required />
        </FieldLabel>
        <FieldLabel label="Brand" hint="Leave blank where the item is unbranded or loose.">
          <TextInput value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={120} />
        </FieldLabel>
        <FieldLabel label="Pack unit" hint="What the container is called. Not the entitlement unit.">
          <SelectInput value={packUnit} onChange={(e) => setPackUnit(e.target.value)}>
            <option value="">No pack unit</option>
            {PACK_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Image reference" hint="A picture held in storage. Blank shows a placeholder to the officer.">
          <TextInput value={imageRef} onChange={(e) => setImageRef(e.target.value)} maxLength={500} />
        </FieldLabel>
        <FieldLabel label="Unit" hint="The entitlement unit the ratio is applied in.">

          <SelectInput value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Consumption ratio" hint="Pool units spent per one unit of this item.">
          <TextInput value={ratio} onChange={(e) => setRatio(e.target.value)} inputMode="decimal" required />
        </FieldLabel>
        <FieldLabel label="Issued with" hint="Can differ from the pool's own ration type — bread is one such case.">
          <SelectInput value={issuePeriod} onChange={(e) => setIssuePeriod(e.target.value as RationType)}>
            {RATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Offered to">
          <SelectInput value={diet} onChange={(e) => setDiet(e.target.value)}>
            <option value="">Every dietary preference</option>
            {DIETS.map((d) => (
              <option key={d} value={d}>
                {d} only
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Effective from">
          <TextInput type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
        </FieldLabel>
      </div>

      <ConfigError error={error} />

      <div className="mt-4">
        <PrimaryButton disabled={busy}>{busy ? 'Saving…' : 'Add provision'}</PrimaryButton>
      </div>
    </form>
  );
}
