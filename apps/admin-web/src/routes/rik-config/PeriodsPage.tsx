import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../../lib/api/resource';
import {
  createPeriod,
  fetchPeriods,
  setPeriodStatus,
  updatePeriod,
  type EntitlementPeriod,
  type PeriodListResponse,
  type PeriodState,
} from '../../lib/api/rik-periods-api';
import { LoadingState, EmptyState, FailureState } from '../../design-system/States';
import {
  AddPanel,
  ConfigError,
  ConfigNotice,
  ConfigTable,
  FieldLabel,
  PrimaryButton,
  SecondaryButton,
  Td,
  TextInput,
  Th,
} from '../../design-system/ConfigUI';

/**
 * Entitlement periods.
 *
 * WHY THIS SCREEN EXISTS. Until now `rik.entitlement_periods` was read-only to
 * the application: the only period in the system was inserted by hand with
 * SQL, and when it ended the whole RIK module reported "no open period" until
 * somebody ran more SQL. This screen is what makes a period ordinary
 * operational data that RIK staff own.
 *
 * WHAT IT DOES NOT DO
 *
 *   It does not invent dates. There is no "this month" button and no default
 *   filled into the form. A period's dates are a facility decision and the
 *   screen asks for them.
 *
 *   It does not delete. A period is referenced by eligibility, entitlements,
 *   selections, issue windows, vouchers and carry-forward rows. Closing it
 *   retires it without touching one of them.
 *
 *   It does not compute an entitlement, a ratio, a scale or a dietary rule.
 *
 * THE DISTINCTION THIS SCREEN KEEPS VISIBLE. `status` is the label the facility
 * set; `state` is what the period actually is today, which the server works out
 * from the dates — with CLOSED overriding them. A period labelled ACTIVE whose
 * dates ended last week shows as PAST, because that is the truth and somebody
 * needs to act on it.
 */

const STATE_LABELS: Record<PeriodState, string> = {
  OPEN: 'Open now',
  UPCOMING: 'Upcoming',
  PAST: 'Ended',
  CLOSED: 'Closed',
};

const STATE_TONES: Record<PeriodState, string> = {
  OPEN: 'bg-brand-greenLight text-brand-greenDark',
  UPCOMING: 'bg-brand-blueLight text-brand-blueDark',
  PAST: 'bg-brand-amberLight text-brand-amberDark',
  CLOSED: 'bg-slate-100 text-slate-600',
};

