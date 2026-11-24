import { useCallback, useState } from 'react';
import { useResource } from '../../lib/api/resource';
import {
  fetchProvisions,
  updateProvision,
  type ConfigProvision,
  type PackUnit,
  PACK_UNITS,
} from '../../lib/api/rik-config-api';
import { LoadingState, EmptyState, FailureState } from '../../design-system/States';
import {
  ConfigError,
  ConfigNotice,
  ConfigTable,
  SecondaryButton,
  SelectInput,
  Td,
  TextInput,
  Th,
  numberOrNull,
} from '../../design-system/ConfigUI';

/**
 * Pack sizes and limits — screen 5 of 7 (STEP 11C).
 *
 * This edits four columns of the provisions table, and nothing else. It
 * is a screen of its own because it answers a different question from
 * the SKU master — "how is this item handed over, and how much of it
 * may one officer take" rather than "what is this item worth" — and
 * because those four columns are the ones a facility revises most often
 * as suppliers and pack formats change.
 *
 * The distinction it exists to make plain:
 *
 *   A PACK SIZE IS NOT AN ENTITLEMENT. Salt issued in 500 g packs
 *   against a 600 g entitlement is normal and correct; the pack size
 *   describes the container, the scale describes the allowance, and
 *   neither constrains the other. Changing a pack size here does not
 *   change what anybody is entitled to.
 *
 * The three limits are separate caps and the strictest one wins:
 *
 *   Max quantity        most of this item one officer may take
 *   Max packs           most whole packs, where the item is packed
 *   Min eligible days   the item is not offered below this many days
 *
 * Leaving a box empty means no cap of that kind. The server decides
 * whether a value is acceptable and says why if it is not.
 *
 * STEP 12A added the pack unit here — the noun for the container
 * (packet, tin, box, litre and so on). It is the second half of the
 * pack size and is deliberately separate from the unit the entitlement
 * is calculated in, which only ever takes g, ml or piece. Changing the
 * pack unit changes what is printed, never what is owed.
 */
export function PackSizesPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const provisions = useResource(() => fetchProvisions(null), [reloadKey]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-slate-600">
        How an item is handed over and how much of it one officer may take.{' '}
        <strong className="font-semibold text-slate-800">A pack size is not an entitlement</strong> — a 500 g pack
        against a 600 g allowance is normal, and changing a pack size here changes nothing about what anyone is
        entitled to.
      </p>

      <ConfigNotice>{notice}</ConfigNotice>
      <ConfigError error={rowError} />

      {provisions.status === 'loading' ? <LoadingState label="Loading pack sizes and limits…" /> : null}
      {provisions.status === 'error' ? <FailureState error={provisions.error} onRetry={reload} /> : null}
      {provisions.status === 'not_implemented' ? <EmptyState title="Provisions are not available yet." /> : null}

      {provisions.status === 'success' ? (
        provisions.data.items.length === 0 ? (
          <EmptyState title="No provisions are configured" description="Add provisions before setting their limits." />
        ) : (
          <ConfigTable
            caption="RIK provision pack sizes and limits"
            head={
              <>
                <Th>Provision</Th>
                <Th>Issued</Th>
                <Th>Pack size</Th>
                <Th>Pack unit</Th>
                <Th>Max quantity</Th>
                <Th>Max packs</Th>
                <Th>Min days</Th>
                <Th>Action</Th>
              </>
            }
          >
            {provisions.data.items.map((p) =>
              editingId === p.id ? (
                <LimitsEditorRow
                  key={p.id}
                  provision={p}
                  onCancel={() => setEditingId(null)}
                  onSaved={(message) => {
                    setEditingId(null);
                    setNotice(message);
                    reload();
                  }}
                  onError={setRowError}
                />
              ) : (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <Td>
                    <p className="font-semibold text-slate-800">{p.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">{p.code}</p>
                  </Td>
                  <Td>
                    {p.isLoose ? 'Loose' : 'Packed'}
                    {/* Whole-units-only is a separate rule from the pack size
                        beside it: a pack size is a ceiling, this is a step.
                        Shown here so an administrator can see which items are
                        counted rather than measured. */}
                    {p.wholeUnitsOnly ? (
                      <span className="mt-0.5 block text-xs text-slate-500">whole units only</span>
                    ) : null}
                  </Td>
                  <Td numeric>{p.packSize ? `${p.packSize} ${p.packUnit ?? p.unit}` : '—'}</Td>
                  <Td>{p.packUnit ?? '—'}</Td>
                  <Td numeric>{p.maxQuantity ? `${p.maxQuantity} ${p.unit}` : 'No cap'}</Td>
                  <Td numeric>{p.maxPacks ?? 'No cap'}</Td>
                  <Td numeric>{p.minEligibleDays ?? '—'}</Td>
                  <Td>
                    <SecondaryButton
                      onClick={() => {
                        setRowError(null);
                        setNotice(null);
                        setEditingId(p.id);
                      }}
                    >
                      Edit
                    </SecondaryButton>
                  </Td>
                </tr>
              )
            )}
          </ConfigTable>
        )
      ) : null}
    </div>
  );
}

