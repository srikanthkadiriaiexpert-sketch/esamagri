import { AdminSettingsService } from './admin-settings.service';
import {
  PIF_SELF_REGISTRATION_SETTING_KEY,
  readSelfRegistrationFlag,
  selfRegistrationSettingValue,
} from '../../auth/pif-registration.gate';
import type { AuthContext } from '../../auth/auth-context';
import type {
  SettingRecord,
  SettingsRepository,
  SettingWithActor,
} from '../../shared/repositories/settings.repository';
import type { AuditLogRepository } from '../../shared/repositories/audit-log.repository';

/**
 * The administrative read and write, with faked repositories. No database.
 *
 * The branch that matters most here is the audit payload. A control that
 * opens a public endpoint is only as accountable as the row it leaves
 * behind, and a `before` that cannot say what the value used to be answers
 * half the question — so these tests pin the previous value, the new
 * value, the actor and the action name, not merely that *something* was
 * logged.
 */

const SUPER_ADMIN_ID = '22222222-2222-7222-8222-222222222222';

const ACTOR: AuthContext = {
  principalType: 'STAFF',
  principalId: SUPER_ADMIN_ID,
  roles: new Set(['SUPER_ADMIN']),
  permissions: new Set(['shared.settings.write']),
};

interface Harness {
  service: AdminSettingsService;
  settings: { findByKey: jest.Mock; findByKeyWithActor: jest.Mock; upsert: jest.Mock };
  auditLog: { logEvent: jest.Mock };
  /** The single audit call's parameters, for payload assertions. */
  auditedOnce: () => Record<string, unknown>;
}

function harness(
  initial:
    | { kind: 'absent' }
    | { kind: 'row'; value: unknown; updatedBy?: string | null; displayName?: string | null; username?: string | null }
): Harness {
  /** Mutable, so a write followed by a read reflects the write. */
  let current: SettingWithActor | null =
    initial.kind === 'absent'
      ? null
      : {
          key: PIF_SELF_REGISTRATION_SETTING_KEY,
          value: initial.value,
          updated_at: '2026-11-01T09:00:00.000Z',
          updated_by: initial.updatedBy ?? null,
          updated_by_username: initial.username ?? null,
          updated_by_display_name: initial.displayName ?? null,
        };

  const findByKey = jest.fn(async (): Promise<SettingRecord | null> =>
    current === null
      ? null
      : {
          key: current.key,
          value: current.value,
          updated_at: current.updated_at,
          updated_by: current.updated_by,
        }
  );
  const findByKeyWithActor = jest.fn(async (): Promise<SettingWithActor | null> => current);
  const upsert = jest.fn(async (input: { key: string; value: unknown; updatedBy: string | null }) => {
    current = {
      key: input.key,
      value: input.value,
      updated_at: '2026-11-14T11:30:00.000Z',
      updated_by: input.updatedBy,
      updated_by_username: 'superadmin',
      updated_by_display_name: 'Facility Super Admin',
    };
    return {
      key: current.key,
      value: current.value,
      updated_at: current.updated_at,
      updated_by: current.updated_by,
    };
  });

  const auditLog = { logEvent: jest.fn().mockResolvedValue('audit-id') };

  const service = new AdminSettingsService(
    { findByKey, findByKeyWithActor, upsert } as unknown as SettingsRepository,
    auditLog as unknown as AuditLogRepository
  );

  return {
    service,
    settings: { findByKey, findByKeyWithActor, upsert },
    auditLog,
    auditedOnce: () => {
      expect(auditLog.logEvent).toHaveBeenCalledTimes(1);
      return auditLog.logEvent.mock.calls[0]?.[0] as Record<string, unknown>;
    },
  };
}

