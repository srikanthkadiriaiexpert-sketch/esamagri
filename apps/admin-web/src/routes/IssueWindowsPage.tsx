import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../lib/api/resource';
import { fetchPeriods, type EntitlementPeriodOption } from '../lib/api/rik-eligibility-api';
import {
  WINDOW_SLOTS,
  configureIssueWindow,
  daysInRange,
  fetchIssueWindowRevisions,
  fetchIssueWindows,
  updateIssueWindow,
  weekdayLabel,
  type IssueWindow,
  type IssueWindowRevision,
  type RationType,
} from '../lib/api/rik-issue-windows-api';
import { LoadingState, EmptyState, FailureState } from '../design-system/States';
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
} from '../design-system/ConfigUI';

/**
 * Issue schedules — RIK administration (STEP 15C).
 *
 * The facility's physical issue schedule: Fresh Issue 1, 2 and 3, the Dry
 * Issue, and the two Miss Muster issues, for one entitlement period at a
 * time.
 *
 * WHAT MAKES THIS SCREEN SAFE TO USE
 *
 *   Every slot is always shown, configured or not, so "Fresh Issue 2
 *   has not been set up" is visible rather than inferred from an absence.
 *   The issue being configured is named in the form's heading, because
 *   setting Issue 2's dates on Issue 3 is the mistake this screen exists to
 *   prevent.
 *
 *   The operating days are TICKED FROM THE WINDOW'S OWN DAYS. Choose the
 *   dates first and the day list follows, so an operating day outside its
 *   window cannot be submitted. Each day shows its weekday beside it, for
 *   recognition only — nothing here defaults to Tuesday, Wednesday and
 *   Friday, or assumes a week is seven days, because a holiday moves a day
 *   and the schedule is whatever the facility decides.
 *
 *   There is no delete. A window an officer was already shown stays on
 *   record; Retire withdraws it and Restore brings it back, and both are
 *   recorded in the window's revision history with the previous values.
 *
 * Mobile first: one column on a phone, the table scrolls sideways rather than
 * squashing, and every control meets the touch-target minimum.
 */
