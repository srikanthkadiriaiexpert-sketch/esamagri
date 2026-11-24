import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OfficersPage } from './OfficersPage';
import type {
  Officer,
  OfficerListResponse,
  RegisterOfficerInput,
  RegisterOfficerResult,
  RevokeSessionsResult,
} from '../lib/api/rik-officers-api';
import { ApiError } from '../lib/api/client';

const fetchOfficers = vi.fn<[{ q?: string }?, AbortSignal?], Promise<OfficerListResponse>>();
const registerOfficer = vi.fn<[RegisterOfficerInput], Promise<RegisterOfficerResult>>();
const setOfficerActive = vi.fn<[string, boolean], Promise<Officer>>();
const revokeOfficerSessions = vi.fn<[string], Promise<RevokeSessionsResult>>();

vi.mock('../lib/api/rik-officers-api', () => ({
  fetchOfficers: (...args: [{ q?: string }?, AbortSignal?]) => fetchOfficers(...args),
  registerOfficer: (...args: [RegisterOfficerInput]) => registerOfficer(...args),
  setOfficerActive: (...args: [string, boolean]) => setOfficerActive(...args),
  // Listed explicitly because this factory REPLACES the module: an export
  // the component imports and the factory omits arrives as undefined, and
  // the failure shows up only when something clicks it.
  revokeOfficerSessions: (...args: [string]) => revokeOfficerSessions(...args),
}));

const officer = (overrides: Partial<Officer> = {}): Officer => ({
  officerId: '01a11a22-0000-7000-8000-000000000001',
  rikId: 'RIK-O-000125',
  name: 'A. Singh',
  officialName: 'A. Singh',
  mobileNumber: '9876543210',
  dietaryPreference: 'NV',
  residence: { quarterBlock: 'B', quarterNumber: '102', landmark: null },
  status: 'ACTIVE',
  createdAt: '2026-10-08T10:00:00.000Z',
  ...overrides,
});

/**
 * The two shapes the register endpoint can answer with.
 *
 * `linked()` deliberately defaults `dietaryPreference` to null and gives a
 * different name from anything a test types into the form: on that path the
 * server writes neither field, so the response carries the RESIDENT's own
 * values and the screen must show those rather than echoing the input back.
 */
const registered = (overrides: Partial<Officer> = {}): RegisterOfficerResult => ({
  ...officer(overrides),
  outcome: 'REGISTERED',
});

const linked = (overrides: Partial<Officer> = {}): RegisterOfficerResult => ({
  ...officer({
    officerId: '01a11a22-0000-7000-8000-000000000009',
    rikId: 'RIK-O-000130',
    name: 'Anil Kumar',
    officialName: 'Lt Cdr Anil Kumar',
    mobileNumber: '9811122233',
    dietaryPreference: null,
    ...overrides,
  }),
  outcome: 'LINKED',
});

/** Fill the form's mandatory fields. The dietary preference is left alone. */
async function fillOfficerDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Officer name'), 'Lt Cdr Anil Kumar');
  await user.type(screen.getByLabelText('Mobile number'), '9811122233');
  await user.type(screen.getByLabelText('Quarter block'), 'D');
  await user.type(screen.getByLabelText('Quarter number'), '14');
}

const page = (items: Officer[], total = items.length): OfficerListResponse => ({
  items,
  total,
  limit: 25,
  offset: 0,
});

beforeEach(() => {
  fetchOfficers.mockReset();
  registerOfficer.mockReset();
  setOfficerActive.mockReset();
});

/**
 * STEP 15B Phase A — the officer administration screen.
 *
 * The assertions that matter most here are about ABSENCE: this screen must
 * not offer a RIK ID field, an eligible-days field, or any of the identity
 * fields the specification prohibits. Those are the mistakes a future edit
 * could reintroduce, so each one is pinned.
 */
