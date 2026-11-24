import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../lib/api/resource';
import { useStaffAuth } from '../lib/auth/StaffAuthContext';
import {
  assignStaffRole,
  createStaff,
  describePasswordProblem,
  fetchStaff,
  fetchStaffRoles,
  PASSWORD_RULE_TEXT,
  resetStaffPassword,
  revokeStaffRole,
  setStaffStatus,
  updateStaff,
  type RoleSummary,
  type StaffAccount,
  staffRefusalMessage,
  type StaffListResponse,
} from '../lib/api/staff-api';
import { FieldLabel, PrimaryButton, SecondaryButton, SelectInput, TextInput } from '../design-system/ConfigUI';
import { EmptyState, FailureState, LoadingState, UnauthorizedState } from '../design-system/States';

const STATUS_FILTERS = ['', 'ACTIVE', 'SUSPENDED', 'DISABLED'] as const;

/**
 * Staff Management — Super Admin only.
 *
 * =====================================================================
 * WHAT THIS SCREEN IS NOT
 * =====================================================================
 *
 * It is not the Officers screen. `/rik/officers` registers the CUSTOMERS who
 * draw rations — people in shared.customers with a `rik_id`, who sign in with
 * a mobile number and a one-time code. This screen manages STAFF: the people
 * who operate this portal, who live in shared.users and sign in with a
 * username and a password. Confusing the two would be the most damaging
 * mistake available here, so they stay visibly separate: different heading,
 * different section, different API.
 *
 * =====================================================================
 * THE GUARD IN THIS FILE IS A COURTESY. THE REAL ONE IS THE SERVER.
 * =====================================================================
 *
 * The `can('shared.user.manage')` check below, and the navigation entry that
 * hides this page, exist so a staff member is not shown a door they cannot
 * open. Neither is a security control. Every request this screen makes is
 * authorized independently by the API against the live
 * shared.user_roles/role_permissions graph, so typing the URL as a RIK_ADMIN
 * reaches this component and then shows the honest refusal the server sent.
 * The role x route matrix in apps/api asserts that 403, for every seeded role.
 *
 * =====================================================================
 * THE ROLES OFFERED COME FROM THE DATABASE
 * =====================================================================
 *
 * `GET /admin/staff/roles` reads shared.roles and each role's real permission
 * codes, and the form offers exactly that. Nothing here hardcodes a role list,
 * so this screen cannot invent a role the database does not have — there is no
 * `RIK_STAFF`; the counter-facing RIK role is `RIK_PICKUP_STAFF`. Each role's
 * permissions are shown next to it, because "DELIVERY_STAFF" does not tell an
 * administrator that it carries PIF delivery codes and nothing for RIK.
 */
