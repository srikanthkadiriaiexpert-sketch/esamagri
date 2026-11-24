import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/client';
import type { StaffSession } from '../../lib/api/admin-api';
import { pifAdmin, pifCashier } from '../../test/staff-session';
import type { OrderAlertSound } from '../../lib/api/pif-admin-api';

/**
 * PIF NOTIFICATION SETTINGS — the client changing their own alert sound.
 *
 * WHAT THIS ASSERTS, end to end:
 *   choose an MP3 -> hear it before saving -> save -> it is reported active;
 *   and the way back: restore the supplied sound.
 *
 * WHAT THIS SCREEN MUST NOT DO, asserted directly:
 *   * offer the upload controls to a staff member who does not hold
 *     `pif.product.manage` — while still letting them hear what is
 *     configured, because hearing the alert is not a privilege;
 *   * send a file that is obviously not an MP3, or one over the server's
 *     stated limit — refused here with a reason and NO request made;
 *   * claim a change that the server refused;
 *   * invent its own size limit instead of using the server's.
 *
 * The rules themselves are the SERVER's: it checks the file by its own first
 * bytes and enforces the limit, and the permission is read from the live
 * grant on every request. What is asserted here is that the screen sends the
 * right request and reports the server's answer.
 */

const api = {
  fetchOrderAlertSound: vi.fn(),
  replaceOrderAlertSound: vi.fn(),
  restoreOrderAlertSound: vi.fn(),
  alertSoundUrl: vi.fn(() => 'http://api.test/pif/alert-sound'),
};

vi.mock('../../lib/api/pif-admin-api', () => api);

let session: StaffSession = pifAdmin();
vi.mock('../../lib/auth/StaffAuthContext', () => ({
  useStaffAuth: () => ({ session, status: 'authenticated' }),
}));

// Imported after the mocks so the module under test picks them up.
const { PifNotificationSettingsPage } = await import('./PifNotificationSettingsPage');

const DEFAULT_SOUND: OrderAlertSound = {
  filename: 'pif-order-alert-default.mp3',
  isDefault: true,
  bytes: 194_360,
  sha256: 'a'.repeat(64),
  updatedAt: null,
  url: '/pif/alert-sound',
  limitBytes: 2_000_000,
};

const CUSTOM_SOUND: OrderAlertSound = {
  filename: 'service-bell.mp3',
  isDefault: false,
  bytes: 120_000,
  sha256: 'b'.repeat(64),
  updatedAt: '2026-11-05T08:00:00.000Z',
  url: '/pif/alert-sound',
  limitBytes: 2_000_000,
};

/** A believable MP3 for the file box: ID3 header, then filler. */
function mp3File(name = 'bell.mp3', bytes = 2_048): File {
  const body = new Uint8Array(bytes);
  body.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  return new File([body], name, { type: 'audio/mpeg' });
}

