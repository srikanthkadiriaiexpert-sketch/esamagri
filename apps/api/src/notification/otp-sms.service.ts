import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { ApiEnv } from '@esamagri/config';
import {
  SmsGatewayHubProvider,
  type SmsGatewayHubFailureReason,
} from './smsgatewayhub.provider';

/**
 * The OTP delivery boundary. ONE PROVIDER NOW SITS BEHIND IT: SMS
 * Gateway Hub.
 *
 * WHAT THIS FILE USED TO BE. A 2Factor client: it built
 * `{base}/{api_key}/SMS/{phone}/{otp}/{template}`, called it with a
 * timeout, read the provider's `Status` field and had a dry-run switch.
 * All of that was removed when the 2Factor integration was retired, and
 * none of it came back: the HTTP call now lives in
 * smsgatewayhub.provider.ts, which this file selects but does not
 * reimplement.
 *
 * WHY THE CLASS AND ITS SEAM SURVIVED THE PROVIDER. CustomerAuthService
 * injects OtpSmsService and awaits `send()` on every code it issues.
 * Deleting the class would have meant editing the authentication flow to
 * remove the call — and the authentication flow is precisely what that
 * cleanup, and this integration, were required to leave alone. The seam
 * did its job: adding SMS Gateway Hub changed this file and the module,
 * and `customer-auth.service.ts` and `auth.module.ts` not at all.
 *
 * THE OUTCOMES, AND WHAT EACH ONE HONESTLY MEANS:
 *
 *   OTP_DELIVERY_PROVIDER=NONE            → DISABLED. Delivery is
 *       switched off, which is still the shipped default.
 *   OTP_DELIVERY_PROVIDER=SMS_GATEWAY_HUB → SENT only when the gateway
 *       answered ErrorCode 000; otherwise FAILED with a specific
 *       reason.
 *   anything else (WHATSAPP)              → FAILED / NO_PROVIDER,
 *       logged at error level, audited by the caller.
 *
 * `SENT` IS NOW REACHABLE, AND ONLY ON ONE PATH. It is returned when,
 * and only when, SmsGatewayHubProvider reports that the gateway
 * accepted the message. Note what it does NOT claim: acceptance by the
 * gateway is not delivery to the handset. The vendor's delivery-report
 * API answers that and is deliberately not called — a one-time code is
 * not worth holding a sign-in open to poll for.
 *
 * THE SECOND HALF OF THE GUARANTEE IS IN THE CONFIG PACKAGE.
 * `OTP_DELIVERY_PROVIDER` still refuses 'SMS_2FACTOR' and 'SMS_GATEWAY'
 * by name, and selecting 'SMS_GATEWAY_HUB' without its credentials is
 * refused at startup. The branch below is the belt to those braces:
 * 'WHATSAPP' is still a spellable value, because the WhatsApp settings
 * also govern order notifications, and selecting it must fail loudly
 * here rather than quietly deliver nothing.
 *
 * WHAT THIS FILE NEVER DID AND STILL DOES NOT DO. It does not generate
 * the code, hash it, store it, expire it, count attempts against it or
 * verify it. OtpService generates (CSPRNG), shared.otp_requests holds
 * only HMAC-SHA256(OTP_HASH_PEPPER, code), and CustomerAuthService
 * verifies in constant time. The provider is transport only, for the
 * reasons set out in @esamagri/config's api-env.ts.
 *
 * NEVER THROWS. A delivery problem must not change what a sign-in
 * request looks like from outside — see the call site.
 */

