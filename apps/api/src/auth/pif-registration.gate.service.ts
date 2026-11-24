import { Injectable, Logger } from '@nestjs/common';
import { SettingsRepository } from '../shared/repositories/settings.repository';
import {
  PIF_SELF_REGISTRATION_SETTING_KEY,
  readSelfRegistrationFlag,
} from './pif-registration.gate';

/**
 * The one place that answers "may a resident register right now?".
 *
 * FOUR WAYS TO BE OFF, AND ONLY ONE WAY TO BE ON. The setting must exist,
 * parse as the approved envelope, and hold the boolean true. A missing
 * row, an uninterpretable value, a false value and a failed query all
 * return false — see pif-registration.gate.ts for why the parser is
 * deliberately unforgiving.
 *
 * WHY THE QUERY IS NOT CACHED. Two public endpoints consult this, at
 * human typing speed, against an indexed primary key. A cache would buy
 * nothing measurable and would introduce the one failure that matters
 * here: a window in which an administrator has switched registration OFF
 * and an API instance still accepts registrations. "Takes effect
 * immediately, everywhere" is worth more than a saved lookup.
 *
 * WHY A FAILED QUERY IS NOT AN ERROR TO THE CALLER. The caller's refusal
 * path is already correct and already tested: 503 with the standard
 * message. Letting a database error propagate would replace that with a
 * 500 and a different body, which tells a resident less and tells an
 * attacker more. The error is logged at error level so an operator sees
 * the real cause.
 */
@Injectable()
export class PifRegistrationGate {
  private readonly logger = new Logger(PifRegistrationGate.name);

  constructor(private readonly settings: SettingsRepository) {}

  async isEnabled(): Promise<boolean> {
    let raw: unknown;
    try {
      const row = await this.settings.findByKey(PIF_SELF_REGISTRATION_SETTING_KEY);
      if (row === null) {
        // The shipped state: the key has never been written. Not an
        // error, and not logged as one — there is no seed row by design.
        return false;
      }
      raw = row.value;
    } catch (err) {
      // FAIL CLOSED. A connection blip must never read as "registration
      // is open". The message is logged, not the resident's request.
      this.logger.error(
        `Could not read ${PIF_SELF_REGISTRATION_SETTING_KEY}; treating PIF self-registration as OFF. ` +
          `cause=${err instanceof Error ? err.name : 'unknown'}`
      );
      return false;
    }

    const enabled = readSelfRegistrationFlag(raw);
    if (!enabled && raw !== null && typeof raw === 'object' && !('value' in (raw as object))) {
      // The row exists but does not carry the envelope. Worth a line: it
      // means something wrote this key by hand, and the administrator who
      // pressed the control will be wondering why nothing happened.
      this.logger.warn(
        `${PIF_SELF_REGISTRATION_SETTING_KEY} exists but has no 'value' property; treating it as OFF.`
      );
    }
    return enabled;
  }
}
