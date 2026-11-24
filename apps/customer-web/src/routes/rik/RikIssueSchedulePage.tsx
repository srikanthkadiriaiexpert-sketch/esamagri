import { Header } from '../../design-system/Header';
import { LoadingState, EmptyState, ErrorState } from '../../design-system/StateViews';
import { useResource } from '../../lib/api/resource';
import { ApiError } from '../../lib/api/client';
import {
  fetchIssueSchedule,
  formatIssueDay,
  formatRange,
  type IssueSchedule,
  type IssueWindowView,
} from '../../lib/api/rik-issue-schedule-api';

/**
 * When you may collect your ration (STEP 15C).
 *
 * READ ONLY, and that is the whole design. The officer sees the three Fresh
 * issues and the Dry issue the facility has published for this period, each
 * with its dates and the days it will actually open. There is no control on
 * this screen that changes anything, no form, and no request this page can
 * make other than the GET that loads it.
 *
 * WHAT IT DOES NOT SHOW
 *
 *   No issue the facility has retired — a withdrawn date would read as one
 *   an officer could travel on. No note, no "last changed by", no revision
 *   history: those are the administrator's records, and the server does not
 *   send them here.
 *
 * NOTHING IS HARDCODED. Not the dates, not the number of operating days, not
 * the weekdays. If the facility moves a day for a holiday, this screen says
 * the new day the moment it is published, because every value on it comes
 * from the configured schedule.
 *
 * Mobile first: one column, cards rather than a table, 16px gutters, and the
 * issue days wrap instead of scrolling sideways.
 */
export function RikIssueSchedulePage() {
  const schedule = useResource<IssueSchedule>(() => fetchIssueSchedule(), undefined, []);

  const noOpenPeriod =
    schedule.status === 'error' &&
    schedule.error instanceof ApiError &&
    schedule.error.details?.reason === 'NO_OPEN_PERIOD';

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="Issue schedule" showBack tone="forest" />

      <main className="px-4 py-4">
        <p className="text-sm leading-relaxed text-slate-600">
          When you may collect your ration this period. The facility sets these dates — they can
          change, and this screen always shows the current schedule.
        </p>

        {schedule.status === 'loading' ? (
          <div className="mt-4">
            <LoadingState label="Loading the schedule…" />
          </div>
        ) : null}

        {noOpenPeriod ? (
          <div className="mt-4">
            <EmptyState
              title="No ration period is open"
              description="When the facility opens the next period and publishes its issue dates, they will appear here."
            />
          </div>
        ) : schedule.status === 'error' ? (
          <div className="mt-4">
            <ErrorState description="The issue schedule could not be loaded." />
          </div>
        ) : null}

        {schedule.status === 'not_implemented' ? (
          <div className="mt-4">
            <ErrorState
              variant="not_implemented"
              description="The issue schedule is being set up and will appear here soon."
            />
          </div>
        ) : null}

        {schedule.status === 'success' ? (
          <>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {schedule.data.period.name}
            </p>

            <WindowGroup
              heading="Fresh"
              description="Vegetables, fruit, milk, eggs and meat."
              windows={schedule.data.fresh}
              accent="green"
            />

            <WindowGroup
              heading="Dry"
              description="Cereals, dal, oil, sugar and other dry provisions."
              windows={schedule.data.dry}
              accent="amber"
            />

            {/*
              The two Miss Muster issues, below Dry. Each renders only when
              the facility has published dates for it — WindowGroup returns
              null on an empty list — so a period with none looks exactly as
              it did before.
            */}
            <WindowGroup
              heading="Miss Muster Fresh"
              description="Fresh provisions for officers who missed their issue."
              windows={schedule.data.missMusterFresh ?? []}
              accent="green"
            />

            <WindowGroup
              heading="Miss Muster Dry"
              description="Dry provisions for officers who missed their issue."
              windows={schedule.data.missMusterDry ?? []}
              accent="amber"
            />

            {schedule.data.fresh.length === 0 &&
            schedule.data.dry.length === 0 &&
            (schedule.data.missMusterFresh ?? []).length === 0 &&
            (schedule.data.missMusterDry ?? []).length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title="No issue dates published yet"
                  description="The facility has not published this period's issue dates. Please check back."
                />
              </div>
            ) : null}

            <p className="mt-6 text-xs leading-relaxed text-slate-500">
              These dates are set by the Base Victualling Yard. If you cannot collect on a listed
              day, speak to the facility — the schedule cannot be changed from this app.
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}

function WindowGroup({
  heading,
  description,
  windows,
  accent,
}: {
  heading: string;
  description: string;
  windows: IssueWindowView[];
  accent: 'green' | 'amber';
}) {
  if (windows.length === 0) return null;

  const tone =
    accent === 'green'
      ? 'border-brand-green/25 bg-brand-greenLight'
      : 'border-brand-amber/30 bg-brand-amberLight';
  const chip =
    accent === 'green' ? 'bg-white/70 text-brand-greenDark' : 'bg-white/70 text-brand-amberDark';
  const title = accent === 'green' ? 'text-brand-greenDark' : 'text-brand-amberDark';

  /**
   * A SLUG, not just a lowercased heading.
   *
   * `aria-labelledby` takes a space-separated LIST of ids, so a heading of
   * more than one word — "Miss Muster Fresh" — produced three id references
   * that matched nothing. The section was left with no accessible name and,
   * in consequence, no `region` role at all. "Fresh" and "Dry" are single
   * words, which is why this never showed up before.
   */
  const headingId = `issue-${heading.toLowerCase().replace(/\s+/g, '-')}-heading`;

  return (
    <section className="mt-5" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-sm font-bold text-slate-900">
        {heading}
      </h2>
      <p className="mt-0.5 text-xs text-slate-500">{description}</p>

      <ul className="mt-2 flex flex-col gap-3">
        {windows.map((w) => (
          <li key={w.windowCode}>
            <article className={['rounded-2xl border p-4', tone].join(' ')}>
              <h3 className={['text-sm font-bold', title].join(' ')}>{w.label}</h3>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-800">
                {formatRange(w.startDate, w.endDate)}
              </p>

              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Issue days
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {w.operatingDays.map((day) => (
                  <li
                    key={day}
                    className={['rounded-lg px-2 py-1 text-xs font-semibold', chip].join(' ')}
                  >
                    {formatIssueDay(day)}
                  </li>
                ))}
              </ul>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
