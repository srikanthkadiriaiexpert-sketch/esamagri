import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../lib/api/resource';
import {
  fetchOfficers,
  registerOfficer,
  setOfficerActive,
  revokeOfficerSessions,
  type DietaryPreference,
  type Officer,
  type RegisterOfficerResult,
} from '../lib/api/rik-officers-api';
import { LoadingState, EmptyState, FailureState } from '../design-system/States';
import {
  AddPanel,
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
 * Officers — RIK administration (STEP 15B Phase A).
 *
 * Registration is administrative: there is no customer-facing sign-up, so
 * this screen is where an officer first exists in e-Samagri. A RIK
 * administrator supplies the name, mobile number, residence and dietary
 * preference; everything else about the record is the system's.
 *
 * WHAT THIS SCREEN DOES NOT OFFER, AND WHY THE ABSENCE IS THE POINT
 *
 *   No RIK ID field. It is generated at the database boundary, so there is
 *   nothing to type and nothing to get wrong. The server refuses one if it is
 *   sent anyway.
 *
 *   No eligible-days field. Eligibility is the facility's own operational
 *   data and arrives through its own import. An officer registered a moment
 *   ago has none recorded, and the customer app already says exactly that
 *   rather than showing a zero.
 *
 *   No service number, rank or unit. The specification prohibits collecting
 *   them, so they are not on the form and the server rejects them in a body.
 *
 *   No delete. An officer is deactivated: their RIK ID appears on issue
 *   records that have to stay readable afterwards.
 *
 * TWO OUTCOMES FROM ONE FORM (Task 2). The mobile number decides, and the
 * SERVER decides it — after canonicalising the number and looking it up. If
 * nobody holds that number, a new officer is created. If a resident already
 * has an e-Samagri account through PIF, that resident is issued a RIK ID in
 * place, keeping their orders, their history, their display name and their
 * dietary preference. There is deliberately no "check this number first"
 * request: it would add an endpoint that answers a question the submit already
 * answers, and would let anyone with this screen test whether a given mobile
 * number has an account.
 */
export function OfficersPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const officers = useResource(() => fetchOfficers({ q: query }), [reloadKey, query]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * DELIBERATE CONFIRMATION, WITHOUT A BROWSER DIALOG.
   *
   * Signing an officer out of every device is not destructive — nothing is
   * deleted and they can sign in again — but it IS disruptive to someone who
   * may be mid-order, so it must not happen on a single stray click. This
   * holds the id of the one row that is armed: the first click arms it and
   * changes the label to say what will happen, the second click does it, and
   * arming a different row disarms this one.
   *
   * A two-step button rather than `window.confirm`: a native dialog blocks
   * the page, cannot say the fifteen-minute caveat in its own words, and is
   * awkward to test. This is testable and reads in place.
   */
  const [armedRevokeId, setArmedRevokeId] = useState<string | null>(null);

  const revokeSessions = async (officer: Officer) => {
    setRowError(null);
    setNotice(null);
    setBusyId(officer.officerId);
    try {
      const result = await revokeOfficerSessions(officer.officerId);
      setNotice(
        result.revokedSessions === 0
          ? `${result.rikId} had no active sessions. Nothing to sign out.`
          : `${result.rikId} signed out of ${result.revokedSessions} ` +
            `${result.revokedSessions === 1 ? 'device' : 'devices'}. ` +
            'They will need a new OTP to sign in. An app already open may keep working ' +
            'for up to 15 minutes.'
      );
      // Disarm regardless of outcome, so a failure cannot leave a primed
      // button behind for the next person to press by accident.
      setArmedRevokeId(null);
      reload();
    } catch (err: unknown) {
      setRowError(err);
      setArmedRevokeId(null);
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (officer: Officer) => {
    setRowError(null);
    setNotice(null);
    setBusyId(officer.officerId);
    try {
      const next = await setOfficerActive(officer.officerId, officer.status !== 'ACTIVE');
      setNotice(
        next.status === 'ACTIVE'
          ? `${next.rikId} is active again.`
          : `${next.rikId} is no longer active. The record and its RIK ID are kept.`
      );
      reload();
    } catch (err: unknown) {
      setRowError(err);
    } finally {
      setBusyId(null);
    }
  };

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    setQuery(search);
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Officers</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every officer carries a permanent RIK ID, issued by the system when the record is created. Search by RIK
          ID, name, mobile number or quarter.
        </p>
      </div>

      <form onSubmit={onSearch} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <FieldLabel label="Search officers">
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="RIK-O-000001, name, mobile or quarter"
              aria-label="Search officers"
            />
          </FieldLabel>
        </div>
        <PrimaryButton>Search</PrimaryButton>
        {query.length > 0 ? (
          <SecondaryButton
            type="button"
            onClick={() => {
              setSearch('');
              setQuery('');
            }}
          >
            Clear
          </SecondaryButton>
        ) : null}
      </form>

      <AddPanel title="Register an officer" open={adding} onToggle={() => setAdding((v) => !v)}>
        <RegisterOfficerForm
          onRegistered={(result) => {
            setAdding(false);
            setNotice(registrationNotice(result));
            setSearch('');
            setQuery('');
            reload();
          }}
        />
      </AddPanel>

      <ConfigNotice>{notice}</ConfigNotice>
      <ConfigError error={rowError} />

      {officers.status === 'loading' ? <LoadingState label="Loading officers…" /> : null}
      {officers.status === 'error' ? <FailureState error={officers.error} onRetry={reload} /> : null}
      {officers.status === 'not_implemented' ? (
        <EmptyState title="Officer records are not available yet." />
      ) : null}

      {officers.status === 'success' ? (
        officers.data.items.length === 0 ? (
          <EmptyState
            title={query.length > 0 ? 'No officer matches that search' : 'No officers are registered yet'}
            description={
              query.length > 0
                ? 'Try the RIK ID, the mobile number, or part of the name.'
                : 'Register the first officer to give them a RIK ID.'
            }
          />
        ) : (
          <>
            <ConfigTable
              caption="Registered officers"
              head={
                <>
                  <Th>RIK ID</Th>
                  <Th>Officer</Th>
                  <Th>Mobile</Th>
                  <Th>Quarter</Th>
                  <Th>Diet</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </>
              }
            >
              {officers.data.items.map((officer) => (
                <tr key={officer.officerId} className="border-b border-slate-100 last:border-0">
                  <Td>
                    <span className="font-mono text-sm font-bold text-slate-900">{officer.rikId}</span>
                  </Td>
                  <Td>
                    <p className="font-semibold text-slate-800">{officer.name}</p>
                    {officer.officialName && officer.officialName !== officer.name ? (
                      <p className="mt-0.5 text-xs text-slate-500">Official: {officer.officialName}</p>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-slate-700">{officer.mobileNumber}</span>
                  </Td>
                  <Td>
                    {officer.residence
                      ? `${officer.residence.quarterBlock} ${officer.residence.quarterNumber}`
                      : '—'}
                  </Td>
                  <Td>{officer.dietaryPreference ?? '—'}</Td>
                  <Td>
                    <span
                      className={[
                        'rounded-full px-2 py-0.5 text-xs font-semibold',
                        officer.status === 'ACTIVE'
                          ? 'bg-brand-greenLight text-brand-greenDark'
                          : 'bg-slate-100 text-slate-600',
                      ].join(' ')}
                    >
                      {officer.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1.5">
                      <SecondaryButton
                        disabled={busyId === officer.officerId}
                        onClick={() => void toggleActive(officer)}
                      >
                        {officer.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                      </SecondaryButton>
                      <SecondaryButton
                        disabled={busyId === officer.officerId}
                        onClick={() => {
                          if (armedRevokeId === officer.officerId) {
                            void revokeSessions(officer);
                          } else {
                            setArmedRevokeId(officer.officerId);
                            setNotice(null);
                            setRowError(null);
                          }
                        }}
                      >
                        {armedRevokeId === officer.officerId
                          ? 'Confirm sign-out'
                          : 'Sign out all devices'}
                      </SecondaryButton>
                      {armedRevokeId === officer.officerId ? (
                        <p className="max-w-[16rem] text-xs text-brand-amberDark">
                          Ends every session on every device. They keep their RIK ID and
                          entitlement, and can sign in again with a new OTP. An app already
                          open may keep working for up to 15 minutes.
                        </p>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </ConfigTable>
            <p className="text-xs text-slate-500">
              Showing {officers.data.items.length} of {officers.data.total}. An officer is deactivated, never
              deleted — their RIK ID stays on the issue records that name it.
            </p>
          </>
        )
      ) : null}
    </div>
  );
}

/**
 * What to tell the administrator, which depends on what the server did.
 *
 * Both sentences name the RIK ID the server issued, because that is the thing
 * the administrator will go on to use. The LINKED sentence additionally says
 * what was NOT changed, for two reasons: it is the question the administrator
 * would otherwise ask, and someone who typed a name into the form and sees a
 * different name in the message needs to know immediately that this is correct
 * and whose name it is.
 *
 * Both read `result`, never the form's own state, so the screen can only
 * report what the record actually holds.
 */
function registrationNotice(result: RegisterOfficerResult): string {
  if (result.outcome === 'LINKED') {
    return (
      `Linked ${result.name} to RIK ID ${result.rikId}. This resident already had an e-Samagri ` +
      `account, so their own name and dietary preference were left as they are.`
    );
  }
  return `Registered ${result.name} as ${result.rikId}.`;
}

const DIETS: readonly { value: DietaryPreference; label: string }[] = [
  { value: 'PV', label: 'PV — pure vegetarian' },
  { value: 'EV', label: 'EV — egg vegetarian' },
  { value: 'NV', label: 'NV — non-vegetarian' },
];

function RegisterOfficerForm({
  onRegistered,
}: {
  onRegistered: (result: RegisterOfficerResult) => void;
}) {
  const [name, setName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [quarterBlock, setQuarterBlock] = useState('');
  const [quarterNumber, setQuarterNumber] = useState('');
  const [landmark, setLandmark] = useState('');
  const [dietaryPreference, setDietaryPreference] = useState<DietaryPreference | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await registerOfficer({
        name,
        mobileNumber,
        quarterBlock,
        quarterNumber,
        landmark: landmark.trim().length > 0 ? landmark : undefined,
        // OMITTED, never ''. An empty string is a value, and the server would
        // refuse it as an invalid preference; absence is what says "this form
        // is not answering that question". On the linking path the resident's
        // own preference must survive untouched, and the only way to be sure
        // of that from here is to send nothing.
        dietaryPreference: dietaryPreference === '' ? undefined : dietaryPreference,
      });
      setName('');
      setMobileNumber('');
      setQuarterBlock('');
      setQuarterNumber('');
      setLandmark('');
      setDietaryPreference('');
      onRegistered(result);
    } catch (err: unknown) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <FieldLabel label="Officer name">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
          aria-label="Officer name"
        />
      </FieldLabel>

      <FieldLabel
        label="Mobile number"
        hint="Ten digits. +91, spaces and hyphens are accepted and removed."
      >
        <TextInput
          value={mobileNumber}
          onChange={(e) => setMobileNumber(e.target.value)}
          inputMode="tel"
          maxLength={20}
          required
          aria-label="Mobile number"
        />
      </FieldLabel>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[8rem] flex-1">
          <FieldLabel label="Quarter block">
            <TextInput
              value={quarterBlock}
              onChange={(e) => setQuarterBlock(e.target.value)}
              maxLength={60}
              required
              aria-label="Quarter block"
            />
          </FieldLabel>
        </div>
        <div className="min-w-[8rem] flex-1">
          <FieldLabel label="Quarter number">
            <TextInput
              value={quarterNumber}
              onChange={(e) => setQuarterNumber(e.target.value)}
              maxLength={60}
              required
              aria-label="Quarter number"
            />
          </FieldLabel>
        </div>
      </div>

      <FieldLabel label="Landmark" hint="Optional.">
        <TextInput
          value={landmark}
          onChange={(e) => setLandmark(e.target.value)}
          maxLength={120}
          aria-label="Landmark"
        />
      </FieldLabel>

      {/*
        NOT `required`, and that is the whole of requirement T2-9.
        Marking it required would make the browser block the submit, which
        would make it impossible to link a resident who already has an account
        — the one case where this form must not state a preference at all. The
        rule has not been dropped, only moved to where the information is: the
        server requires it on the create path and refuses a value outside the
        set, and it is the server that knows which path applies.
      */}
      <FieldLabel
        label="Dietary preference"
        hint="Required for a new officer. Leave blank when the mobile number belongs to a resident who already has an e-Samagri account — their own preference is never changed by this form."
      >
        <SelectInput
          value={dietaryPreference}
          onChange={(e) => setDietaryPreference(e.target.value as DietaryPreference | '')}
          aria-label="Dietary preference"
        >
          <option value="">Choose…</option>
          {DIETS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </SelectInput>
      </FieldLabel>

      <ConfigError error={error} />

      <p className="text-xs text-slate-500">
        The RIK ID is issued automatically. Eligible days are not entered here — they come from the facility's
        eligibility data.
      </p>

      <p className="text-xs text-slate-500">
        If this mobile number already belongs to a resident with an e-Samagri account, they are issued a RIK ID
        on that same account and keep their orders and history. Their dietary preference stays blank here until
        they choose it themselves.
      </p>

      <div>
        <PrimaryButton disabled={busy}>{busy ? 'Registering…' : 'Register officer'}</PrimaryButton>
      </div>
    </form>
  );
}