export function IssueWindowsPage() {
  const periods = useResource(() => fetchPeriods(), []);
  const [periodId, setPeriodId] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const windows = useResource(
    () => (periodId === '' ? Promise.resolve({ items: [] }) : fetchIssueWindows(periodId)),
    [periodId, reloadKey]
  );

  const [editing, setEditing] = useState<{ code: string; window: IssueWindow | null } | null>(null);
  const [historyFor, setHistoryFor] = useState<IssueWindow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const selectedPeriod = useMemo(
    () =>
      periods.status === 'success'
        ? periods.data.items.find((p) => p.periodId === periodId)
        : undefined,
    [periods, periodId]
  );

  const bySlot = useMemo(() => {
    const map = new Map<string, IssueWindow>();
    if (windows.status === 'success') {
      for (const w of windows.data.items) map.set(w.windowCode, w);
    }
    return map;
  }, [windows]);

  const toggleActive = async (window: IssueWindow) => {
    setRowError(null);
    setNotice(null);
    setBusyId(window.windowId);
    try {
      const next = await updateIssueWindow(window.windowId, { isActive: !window.isActive });
      setNotice(
        next.isActive
          ? `${next.label} is published again.`
          : `${next.label} is retired. The schedule and its history are kept.`
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
      <div>
        <h1 className="text-lg font-bold text-slate-900">Issue schedules</h1>
        <p className="mt-1 text-sm text-slate-600">
          When officers may collect their ration: three Fresh issues, one Dry issue and the two Miss Muster issues per period,
          with the days the facility will actually issue on. Every date is configured here — nothing
          is assumed about weekdays or month lengths.
        </p>
      </div>

      {periods.status === 'loading' ? <LoadingState label="Loading periods…" /> : null}
      {periods.status === 'error' ? <FailureState error={periods.error} onRetry={reload} /> : null}
      {periods.status === 'not_implemented' ? (
        <EmptyState title="Issue schedule configuration is not available yet." />
      ) : null}

      {periods.status === 'success' ? (
        periods.data.items.length === 0 ? (
          <EmptyState
            title="No entitlement period exists yet"
            description="An issue schedule belongs to a period, so a period has to exist before a schedule can be set."
          />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <FieldLabel
              label="Period"
              hint="The schedule is configured one period at a time, and an issue must fall inside it."
            >
              <SelectInput
                value={periodId}
                onChange={(e) => {
                  setPeriodId(e.target.value);
                  setEditing(null);
                  setHistoryFor(null);
                  setNotice(null);
                  setRowError(null);
                }}
                aria-label="Period"
              >
                <option value="">Choose a period…</option>
                {periods.data.items.map((p: EntitlementPeriodOption) => (
                  <option key={p.periodId} value={p.periodId}>
                    {p.name} ({p.startDate} → {p.endDate})
                  </option>
                ))}
              </SelectInput>
            </FieldLabel>
          </div>
        )
      ) : null}

      <ConfigNotice>{notice}</ConfigNotice>
      <ConfigError error={rowError} />

      {periodId === '' ? null : windows.status === 'loading' ? (
        <LoadingState label="Loading the schedule…" />
      ) : windows.status === 'error' ? (
        <FailureState error={windows.error} onRetry={reload} />
      ) : (
        <>
          <ConfigTable
            caption="Issue schedules for the selected period"
            head={
              <>
                <Th>Issue</Th>
                <Th>Dates</Th>
                <Th>Operating days</Th>
                <Th>Status</Th>
                <Th>Last changed</Th>
                <Th>Action</Th>
              </>
            }
          >
            {WINDOW_SLOTS.map((slot) => {
              const window = bySlot.get(slot.code) ?? null;
              return (
                <tr key={slot.code} className="border-b border-slate-100 last:border-0">
                  <Td>
                    <p className="font-semibold text-slate-800">{slot.label}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{slot.rationType}</p>
                  </Td>
                  <Td>
                    {window ? (
                      <span className="tabular-nums text-slate-700">
                        {window.startDate} → {window.endDate}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Not configured</span>
                    )}
                  </Td>
                  <Td>
                    {window ? (
                      <ul className="flex flex-wrap gap-1">
                        {window.operatingDays.map((day) => (
                          <li
                            key={day}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-700"
                          >
                            {day} <span className="text-slate-500">{weekdayLabel(day)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </Td>
                  <Td>
                    {window ? (
                      <span
                        className={[
                          'rounded-full px-2 py-0.5 text-xs font-semibold',
                          window.isActive
                            ? 'bg-brand-greenLight text-brand-greenDark'
                            : 'bg-slate-100 text-slate-600',
                        ].join(' ')}
                      >
                        {window.isActive ? 'Published' : 'Retired'}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </Td>
                  <Td>
                    {window ? (
                      <span className="text-xs text-slate-600">
                        {window.updatedAt.slice(0, 10)}
                        {window.updatedBy.name ? ` · ${window.updatedBy.name}` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <SecondaryButton
                        onClick={() => {
                          setEditing({ code: slot.code, window });
                          setHistoryFor(null);
                        }}
                      >
                        {window ? 'Edit' : 'Configure'}
                      </SecondaryButton>
                      {window ? (
                        <>
                          <SecondaryButton
                            disabled={busyId === window.windowId}
                            onClick={() => void toggleActive(window)}
                          >
                            {window.isActive ? 'Retire' : 'Restore'}
                          </SecondaryButton>
                          <SecondaryButton
                            onClick={() => {
                              setHistoryFor(window);
                              setEditing(null);
                            }}
                          >
                            History
                          </SecondaryButton>
                        </>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </ConfigTable>

          <p className="text-xs text-slate-500">
            A window is retired, never deleted — the schedule an officer was shown has to stay
            explicable. Officers see published windows only.
          </p>
        </>
      )}

      {editing && selectedPeriod ? (
        <WindowForm
          key={`${editing.code}-${editing.window?.windowId ?? 'new'}`}
          slot={WINDOW_SLOTS.find((s) => s.code === editing.code)!}
          period={selectedPeriod}
          window={editing.window}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setNotice(`${saved.label} saved: ${saved.startDate} → ${saved.endDate}.`);
            reload();
          }}
        />
      ) : null}

      {historyFor ? (
        <RevisionHistory window={historyFor} onClose={() => setHistoryFor(null)} />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ the form

function WindowForm({
  slot,
  period,
  window,
  onCancel,
  onSaved,
}: {
  slot: { rationType: RationType; sequenceNo: number; code: string; label: string };
  period: EntitlementPeriodOption;
  window: IssueWindow | null;
  onCancel: () => void;
  onSaved: (saved: IssueWindow) => void;
}) {
  const [startDate, setStartDate] = useState(window?.startDate ?? period.startDate);
  const [endDate, setEndDate] = useState(window?.endDate ?? period.endDate);
  const [days, setDays] = useState<string[]>(window?.operatingDays ?? []);
  const [notes, setNotes] = useState(window?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  /**
   * The days on offer are the window's OWN days. Narrow the range and a
   * now-outside day disappears from the list and from the selection, so the
   * form cannot submit an operating day outside its window — the refusal the
   * server and the database would both give.
   */
  const available = useMemo(() => daysInRange(startDate, endDate), [startDate, endDate]);
  const selected = useMemo(() => days.filter((d) => available.includes(d)), [days, available]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const saved =
        window === null
          ? await configureIssueWindow({
              periodId: period.periodId,
              rationType: slot.rationType,
              sequenceNo: slot.sequenceNo,
              startDate,
              endDate,
              operatingDays: selected,
              ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
            })
          : await updateIssueWindow(window.windowId, {
              startDate,
              endDate,
              operatingDays: selected,
              ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
            });
      onSaved(saved);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-brand-blue/40 bg-white p-4"
    >
      {/* Which window is being configured, said plainly. */}
      <h2 className="text-base font-bold text-slate-900">
        {window === null ? 'Configure' : 'Edit'} {slot.label}
      </h2>
      <p className="text-sm text-slate-600">
        {period.name} runs {period.startDate} → {period.endDate}. This window must fall inside it.
      </p>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[10rem] flex-1">
          <FieldLabel label="Start date">
            <TextInput
              type="date"
              value={startDate}
              min={period.startDate}
              max={period.endDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              aria-label="Start date"
            />
          </FieldLabel>
        </div>
        <div className="min-w-[10rem] flex-1">
          <FieldLabel label="End date">
            <TextInput
              type="date"
              value={endDate}
              min={startDate || period.startDate}
              max={period.endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              aria-label="End date"
            />
          </FieldLabel>
        </div>
      </div>

      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Operating days</legend>
        <p className="mb-2 text-xs text-slate-500">
          The days the facility will actually issue on. Tick whichever apply — a holiday or a local
          change moves them, so nothing is preset.
        </p>
        {available.length === 0 ? (
          <p className="text-sm text-slate-600">Choose the window dates first.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((day) => (
              <li key={day}>
                <label className="flex min-h-touch items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={selected.includes(day)}
                    onChange={(e) =>
                      setDays((current) =>
                        e.target.checked
                          ? [...current, day].sort()
                          : current.filter((d) => d !== day)
                      )
                    }
                    aria-label={`Issue on ${day}`}
                  />
                  <span className="tabular-nums">{day}</span>
                  <span className="text-xs text-slate-500">{weekdayLabel(day)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <FieldLabel label="Note" hint="Optional — why this window runs when it does.">
        <TextInput
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          aria-label="Note"
        />
      </FieldLabel>

      <ConfigError error={error} />

      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton disabled={busy || selected.length === 0}>
          {busy ? 'Saving…' : window === null ? `Configure ${slot.label}` : `Save ${slot.label}`}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
        {selected.length === 0 ? (
          <span className="text-xs text-slate-500">Tick at least one operating day.</span>
        ) : null}
      </div>
    </form>
  );
}

// -------------------------------------------------------------- the history

function RevisionHistory({ window, onClose }: { window: IssueWindow; onClose: () => void }) {
  const revisions = useResource(() => fetchIssueWindowRevisions(window.windowId), [window.windowId]);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">{window.label} — change history</h2>
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
      </div>
      <p className="text-sm text-slate-600">
        Every change to this window, newest first, with what it said before. Recorded by the
        database itself, and never rewritten.
      </p>

      {revisions.status === 'loading' ? <LoadingState label="Loading history…" /> : null}
      {revisions.status === 'error' ? <FailureState error={revisions.error} /> : null}
      {revisions.status === 'success' ? (
        <ConfigTable
          caption={`Revision history for ${window.label}`}
          head={
            <>
              <Th>No.</Th>
              <Th>Change</Th>
              <Th>Before</Th>
              <Th>After</Th>
              <Th>By</Th>
              <Th>When</Th>
            </>
          }
        >
          {revisions.data.items.map((r: IssueWindowRevision) => (
            <tr key={r.revisionId} className="border-b border-slate-100 last:border-0">
              <Td numeric>{r.revisionNo}</Td>
              <Td>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                  {r.changeType}
                </span>
              </Td>
              <Td>
                {r.before === null ? (
                  <span className="text-xs text-slate-400">—</span>
                ) : (
                  <StateSummary state={r.before} />
                )}
              </Td>
              <Td>
                <StateSummary state={r.after} />
              </Td>
              <Td>
                <span className="text-xs text-slate-600">{r.changedBy.name ?? '—'}</span>
              </Td>
              <Td>
                <span className="text-xs tabular-nums text-slate-600">
                  {r.changedAt.slice(0, 16).replace('T', ' ')}
                </span>
              </Td>
            </tr>
          ))}
        </ConfigTable>
      ) : null}
    </section>
  );
}

function StateSummary({
  state,
}: {
  state: { startDate: string; endDate: string; operatingDays: string[]; isActive: boolean };
}) {
  return (
    <div className="text-xs text-slate-700">
      <p className="tabular-nums">
        {state.startDate} → {state.endDate}
      </p>
      <p className="mt-0.5 tabular-nums text-slate-500">
        {state.operatingDays.length} day{state.operatingDays.length === 1 ? '' : 's'}:{' '}
        {state.operatingDays.join(', ')}
      </p>
      <p className="mt-0.5 text-slate-500">{state.isActive ? 'Published' : 'Retired'}</p>
    </div>
  );
}