export function PeriodsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const periods = useResource<PeriodListResponse>(() => fetchPeriods(), [reloadKey]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EntitlementPeriod | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const close = async (period: EntitlementPeriod) => {
    setRowError(null);
    setNotice(null);
    setBusyId(period.periodId);
    try {
      await setPeriodStatus(period.periodId, 'CLOSED');
      setNotice(
        `${period.name} is closed. It can no longer be the operational period. Its records are kept and it stays available for an eligibility correction.`
      );
      setEditing(null);
      reload();
    } catch (err: unknown) {
      setRowError(err);
    } finally {
      setBusyId(null);
    }
  };

  const reopen = async (period: EntitlementPeriod) => {
    setRowError(null);
    setNotice(null);
    setBusyId(period.periodId);
    try {
      await setPeriodStatus(period.periodId, 'ACTIVE');
      setNotice(
        `${period.name} is no longer closed. Whether it is the operational period still depends on its dates.`
      );
      reload();
    } catch (err: unknown) {
      setRowError(err);
    } finally {
      setBusyId(null);
    }
  };

  const current =
    periods.status === 'success'
      ? (periods.data.items.find((p) => p.isCurrent) ?? null)
      : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Entitlement periods</h1>
        <p className="mt-1 text-sm text-slate-600">
          A period is a name and two dates. Whichever period contains today — and has not been
          closed — is the operational period: eligibility, entitlements and issue schedules all
          belong to it. Periods cannot overlap.
        </p>
      </div>

      {/*
        THE MOST IMPORTANT THING ON THIS SCREEN. When no period contains today,
        the RIK module has no operational period and officers see "no period is
        open". Saying so here, plainly, is what stops that going unnoticed for
        days — which is exactly what happened in staging in November 2026.
      */}
      {periods.status === 'success' ? (
        current === null ? (
          <p
            role="status"
            className="rounded-lg border border-brand-amber/40 bg-brand-amberLight px-3 py-2 text-sm font-semibold text-brand-amberDark"
          >
            No operational period is configured. Officers currently have no entitlement and no issue
            schedule. Create a period covering today to begin operations.
          </p>
        ) : (
          <p
            role="status"
            className="rounded-lg border border-brand-green/30 bg-brand-greenLight px-3 py-2 text-sm text-brand-greenDark"
          >
            Current operational period: <strong>{current.name}</strong> ({current.startDate} to{' '}
            {current.endDate}).
          </p>
        )
      ) : null}

      <AddPanel
        title="Create a period"
        open={adding}
        onToggle={() => {
          setAdding((v) => !v);
          setEditing(null);
        }}
      >
        <PeriodForm
          mode="create"
          onDone={(p) => {
            setAdding(false);
            setNotice(
              `${p.name} created, ${p.startDate} to ${p.endDate}. It is ${STATE_LABELS[p.state].toLowerCase()}.`
            );
            reload();
          }}
        />
      </AddPanel>

      {editing !== null ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-base font-bold text-slate-900">Edit {editing.name}</h2>
          <PeriodForm
            mode="edit"
            period={editing}
            onDone={(p) => {
              setEditing(null);
              setNotice(`${p.name} updated.`);
              reload();
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      ) : null}

      <ConfigNotice>{notice}</ConfigNotice>
      <ConfigError error={rowError} />

      {periods.status === 'loading' ? <LoadingState label="Loading periods…" /> : null}
      {periods.status === 'error' ? (
        <FailureState error={periods.error} onRetry={reload} />
      ) : null}
      {periods.status === 'not_implemented' ? (
        <EmptyState title="Entitlement periods are not available yet." />
      ) : null}

      {periods.status === 'success' ? (
        periods.data.items.length === 0 ? (
          <EmptyState
            title="No entitlement period exists yet"
            description="Create the first period so eligibility, entitlements and issue schedules have somewhere to belong."
          />
        ) : (
          <>
            <ConfigTable
              caption="Entitlement periods"
              head={
                <>
                  <Th>Period</Th>
                  <Th>Dates</Th>
                  <Th>State today</Th>
                  <Th>Label</Th>
                  <Th>In use by</Th>
                  <Th>Action</Th>
                </>
              }
            >
              {periods.data.items.map((p) => (
                <tr key={p.periodId} className="border-b border-slate-100 last:border-0">
                  <Td>
                    <p className="font-semibold text-slate-800">{p.name}</p>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-slate-700">
                      {p.startDate} → {p.endDate}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={[
                        'rounded-full px-2 py-0.5 text-xs font-semibold',
                        STATE_TONES[p.state],
                      ].join(' ')}
                    >
                      {STATE_LABELS[p.state]}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs text-slate-600">{p.status}</span>
                  </Td>
                  <Td>
                    {p.dependents.total === 0 ? (
                      <span className="text-xs text-slate-500">nothing yet</span>
                    ) : (
                      <span className="text-xs text-slate-700">
                        {p.dependents.total} record{p.dependents.total === 1 ? '' : 's'}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <SecondaryButton
                        disabled={busyId === p.periodId}
                        onClick={() => {
                          setAdding(false);
                          setNotice(null);
                          setRowError(null);
                          setEditing(p);
                        }}
                      >
                        Edit
                      </SecondaryButton>
                      {p.status === 'CLOSED' ? (
                        <SecondaryButton
                          disabled={busyId === p.periodId}
                          onClick={() => void reopen(p)}
                        >
                          Reopen
                        </SecondaryButton>
                      ) : (
                        <SecondaryButton
                          disabled={busyId === p.periodId}
                          onClick={() => void close(p)}
                        >
                          Close
                        </SecondaryButton>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </ConfigTable>
            <p className="text-xs text-slate-500">
              A period is closed, never deleted — eligibility, entitlements, issue windows and
              vouchers refer to it. A closed period is never the operational period, and stays
              available on the Eligibility screen for a historical correction.
            </p>
          </>
        )
      ) : null}
    </div>
  );
}

/**
 * The create and edit form, which are the same four questions.
 *
 * On edit, the date fields are DISABLED once anything references the period,
 * and the form says how many records and why — rather than silently refusing on
 * submit. Moving the dates of a period that already holds eligibility or issue
 * windows would reinterpret records written against the old dates, so the
 * server refuses it too; this is the same rule stated early enough to be
 * useful.
 */
function PeriodForm({
  mode,
  period,
  onDone,
  onCancel,
}: {
  mode: 'create' | 'edit';
  period?: EntitlementPeriod;
  onDone: (period: EntitlementPeriod) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(period?.name ?? '');
  const [startDate, setStartDate] = useState(period?.startDate ?? '');
  const [endDate, setEndDate] = useState(period?.endDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const datesLocked = mode === 'edit' && period !== undefined && !period.datesEditable;
  const valid = name.trim() !== '' && startDate !== '' && endDate !== '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setError(null);
    setBusy(true);
    try {
      const result =
        mode === 'create'
          ? await createPeriod({ name: name.trim(), startDate, endDate })
          : await updatePeriod(period!.periodId, { name: name.trim(), startDate, endDate });
      if (mode === 'create') {
        setName('');
        setStartDate('');
        setEndDate('');
      }
      onDone(result);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <FieldLabel
        label="Period name"
        hint="The facility's own name for this period. It must be unique."
      >
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          aria-label="Period name"
        />
      </FieldLabel>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[10rem] flex-1">
          <FieldLabel label="Start date">
            <TextInput
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={datesLocked}
              aria-label="Start date"
            />
          </FieldLabel>
        </div>
        <div className="min-w-[10rem] flex-1">
          <FieldLabel label="End date" hint="Must be after the start date.">
            <TextInput
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={datesLocked}
              aria-label="End date"
            />
          </FieldLabel>
        </div>
      </div>

      {datesLocked ? (
        <p className="text-xs font-semibold text-brand-amberDark">
          The dates cannot be changed: {period!.dependents.total} record
          {period!.dependents.total === 1 ? '' : 's'} already belong to this period. The name can
          still be corrected, and the period can be closed.
        </p>
      ) : null}

      <ConfigError error={error} />

      <p className="text-xs text-slate-500">
        Periods cannot overlap, not even by one day. Whichever period contains today, and is not
        closed, is the operational one — a new period does not have to be created as active.
      </p>

      <div className="flex gap-2">
        <PrimaryButton disabled={busy || !valid}>
          {busy ? 'Saving…' : mode === 'create' ? 'Create period' : 'Save changes'}
        </PrimaryButton>
        {onCancel ? (
          <SecondaryButton type="button" onClick={onCancel}>
            Cancel
          </SecondaryButton>
        ) : null}
      </div>
    </form>
  );
}