describe('AdminSettingsService — reading the switch', () => {
  it('reports OFF and neverSet when the key has no row', async () => {
    const h = harness({ kind: 'absent' });
    await expect(h.service.readPifSelfRegistration()).resolves.toEqual({
      enabled: false,
      neverSet: true,
      malformed: false,
      updatedAt: null,
      updatedByUserId: null,
      updatedByName: null,
    });
  });

  it('reports ON with who changed it and when', async () => {
    const h = harness({
      kind: 'row',
      value: selfRegistrationSettingValue(true),
      updatedBy: SUPER_ADMIN_ID,
      displayName: 'Facility Super Admin',
      username: 'superadmin',
    });

    await expect(h.service.readPifSelfRegistration()).resolves.toEqual({
      enabled: true,
      neverSet: false,
      malformed: false,
      updatedAt: '2026-11-01T09:00:00.000Z',
      updatedByUserId: SUPER_ADMIN_ID,
      updatedByName: 'Facility Super Admin',
    });
  });

  it('falls back to the username when no display name is recorded', async () => {
    const h = harness({
      kind: 'row',
      value: selfRegistrationSettingValue(false),
      updatedBy: SUPER_ADMIN_ID,
      displayName: null,
      username: 'superadmin',
    });
    const status = await h.service.readPifSelfRegistration();
    expect(status.updatedByName).toBe('superadmin');
  });

  it('AGREES WITH THE GATE on a malformed row: enabled false, and says why', async () => {
    // If the screen could say ON while the public endpoint refused, an
    // administrator would have no way to discover the discrepancy.
    const h = harness({ kind: 'row', value: { value: 'true' } });
    const status = await h.service.readPifSelfRegistration();

    expect(status.enabled).toBe(false);
    expect(status.enabled).toBe(readSelfRegistrationFlag({ value: 'true' }));
    expect(status.malformed).toBe(true);
    expect(status.neverSet).toBe(false);
  });

  it('does not call a malformed row "never set" — it exists, it just cannot be read', async () => {
    const h = harness({ kind: 'row', value: 'nonsense' });
    const status = await h.service.readPifSelfRegistration();
    expect(status.neverSet).toBe(false);
    expect(status.malformed).toBe(true);
  });
});

describe('AdminSettingsService — turning it ON', () => {
  it('writes the approved envelope under the approved key, attributed to the actor', async () => {
    const h = harness({ kind: 'absent' });
    await h.service.setPifSelfRegistration(ACTOR, true);

    expect(h.settings.upsert).toHaveBeenCalledWith({
      key: PIF_SELF_REGISTRATION_SETTING_KEY,
      value: selfRegistrationSettingValue(true),
      updatedBy: SUPER_ADMIN_ID,
    });
  });

  it('writes a value the strict gate parser will read back as ON', async () => {
    const h = harness({ kind: 'absent' });
    await h.service.setPifSelfRegistration(ACTOR, true);

    const written = h.settings.upsert.mock.calls[0]?.[0] as { value: unknown };
    // The round trip through JSON matters: the column is jsonb.
    expect(readSelfRegistrationFlag(JSON.parse(JSON.stringify(written.value)))).toBe(true);
  });

  it('returns the state re-read from storage, not the value the caller sent', async () => {
    const h = harness({ kind: 'absent' });
    const result = await h.service.setPifSelfRegistration(ACTOR, true);

    expect(result.enabled).toBe(true);
    expect(result.neverSet).toBe(false);
    expect(result.updatedByUserId).toBe(SUPER_ADMIN_ID);
    // findByKeyWithActor is the re-read; it runs after the upsert.
    expect(h.settings.findByKeyWithActor).toHaveBeenCalled();
  });
});

