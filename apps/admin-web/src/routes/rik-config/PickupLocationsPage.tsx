import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../../lib/api/resource';
import {
  createPickupLocation,
  fetchPickupLocations,
  setPickupLocationActive,
  type ConfigPickupLocation,
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
  Td,
  TextInput,
  Th,
  todayIso,
} from '../../design-system/ConfigUI';

/**
 * Collection points — screen 8 of 8 (STEP 11E).
 *
 * Where a customer may collect a RIK issue. This screen exists so the
 * facility never needs a developer to open a new counter, rename one,
 * or take one out of use: "Naval Park" and "Dolphin Hill" are rows in a
 * table, not names in any source file.
 *
 * Retired rather than deleted, like every other RIK configuration
 * table, because a confirmed selection names one. Retiring removes it
 * from the customer's choices immediately; it does not touch any
 * confirmation already made — those carry the location NAME as it was
 * on the day, so even renaming this row leaves past issues alone.
 */
export function PickupLocationsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const locations = useResource(() => fetchPickupLocations(), [reloadKey]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggleActive = async (location: ConfigPickupLocation) => {
    setRowError(null);
    setNotice(null);
    setBusyId(location.id);
    try {
      await setPickupLocationActive(location.id, !location.isActive);
      setNotice(
        location.isActive
          ? `${location.name} is no longer offered to customers. Confirmations already made are unchanged.`
          : `${location.name} is offered to customers again.`
      );
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
        The places a customer may choose to collect their ration. A customer sees only the points that are in force
        today, in the order below.
      </p>

      <AddPanel title="Add a collection point" open={adding} onToggle={() => setAdding((v) => !v)}>
        <CreatePickupLocationForm
          onCreated={(location) => {
            setAdding(false);
            setNotice(`Created ${location.name}.`);
            reload();
          }}
        />
      </AddPanel>

      <ConfigNotice>{notice}</ConfigNotice>
      <ConfigError error={rowError} />

      {locations.status === 'loading' ? <LoadingState label="Loading collection points…" /> : null}
      {locations.status === 'error' ? <FailureState error={locations.error} onRetry={reload} /> : null}
      {locations.status === 'not_implemented' ? (
        <EmptyState title="Collection points are not available yet." />
      ) : null}

      {locations.status === 'success' ? (
        locations.data.items.length === 0 ? (
          <EmptyState
            title="No collection points are configured"
            description="Until one exists, customers can only choose delivery."
          />
        ) : (
          <ConfigTable
            caption="RIK collection points"
            head={
              <>
                <Th>Collection point</Th>
                <Th>Order</Th>
                <Th>Effective</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </>
            }
          >
            {locations.data.items.map((location) => (
              <tr key={location.id} className="border-b border-slate-100 last:border-0">
                <Td>
                  <p className="font-semibold text-slate-800">{location.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-slate-500">{location.code}</p>
                  {location.description ? (
                    <p className="mt-0.5 text-xs text-slate-500">{location.description}</p>
                  ) : null}
                </Td>
                <Td numeric>{location.displayOrder}</Td>
                <Td>
                  <EffectiveWindow from={location.effectiveFrom} to={location.effectiveTo} />
                </Td>
                <Td>
                  <RuleStatus
                    isActive={location.isActive}
                    effectiveFrom={location.effectiveFrom}
                    effectiveTo={location.effectiveTo}
                  />
                </Td>
                <Td>
                  <SecondaryButton disabled={busyId === location.id} onClick={() => void toggleActive(location)}>
                    {location.isActive ? 'Retire' : 'Restore'}
                  </SecondaryButton>
                </Td>
              </tr>
            ))}
          </ConfigTable>
        )
      ) : null}

      <p className="text-xs text-slate-500">
        A collection point is retired, never deleted — a confirmed ration names one. Renaming a point here changes
        what future customers see; every confirmation already made keeps the name it was given on the day.
      </p>
    </div>
  );
}

function CreatePickupLocationForm({ onCreated }: { onCreated: (location: ConfigPickupLocation) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const location = await createPickupLocation({
        code: code.trim(),
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        displayOrder: Number(displayOrder) || 0,
        effectiveFrom,
      });
      setCode('');
      setName('');
      setDescription('');
      onCreated(location);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldLabel label="Code" hint="Letters, digits and underscores. Never shown to customers.">
          <TextInput value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={60} required />
        </FieldLabel>
        <FieldLabel label="Name" hint="Exactly as customers should see it.">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </FieldLabel>
        <FieldLabel label="Description (optional)" hint="A landmark or timing note, if it helps.">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </FieldLabel>
        <FieldLabel label="Order" hint="Lower numbers appear first in the customer's list.">
          <TextInput value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} inputMode="numeric" />
        </FieldLabel>
        <FieldLabel label="Effective from">
          <TextInput type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
        </FieldLabel>
      </div>

      <ConfigError error={error} />

      <div className="mt-4">
        <PrimaryButton disabled={busy}>{busy ? 'Saving…' : 'Add collection point'}</PrimaryButton>
      </div>
    </form>
  );
}