export function StaffPage() {
  const { can } = useStaffAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  /**
   * Hooks run before any early return, so the permission check has to be part
   * of the loader rather than a guard above it — otherwise a RIK_ADMIN opening
   * this URL would fire two requests purely to be refused twice. The server
   * would of course refuse them; asking anyway is just noise in the log.
   */
  const allowed = can('shared.user.manage');

  const list = useResource<StaffListResponse>(
    () =>
      !allowed
        ? Promise.resolve({ items: [], total: 0, limit: 0, offset: 0 })
        : fetchStaff({
            q: appliedQ === '' ? undefined : appliedQ,
            role: roleFilter === '' ? undefined : roleFilter,
            status: statusFilter === '' ? undefined : statusFilter,
            limit: 100,
          }),
    [reloadKey, appliedQ, roleFilter, statusFilter, allowed]
  );
  const roles = useResource<{ roles: RoleSummary[] }>(
    () => (!allowed ? Promise.resolve({ roles: [] }) : fetchStaffRoles()),
    [reloadKey, allowed]
  );

  if (!allowed) {
    return (
      <section aria-labelledby="staff-heading">
        <h1 id="staff-heading" className="mb-1 text-xl font-bold text-brand-forest">
          Staff Management
        </h1>
        <UnauthorizedState description="Managing staff accounts is reserved to Super Admin." />
      </section>
    );
  }

  const roleOptions = roles.status === 'success' ? roles.data.roles : [];

  return (
    <section aria-labelledby="staff-heading">
      <h1 id="staff-heading" className="mb-1 text-xl font-bold text-brand-forest">
        Staff Management
      </h1>
      <p className="mb-4 text-sm text-slate-500">
        Portal sign-in accounts for the people who run e&nbsp;Samagri. Ration officers are managed
        separately, under RIK Administration &rarr; Officers.
      </p>

      {notice === null ? null : (
        <p role="status" className="mb-4 rounded-lg bg-brand-greenLight px-4 py-2.5 text-sm font-semibold text-brand-greenDark">
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-6">
        <CreateStaffForm
          roles={roleOptions}
          onCreated={(account) => {
            setNotice(`Staff account ${account.username} created.`);
            reload();
          }}
        />

        <form
          className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedQ(q);
          }}
        >
          <FieldLabel label="Search name or username">
            <TextInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. Kumar or a.kumar"
              aria-label="Search staff by name or username"
            />
          </FieldLabel>
          <FieldLabel label="Role">
            <SelectInput
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              aria-label="Filter by role"
            >
              <option value="">All roles</option>
              {roleOptions.map((role) => (
                <option key={role.name} value={role.name}>
                  {role.name}
                </option>
              ))}
            </SelectInput>
          </FieldLabel>
          <FieldLabel label="Status">
            <SelectInput
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
            >
              {STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {status === '' ? 'All statuses' : status}
                </option>
              ))}
            </SelectInput>
          </FieldLabel>
          <PrimaryButton type="submit">Search</PrimaryButton>
        </form>

        {list.status === 'loading' ? <LoadingState label="Loading staff accounts…" /> : null}
        {list.status === 'error' ? <FailureState error={list.error} onRetry={reload} /> : null}
        {list.status === 'not_implemented' ? (
          <EmptyState title="Staff management is not available on this server." />
        ) : null}

        {list.status === 'success' ? (
          list.data.items.length === 0 ? (
            <EmptyState
              title="No staff accounts match"
              description="Clear the filters, or create an account above."
            />
          ) : (
            <>
              <p className="text-sm text-slate-500">
                {list.data.items.length} of {list.data.total} accounts
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full min-w-[52rem] text-left text-sm">
                  <caption className="sr-only">Staff accounts</caption>
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-2.5">Name</th>
                      <th scope="col" className="px-4 py-2.5">Username</th>
                      <th scope="col" className="px-4 py-2.5">Roles</th>
                      <th scope="col" className="px-4 py-2.5">Status</th>
                      <th scope="col" className="px-4 py-2.5">Last sign-in</th>
                      <th scope="col" className="px-4 py-2.5">Manage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.map((account) => (
                      <StaffRow
                        key={account.id}
                        account={account}
                        roles={roleOptions}
                        onChanged={(message) => {
                          setNotice(message);
                          reload();
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        ) : null}

        {roleOptions.length === 0 ? null : <RoleReference roles={roleOptions} />}
      </div>
    </section>
  );
}

function StaffRow({
  account,
  roles,
  onChanged,
}: {
  account: StaffAccount;
  roles: readonly RoleSummary[];
  onChanged: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-b border-slate-100 last:border-0" data-testid={`staff-row-${account.username}`}>
        <td className="px-4 py-3 font-semibold text-slate-800">{account.displayName}</td>
        <td className="px-4 py-3 font-mono text-xs text-slate-600">{account.username}</td>
        <td className="px-4 py-3 text-slate-700">
          {account.roles.length === 0 ? (
            <span className="text-xs italic text-slate-400">No role — can sign in, can reach nothing</span>
          ) : (
            account.roles.join(', ')
          )}
        </td>
        <td className="px-4 py-3">
          <span
            className={[
              'rounded px-2 py-0.5 text-xs font-bold',
              account.status === 'ACTIVE'
                ? 'bg-brand-greenLight text-brand-greenDark'
                : 'bg-amber-100 text-amber-800',
            ].join(' ')}
          >
            {account.status}
          </span>
        </td>
        <td className="px-4 py-3 tabular-nums text-slate-600">
          {account.lastLoginAt === null ? 'Never' : account.lastLoginAt.slice(0, 10)}
        </td>
        <td className="px-4 py-3">
          <SecondaryButton onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Close' : 'Manage'}
          </SecondaryButton>
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-slate-100 bg-slate-50 last:border-0">
          <td colSpan={6} className="px-4 py-4">
            <ManagePanel account={account} roles={roles} onChanged={onChanged} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * The per-account actions.
 *
 * Every refusal the server can return is shown verbatim, because the server's
 * messages are the ones that explain WHY — "this is the only active Super
 * Admin", "you cannot change your own status" — and a generic "something went
 * wrong" would hide exactly the information the administrator needs.
 */
function ManagePanel({
  account,
  roles,
  onChanged,
}: {
  account: StaffAccount;
  roles: readonly RoleSummary[];
  onChanged: (message: string) => void;
}) {
  const [displayName, setDisplayName] = useState(account.displayName);
  const [roleToAdd, setRoleToAdd] = useState('');
  const [reason, setReason] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (work: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await work());
    } catch (err) {
      setError(staffRefusalMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const assignable = roles.filter((role) => !account.roles.includes(role.name));
  const passwordProblem = newPassword === '' ? null : describePasswordProblem(newPassword, account.username);

  return (
    <div className="flex flex-col gap-5" aria-label={`Manage ${account.username}`}>
      {error === null ? null : (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <FieldLabel label="Full name">
          <TextInput
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-label={`Full name for ${account.username}`}
          />
        </FieldLabel>
        <SecondaryButton
          disabled={busy || displayName.trim() === account.displayName || displayName.trim().length < 2}
          onClick={() =>
            void act(async () => {
              const saved = await updateStaff(account.id, { displayName: displayName.trim() });
              return `${saved.username} renamed to ${saved.displayName}.`;
            })
          }
        >
          Save name
        </SecondaryButton>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <FieldLabel label="Add a role" hint="Roles come from the database, with the permissions each confers.">
          <SelectInput
            value={roleToAdd}
            onChange={(e) => setRoleToAdd(e.target.value)}
            aria-label={`Role to add for ${account.username}`}
          >
            <option value="">Choose a role…</option>
            {assignable.map((role) => (
              <option key={role.name} value={role.name}>
                {role.name}
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <SecondaryButton
          disabled={busy || roleToAdd === ''}
          onClick={() =>
            void act(async () => {
              const saved = await assignStaffRole(account.id, roleToAdd);
              setRoleToAdd('');
              return `${roleToAdd} granted to ${saved.username}.`;
            })
          }
        >
          Grant role
        </SecondaryButton>
        {account.roles.map((role) => (
          <SecondaryButton
            key={role}
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const saved = await revokeStaffRole(account.id, role);
                return `${role} removed from ${saved.username}.`;
              })
            }
          >
            Remove {role}
          </SecondaryButton>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <FieldLabel label="Reason" hint="Recorded in the audit log against this change.">
          <TextInput
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label={`Reason for changing ${account.username}`}
          />
        </FieldLabel>
        {account.status === 'ACTIVE' ? (
          <SecondaryButton
            disabled={busy || reason.trim().length < 5}
            onClick={() =>
              void act(async () => {
                const saved = await setStaffStatus(account.id, {
                  status: 'SUSPENDED',
                  reason: reason.trim(),
                });
                return `${saved.username} suspended. Their sessions were ended.`;
              })
            }
          >
            Suspend
          </SecondaryButton>
        ) : (
          <PrimaryButton
            disabled={busy || reason.trim().length < 5}
            onClick={() =>
              void act(async () => {
                const saved = await setStaffStatus(account.id, { status: 'ACTIVE', reason: reason.trim() });
                return `${saved.username} reactivated.`;
              })
            }
          >
            Reactivate
          </PrimaryButton>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <FieldLabel label="New password" hint={PASSWORD_RULE_TEXT}>
          <TextInput
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            aria-label={`New password for ${account.username}`}
          />
        </FieldLabel>
        <SecondaryButton
          disabled={busy || newPassword === '' || passwordProblem !== null || reason.trim().length < 5}
          onClick={() =>
            void act(async () => {
              const result = await resetStaffPassword(account.id, {
                newPassword,
                reason: reason.trim(),
              });
              setNewPassword('');
              return `Password reset for ${account.username}. ${result.revokedSessions} session(s) ended. Give them the new password yourself — it is not shown again.`;
            })
          }
        >
          Reset password
        </SecondaryButton>
        {passwordProblem === null ? null : (
          <p data-testid="password-problem" className="text-xs font-semibold text-red-700">
            {passwordProblem}
          </p>
        )}
      </div>
    </div>
  );
}

function CreateStaffForm({
  roles,
  onCreated,
}: {
  roles: readonly RoleSummary[];
  onCreated: (account: StaffAccount) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordProblem = password === '' ? null : describePasswordProblem(password, username);
  const ready =
    displayName.trim().length >= 2 && username.trim().length >= 3 && password !== '' && passwordProblem === null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await createStaff({
        displayName: displayName.trim(),
        username: username.trim(),
        password,
        role: role === '' ? undefined : role,
      });
      setDisplayName('');
      setUsername('');
      setPassword('');
      setRole('');
      onCreated(created);
    } catch (err) {
      setError(staffRefusalMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
      onSubmit={(e) => void onSubmit(e)}
      aria-label="Create a staff account"
    >
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Create a staff account</h2>

      {error === null ? null : (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <FieldLabel label="Full name">
          <TextInput
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-label="Full name"
          />
        </FieldLabel>
        <FieldLabel label="Username" hint="Lower-case letters, digits, dot, dash, underscore.">
          <TextInput
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            aria-label="Username"
          />
        </FieldLabel>
        <FieldLabel label="Initial password" hint={PASSWORD_RULE_TEXT}>
          <TextInput
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="Initial password"
          />
        </FieldLabel>
        <FieldLabel label="Role" hint="Optional. An account with no role can sign in but reach nothing.">
          <SelectInput value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
            <option value="">No role yet</option>
            {roles.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name}
              </option>
            ))}
          </SelectInput>
        </FieldLabel>
        <PrimaryButton type="submit" disabled={busy || !ready}>
          {busy ? 'Creating…' : 'Create account'}
        </PrimaryButton>
      </div>

      {passwordProblem === null ? null : (
        <p data-testid="password-problem" className="text-xs font-semibold text-red-700">
          {passwordProblem}
        </p>
      )}
      <p className="text-xs text-slate-500">
        You set the first password and tell the person yourself. The server stores only a bcrypt hash and
        never sends a password back, so this is the only time it is on screen.
      </p>
    </form>
  );
}

/** What each role actually confers, so a name is never assigned blind. */
function RoleReference({ roles }: { roles: readonly RoleSummary[] }) {
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-bold text-slate-700">
        What each role can do ({roles.length} roles)
      </summary>
      <ul className="mt-3 flex flex-col gap-3">
        {roles.map((role) => (
          <li key={role.name}>
            <p className="text-sm font-semibold text-slate-800">{role.name}</p>
            {role.description === null ? null : (
              <p className="text-xs text-slate-500">{role.description}</p>
            )}
            <p className="mt-1 font-mono text-xs text-slate-600">
              {role.permissions.length === 0 ? 'No permissions' : role.permissions.join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}
