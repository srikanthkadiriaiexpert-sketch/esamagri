import { Injectable } from '@nestjs/common';
import { SettingsRepository } from '../../shared/repositories/settings.repository';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import type { AuthContext } from '../../auth/auth-context';
import {
  PIF_SELF_REGISTRATION_SETTING_KEY,
  readSelfRegistrationFlag,
  selfRegistrationSettingValue,
} from '../../auth/pif-registration.gate';

/**
 * The administrative side of the PIF self-registration switch: reading its
 * current state for the Settings screen, and changing it with an audit
 * entry that survives the people who wrote it.
 *
 * THIS SERVICE PERFORMS NO AUTHORIZATION. `shared.settings.write` is
 * enforced by @RequirePermissions on the controller route, which is where
 * every other permission in this codebase is checked. Duplicating it here
 * would create a second place for the rule to drift.
 *
 * READ AND WRITE DELIBERATELY DISAGREE ABOUT STRICTNESS, and that is not
 * an inconsistency. The gate that guards the public endpoint accepts one
 * shape and treats everything else as OFF. This service reports the same
 * answer the gate would give — so the screen can never say ON while the
 * endpoint refuses — but it also reports `malformed`, so an administrator
 * looking at a hand-edited row is told why the switch reads OFF instead of
 * being left to guess.
 */

export interface PifSelfRegistrationStatus {
  /** Exactly what the gate would answer for a live request. */
  enabled: boolean;
  /** True when the key has no row at all — the shipped default. */
  neverSet: boolean;
  /**
   * True when a row exists but does not parse as the approved envelope.
   * `enabled` is then false, because the gate fails closed.
   */
  malformed: boolean;
  updatedAt: string | null;
  updatedByUserId: string | null;
  /** Display name, falling back to username, or null if neither is known. */
  updatedByName: string | null;
}

@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly auditLog: AuditLogRepository
  ) {}

  /** Current state of the switch, with who last changed it and when. */
  async readPifSelfRegistration(): Promise<PifSelfRegistrationStatus> {
    const row = await this.settings.findByKeyWithActor(PIF_SELF_REGISTRATION_SETTING_KEY);
    if (row === null) {
      return {
        enabled: false,
        neverSet: true,
        malformed: false,
        updatedAt: null,
        updatedByUserId: null,
        updatedByName: null,
      };
    }

    const enabled = readSelfRegistrationFlag(row.value);
    return {
      enabled,
      neverSet: false,
      // A row that does not parse is malformed whether it was meant to be
      // on or off: either way the stored bytes do not say what the gate
      // requires, and the screen should say so.
      malformed: !isApprovedEnvelope(row.value),
      updatedAt: row.updated_at,
      updatedByUserId: row.updated_by,
      updatedByName: row.updated_by_display_name ?? row.updated_by_username ?? null,
    };
  }

  /**
   * Turns the switch on or off, and records it.
   *
   * ORDER MATTERS: the previous value is read BEFORE the write, because
   * after the upsert it is gone. An audit entry that cannot say what the
   * value used to be answers half the question.
   *
   * EVERY SUCCESSFUL WRITE IS AUDITED, including one that sets the switch
   * to the value it already held. That is a deliberate departure from
   * RikOfficerService.setActive, which audits only a real change: there,
   * pressing Deactivate on an inactive officer genuinely does nothing,
   * whereas here the row itself changes — `updated_by` and `updated_at`
   * both move — and for a control that governs a public endpoint, "who
   * touched this, and when" is the question the log exists to answer. The
   * `before`/`after` payloads make a re-affirmation visibly distinct from
   * a flip.
   *
   * THE AUDIT IS WRITTEN AFTER THE SETTING, not before, so nothing is ever
   * recorded that did not happen. The reverse ordering would log a change
   * that a failed write never made. If the audit insert itself fails the
   * error propagates and the caller sees a failure — the setting has
   * changed by then, which is the lesser of the two wrongs and is visible
   * in the row's own `updated_at`/`updated_by`.
   */
  async setPifSelfRegistration(
    actor: AuthContext,
    enabled: boolean
  ): Promise<PifSelfRegistrationStatus> {
    const previous = await this.settings.findByKey(PIF_SELF_REGISTRATION_SETTING_KEY);
    const previousEnabled = previous === null ? false : readSelfRegistrationFlag(previous.value);

    await this.settings.upsert({
      key: PIF_SELF_REGISTRATION_SETTING_KEY,
      value: selfRegistrationSettingValue(enabled),
      updatedBy: actor.principalId,
    });

    await this.auditLog.logEvent({
      actorId: actor.principalId,
      actorRole: [...actor.roles].sort().join(',') || null,
      module: 'shared',
      action: enabled ? 'PIF_SELF_REGISTRATION_ENABLED' : 'PIF_SELF_REGISTRATION_DISABLED',
      entityType: 'shared.settings',
      // shared.settings has a TEXT primary key and this column is uuid, so
      // the key travels in the payloads instead. Same approach as the OTP
      // events in CustomerAuthService.
      entityId: null,
      before: {
        key: PIF_SELF_REGISTRATION_SETTING_KEY,
        enabled: previousEnabled,
        // Distinguishes "was off" from "had never been set", which the
        // boolean alone cannot.
        existed: previous !== null,
      },
      after: {
        key: PIF_SELF_REGISTRATION_SETTING_KEY,
        enabled,
      },
    });

    return this.readPifSelfRegistration();
  }
}

/**
 * Whether the stored jsonb is the envelope this feature writes — an
 * object carrying a boolean `value`. Used only to tell an administrator
 * that a row is unreadable; the gate's own decision never consults it.
 */
function isApprovedEnvelope(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return typeof (raw as { value?: unknown }).value === 'boolean';
}
