import { Logger } from '@nestjs/common';
import { PifRegistrationGate } from './pif-registration.gate.service';
import {
  PIF_SELF_REGISTRATION_SETTING_KEY,
  selfRegistrationSettingValue,
} from './pif-registration.gate';
import type { SettingsRepository } from '../shared/repositories/settings.repository';

/**
 * The gate, with a faked SettingsRepository. No database.
 *
 * FOUR WAYS TO BE OFF is the whole point of this suite, and the fourth —
 * the query throwing — is the one that could not be covered before the
 * gate existed. A connection blip must read as "registration is closed",
 * never as "registration is open", and nothing but a test keeps that true
 * after the next refactor.
 */

function gateWith(
  behaviour:
    | { kind: 'row'; value: unknown }
    | { kind: 'absent' }
    | { kind: 'throws'; error: unknown }
): { gate: PifRegistrationGate; findByKey: jest.Mock } {
  const findByKey = jest.fn(async (key: string) => {
    expect(key).toBe(PIF_SELF_REGISTRATION_SETTING_KEY);
    if (behaviour.kind === 'throws') throw behaviour.error;
    if (behaviour.kind === 'absent') return null;
    return {
      key,
      value: behaviour.value,
      updated_at: '2026-11-14T10:00:00.000Z',
      updated_by: null,
    };
  });
  const settings = { findByKey } as unknown as SettingsRepository;
  return { gate: new PifRegistrationGate(settings), findByKey };
}

beforeEach(() => {
  // The gate logs on the failure paths; keep the suite output clean while
  // still letting the calls happen.
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PifRegistrationGate — the only way to be ON', () => {
  it('is ON when the setting holds the approved envelope with value true', async () => {
    const { gate } = gateWith({ kind: 'row', value: selfRegistrationSettingValue(true) });
    await expect(gate.isEnabled()).resolves.toBe(true);
  });

  it('reads the setting on every call, so a change takes effect immediately', async () => {
    const { gate, findByKey } = gateWith({ kind: 'row', value: selfRegistrationSettingValue(true) });
    await gate.isEnabled();
    await gate.isEnabled();
    await gate.isEnabled();
    // Three calls, three reads: nothing is cached, so an administrator
    // switching the setting OFF cannot be served a stale ON.
    expect(findByKey).toHaveBeenCalledTimes(3);
  });
});

describe('PifRegistrationGate — the four ways to be OFF', () => {
  it('1. ABSENT SETTING IS OFF — there is no seed row, so this is the shipped state', async () => {
    const { gate } = gateWith({ kind: 'absent' });
    await expect(gate.isEnabled()).resolves.toBe(false);
  });

  it('2. an explicit false is OFF', async () => {
    const { gate } = gateWith({ kind: 'row', value: selfRegistrationSettingValue(false) });
    await expect(gate.isEnabled()).resolves.toBe(false);
  });

  it('3. A MALFORMED VALUE IS OFF, for every shape a hand-edit might leave', async () => {
    const malformed: unknown[] = [
      null,
      true,
      'true',
      1,
      {},
      { enabled: true },
      { value: 'true' },
      { value: 1 },
      { value: null },
      [{ value: true }],
    ];
    for (const value of malformed) {
      const { gate } = gateWith({ kind: 'row', value });
      await expect(gate.isEnabled()).resolves.toBe(false);
    }
  });

  it('4. A FAILED QUERY IS OFF, and does not throw at the caller', async () => {
    const { gate } = gateWith({ kind: 'throws', error: new Error('connection terminated') });
    // Not rejects — resolves false. The caller's refusal path (503 with the
    // standard message) is already correct; letting this propagate would
    // turn a database blip into a 500 with a different body.
    await expect(gate.isEnabled()).resolves.toBe(false);
  });

  it('fails closed even when the thrown thing is not an Error', async () => {
    for (const error of ['boom', null, undefined, 42, { code: '57P01' }]) {
      const { gate } = gateWith({ kind: 'throws', error });
      await expect(gate.isEnabled()).resolves.toBe(false);
    }
  });

  it('logs the failure at error level so an operator sees the real cause', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { gate } = gateWith({ kind: 'throws', error: new Error('connection terminated') });

    await gate.isEnabled();

    expect(errorLog).toHaveBeenCalledTimes(1);
    const message = String(errorLog.mock.calls[0]?.[0] ?? '');
    expect(message).toContain(PIF_SELF_REGISTRATION_SETTING_KEY);
    expect(message).toContain('OFF');
  });

  it('does not log an error for the absent row, which is a normal state and not a fault', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { gate } = gateWith({ kind: 'absent' });

    await gate.isEnabled();

    expect(errorLog).not.toHaveBeenCalled();
  });
});