function LimitsEditorRow({
  provision,
  onCancel,
  onSaved,
  onError,
}: {
  provision: ConfigProvision;
  onCancel: () => void;
  onSaved: (message: string) => void;
  onError: (err: unknown) => void;
}) {
  const [isLoose, setIsLoose] = useState(provision.isLoose);
  const [packSize, setPackSize] = useState(provision.packSize ?? '');
  const [packUnit, setPackUnit] = useState(provision.packUnit ?? '');
  const [maxQuantity, setMaxQuantity] = useState(provision.maxQuantity ?? '');
  const [maxPacks, setMaxPacks] = useState(provision.maxPacks === null ? '' : String(provision.maxPacks));
  const [minDays, setMinDays] = useState(provision.minEligibleDays === null ? '' : String(provision.minEligibleDays));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateProvision(provision.id, {
        isLoose,
        packSize: numberOrNull(String(packSize)),
        packUnit: packUnit === '' ? null : (packUnit as PackUnit),
        maxQuantity: numberOrNull(String(maxQuantity)),
        maxPacks: numberOrNull(maxPacks),
        minEligibleDays: numberOrNull(minDays),
      });
      onSaved(`Updated the limits for ${provision.name}.`);
    } catch (err: unknown) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-b border-slate-100 bg-slate-50 align-top last:border-0">
      <Td>
        <p className="font-semibold text-slate-800">{provision.name}</p>
        <p className="mt-0.5 font-mono text-xs text-slate-500">{provision.code}</p>
      </Td>
      <Td>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isLoose}
            onChange={(e) => setIsLoose(e.target.checked)}
            className="h-4 w-4"
            aria-label={`Issued loose: ${provision.name}`}
          />
          Loose
        </label>
      </Td>
      <Td>
        <TextInput
          aria-label={`Pack size for ${provision.code}`}
          value={packSize}
          onChange={(e) => setPackSize(e.target.value)}
          inputMode="decimal"
        />
      </Td>
      <Td>
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
      </Td>
      <Td>
        <TextInput
          aria-label={`Max quantity for ${provision.code}`}
          value={maxQuantity}
          onChange={(e) => setMaxQuantity(e.target.value)}
          inputMode="decimal"
        />
      </Td>
      <Td>
        <TextInput
          aria-label={`Max packs for ${provision.code}`}
          value={maxPacks}
          onChange={(e) => setMaxPacks(e.target.value)}
          inputMode="numeric"
        />
      </Td>
      <Td>
        <TextInput
          aria-label={`Minimum eligible days for ${provision.code}`}
          value={minDays}
          onChange={(e) => setMinDays(e.target.value)}
          inputMode="numeric"
        />
      </Td>
      <Td>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </SecondaryButton>
          <SecondaryButton disabled={busy} onClick={onCancel}>
            Cancel
          </SecondaryButton>
        </div>
      </Td>
    </tr>
  );
}
