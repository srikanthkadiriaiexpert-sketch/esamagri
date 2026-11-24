import { useState } from 'react';
import { useResource } from '../lib/api/resource';
import { fetchIssueSchedules, type IssueScheduleListResponse } from '../lib/api/admin-api';
import { LoadingState, EmptyState, FailureState } from '../design-system/States';

/**
 * RIK issue schedules (STEP 10 Section 8) — a read-only administrative
 * view over the existing `rik.issue_schedules` table, gated by the
 * existing `rik.issue_schedule.manage` permission.
 *
 * Creating a schedule is deliberately not offered: real issue dates,
 * category windows and collection timings are unresolved business
 * decisions (BD-4, plus BD-1/BD-3 for anything category-scoped). The
 * server exposes no creation endpoint either, so this is a boundary
 * rather than a hidden button.
 */
export function IssueSchedulesPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const schedules = useResource<IssueScheduleListResponse>(() => fetchIssueSchedules(), [reloadKey]);

  return (
    <section aria-labelledby="issue-schedules-heading">
      <h1 id="issue-schedules-heading" className="mb-1 text-xl font-bold text-brand-blueDark">
        RIK issue schedules
      </h1>
      <p className="mb-4 text-sm text-slate-500">Issue days and windows recorded in the system.</p>

      {schedules.status === 'loading' ? <LoadingState label="Loading schedules…" /> : null}
      {schedules.status === 'error' ? <FailureState error={schedules.error} onRetry={() => setReloadKey((k) => k + 1)} /> : null}
      {schedules.status === 'not_implemented' ? <EmptyState title="Issue schedules are not available yet." /> : null}

      {schedules.status === 'success' ? (
        schedules.data.items.length === 0 ? (
          <EmptyState
            title="No issue schedules recorded"
            description="Schedules will appear here once the facility's issue days and windows are confirmed and entered."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">Recorded RIK issue schedules</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2.5">Date</th>
                  <th scope="col" className="px-4 py-2.5">Scope</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                  <th scope="col" className="px-4 py-2.5">Window</th>
                  <th scope="col" className="px-4 py-2.5">Published</th>
                </tr>
              </thead>
              <tbody>
                {schedules.data.items.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 tabular-nums text-slate-700">{s.scheduleDate}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {s.categoryId ? 'Category' : s.productId ? 'Product' : 'All items'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{s.status}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">
                      {s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{s.isPublished ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}