beforeEach(() => {
  session = pifAdmin();
  Object.values(api).forEach((fn) => {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as { mockReset: () => void }).mockReset();
  });
  api.alertSoundUrl.mockReturnValue('http://api.test/pif/alert-sound');
  api.fetchOrderAlertSound.mockResolvedValue(DEFAULT_SOUND);
  // jsdom implements neither of these, and the preview depends on both.
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:preview'), writable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===================================================================
describe('what is active', () => {
  it('names the active sound and says it is the supplied one', async () => {
    render(<PifNotificationSettingsPage />);
    expect(await screen.findByText('pif-order-alert-default.mp3')).toBeInTheDocument();
    expect(screen.getByText('Original supplied sound')).toBeInTheDocument();
  });

  it('says when the facility uploaded it instead', async () => {
    api.fetchOrderAlertSound.mockResolvedValue(CUSTOM_SOUND);
    render(<PifNotificationSettingsPage />);
    expect(await screen.findByText('service-bell.mp3')).toBeInTheDocument();
    expect(screen.getByText('Uploaded by the facility')).toBeInTheDocument();
  });

  it('offers a player for the active sound, so it can be heard before it is replaced', async () => {
    render(<PifNotificationSettingsPage />);
    await screen.findByText('pif-order-alert-default.mp3');
    const players = document.querySelectorAll('audio');
    expect(players.length).toBeGreaterThanOrEqual(1);
    // The address carries the hash, so replacing the sound reloads the player
    // instead of replaying a cached copy.
    expect(players[0]!.getAttribute('src')).toContain('http://api.test/pif/alert-sound');
    expect(players[0]!.getAttribute('src')).toContain('aaaaaaaaaaaa');
  });

  it('states the server’s own limit rather than a number of its own', async () => {
    api.fetchOrderAlertSound.mockResolvedValue({ ...DEFAULT_SOUND, limitBytes: 500_000 });
    render(<PifNotificationSettingsPage />);
    expect(await screen.findByText(/The limit is 0\.5 MB/)).toBeInTheDocument();
  });
});

// ===================================================================
describe('who may replace it', () => {
  it('offers the upload controls to a PIF administrator', async () => {
    render(<PifNotificationSettingsPage />);
    await screen.findByText('pif-order-alert-default.mp3');
    expect(screen.getByLabelText(/MP3 file/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save and activate/i })).toBeInTheDocument();
  });

  it('refuses the controls to staff without pif.product.manage, but still lets them listen', async () => {
    session = pifCashier();
    render(<PifNotificationSettingsPage />);
    await screen.findByText('pif-order-alert-default.mp3');

    expect(screen.queryByLabelText(/MP3 file/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save and activate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore original/i })).not.toBeInTheDocument();
    // …and the explanation says which permission, rather than just refusing.
    expect(screen.getByText(/pif\.product\.manage/)).toBeInTheDocument();
    // The player is still there.
    expect(document.querySelectorAll('audio').length).toBeGreaterThanOrEqual(1);
  });
});

// ===================================================================
describe('choosing a file', () => {
  it('refuses something that is not named like an MP3, and sends nothing', async () => {
    render(<PifNotificationSettingsPage />);
    await screen.findByText('pif-order-alert-default.mp3');

    /*
     * fireEvent, NOT userEvent.upload, and the reason matters. The box carries
     * accept="audio/mpeg,.mp3", and userEvent.upload honours that filter — it
     * would silently drop a .png and the change handler would never run, so
     * the test would be asserting nothing. A real browser's accept attribute
     * is only a hint to the file picker: a person can defeat it with
     * drag-and-drop or by switching the picker to "All files", and that is the
     * case this asserts. The component's own check is the boundary, not the
     * attribute.
     */
    fireEvent.change(screen.getByLabelText(/MP3 file/i), {
      target: { files: [new File([new Uint8Array(32)], 'photo.png', { type: 'image/png' })] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/needs to be an MP3/i);
    expect(api.replaceOrderAlertSound).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /save and activate/i })).toBeDisabled();
  });

  it('refuses a file over the server’s limit, and sends nothing', async () => {
    const user = userEvent.setup();
    api.fetchOrderAlertSound.mockResolvedValue({ ...DEFAULT_SOUND, limitBytes: 1_000 });
    render(<PifNotificationSettingsPage />);
    await screen.findByText('pif-order-alert-default.mp3');

    await user.upload(screen.getByLabelText(/MP3 file/i), mp3File('huge.mp3', 5_000));

    expect(await screen.findByRole('alert')).toHaveTextContent(/limit is 0\.0 MB/i);
    expect(api.replaceOrderAlertSound).not.toHaveBeenCalled();
  });

  it('previews a valid MP3 and saves nothing until told to', async () => {
    const user = userEvent.setup();
    render(<PifNotificationSettingsPage />);
    await screen.findByText('pif-order-alert-default.mp3');

    await user.upload(screen.getByLabelText(/MP3 file/i), mp3File('new-bell.mp3'));

    expect(await screen.findByText(/Preview: new-bell\.mp3/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been saved yet/i)).toBeInTheDocument();
    expect(api.replaceOrderAlertSound).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /save and activate/i })).toBeEnabled();
  });
});

