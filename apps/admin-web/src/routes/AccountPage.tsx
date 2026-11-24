import { useNavigate } from 'react-router-dom';
import { useStaffAuth } from '../lib/auth/StaffAuthContext';
import { EmptyState } from '../design-system/States';

/**
 * The signed-in staff member's own account (STEP 10 Section 3:
 * profile / account / logout).
 *
 * Everything shown here comes from `GET /admin/session`, which resolves
 * the account's roles and permissions from the database per request. No
 * new endpoint was added for this screen and nothing sensitive is
 * exposed: the session response deliberately carries no password hash,
 * no TOTP secret, no token and no other staff member's details.
 *
 * Permissions are listed verbatim, as their real codes, because a staff
 * member asking "why can't I see X" needs the truth rather than a
 * friendly paraphrase that may not match what the server enforces.
 */
export function AccountPage() {
  const { session, logout } = useStaffAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  if (!session) {
    return <EmptyState title="Your account details could not be loaded." />;
  }

  return (
    <section aria-labelledby="account-heading" className="flex flex-col gap-4">
      <div>
        <h1 id="account-heading" className="text-xl font-bold text-brand-forest">
          Your account
        </h1>
        <p className="mt-1 text-sm text-slate-500">Read-only. Contact a super administrator to change access.</p>
      </div>

      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2">
        <Field label="Name" value={session.displayName ?? '—'} />
        <Field label="Username" value={session.username ?? '—'} />
      </dl>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-800">Roles</h2>
        {session.roles.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No role is assigned to your account, so no module is available to you.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2" role="list">
            {session.roles.map((role) => (
              <li key={role} className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                {role}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-800">Permissions</h2>
        <p className="mt-1 text-xs text-slate-500">
          These are the exact permissions the server checks on every request.
        </p>
        {session.permissions.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">None granted.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2" role="list">
            {[...session.permissions].sort((a, b) => a.localeCompare(b)).map((permission) => (
              <li key={permission} className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
                {permission}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={onLogout}
          className="min-h-touch rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Log out
        </button>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-800">{value}</dd>
    </div>
  );
}
