import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../../lib/api/resource';
import {
  createScale,
  fetchPools,
  fetchScales,
  setScaleActive,
  supersedeScale,
  updateScale,
  type ConfigPool,
  type ConfigScale,
  type DietaryPreference,
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
 * Daily scales — screen 2 of 7 (STEP 11C).
 *
 * One row says: for this pool, an officer of this dietary preference
 * receives this much per eligible day. The entitlement for a period is
 * that number multiplied by the officer's eligible days, and nothing
 * else.
 *
 * The absence of a row is itself a rule, and the most important thing
 * on this screen. A pool with no row for a dietary preference does not
 * apply to that preference at all — that is how "no meat for a pure
 * vegetarian" is expressed, with no condition anywhere in the code.
 * Adding a row makes the pool apply; retiring it makes the pool stop
 * applying. The screen therefore says so in words, because an
 * administrator who does not know this could remove an entitlement by
 * accident while believing they were tidying up.
 *
 * TWO WAYS TO CHANGE A NUMBER, and they mean different things:
 *
 *   Edit        corrects a rule that was never right. The window is
 *               unchanged, so a calculation dated inside it now uses
 *               the corrected figure.
 *   Supersede   changes the rule from a date forward. The current row
 *               is closed the day before and a new one opens, so what
 *               the rule WAS on an earlier date is still readable.
 *
 * Both are offered because both are real administrative acts. A
 * confirmed issue is unaffected either way — it keeps its own snapshot.
 */
const DIETS: readonly DietaryPreference[] = ['PV', 'EV', 'NV'];

export function ScalesPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [poolFilter, setPoolFilter] = useState('');
  const pools = useResource(() => fetchPools(), []);
  const scales = useResource(() => fetchScales(poolFilter || null), [reloadKey, poolFilter]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const [editing, setEditing] = useState<{ id: string; mode: 'edit' | 'supersede' } | null>(null);

  const poolOptions: ConfigPool[] = pools.status === 'success' ? pools.data.items : [];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-slate-600">
        How much of a pool an officer receives per eligible day, by dietary preference.{' '}
        <strong className="font-semibold text-slate-800">
          A pool with no row for a dietary preference does not apply to that preference at all
        </strong>{' '}
        — that absence is how a preference-specific exclusion is expressed, so retiring a row removes the entitlement
        rather than zeroing it.
      </p>

      <AddPanel title="Add a daily scale" open={adding} onToggle={() => setAdding((v) => !v)}>
        <CreateScaleForm
          pools={poolOptions}
          onCreated={(scale) => {
            setAdding(false);
            setNotice(`Added a ${scale.dietaryPreference} scale for ${scale.poolName}.`);
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

      {scales.status === 'loading' ? <LoadingState label="Loading daily scales…" /> : null}
      {scales.status === 'error' ? <FailureState error={scales.error} onRetry={reload} /> : null}
      {scales.status === 'not_implemented' ? <EmptyState title="Daily scales are not available yet." /> : null}

      {scales.status === 'success' ? (
        scales.data.items.length === 0 ? (
          <EmptyState
            title="No daily scales are configured"
            description="Until a pool has a scale for a dietary preference, that preference receives nothing from it."
          />
        ) : (
          <ConfigTable
            caption="RIK daily entitlement scales"
            head={
              <>
                <Th>Pool</Th>
                <Th>Diet</Th>
                <Th>Per day</Th>
                <Th>Effective</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </>
            }
          >
            {scales.data.items.map((scale) => (
              <ScaleRow
                key={scale.id}
                scale={scale}
                editing={editing?.id === scale.id ? editing.mode : null}
                onEdit={(mode) => {
                  setRowError(null);
                  setNotice(null);
                  setEditing(mode ? { id: scale.id, mode } : null);
                }}
                onSaved={(message) => {
                  setEditing(null);
                  setNotice(message);
                  reload();
                }}
                onError={setRowError}
              />
            ))}
          </ConfigTable>
        )
      ) : null}
    </div>
  );
}

function ScaleRow({
  scale,
  editing,
  onEdit,
  onSaved,
  onError,
}: {
  scale: ConfigScale;
  editing: 'edit' | 'supersede' | null;
  onEdit: (mode: 'edit' | 'supersede' | null) => void;
  onSaved: (message: string) => void;
  onError: (err: unknown) => void;
}) {
  const [value, setValue] = useState(scale.dailyQty);
  const [from, setFrom] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (editing === 'edit') {
        await updateScale(scale.id, { dailyQty: Number(value) });
        onSaved(`Corrected the ${scale.dietaryPreference} scale for ${scale.poolName}.`);
      } else {
        await supersedeScale(scale.id, { dailyQty: Number(value), effectiveFrom: from });
        onSaved(`The ${scale.dietaryPreference} scale for ${scale.poolName} changes from ${from}.`);
      }
    } catch (err: unknown) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    setBusy(true);
    try {
      await setScaleActive(scale.id, !scale.isActive);
      onSaved(
        scale.isActive
          ? `Retired the ${scale.dietaryPreference} scale for ${scale.poolName}. That pool no longer applies to ${scale.dietaryPreference}.`
          : `Restored the ${scale.dietaryPreference} scale for ${scale.poolName}.`
      );
    } catch (err: unknown) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-b border-slate-100 last:border-0 align-top">
      <Td>
        <p className="font-semibold text-slate-800">{scale.poolName}</p>
        <p className="mt-0.5 font-mono text-xs text-slate-500">{scale.poolCode}</p>
      </Td>
      <Td>{scale.dietaryPreference}</Td>
      <Td numeric>
        {editing ? (
          <div className="flex flex-col gap-2">
            <TextInput
              aria-label={`Daily quantity for ${scale.poolName} ${scale.dietaryPreference}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="decimal"
            />
            {editing === 'supersede' ? (
              <TextInput
                aria-label="New rule starts on"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            ) : null}
            <div className="flex gap-2">
              <SecondaryButton disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save'}
              </SecondaryButton>
              <SecondaryButton disabled={busy} onClick={() => onEdit(null)}>
                Cancel
              </SecondaryButton>
            </div>
          </div>
        ) : (
          <>
            {scale.dailyQty} {scale.poolUnit}
          </>
        )}
      </Td>
      <Td>
        <EffectiveWindow from={scale.effectiveFrom} to={scale.effectiveTo} />
      </Td>
      <Td>
        <RuleStatus isActive={scale.isActive} effectiveFrom={scale.effectiveFrom} effectiveTo={scale.effectiveTo} />
      </Td>
      <Td>
        {editing ? null : (
          <div className="flex flex-wrap gap-2">
            <SecondaryButton onClick={() => onEdit('edit')}>Correct</SecondaryButton>
            <SecondaryButton onClick={() => onEdit('supersede')}>Change from date</SecondaryButton>
            <SecondaryButton disabled={busy} onClick={() => void toggle()}>
              {scale.isActive ? 'Retire' : 'Restore'}
            </SecondaryButton>
          </div>
        )}
      </Td>
    </tr>
  );
}

function CreateScaleForm({ pools, onCreated }: { pools: ConfigPool[]; onCreated: (scale: ConfigScale) => void }) {
  const [poolId, setPoolId] = useState('');
  const [diet, setDiet] = useState<DietaryPreference>('NV');
  const [dailyQty, setDailyQty] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const scale = await createScale({
        poolId,
        dietaryPreference: diet,
        dailyQty: Number(dailyQty),
        effectiveFrom,
      });
      setDailyQty('');
      onCreated(scale);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldLabel label="Pool">
          <SelectInput value={poolId} onChange={(e) => setPoolId(e.target.value)} required>
            <option value="">Choose a pool</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.unit})
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Dietary preference">
          <SelectInput value={diet} onChange={(e) => setDiet(e.target.value as DietaryPreference)}>
            {DIETS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Quantity per eligible day">
          <TextInput value={dailyQty} onChange={(e) => setDailyQty(e.target.value)} inputMode="decimal" required />
        </FieldLabel>
        <FieldLabel label="Effective from">
          <TextInput type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
        </FieldLabel>
      </div>

      <ConfigError error={error} />

      <div className="mt-4">
        <PrimaryButton disabled={busy}>{busy ? 'Saving…' : 'Add scale'}</PrimaryButton>
      </div>
    </form>
  );
}