/**
 * THE DLT-APPROVED MESSAGE. The wording is fixed by the template
 * registered with the operator; it is not a string to tidy up. Changing
 * so much as the punctuation makes the text stop matching the
 * registered template, and the gateway answers ErrorCode 024
 * ("invalid template or template mismatch") — which surfaces here as
 * FAILED/PROVIDER_TEMPLATE and means no customer receives a code at
 * all.
 *
 * THE REGISTERED TEMPLATE, EXACTLY AS APPROVED:
 *
 *   Your OTP for e-Samagri login is {#num#}. Valid for 5 minutes. Do
 *   not share this OTP with anyone. - Sri Lakshmi Srinivasa Mart
 *
 * `{#num#}` IS A REGISTRATION TOKEN, NOT TEXT TO SEND. It marks, for
 * the operator's registry, the one position in the template that is
 * allowed to vary. The message that goes on the wire carries the
 * six-digit code in that position and the token itself NEVER appears in
 * it — sending the literal `{#num#}` would be a template mismatch and
 * would also put a meaningless string in front of a customer. There is
 * a test asserting the sent text contains no `{#`.
 *
 * The code is that single substitution. This is the one and only place
 * the OTP is read in this file, and it goes straight into the string
 * handed to the transport — never into a log line, never into a return
 * value, never into an audit row.
 */
export function buildOtpMessage(code: string): string {
  return (
    `Your OTP for e-Samagri login is ${code}. Valid for 5 minutes. ` +
    `Do not share this OTP with anyone. - Sri Lakshmi Srinivasa Mart`
  );
}

/**
 * `NO_PROVIDER` means a channel was selected that this build cannot
 * perform. Every other reason comes from the SMS Gateway Hub transport
 * and is already a safe, internal label — the gateway's own response
 * never travels further than a log line.
 */
export type OtpDeliveryFailureReason = 'NO_PROVIDER' | SmsGatewayHubFailureReason;

export type OtpDeliveryOutcome =
  | { status: 'DISABLED' }
  /** Reached only when SMS Gateway Hub accepted the message (ErrorCode 000). */
  | { status: 'SENT' }
  | { status: 'FAILED'; reason: OtpDeliveryFailureReason };

@Injectable()
export class OtpSmsService implements OnModuleInit {
  private readonly logger = new Logger(OtpSmsService.name);