describe('AdminSettingsService — the audit entry', () => {
  it('RECORDS THE PREVIOUS VALUE AND THE NEW VALUE, with the administrator', async () => {
    const h = harness({ kind: 'row', value: selfRegistrationSettingValue(false) });
    await h.service.setPifSelfRegistration(ACTOR, true);

    const entry = h.auditedOnce();
    expect(entry).toMatchObject({
      actorId: SUPER_ADMIN_ID,
      actorRole: 'SUPER_ADMIN',
      module: 'shared',
      action: 'PIF_SELF_REGISTRATION_ENABLED',
      entityType: 'shared.settings',
      entityId: null,
      before: { key: PIF_SELF_REGISTRATION_SETTING_KEY, enabled: false, existed: true },
      after: { key: PIF_SELF_REGISTRATION_SETTING_KEY, enabled: true },
    });
  });

  it('names the action PIF_SELF_REGISTRATION_DISABLED when switching off', async () => {
    const h = harness({ kind: 'row', value: selfRegistrationSettingValue(true) });
    await h.service.setPifSelfRegistration(ACTOR, false);

    const entry = h.auditedOnce();
    expect(entry.action).toBe('PIF_SELF_REGISTRATION_DISABLED');
    expect(entry.before).toEqual({
      key: PIF_SELF_REGISTRATION_SETTING_KEY,
      enabled: true,
      existed: true,
    });
    expect(entry.after).toEqual({ key: PIF_SELF_REGISTRATION_SETTING_KEY, enabled: false });
  });

  it('distinguishes "was off" from "had never been set"', async () => {
    const h = harness({ kind: 'absent' });
    await h.service.setPifSelfRegistration(ACTOR, true);

    // enabled:false alone cannot tell those apart, which is why `existed`
    // is recorded beside it.
    expect(h.auditedOnce().before).toEqual({
      key: PIF_SELF_REGISTRATION_SETTING_KEY,
      enabled: false,
      existed: false,
    });
  });

  it('treats a malformed previous value as having been OFF, matching the gate', async () => {
    const h = harness({ kind: 'row', value: { value: 'true' } });
    await h.service.setPifSelfRegistration(ACTOR, true);

    expect(h.auditedOnce().before).toMatchObject({ enabled: false, existed: true });
  });

  it('AUDITS EVEN A RE-AFFIRMATION, because the row itself changed', async () => {
    // A deliberate departure from RikOfficerService.setActive, which
    // audits only a real change: there, pressing the button on an
    // already-inactive officer does nothing, whereas here updated_by and
    // updated_at both move — and for a control over a public endpoint,
    // "who touched this" is the question the log exists to answer.
    const h = harness({ kind: 'row', value: selfRegistrationSettingValue(true) });
    await h.service.setPifSelfRegistration(ACTOR, true);

    const entry = h.auditedOnce();
    expect(entry.action).toBe('PIF_SELF_REGISTRATION_ENABLED');
    // before and after agree, which is how a reader tells a re-affirmation
    // from a flip.
    expect(entry.before).toMatchObject({ enabled: true });
    expect(entry.after).toMatchObject({ enabled: true });
  });

  it('writes the setting BEFORE the audit, so nothing is logged that did not happen', async () => {
    const h = harness({ kind: 'absent' });
    const order: string[] = [];
    h.settings.upsert.mockImplementation(async () => {
      order.push('upsert');
      return {
        key: PIF_SELF_REGISTRATION_SETTING_KEY,
        value: selfRegistrationSettingValue(true),
        updated_at: '2026-11-14T11:30:00.000Z',
        updated_by: SUPER_ADMIN_ID,
      };
    });
    h.auditLog.logEvent.mockImplementation(async () => {
      order.push('audit');
      return 'audit-id';
    });

    await h.service.setPifSelfRegistration(ACTOR, true);
    expect(order).toEqual(['upsert', 'audit']);
  });

  it('reads the previous value before overwriting it — otherwise `before` would be the new one', async () => {
    const h = harness({ kind: 'row', value: selfRegistrationSettingValue(false) });
    await h.service.setPifSelfRegistration(ACTOR, true);

    const findOrder = h.settings.findByKey.mock.invocationCallOrder[0] ?? Infinity;
    const upsertOrder = h.settings.upsert.mock.invocationCallOrder[0] ?? -Infinity;
    expect(findOrder).toBeLessThan(upsertOrder);
  });

  it('records a multi-role actor as a sorted, comma-joined list, like the staff service', async () => {
    const h = harness({ kind: 'absent' });
    await h.service.setPifSelfRegistration(
      { ...ACTOR, roles: new Set(['SUPER_ADMIN', 'PIF_ADMIN']) },
      true
    );
    expect(h.auditedOnce().actorRole).toBe('PIF_ADMIN,SUPER_ADMIN');
  });

  it('does not invent an actorRole when the principal holds no roles', async () => {
    const h = harness({ kind: 'absent' });
    await h.service.setPifSelfRegistration({ ...ACTOR, roles: new Set() }, true);
    expect(h.auditedOnce().actorRole).toBeNull();
  });
});
