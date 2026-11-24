import { useCallback, useState } from 'react';
import { useResource } from '../../lib/api/resource';
import {
  fetchProvisions,
  updateProvision,
  type ConfigProvision,
  type DietaryPreference,
  type RationType,
} from '../../lib/api/rik-config-api';
import { LoadingState, EmptyState, FailureState } from '../../design-system/States';
import {
  ConfigError,
  ConfigNotice,
  ConfigTable,
  RuleStatus,
  SecondaryButton,
  SelectInput,
  Td,
  Th,
} from '../../design-system/ConfigUI';

/**
 * Issue period and availability — screen 6 of 7 (STEP 11C).
 *
 * Three columns of the provisions table, again — the ones that decide
 * WHEN an item is handed over and WHO is offered it:
 *
 *   Issued with          FRESH or DRY. This is the physical issue, and
 *                        it is INDEPENDENT of the pool's own ration
 *                        type. An item can belong to a dry pool and be
 *                        issued on the fresh day; bread is exactly that
 *                        case. The screen shows both so the difference
 *                        is visible rather than surprising.
 *   Offered to           one dietary preference, or all of them. This
 *                        narrows an item within a pool that already
 *                        applies; it does NOT grant entitlement — that
 *                        is the daily scale's job.
 *   Officer selectable   whether an officer sees the item at all. An
 *                        unselectable item is not offered rather than
 *                        offered and refused.
 *
 * Nothing here decides how much anyone gets. Availability and
 * entitlement are separate, and keeping them on separate screens is the
 * point of this one.
 */
const RATION_TYPES: readonly RationType[] = ['FRESH', 'DRY'];
const DIETS: readonly DietaryPreference[] = ['PV', 'EV', 'NV'];

export function AvailabilityPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const provisions = useResource(() => fetchProvisions(null), [reloadKey]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const patch = async (provision: ConfigProvision, body: Parameters<typeof updateProvision>[1], message: string) => {
    setRowError(null);
    setNotice(null);
    setBusyId(provision.id);
    try {
      await updateProvision(provision.id, body);
      setNotice(message);
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
        When an item is issued and who is offered it.{' '}
        <strong className="font-semibold text-slate-800">The issue day is independent of the pool&rsquo;s ration type</strong>{' '}
        — an item can belong to a dry pool and still be handed over on the fresh day. Nothing on this screen changes
        what anyone is entitled to.
      </p>

      <ConfigNotice>{notice}</ConfigNotice>
      <ConfigError error={rowError} />

      {provisions.status === 'loading' ? <LoadingState label="Loading availability…" /> : null}
      {provisions.status === 'error' ? <FailureState error={provisions.error} onRetry={reload} /> : null}
      {provisions.status === 'not_implemented' ? <EmptyState title="Provisions are not available yet." /> : null}

      {provisions.status === 'success' ? (
        provisions.data.items.length === 0 ? (
          <EmptyState
            title="No provisions are configured"
            description="Add provisions before deciding when and to whom they are offered."
          />
        ) : (
          <ConfigTable
            caption="RIK provision issue period and availability"
            head={
              <>
                <Th>Provision</Th>
                <Th>Pool is</Th>
                <Th>Issued with</Th>
                <Th>Offered to</Th>
                <Th>Officer sees it</Th>
                <Th>Status</Th>
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
                  <span className="text-slate-500">{p.poolRationType}</span>
                </Td>
                <Td>
                  <SelectInput
                    aria-label={`Issue period for ${p.code}`}
                    value={p.issuePeriod}
                    disabled={busyId === p.id}
                    onChange={(e) =>
                      void patch(
                        p,
                        { issuePeriod: e.target.value as RationType },
                        `${p.name} is now issued with the ${e.target.value.toLowerCase()} ration.`
                      )
                    }
                  >
                    {RATION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </SelectInput>
                  {p.issuePeriod !== p.poolRationType ? (
                    <p className="mt-1 text-xs text-brand-amberDark">Differs from the pool — deliberate.</p>
                  ) : null}
                </Td>
                <Td>
                  <SelectInput
                    aria-label={`Dietary preference for ${p.code}`}
                    value={p.dietaryPreference ?? ''}
                    disabled={busyId === p.id}
                    onChange={(e) =>
                      void patch(
                        p,
                        { dietaryPreference: e.target.value === '' ? null : (e.target.value as DietaryPreference) },
                        e.target.value === ''
                          ? `${p.name} is now offered to every dietary preference.`
                          : `${p.name} is now offered to ${e.target.value} only.`
                      )
                    }
                  >
                    <option value="">Every preference</option>
                    {DIETS.map((d) => (
                      <option key={d} value={d}>
                        {d} only
                      </option>
                    ))}
                  </SelectInput>
                </Td>
                <Td>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={p.isCustomerSelectable}
                      disabled={busyId === p.id}
                      aria-label={`Officer selectable: ${p.name}`}
                      onChange={(e) =>
                        void patch(
                          p,
                          { isCustomerSelectable: e.target.checked },
                          e.target.checked
                            ? `${p.name} is offered to officers again.`
                            : `${p.name} is no longer offered to officers.`
                        )
                      }
                    />
                    {p.isCustomerSelectable ? 'Offered' : 'Hidden'}
                  </label>
                </Td>
                <Td>
                  <RuleStatus isActive={p.isActive} effectiveFrom={p.effectiveFrom} effectiveTo={p.effectiveTo} />
                </Td>
              </tr>
            ))}
          </ConfigTable>
        )
      ) : null}

      <p className="text-xs text-slate-500">
        Hiding an item removes it from the officer&rsquo;s list on the next calculation. Retiring it, on the Provisions
        screen, removes it from the configuration altogether. Neither deletes anything.
      </p>
      <SecondaryButton onClick={reload}>Refresh</SecondaryButton>
    </div>
  );
}