// ===================================================================
describe('saving', () => {
  it('sends the chosen file and reports the new sound as active', async () => {
    const user = userEvent.setup();
    const file = mp3File('service-bell.mp3');
    api.replaceOrderAlertSound.mockResolvedValue(CUSTOM_SOUND);

    render(<PifNotificationSettingsPage />);
    await screen.findByText('pif-order-alert-default.mp3');
    await user.upload(screen.getByLabelText(/MP3 file/i), file);
    await user.click(screen.getByRole('button', { name: /save and activate/i }));

    await waitFor(() => expect(api.replaceOrderAlertSound).toHaveBeenCalledTimes(1));
    expect(api.replaceOrderAlertSound.mock.calls[0]![0]).toBe(file);

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/service-bell\.mp3/);
    expect(status).toHaveTextContent(/every PIF staff member/i);
    expect(screen.getByText('Uploaded by the facility')).toBeInTheDocument();
  });

  it('reports the server’s own refusal and does not claim a change', async () => {
    const user = userEvent.setup();
    api.replaceOrderAlertSound.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: 'Only MP3 audio can be uploaded.',
      })
    );

    render(<PifNotificationSettingsPage />);
    await screen.findByText('pif-order-alert-default.mp3');
    await user.upload(screen.getByLabelText(/MP3 file/i), mp3File());
    await user.click(screen.getByRole('button', { name: /save and activate/i }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/was not changed/i);
    expect(status).toHaveTextContent(/Only MP3 audio can be uploaded/);
    // Still the supplied sound.
    expect(screen.getByText('Original supplied sound')).toBeInTheDocument();
  });
});

// ===================================================================
describe('restoring the supplied sound', () => {
  it('is not offered while the supplied sound is already active', async () => {
    render(<PifNotificationSettingsPage />);
    await screen.findByText('pif-order-alert-default.mp3');
    expect(screen.getByText(/already active/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore original sound/i })).not.toBeInTheDocument();
  });

  it('asks once before deleting the uploaded file, then restores', async () => {
    const user = userEvent.setup();
    api.fetchOrderAlertSound.mockResolvedValue(CUSTOM_SOUND);
    api.restoreOrderAlertSound.mockResolvedValue(DEFAULT_SOUND);

    render(<PifNotificationSettingsPage />);
    await screen.findByText('service-bell.mp3');

    await user.click(screen.getByRole('button', { name: /restore original sound/i }));
    // Nothing has happened yet — it only asked.
    expect(api.restoreOrderAlertSound).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /yes, restore the original/i }));
    await waitFor(() => expect(api.restoreOrderAlertSound).toHaveBeenCalledTimes(1));

    expect(await screen.findByRole('status')).toHaveTextContent(/original supplied sound is active/i);
    expect(screen.getByText('pif-order-alert-default.mp3')).toBeInTheDocument();
  });

  it('can be backed out of without sending anything', async () => {
    const user = userEvent.setup();
    api.fetchOrderAlertSound.mockResolvedValue(CUSTOM_SOUND);

    render(<PifNotificationSettingsPage />);
    await screen.findByText('service-bell.mp3');

    await user.click(screen.getByRole('button', { name: /restore original sound/i }));
    await user.click(screen.getByRole('button', { name: /keep the uploaded sound/i }));

    expect(api.restoreOrderAlertSound).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /restore original sound/i })).toBeInTheDocument();
  });
});

// ===================================================================
describe('what the screen says about sound itself', () => {
  it('says each staff member still has to allow sound once, and that RIK is unaffected', async () => {
    render(<PifNotificationSettingsPage />);
    await screen.findByText('pif-order-alert-default.mp3');
    const notice = screen.getByText(/allow sound once per visit/i);
    expect(notice).toHaveTextContent(/Enable sound/i);
    expect(notice).toHaveTextContent(/does not affect RIK/i);
  });

  it('keeps exactly one live region, so a save result is announced unambiguously', async () => {
    const user = userEvent.setup();
    api.replaceOrderAlertSound.mockResolvedValue(CUSTOM_SOUND);
    render(<PifNotificationSettingsPage />);
    await screen.findByText('pif-order-alert-default.mp3');

    // None before anything happens…
    expect(screen.queryAllByRole('status')).toHaveLength(0);

    await user.upload(screen.getByLabelText(/MP3 file/i), mp3File());
    await user.click(screen.getByRole('button', { name: /save and activate/i }));

    // …and exactly one after, which is the outcome.
    await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(1));
  });
});