  /**
   * The provider is @Optional() for one specific reason: the existing
   * unit suites construct this service with `new OtpSmsService(config)`
   * and assert that NO HTTP request is made. Making the transport a
   * required constructor argument would have forced every one of those
   * tests to supply one, which is the opposite of what they are
   * defending. Absent, it fails safe — SMS_GATEWAY_HUB with no
   * transport wired in reports FAILED/NO_PROVIDER, exactly as an
   * unimplemented channel does.
   */
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnv, true>,
    @Optional() @Inject(SmsGatewayHubProvider) private readonly smsGatewayHub?: SmsGatewayHubProvider
  ) {}

  /**
   * A single line at start-up saying what this process will do with an
   * OTP, and it exists because of a real afternoon lost to its absence.
   *
   * Settings are read ONCE, when the process starts. An API already
   * running when .env is edited keeps the old settings — so an operator
   * who switches SMS on, and does not restart, sees codes being issued,
   * no error anywhere, and no SMS arriving. The DISABLED path is
   * deliberately quiet (it is the shipped default and must not fill the
   * log), which is right, but it leaves "switched off" and "sent
   * successfully" looking identical from outside.
   *
   * This line is the difference. It names the channel, and for SMS
   * Gateway Hub it says whether the credentials are present and whether
   * the transport is wired — WITHOUT reading either credential out.
   */
  onModuleInit(): void {
    const provider = this.config.get('OTP_DELIVERY_PROVIDER', { infer: true });

    if (provider === 'NONE') {
      this.logger.log(
        'OTP delivery: SWITCHED OFF (OTP_DELIVERY_PROVIDER=NONE). Codes will be issued and ' +
          'verified normally, but NO SMS WILL BE SENT.'
      );
      return;
    }

    if (provider === 'SMS_GATEWAY_HUB') {
      // isConfigured() checks presence only; no value is read out here.
      const credentials = this.smsGatewayHub?.isConfigured() === true ? 'present' : 'MISSING';
      const transport = this.smsGatewayHub ? 'wired' : 'NOT WIRED';
      this.logger.log(
        `OTP delivery: SMS Gateway Hub — credentials ${credentials}, transport ${transport}.`
      );
      return;
    }

    this.logger.warn(
      `OTP delivery: OTP_DELIVERY_PROVIDER=${provider} is selected, but this build has NO ` +
        `transport for it. Every code issued will record OTP_DELIVERY_FAILED and NO SMS WILL ` +
        `BE SENT.`
    );
  }

  /**
   * Whether a delivery channel has been ASKED FOR — not whether one can
   * be performed, which is false either way today. The distinction is why
   * this is not named `canDeliver`: an operator who selected a channel
   * should see a failure, not silence, and `send()` relies on this
   * telling it what was requested.
   */
  isEnabled(): boolean {
    return this.config.get('OTP_DELIVERY_PROVIDER', { infer: true }) !== 'NONE';
  }

  /**
   * `code` was deliberately unread while there was nowhere to send it.
   * It is read now, in exactly one place and for exactly one purpose:
   * buildOtpMessage composes the DLT-approved text around it and hands
   * that text to the transport. It is still never logged, never
   * returned, and never written anywhere but as its HMAC, which
   * CustomerAuthService wrote before calling this.
   *
   * The signature is unchanged, so the call site is unchanged.
   */
  async send(mobileNumber: string, code: string): Promise<OtpDeliveryOutcome> {
    const recipient = this.recipientHash(mobileNumber);
    const provider = this.config.get('OTP_DELIVERY_PROVIDER', { infer: true });

    if (provider === 'NONE') {
      // Not an error, and not a failure to audit: this is the shipped
      // default. The OTP row has already been written either way, so a
      // code nobody receives simply goes unused and expires.
      this.logger.debug(`OTP delivery is switched off; nothing sent. recipient=${recipient}`);
      return { status: 'DISABLED' };
    }

    if (provider === 'SMS_GATEWAY_HUB' && this.smsGatewayHub) {
      // The ONE path that can report a delivery, and it reports one
      // only because the gateway said ErrorCode 000. Everything the
      // provider can go wrong with — no credentials, a rejected sender
      // ID, a template mismatch, a timeout, a body that is not JSON —
      // comes back as a specific FAILED reason, which the caller
      // audits as OTP_DELIVERY_FAILED. The provider never throws, and
      // the try/catch is the belt to that braces: if it ever did, a
      // sign-in must still not break.
      try {
        const result = await this.smsGatewayHub.send(mobileNumber, buildOtpMessage(code));
        if (result.status === 'SENT') {
          return { status: 'SENT' };
        }
        return { status: 'FAILED', reason: result.reason };
      } catch (error) {
        this.logger.error(
          `SMS Gateway Hub transport threw, which it is not supposed to do ` +
            `(${error instanceof Error ? error.name : typeof error}); NOTHING CONFIRMED SENT. ` +
            `recipient=${recipient}`
        );
        return { status: 'FAILED', reason: 'NETWORK' };
      }
    }

    // An operator asked for delivery and there is no transport to do
    // it — either a channel this build does not implement (WHATSAPP),
    // or SMS_GATEWAY_HUB with no provider wired in. Error level, and
    // the caller audits it: the one thing this must never do is return
    // quietly and let the sign-in look complete.
    this.logger.error(
      `OTP delivery was requested (OTP_DELIVERY_PROVIDER=${provider}) but NO SMS PROVIDER IS ` +
        `IMPLEMENTED for it in this build, so NOTHING WAS SENT and no code reached the recipient. ` +
        `Set OTP_DELIVERY_PROVIDER=NONE, or SMS_GATEWAY_HUB with its credentials. ` +
        `recipient=${recipient}`
    );
    return { status: 'FAILED', reason: 'NO_PROVIDER' };
  }

  /**
   * A short, non-reversible tag for one mobile number. Identical to
   * CustomerAuthService.hashForAudit, on purpose: a log line and an audit
   * row for the same sign-in can be matched up without either storing a
   * phone number.
   */
  private recipientHash(mobileNumber: string): string {
    return createHash('sha256').update(mobileNumber).digest('hex').slice(0, 16);
  }
}
