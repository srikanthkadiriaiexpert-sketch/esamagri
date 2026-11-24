import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../lib/api/resource';
import {
  createAnnouncement,
  fetchAnnouncements,
  type AnnouncementAudience,
  type AnnouncementListResponse,
  type AnnouncementPriority,
} from '../lib/api/admin-api';
import { LoadingState, EmptyState, FailureState } from '../design-system/States';
import { ApiError, NetworkError } from '../lib/api/client';

const PRIORITIES: readonly AnnouncementPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/**
 * Announcement administration (STEP 10 Section 7).
 *
 * The audience options offered here come from the server's own
 * `manageableAudiences`, so a RIK_ADMIN is never shown a PIF option and
 * vice versa. That is a courtesy, not the control: the server checks the
 * audience again on every create, and refuses with 403 regardless of
 * what the browser sends — proven by the role-isolation tests.
 *
 * Priorities and audiences are the frozen table's own CHECK-constraint
 * values. Nothing about announcement content is invented here: the list
 * renders exactly what the database holds, which is an honest empty
 * state until staff create something.
 */
export function AnnouncementsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const list = useResource<AnnouncementListResponse>(() => fetchAnnouncements(), [reloadKey]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <section aria-labelledby="announcements-heading">
      <h1 id="announcements-heading" className="mb-1 text-xl font-bold text-brand-forest">
        Announcements
      </h1>
      <p className="mb-4 text-sm text-slate-500">Notices shown to customers in the app.</p>

      {list.status === 'loading' ? <LoadingState label="Loading announcements…" /> : null}
      {list.status === 'error' ? <FailureState error={list.error} onRetry={reload} /> : null}
      {list.status === 'not_implemented' ? <EmptyState title="Announcements are not available yet." /> : null}

      {list.status === 'success' ? (
        <div className="flex flex-col gap-6">
          <CreateForm audiences={list.data.manageableAudiences} onCreated={reload} />

          {list.data.items.length === 0 ? (
            <EmptyState
              title="No announcements yet"
              description="Anything published here appears in the customer app for the audience you choose."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">Announcements you can see</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Title</th>
                    <th scope="col" className="px-4 py-2.5">Audience</th>
                    <th scope="col" className="px-4 py-2.5">Priority</th>
                    <th scope="col" className="px-4 py-2.5">Status</th>
                    <th scope="col" className="px-4 py-2.5">Starts</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((a) => (
                    <tr key={a.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">{a.title}</p>
                        <p className="mt-0.5 line-clamp-2 max-w-md text-xs text-slate-500">{a.body}</p>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700">{a.targetAudience}</td>
                      <td className="px-4 py-3 text-slate-700">{a.priority}</td>
                      <td className="px-4 py-3">
                        <span
                          className={[
                            'rounded px-2 py-0.5 text-xs font-bold',
                            a.isPublished ? 'bg-brand-greenLight text-brand-greenDark' : 'bg-slate-100 text-slate-600',
                          ].join(' ')}
                        >
                          {a.isPublished ? 'Published' : 'Draft'}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-600">{a.startDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function CreateForm({ audiences, onCreated }: { audiences: AnnouncementAudience[]; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<AnnouncementAudience | ''>(audiences[0] ?? '');
  const [priority, setPriority] = useState<AnnouncementPriority>('NORMAL');
  const [publish, setPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (audiences.length === 0) {
    return (
      <EmptyState
        title="You can view announcements but not create them"
        description="Creating an announcement requires an audience your role administers."
      />
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !body.trim() || !audience) {
      setError('Enter a title, a message and an audience.');
      return;
    }
    setBusy(true);
    try {
      await createAnnouncement({
        title: title.trim(),
        body: body.trim(),
        announcementType: 'GENERAL',
        targetAudience: audience,
        priority,
        isPublished: publish,
      });
      setTitle('');
      setBody('');
      setPublish(false);
      onCreated();
    } catch (err: unknown) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-800">New announcement</h2>
      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-semantic-danger/30 bg-semantic-dangerLight px-3 py-2 text-sm text-semantic-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className="mt-1 min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="text-sm font-medium text-slate-700 sm:col-span-2">
          Message
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={4000}
            className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="text-sm font-medium text-slate-700">
          Audience
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as AnnouncementAudience)}
            className="mt-1 min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {audiences.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-slate-700">
          Priority
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as AnnouncementPriority)}
            className="mt-1 min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} className="h-4 w-4" />
          Publish immediately
        </label>
        <button
          type="submit"
          disabled={busy}
          className="min-h-touch rounded-lg bg-brand-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Create announcement'}
        </button>
      </div>
    </form>
  );
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'You cannot create an announcement for that audience.';
    if (err.status === 400) return 'Please check the details you entered and try again.';
    if (err.status === 401) return 'Your session has expired. Please sign in again.';
    return 'The announcement could not be saved. Please try again.';
  }
  if (err instanceof NetworkError) return 'The server could not be reached. Check your connection and try again.';
  return 'The announcement could not be saved. Please try again.';
}
