import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../../lib/api/resource';
import {
  createConversion,
  fetchConversions,
  fetchPools,
  setConversionActive,
  type ConfigConversion,
  type ConfigPool,
  type ConversionMode,
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
 * Conversions — screen 3 of 7 (STEP 11C).
 *
 * A conversion moves entitlement from one pool to another at a stated
 * rate. Two modes, and the difference matters to the officer:
 *
 *   AUTOMATIC  applies by itself to everyone of that dietary
 *              preference. The officer is not asked and cannot decline.
 *   ELECTIVE   is offered as a choice. Taking it surrenders the source
 *              pool's contribution and adds the target's, so the same
 *              entitlement is never counted twice.
 *
 * Leaving the dietary preference blank means the conversion applies to
 * every preference. Setting it restricts the conversion to one.
 *
 * The rate is stated as two quantities — "this much of the source
 * becomes this much of the target" — rather than as a single factor, so
 * the row reads the way the rule was written down and nobody has to
 * divide to check it.
 */
const MODES: readonly ConversionMode[] = ['AUTOMATIC', 'ELECTIVE'];
const DIETS: readonly DietaryPreference[] = ['PV', 'EV', 'NV'];

export function ConversionsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const pools = useResource(() => fetchPools(), []);
  const conversions = useResource(() => fetchConversions(), [reloadKey]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const poolOptions: ConfigPool[] = pools.status === 'success' ? pools.data.items : [];

  const toggle = async (conversion: ConfigConversion) => {
    setRowError(null);
    setNotice(null);
    setBusyId(conversion.id);
    try {
      await setConversionActive(conversion.id, !conversion.isActive);
      setNotice(`${conversion.code} is now ${conversion.isActive ? 'retired' : 'in force'}.`);
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
        What may be exchanged for what, and at what rate.{' '}
        <strong className="font-semibold text-slate-800">Automatic</strong> conversions apply on their own;{' '}
        <strong className="font-semibold text-slate-800">elective</strong> ones are offered as a choice, and taking one
        surrenders the source pool rather than adding to it.
      </p>

      <AddPanel title="Add a conversion" open={adding} onToggle={() => setAdding((v) => !v)}>
        <CreateConversionForm
          pools={poolOptions}
          onCreated={(conversion) => {
            setAdding(false);
            setNotice(`Created ${conversion.code}.`);
            reload();
          }}
        />
      </AddPanel>

      <ConfigNotice>{notice}</ConfigNotice>
      <ConfigError error={rowError} />

      {conversions.status === 'loading' ? <LoadingState label="Loading conversions…" /> : null}
      {conversions.status === 'error' ? <FailureState error={conversions.error} onRetry={reload} /> : null}
      {conversions.status === 'not_implemented' ? <EmptyState title="Conversions are not available yet." /> : null}

      {conversions.status === 'success' ? (
        conversions.data.items.length === 0 ? (
          <EmptyState
            title="No conversions are configured"
            description="Without a conversion, each pool stands alone and nothing may be exchanged for anything else."
          />
        ) : (
          <ConfigTable
            caption="RIK cross-pool conversions"
            head={
              <>
                <Th>Conversion</Th>
                <Th>Rate</Th>
                <Th>Mode</Th>
                <Th>Applies to</Th>
                <Th>Effective</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </>
            }
          >
            {conversions.data.items.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 last:border-0">
                <Td>
                  <p className="font-mono text-xs text-slate-500">{c.code}</p>
                  <p className="mt-0.5 font-semibold text-slate-800">
                    {c.fromPoolCode} → {c.toPoolCode}
                  </p>
                </Td>
                <Td numeric>
                  {c.fromQty} → {c.toQty}
                </Td>
                <Td>
                  <span
                    className={[
                      'rounded px-2 py-0.5 text-xs font-bold',
                      c.mode === 'AUTOMATIC' ? 'bg-brand-blueLight text-brand-blueDark' : 'bg-slate-100 text-slate-700',
                    ].join(' ')}
                  >
                    {c.mode === 'AUTOMATIC' ? 'Automatic' : 'Officer chooses'}
                  </span>
                </Td>
                <Td>{c.dietaryPreference ?? 'Every preference'}</Td>
                <Td>
                  <EffectiveWindow from={c.effectiveFrom} to={c.effectiveTo} />
                </Td>
                <Td>
                  <RuleStatus isActive={c.isActive} effectiveFrom={c.effectiveFrom} effectiveTo={c.effectiveTo} />
                </Td>
                <Td>
                  <SecondaryButton disabled={busyId === c.id} onClick={() => void toggle(c)}>
                    {c.isActive ? 'Retire' : 'Restore'}
                  </SecondaryButton>
                </Td>
              </tr>
            ))}
          </ConfigTable>
        )
      ) : null}
    </div>
  );
}

function CreateConversionForm({
  pools,
  onCreated,
}: {
  pools: ConfigPool[];
  onCreated: (conversion: ConfigConversion) => void;
}) {
  const [code, setCode] = useState('');
  const [fromPoolId, setFromPoolId] = useState('');
  const [toPoolId, setToPoolId] = useState('');
  const [fromQty, setFromQty] = useState('');
  const [toQty, setToQty] = useState('');
  const [mode, setMode] = useState<ConversionMode>('ELECTIVE');
  const [diet, setDiet] = useState<string>('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const conversion = await createConversion({
        code: code.trim(),
        fromPoolId,
        toPoolId,
        fromQty: Number(fromQty),
        toQty: Number(toQty),
        mode,
        dietaryPreference: diet === '' ? null : (diet as DietaryPreference),
        effectiveFrom,
      });
      setCode('');
      setFromQty('');
      setToQty('');
      onCreated(conversion);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldLabel label="Code">
          <TextInput value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={60} required />
        </FieldLabel>
        <FieldLabel label="Mode">
          <SelectInput value={mode} onChange={(e) => setMode(e.target.value as ConversionMode)}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m === 'AUTOMATIC' ? 'Automatic — applies on its own' : 'Elective — the officer chooses'}
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Surrendered from">
          <SelectInput value={fromPoolId} onChange={(e) => setFromPoolId(e.target.value)} required>
            <option value="">Choose a pool</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Received as">
          <SelectInput value={toPoolId} onChange={(e) => setToPoolId(e.target.value)} required>
            <option value="">Choose a pool</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <FieldLabel label="Quantity surrendered (per day)">
          <TextInput value={fromQty} onChange={(e) => setFromQty(e.target.value)} inputMode="decimal" required />
        </FieldLabel>
        <FieldLabel label="Quantity received (per day)">
          <TextInput value={toQty} onChange={(e) => setToQty(e.target.value)} inputMode="decimal" required />
        </FieldLabel>
        <FieldLabel label="Applies to" hint="Leave as every preference unless the rule is specific to one.">
          <SelectInput value={diet} onChange={(e) => setDiet(e.target.value)}>
            <option value="">Every dietary preference</option>
            {DIETS.map((d) => (
              <option key={d} value={d}>
                {d}
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
        <PrimaryButton disabled={busy}>{busy ? 'Saving…' : 'Add conversion'}</PrimaryButton>
      </div>
    </form>
  );
}