describe('OfficersPage (STEP 15B Phase A)', () => {
  it('shows an honest empty state before any officer is registered', async () => {
    fetchOfficers.mockResolvedValue(page([]));
    render(<OfficersPage />);
    expect(await screen.findByText(/no officers are registered yet/i)).toBeInTheDocument();
    expect(screen.getByText(/give them a RIK ID/i)).toBeInTheDocument();
  });

  it('renders the RIK ID as the leading identifier', async () => {
    fetchOfficers.mockResolvedValue(page([officer()]));
    render(<OfficersPage />);
    const row = await screen.findByRole('row', { name: /RIK-O-000125/ });
    expect(within(row).getByText('RIK-O-000125')).toBeInTheDocument();
    expect(within(row).getByText('A. Singh')).toBeInTheDocument();
    expect(within(row).getByText('9876543210')).toBeInTheDocument();
    expect(within(row).getByText('B 102')).toBeInTheDocument();
    expect(within(row).getByText('NV')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
  });

  it('shows the facility spelling only when it differs from the display name', async () => {
    fetchOfficers.mockResolvedValue(page([officer({ officialName: 'Lt Cdr A. Singh' })]));
    render(<OfficersPage />);
    expect(await screen.findByText(/Official: Lt Cdr A. Singh/)).toBeInTheDocument();
  });

  it('does not repeat the name as an official name when the two match', async () => {
    fetchOfficers.mockResolvedValue(page([officer()]));
    render(<OfficersPage />);
    await screen.findByText('RIK-O-000125');
    expect(screen.queryByText(/^Official:/)).not.toBeInTheDocument();
  });

  it('marks an inactive officer as inactive and offers to restore them', async () => {
    fetchOfficers.mockResolvedValue(page([officer({ status: 'INACTIVE' })]));
    render(<OfficersPage />);
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reactivate/i })).toBeInTheDocument();
  });

  it('offers no delete anywhere on the screen', async () => {
    fetchOfficers.mockResolvedValue(page([officer()]));
    render(<OfficersPage />);
    await screen.findByText('RIK-O-000125');
    expect(screen.queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument();
    expect(screen.getByText(/deactivated, never\s*deleted/i)).toBeInTheDocument();
  });

  it('searches by what the administrator typed', async () => {
    fetchOfficers.mockResolvedValue(page([officer()]));
    render(<OfficersPage />);
    await screen.findByText('RIK-O-000125');

    await userEvent.type(screen.getByLabelText('Search officers'), 'RIK-O-000125');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(fetchOfficers).toHaveBeenLastCalledWith({ q: 'RIK-O-000125' });
  });

  it('says plainly when a search matches nobody', async () => {
    fetchOfficers.mockResolvedValue(page([officer()]));
    render(<OfficersPage />);
    await screen.findByText('RIK-O-000125');

    fetchOfficers.mockResolvedValue(page([]));
    await userEvent.type(screen.getByLabelText('Search officers'), 'nobody');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByText(/no officer matches that search/i)).toBeInTheDocument();
  });

  it('registers an officer and reports the identifier the server issued', async () => {
    fetchOfficers.mockResolvedValue(page([]));
    registerOfficer.mockResolvedValue(registered({ rikId: 'RIK-O-000126', name: 'B. Kumar' }));
    render(<OfficersPage />);
    await screen.findByText(/no officers are registered yet/i);

    await userEvent.click(screen.getByRole('button', { name: /register an officer/i }));
    await userEvent.type(screen.getByLabelText('Officer name'), 'B. Kumar');
    await userEvent.type(screen.getByLabelText('Mobile number'), '9876543211');
    await userEvent.type(screen.getByLabelText('Quarter block'), 'C');
    await userEvent.type(screen.getByLabelText('Quarter number'), '301');
    await userEvent.selectOptions(screen.getByLabelText('Dietary preference'), 'PV');
    await userEvent.click(screen.getByRole('button', { name: /register officer/i }));

    expect(registerOfficer).toHaveBeenCalledWith({
      name: 'B. Kumar',
      mobileNumber: '9876543211',
      quarterBlock: 'C',
      quarterNumber: '301',
      landmark: undefined,
      dietaryPreference: 'PV',
    });
    expect(await screen.findByText(/Registered B. Kumar as RIK-O-000126/)).toBeInTheDocument();
  });

  it('offers no RIK ID field — the identifier is the database’s', async () => {
    fetchOfficers.mockResolvedValue(page([]));
    render(<OfficersPage />);
    await screen.findByText(/no officers are registered yet/i);
    await userEvent.click(screen.getByRole('button', { name: /register an officer/i }));

    expect(screen.queryByLabelText(/rik id/i)).not.toBeInTheDocument();
    expect(screen.getByText(/RIK ID is issued automatically/i)).toBeInTheDocument();
  });

  it('offers no eligible-days field, and says where eligibility comes from', async () => {
    fetchOfficers.mockResolvedValue(page([]));
    render(<OfficersPage />);
    await screen.findByText(/no officers are registered yet/i);
    await userEvent.click(screen.getByRole('button', { name: /register an officer/i }));

    expect(screen.queryByLabelText(/eligible/i)).not.toBeInTheDocument();
    expect(screen.getByText(/not entered here/i)).toBeInTheDocument();
  });

  it('offers none of the prohibited identity fields', async () => {
    fetchOfficers.mockResolvedValue(page([]));
    render(<OfficersPage />);
    await screen.findByText(/no officers are registered yet/i);
    await userEvent.click(screen.getByRole('button', { name: /register an officer/i }));

    for (const label of [/service number/i, /^rank$/i, /^unit$/i, /aadhaar/i, /\bpan\b/i]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
  });

  it('reports the server’s own refusal rather than inventing one', async () => {
    fetchOfficers.mockResolvedValue(page([]));
    registerOfficer.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: 'That mobile number already belongs to officer RIK-O-000125.',
        details: { reason: 'DUPLICATE_MOBILE', field: 'mobileNumber' },
      })
    );
    render(<OfficersPage />);
    await screen.findByText(/no officers are registered yet/i);

    await userEvent.click(screen.getByRole('button', { name: /register an officer/i }));
    await userEvent.type(screen.getByLabelText('Officer name'), 'B. Kumar');
    await userEvent.type(screen.getByLabelText('Mobile number'), '9876543210');
    await userEvent.type(screen.getByLabelText('Quarter block'), 'C');
    await userEvent.type(screen.getByLabelText('Quarter number'), '301');
    await userEvent.selectOptions(screen.getByLabelText('Dietary preference'), 'NV');
    await userEvent.click(screen.getByRole('button', { name: /register officer/i }));

    expect(
      await screen.findByText(/already belongs to officer RIK-O-000125/)
    ).toBeInTheDocument();
  });

  it('deactivates an officer and keeps their identifier in the message', async () => {
    fetchOfficers.mockResolvedValue(page([officer()]));
    setOfficerActive.mockResolvedValue(officer({ status: 'INACTIVE' }));
    render(<OfficersPage />);
    await screen.findByText('RIK-O-000125');

    await userEvent.click(screen.getByRole('button', { name: /deactivate/i }));

    expect(setOfficerActive).toHaveBeenCalledWith('01a11a22-0000-7000-8000-000000000001', false);
    expect(await screen.findByText(/RIK-O-000125 is no longer active/)).toBeInTheDocument();
    expect(screen.getByText(/record and its RIK ID are kept/i)).toBeInTheDocument();
  });

  /**
   * SIGNING AN OFFICER OUT OF EVERY DEVICE.
   *
   * A customer session is a rolling 365 days, so a lost or handed-on phone
   * would otherwise stay signed in for a year. These pin the two things that
   * make the control safe to put on a row of a table: it takes two clicks,
   * and it says what it does — including that it is not instant.
   */
  it('takes TWO clicks: the first arms it, the second performs it', async () => {
    fetchOfficers.mockResolvedValue(page([officer()]));
    revokeOfficerSessions.mockResolvedValue({ ...officer(), revokedSessions: 2 });
    render(<OfficersPage />);
    await screen.findByText('RIK-O-000125');

    await userEvent.click(screen.getByRole('button', { name: /sign out all devices/i }));
    // Armed, and nothing has happened yet.
    expect(revokeOfficerSessions).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /confirm sign-out/i }));
    expect(revokeOfficerSessions).toHaveBeenCalledWith('01a11a22-0000-7000-8000-000000000001');
  });

  it('warns, before the second click, that it is not instant', async () => {
    fetchOfficers.mockResolvedValue(page([officer()]));
    render(<OfficersPage />);
    await screen.findByText('RIK-O-000125');

    await userEvent.click(screen.getByRole('button', { name: /sign out all devices/i }));

    // The 15-minute caveat is the truth about this control and must be read
    // BEFORE confirming, not discovered afterwards.
    expect(screen.getByText(/up to 15 minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/keep their RIK ID and\s+entitlement/i)).toBeInTheDocument();
  });

  it('reports how many devices were signed out', async () => {
    fetchOfficers.mockResolvedValue(page([officer()]));
    revokeOfficerSessions.mockResolvedValue({ ...officer(), revokedSessions: 2 });
    render(<OfficersPage />);
    await screen.findByText('RIK-O-000125');

    await userEvent.click(screen.getByRole('button', { name: /sign out all devices/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm sign-out/i }));

    expect(await screen.findByText(/signed out of 2 devices/i)).toBeInTheDocument();
    expect(screen.getByText(/need a new OTP/i)).toBeInTheDocument();
  });

  it('says plainly when there was nothing to sign out', async () => {
    fetchOfficers.mockResolvedValue(page([officer()]));
    revokeOfficerSessions.mockResolvedValue({ ...officer(), revokedSessions: 0 });
    render(<OfficersPage />);
    await screen.findByText('RIK-O-000125');

    await userEvent.click(screen.getByRole('button', { name: /sign out all devices/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm sign-out/i }));

    expect(await screen.findByText(/had no active sessions/i)).toBeInTheDocument();
  });

  it('does NOT deactivate the officer — it is the smaller hammer', async () => {
    fetchOfficers.mockResolvedValue(page([officer()]));
    revokeOfficerSessions.mockResolvedValue({ ...officer(), revokedSessions: 1 });
    render(<OfficersPage />);
    await screen.findByText('RIK-O-000125');

    await userEvent.click(screen.getByRole('button', { name: /sign out all devices/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm sign-out/i }));

    expect(setOfficerActive).not.toHaveBeenCalled();
  });

  it('disarms after a failure, so a primed button is not left behind', async () => {
    fetchOfficers.mockResolvedValue(page([officer()]));
    revokeOfficerSessions.mockRejectedValue(
      new ApiError(403, { code: 'FORBIDDEN', message: 'Forbidden' })
    );
    render(<OfficersPage />);
    await screen.findByText('RIK-O-000125');

    await userEvent.click(screen.getByRole('button', { name: /sign out all devices/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm sign-out/i }));

    expect(await screen.findByRole('button', { name: /sign out all devices/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm sign-out/i })).not.toBeInTheDocument();
  });

  it('surfaces a failure to load rather than showing an empty list', async () => {
    fetchOfficers.mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Forbidden' }));
    render(<OfficersPage />);
    expect(await screen.findByText(/do not have access to this area/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

// ===================================================================
/**
 * TASK 2 — the same form, used to approve a resident who already has an
 * account.
 *
 * WHY THESE TESTS ARE WORTH THEIR LENGTH. The linking path has one failure
 * mode that no error message would ever reveal: the form sends a dietary
 * preference, and a resident's own recorded preference is silently
 * overwritten by whatever a staff member happened to pick from a dropdown.
 * Nothing throws, nothing is logged, and the resident finds out when they are
 * issued the wrong rations. So the assertions below are mostly about what is
 * NOT sent and NOT displayed.
 *
 * The screen never predicts which path a submit will take. It submits once and
 * reads `outcome` from the reply — there is no lookup request to mock here,
 * and adding one would be the wrong fix.
 */
describe('OfficersPage — linking an existing resident (Task 2)', () => {
  it('links an existing resident, naming them as the server returned them', async () => {
    const user = userEvent.setup();
    fetchOfficers.mockResolvedValue(page([]));
    registerOfficer.mockResolvedValue(linked());
    render(<OfficersPage />);
    await screen.findByText(/no officers are registered yet/i);

    await user.click(screen.getByRole('button', { name: /register an officer/i }));
    await fillOfficerDetails(user);
    await user.click(screen.getByRole('button', { name: /register officer/i }));

    // 'Anil Kumar' is the resident's OWN display name, which the server kept.
    // The administrator typed 'Lt Cdr Anil Kumar'. The message must show the
    // former, or it tells the administrator the name was changed when it
    // was not.
    expect(await screen.findByText(/Linked Anil Kumar to RIK ID RIK-O-000130/)).toBeInTheDocument();
    expect(screen.getByText(/already had an e-Samagri account/i)).toBeInTheDocument();
    expect(
      screen.getByText(/own name and dietary preference were left as they are/i)
    ).toBeInTheDocument();
  });

  it('does not describe a new registration as a link', async () => {
    const user = userEvent.setup();
    fetchOfficers.mockResolvedValue(page([]));
    registerOfficer.mockResolvedValue(registered({ rikId: 'RIK-O-000131', name: 'C. Rao' }));
    render(<OfficersPage />);
    await screen.findByText(/no officers are registered yet/i);

    await user.click(screen.getByRole('button', { name: /register an officer/i }));
    await fillOfficerDetails(user);
    await user.selectOptions(screen.getByLabelText('Dietary preference'), 'PV');
    await user.click(screen.getByRole('button', { name: /register officer/i }));

    expect(await screen.findByText(/Registered C. Rao as RIK-O-000131/)).toBeInTheDocument();
    expect(screen.queryByText(/already had an e-Samagri account/i)).not.toBeInTheDocument();
  });

  it('sends no dietary preference at all when the field is left blank', async () => {
    const user = userEvent.setup();
    fetchOfficers.mockResolvedValue(page([]));
    registerOfficer.mockResolvedValue(linked());
    render(<OfficersPage />);
    await screen.findByText(/no officers are registered yet/i);

    await user.click(screen.getByRole('button', { name: /register an officer/i }));
    await fillOfficerDetails(user);
    await user.click(screen.getByRole('button', { name: /register officer/i }));

    const body = registerOfficer.mock.calls[0][0];
    // THIS IS THE ASSERTION THAT MATTERS. An empty string is a value, and the
    // server would refuse it as an invalid preference; absence is what means
    // "this form is not answering that question", which is what leaves the
    // resident's own preference untouched.
    expect(body.dietaryPreference).toBeUndefined();
    expect(body.dietaryPreference).not.toBe('');
    expect(body).toEqual({
      name: 'Lt Cdr Anil Kumar',
      mobileNumber: '9811122233',
      quarterBlock: 'D',
      quarterNumber: '14',
      landmark: undefined,
      dietaryPreference: undefined,
    });
  });

  it('still sends the preference when the administrator chooses one', async () => {
    const user = userEvent.setup();
    fetchOfficers.mockResolvedValue(page([]));
    registerOfficer.mockResolvedValue(registered());
    render(<OfficersPage />);
    await screen.findByText(/no officers are registered yet/i);

    await user.click(screen.getByRole('button', { name: /register an officer/i }));
    await fillOfficerDetails(user);
    await user.selectOptions(screen.getByLabelText('Dietary preference'), 'EV');
    await user.click(screen.getByRole('button', { name: /register officer/i }));

    expect(registerOfficer.mock.calls[0][0].dietaryPreference).toBe('EV');
  });

  it('does not make the dietary preference mandatory in the browser', async () => {
    fetchOfficers.mockResolvedValue(page([]));
    render(<OfficersPage />);
    await screen.findByText(/no officers are registered yet/i);
    await userEvent.click(screen.getByRole('button', { name: /register an officer/i }));

    // A `required` attribute here would make the browser refuse the submit,
    // which would make linking impossible — the one case where this form must
    // state no preference. The rule still exists, enforced by the server on
    // the create path, which is the only place that knows which path applies.
    expect(screen.getByLabelText('Dietary preference')).not.toHaveAttribute('required');
    expect(screen.getByText(/Required for a new officer/i)).toBeInTheDocument();
    expect(
      screen.getByText(/their own preference is never changed by this form/i)
    ).toBeInTheDocument();
  });

  it('reports the server’s refusal when a new officer has no dietary preference', async () => {
    const user = userEvent.setup();
    fetchOfficers.mockResolvedValue(page([]));
    registerOfficer.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: 'The dietary preference must be PV, EV or NV.',
        details: { reason: 'INVALID_DIETARY_PREFERENCE', field: 'dietaryPreference' },
      })
    );
    render(<OfficersPage />);
    await screen.findByText(/no officers are registered yet/i);

    await user.click(screen.getByRole('button', { name: /register an officer/i }));
    await fillOfficerDetails(user);
    await user.click(screen.getByRole('button', { name: /register officer/i }));

    expect(
      await screen.findByText(/dietary preference must be PV, EV or NV/i)
    ).toBeInTheDocument();
  });

  it('reports a linking conflict in the server’s own words', async () => {
    const user = userEvent.setup();
    fetchOfficers.mockResolvedValue(page([]));
    registerOfficer.mockRejectedValue(
      new ApiError(409, {
        code: 'VALIDATION_FAILED',
        message:
          'That resident was approved for RIK by another request a moment ago. Reload the list to see their RIK ID.',
        details: { reason: 'LINK_CONFLICT' },
      })
    );
    render(<OfficersPage />);
    await screen.findByText(/no officers are registered yet/i);

    await user.click(screen.getByRole('button', { name: /register an officer/i }));
    await fillOfficerDetails(user);
    await user.click(screen.getByRole('button', { name: /register officer/i }));

    // A 409 is a refusal the server explained; it is not restated or softened.
    expect(
      await screen.findByText(/approved for RIK by another request a moment ago/i)
    ).toBeInTheDocument();
  });

  it('shows a linked resident’s blank preference as blank, inventing nothing', async () => {
    fetchOfficers.mockResolvedValue(
      page([officer({ rikId: 'RIK-O-000130', name: 'Anil Kumar', dietaryPreference: null })])
    );
    render(<OfficersPage />);

    const row = await screen.findByRole('row', { name: /RIK-O-000130/ });
    expect(within(row).getByText('—')).toBeInTheDocument();
    // No default, no 'PV', no 'Not set' pretending to be a recorded answer.
    for (const diet of ['PV', 'EV', 'NV']) {
      expect(within(row).queryByText(diet)).not.toBeInTheDocument();
    }
  });

  it('shows the facility spelling once a resident has been linked', async () => {
    fetchOfficers.mockResolvedValue(
      page([officer({ name: 'Anil Kumar', officialName: 'Lt Cdr Anil Kumar' })])
    );
    render(<OfficersPage />);
    // official_name is what the administrator typed; the display name stays
    // the resident's. Both travel, and the screen shows both when they differ.
    expect(await screen.findByText(/Official: Lt Cdr Anil Kumar/)).toBeInTheDocument();
    expect(screen.getByText('Anil Kumar')).toBeInTheDocument();
  });
});
