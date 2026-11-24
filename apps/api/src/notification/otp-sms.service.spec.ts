import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import 'reflect-metadata';
import { loadApiEnv, type ApiEnv } from '@esamagri/config';
import { OtpSmsService, buildOtpMessage } from './otp-sms.service';
import { SmsGatewayHubProvider } from './smsgatewayhub.provider';
import { NotificationModule } from './notification.module';

/**
 * Unit tests for the OTP delivery boundary AFTER the 2Factor integration
 * was removed. No network, no database, no provider account.
 *
 * This suite replaces the 2Factor one. Those tests asserted the shape of
 * a 2Factor URL, its dry-run switch, its `Status` parsing and its
 * timeout handling — all of which describe code that no longer exists,
 * so keeping them would have meant keeping the provider. What carried
 * over is every protection that was not about 2Factor specifically: that
 * nothing is sent unless it is meant to be, that a delivery problem is
 * never thrown at a sign-in, that no secret reaches a log line, and that
 * the recipient stays correlatable without being identifiable.
 *
 * The four things these tests are really defending:
 *
 *   1. NO HTTP REQUEST IS MADE, EVER. `fetch` is replaced with a spy
 *      that fails the test if it is called at all. That is the strongest
 *      statement available here that the provider is gone rather than
 *      merely switched off.
 *   2. A non-delivery can never read as a delivery. Only DISABLED and
 *      FAILED/NO_PROVIDER are reachable; SENT is not.
 *   3. Selecting a channel that has no implementation FAILS LOUDLY —
 *      it does not return DISABLED and look deliberate.
 *   4. The configuration layer refuses the retired provider values by
 *      name, and no SMS_2FACTOR_* setting exists any more.
 */

const MOBILE = '+919000000001';
const CODE = '246813';

let logs: string[] = [];
let originalFetch: unknown;
let fetchSpy: jest.Mock;

function makeService(overrides: Record<string, unknown> = {}): OtpSmsService {
  const values: Record<string, unknown> = { OTP_DELIVERY_PROVIDER: 'NONE', ...overrides };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService<ApiEnv, true>;
  return new OtpSmsService(config);
}

/** Every log line this suite produced, joined — for leak assertions. */
function allLogText(): string {
  return logs.join('\n');
}

beforeEach(() => {
  logs = [];
  originalFetch = (globalThis as unknown as { fetch: unknown }).fetch;

  // Not a stub that returns a response — a tripwire. Any surviving
  // provider code path would call this and fail the test by name.
  fetchSpy = jest.fn(() => {
    throw new Error('fetch must never be called: OTP SMS delivery has no provider');
  });
  (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;

  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    // The rest parameter is required, not decorative: Nest's Logger
    // methods are (message: any, ...optionalParams: any[]) => void, so a
    // one-argument implementation is not assignable to them — the target
    // "allows only 1 element but source may have more".
    jest
      .spyOn(Logger.prototype, level)
      .mockImplementation((message: unknown, ..._rest: unknown[]): void => {
        logs.push(typeof message === 'string' ? message : JSON.stringify(message));
      });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
  (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
});

describe('OtpSmsService — there is no provider, and nothing pretends otherwise', () => {
  it('reports DISABLED, and sends nothing, when no channel is selected', async () => {
    const service = makeService({ OTP_DELIVERY_PROVIDER: 'NONE' });

    await expect(service.send(MOBILE, CODE)).resolves.toEqual({ status: 'DISABLED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('makes no HTTP request whatever the configuration says', async () => {
    for (const provider of ['NONE', 'WHATSAPP', 'SMS_2FACTOR', 'SMS_GATEWAY', 'anything']) {
      await makeService({ OTP_DELIVERY_PROVIDER: provider }).send(MOBILE, CODE);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never reports SENT, for any provider value', async () => {
    for (const provider of ['NONE', 'WHATSAPP', 'SMS_2FACTOR', 'SMS_GATEWAY', 'anything']) {
      const outcome = await makeService({ OTP_DELIVERY_PROVIDER: provider }).send(MOBILE, CODE);
      expect(outcome.status).not.toBe('SENT');
    }
  });

  it('isEnabled() reports what was ASKED FOR, not what can be done', async () => {
    expect(makeService({ OTP_DELIVERY_PROVIDER: 'NONE' }).isEnabled()).toBe(false);
    expect(makeService({ OTP_DELIVERY_PROVIDER: 'WHATSAPP' }).isEnabled()).toBe(true);
  });
});

describe('OtpSmsService — selecting an unimplemented channel fails loudly', () => {
  it('reports FAILED/NO_PROVIDER rather than DISABLED when a channel IS selected', async () => {
    const service = makeService({ OTP_DELIVERY_PROVIDER: 'WHATSAPP' });

    await expect(service.send(MOBILE, CODE)).resolves.toEqual({
      status: 'FAILED',
      reason: 'NO_PROVIDER',
    });
  });

  it('says plainly, at error level, that nothing was sent', async () => {
    await makeService({ OTP_DELIVERY_PROVIDER: 'WHATSAPP' }).send(MOBILE, CODE);

    expect(allLogText()).toContain('NO SMS PROVIDER IS IMPLEMENTED');
    expect(allLogText()).toContain('NOTHING WAS SENT');
  });

  it('tells the operator how to put the configuration back to the honest state', async () => {
    await makeService({ OTP_DELIVERY_PROVIDER: 'WHATSAPP' }).send(MOBILE, CODE);

    expect(allLogText()).toContain('OTP_DELIVERY_PROVIDER=NONE');
  });

  it('never rejects, whatever the provider value is — a sign-in must not break', async () => {
    for (const provider of ['NONE', 'WHATSAPP', 'SMS_2FACTOR', '', 'nonsense']) {
      await expect(
        makeService({ OTP_DELIVERY_PROVIDER: provider }).send(MOBILE, CODE)
      ).resolves.toBeDefined();
    }
  });

  it('survives a provider value that is missing from the configuration entirely', async () => {
    const config = { get: () => undefined } as unknown as ConfigService<ApiEnv, true>;
    await expect(new OtpSmsService(config).send(MOBILE, CODE)).resolves.toEqual({
      status: 'FAILED',
      reason: 'NO_PROVIDER',
    });
  });
});

describe('OtpSmsService — nothing secret reaches a log line', () => {
  it('logs neither the code nor the full mobile number when delivery is off', async () => {
    await makeService({ OTP_DELIVERY_PROVIDER: 'NONE' }).send(MOBILE, CODE);

    const text = allLogText();
    expect(text).not.toContain(CODE);
    expect(text).not.toContain(MOBILE);
    expect(text).not.toContain('9000000001');
  });

  it('logs neither the code nor the full mobile number on a NO_PROVIDER failure', async () => {
    await makeService({ OTP_DELIVERY_PROVIDER: 'WHATSAPP' }).send(MOBILE, CODE);

    const text = allLogText();
    expect(text).not.toContain(CODE);
    expect(text).not.toContain(MOBILE);
    expect(text).not.toContain('9000000001');
  });

  it('still identifies the recipient well enough to correlate, without the number', async () => {
    await makeService({ OTP_DELIVERY_PROVIDER: 'WHATSAPP' }).send(MOBILE, CODE);

    // Same scheme as CustomerAuthService.hashForAudit: sha256, first 16 hex.
    expect(allLogText()).toMatch(/recipient=[0-9a-f]{16}/);
  });
});

describe('configuration validation', () => {
  const VALID_SOURCE: Record<string, string | undefined> = {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/esamagri_test',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    REFRESH_COOKIE_DOMAIN: 'localhost',
    OTP_HASH_PEPPER: 'b'.repeat(16),
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  };

  it('defaults to sending nothing: provider NONE', () => {
    const env = loadApiEnv(VALID_SOURCE);
    expect(env.OTP_DELIVERY_PROVIDER).toBe('NONE');
  });

  it('no longer defines any SMS_2FACTOR_* setting at all', () => {
    // NARROWED, NOT WEAKENED, when SMS Gateway Hub landed. This used to
    // assert that NO key began with "SMS_", which was the right test
    // while there was no SMS provider: any such key would have been a
    // 2Factor leftover. There is a provider now, so the assertion is
    // the one that was always meant — every SMS_* setting belongs to
    // the provider that is actually implemented, and not one belongs to
    // the retired integration.
    const env = loadApiEnv(VALID_SOURCE);
    const smsKeys = Object.keys(env).filter((key) => key.startsWith('SMS_'));
    expect(smsKeys.filter((key) => !key.startsWith('SMS_GATEWAY_HUB_'))).toEqual([]);
    expect(smsKeys.some((key) => key.includes('2FACTOR'))).toBe(false);
  });

  it('refuses to start when the retired 2Factor provider is selected, naming it', () => {
    expect(() => loadApiEnv({ ...VALID_SOURCE, OTP_DELIVERY_PROVIDER: 'SMS_2FACTOR' })).toThrow(
      /SMS_2FACTOR is no longer supported/
    );
  });

  it('refuses to start on SMS_GATEWAY, which never had an implementation', () => {
    expect(() => loadApiEnv({ ...VALID_SOURCE, OTP_DELIVERY_PROVIDER: 'SMS_GATEWAY' })).toThrow(
      /SMS_GATEWAY is no longer supported/
    );
  });

  it('tells the operator, in the refusal, which value now provides SMS', () => {
    // The advice in this message changed with the integration, and had
    // to: it used to say no value enables SMS delivery, which stopped
    // being true. What must NOT change is that the refusal still
    // happens and still names the retired value — asserted above.
    expect(() => loadApiEnv({ ...VALID_SOURCE, OTP_DELIVERY_PROVIDER: 'SMS_2FACTOR' })).toThrow(
      /OTP_DELIVERY_PROVIDER=SMS_GATEWAY_HUB/
    );
  });

  it('accepts SMS_GATEWAY_HUB when both credentials are present', () => {
    const env = loadApiEnv({
      ...VALID_SOURCE,
      OTP_DELIVERY_PROVIDER: 'SMS_GATEWAY_HUB',
      SMS_GATEWAY_HUB_API_KEY: 'not-a-real-key',
      SMS_GATEWAY_HUB_SENDER_ID: 'TESTID',
    });
    expect(env.OTP_DELIVERY_PROVIDER).toBe('SMS_GATEWAY_HUB');
  });

  it('applies the documented defaults for route, channel, DCS and timeout', () => {
    const env = loadApiEnv({
      ...VALID_SOURCE,
      OTP_DELIVERY_PROVIDER: 'SMS_GATEWAY_HUB',
      SMS_GATEWAY_HUB_API_KEY: 'not-a-real-key',
      SMS_GATEWAY_HUB_SENDER_ID: 'TESTID',
    });
    expect(env.SMS_GATEWAY_HUB_ROUTE).toBe('1');
    expect(env.SMS_GATEWAY_HUB_CHANNEL).toBe('2');
    expect(env.SMS_GATEWAY_HUB_DCS).toBe('0');
    expect(env.SMS_GATEWAY_HUB_TIMEOUT_MS).toBe(10_000);
  });

  it('refuses to start on SMS_GATEWAY_HUB with no API key, naming the setting', () => {
    expect(() =>
      loadApiEnv({
        ...VALID_SOURCE,
        OTP_DELIVERY_PROVIDER: 'SMS_GATEWAY_HUB',
        SMS_GATEWAY_HUB_SENDER_ID: 'TESTID',
      })
    ).toThrow(/SMS_GATEWAY_HUB_API_KEY/);
  });

  it('refuses to start on SMS_GATEWAY_HUB with no sender ID, naming the setting', () => {
    expect(() =>
      loadApiEnv({
        ...VALID_SOURCE,
        OTP_DELIVERY_PROVIDER: 'SMS_GATEWAY_HUB',
        SMS_GATEWAY_HUB_API_KEY: 'not-a-real-key',
      })
    ).toThrow(/SMS_GATEWAY_HUB_SENDER_ID/);
  });

  it('never echoes the API key back in a validation error', () => {
    // A refusal that quotes the credential it is complaining about puts
    // it into a log, a terminal and probably a screenshot.
    const key = 'sghk-live-SHOULD-NEVER-APPEAR-IN-AN-ERROR';
    try {
      loadApiEnv({
        ...VALID_SOURCE,
        OTP_DELIVERY_PROVIDER: 'SMS_GATEWAY_HUB',
        SMS_GATEWAY_HUB_API_KEY: key,
        // sender ID omitted, so this refuses and we can read the message
      });
      throw new Error('expected loadApiEnv to refuse');
    } catch (error) {
      expect((error as Error).message).not.toContain(key);
    }
  });

  it('still refuses the retired SMS_GATEWAY, which SMS_GATEWAY_HUB must not unlock', () => {
    // The two values differ by a suffix. The refusal is an exact-key
    // lookup, and this is what proves adding the new one did not turn
    // the old one into a prefix match.
    expect(() => loadApiEnv({ ...VALID_SOURCE, OTP_DELIVERY_PROVIDER: 'SMS_GATEWAY' })).toThrow(
      /SMS_GATEWAY is no longer supported/
    );
  });

  it('still accepts NONE and the WhatsApp channel, so existing deployments start', () => {
    expect(loadApiEnv({ ...VALID_SOURCE, OTP_DELIVERY_PROVIDER: 'NONE' }).OTP_DELIVERY_PROVIDER).toBe(
      'NONE'
    );
    expect(
      loadApiEnv({
        ...VALID_SOURCE,
        OTP_DELIVERY_PROVIDER: 'WHATSAPP',
        WHATSAPP_API_BASE_URL: 'https://graph.facebook.test/v20.0',
        WHATSAPP_API_TOKEN: 'token-not-a-real-credential',
        WHATSAPP_BUSINESS_PHONE_NUMBER_ID: '1234567890',
      }).OTP_DELIVERY_PROVIDER
    ).toBe('WHATSAPP');
  });

  it('leaves every existing OTP control at its established default', () => {
    const env = loadApiEnv(VALID_SOURCE);
    expect(env.OTP_TTL_SECONDS).toBe(300);
    expect(env.OTP_MAX_ATTEMPTS).toBe(5);
    expect(env.OTP_REQUEST_WINDOW_SECONDS).toBe(3600);
    expect(env.OTP_REQUEST_MAX_PER_WINDOW).toBe(5);
  });

  it('still requires the OTP hash pepper — local hashing is not optional', () => {
    const { OTP_HASH_PEPPER: _omitted, ...withoutPepper } = VALID_SOURCE;
    expect(() => loadApiEnv(withoutPepper)).toThrow(/OTP_HASH_PEPPER/);
  });
});

/**
 * The SMS Gateway Hub branch, at the PORT level. The transport itself
 * has its own suite (smsgatewayhub.provider.spec.ts); what is asserted
 * here is only what this file decides: which provider is selected, that
 * a gateway failure becomes a FAILED outcome rather than an exception,
 * that the approved DLT wording is what gets handed over, and that the
 * code still never reaches a log line now that it is finally read.
 *
 * The fetch tripwire from the top of this file is still armed
 * throughout: the transport is a stub here, so no code path in this
 * suite may reach the network either.
 */
function makeServiceWithGateway(
  gatewaySend: jest.Mock,
  overrides: Record<string, unknown> = {}
): OtpSmsService {
  const values: Record<string, unknown> = {
    OTP_DELIVERY_PROVIDER: 'SMS_GATEWAY_HUB',
    ...overrides,
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService<ApiEnv, true>;
  const gateway = { send: gatewaySend, isConfigured: () => true } as unknown as SmsGatewayHubProvider;
  return new OtpSmsService(config, gateway);
}

describe('OtpSmsService — the SMS Gateway Hub branch', () => {
  it('reports SENT when, and only when, the gateway accepted the message', async () => {
    const send = jest.fn().mockResolvedValue({ status: 'SENT', jobId: '375887642', messageId: 'KB9' });

    await expect(makeServiceWithGateway(send).send(MOBILE, CODE)).resolves.toEqual({
      status: 'SENT',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hands the transport the DLT-approved wording, with the code substituted', async () => {
    const send = jest.fn().mockResolvedValue({ status: 'SENT', jobId: null, messageId: null });
    await makeServiceWithGateway(send).send(MOBILE, CODE);

    const [number, text] = send.mock.calls[0] as [string, string];
    expect(number).toBe(MOBILE);
    expect(text).toBe(
      `Your OTP for e-Samagri login is ${CODE}. Valid for 5 minutes. ` +
        `Do not share this OTP with anyone. - Sri Lakshmi Srinivasa Mart`
    );
  });

  /**
   * THE REGISTERED DLT TEMPLATE, TRANSCRIBED VERBATIM — including the
   * `{#num#}` token, every space and the hyphen before the trading
   * name. This constant is the contract with the telecom registry, and
   * it is written out here rather than derived from the code so that
   * the test compares our output against the APPROVED TEXT, not against
   * itself. Any edit to the message — a stray space, a full stop, "e
   * Samagri" for "e-Samagri" — fails this test instead of failing
   * silently at the gateway with ErrorCode 024, by which point no
   * customer is receiving a code.
   */
  const DLT_APPROVED_TEMPLATE =
    'Your OTP for e-Samagri login is {#num#}. Valid for 5 minutes. ' +
    'Do not share this OTP with anyone. - Sri Lakshmi Srinivasa Mart';

  it('reproduces the registered template exactly, with only {#num#} substituted', () => {
    for (const code of ['123456', '000000', '482915']) {
      expect(buildOtpMessage(code)).toBe(DLT_APPROVED_TEMPLATE.replace('{#num#}', code));
    }
  });

  /**
   * `{#num#}` is a registration token, not text. Sending it literally
   * would both mismatch the template and put gibberish in front of a
   * customer, so it must never survive into the message.
   */
  it('never sends the placeholder token itself', () => {
    const message = buildOtpMessage('482915');
    expect(message).not.toContain('{#');
    expect(message).not.toContain('#}');
    expect(message).not.toContain('num');
    expect(message).toContain('482915');
  });

  it('stays within one SMS segment, in plain GSM characters', () => {
    const message = buildOtpMessage('482915');
    expect(message.length).toBeLessThanOrEqual(160);
    // No smart quotes, no en dash, nothing that would force Unicode
    // (DCS 8) and halve the segment length.
    expect(/^[\x20-\x7E]*$/.test(message)).toBe(true);
  });

  it('builds that message from the exported helper, so the template has one home', () => {
    expect(buildOtpMessage('123456')).toContain('Your OTP for e-Samagri login is 123456.');
    expect(buildOtpMessage('123456')).toContain('Valid for 5 minutes.');
    expect(buildOtpMessage('123456')).toContain('Do not share this OTP with anyone.');
    expect(buildOtpMessage('123456')).toContain('Sri Lakshmi Srinivasa Mart');
  });

  it('passes a gateway failure through as a FAILED outcome with its own reason', async () => {
    for (const reason of [
      'NOT_CONFIGURED',
      'PROVIDER_KEY_REJECTED',
      'PROVIDER_ACCOUNT_BLOCKED',
      'PROVIDER_API_RESTRICTED',
      'PROVIDER_IP_NOT_ALLOWED',
      'PROVIDER_SENDER_ID',
      'PROVIDER_TEMPLATE',
      'PROVIDER_CREDITS',
      'TIMEOUT',
      'NETWORK',
      'MALFORMED_RESPONSE',
    ] as const) {
      const send = jest.fn().mockResolvedValue({ status: 'FAILED', reason, errorCode: null });
      await expect(makeServiceWithGateway(send).send(MOBILE, CODE)).resolves.toEqual({
        status: 'FAILED',
        reason,
      });
    }
  });

  it('never rejects even if the transport throws, which it is not supposed to', async () => {
    const send = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(makeServiceWithGateway(send).send(MOBILE, CODE)).resolves.toEqual({
      status: 'FAILED',
      reason: 'NETWORK',
    });
  });

  it('fails safe when SMS_GATEWAY_HUB is selected but no transport is wired in', async () => {
    // Nest registers the provider, so this cannot happen in the running
    // app — but if it ever did, the result must be an audited failure,
    // never a silent success.
    await expect(makeService({ OTP_DELIVERY_PROVIDER: 'SMS_GATEWAY_HUB' }).send(MOBILE, CODE))
      .resolves.toEqual({ status: 'FAILED', reason: 'NO_PROVIDER' });
  });

  it('does not call the gateway at all when delivery is switched off', async () => {
    const send = jest.fn();
    await expect(
      makeServiceWithGateway(send, { OTP_DELIVERY_PROVIDER: 'NONE' }).send(MOBILE, CODE)
    ).resolves.toEqual({ status: 'DISABLED' });
    expect(send).not.toHaveBeenCalled();
  });

  it('does not call the gateway when a different channel is selected', async () => {
    const send = jest.fn();
    await expect(
      makeServiceWithGateway(send, { OTP_DELIVERY_PROVIDER: 'WHATSAPP' }).send(MOBILE, CODE)
    ).resolves.toEqual({ status: 'FAILED', reason: 'NO_PROVIDER' });
    expect(send).not.toHaveBeenCalled();
  });

  it('still logs neither the code nor the mobile number, now that the code is read', async () => {
    const send = jest.fn().mockResolvedValue({ status: 'SENT', jobId: null, messageId: null });
    await makeServiceWithGateway(send).send(MOBILE, CODE);

    const text = allLogText();
    expect(text).not.toContain(CODE);
    expect(text).not.toContain(MOBILE);
    expect(text).not.toContain('9000000001');
  });

  it('logs no code or number on a failure either', async () => {
    const send = jest
      .fn()
      .mockResolvedValue({ status: 'FAILED', reason: 'PROVIDER_TEMPLATE', errorCode: '024' });
    await makeServiceWithGateway(send).send(MOBILE, CODE);

    const text = allLogText();
    expect(text).not.toContain(CODE);
    expect(text).not.toContain(MOBILE);
  });

  it('isEnabled() reports true for SMS_GATEWAY_HUB', () => {
    expect(makeService({ OTP_DELIVERY_PROVIDER: 'SMS_GATEWAY_HUB' }).isEnabled()).toBe(true);
  });
});

/**
 * THE START-UP LINE. Its whole purpose is to make "this process is
 * running settings that were edited after it started" visible from the
 * log, because that failure is otherwise indistinguishable from a
 * working send.
 */
describe('OtpSmsService — the start-up line says what this process will do', () => {
  it('says plainly that nothing will be sent when delivery is off', () => {
    makeService({ OTP_DELIVERY_PROVIDER: 'NONE' }).onModuleInit();

    expect(allLogText()).toContain('SWITCHED OFF');
    expect(allLogText()).toContain('NO SMS WILL BE SENT');
  });

  it('names SMS Gateway Hub, and confirms credentials and transport, when selected', () => {
    const gateway = { send: jest.fn(), isConfigured: () => true } as unknown as SmsGatewayHubProvider;
    const config = {
      get: () => 'SMS_GATEWAY_HUB',
    } as unknown as ConfigService<ApiEnv, true>;

    new OtpSmsService(config, gateway).onModuleInit();

    expect(allLogText()).toContain('SMS Gateway Hub');
    expect(allLogText()).toContain('credentials present');
    expect(allLogText()).toContain('transport wired');
  });

  it('says MISSING rather than present when the credentials are absent', () => {
    const gateway = { send: jest.fn(), isConfigured: () => false } as unknown as SmsGatewayHubProvider;
    const config = { get: () => 'SMS_GATEWAY_HUB' } as unknown as ConfigService<ApiEnv, true>;

    new OtpSmsService(config, gateway).onModuleInit();

    expect(allLogText()).toContain('credentials MISSING');
  });

  it('warns when a channel with no transport is selected', () => {
    makeService({ OTP_DELIVERY_PROVIDER: 'WHATSAPP' }).onModuleInit();

    expect(allLogText()).toContain('NO ');
    expect(allLogText()).toContain('NO SMS WILL BE SENT');
  });

  it('never puts a credential, a code or a number in the start-up line', () => {
    const gateway = { send: jest.fn(), isConfigured: () => true } as unknown as SmsGatewayHubProvider;
    const values: Record<string, unknown> = {
      OTP_DELIVERY_PROVIDER: 'SMS_GATEWAY_HUB',
      SMS_GATEWAY_HUB_API_KEY: 'KEY-MUST-NEVER-BE-LOGGED',
      SMS_GATEWAY_HUB_SENDER_ID: 'TESTID',
    };
    const config = { get: (k: string) => values[k] } as unknown as ConfigService<ApiEnv, true>;

    new OtpSmsService(config, gateway).onModuleInit();

    expect(allLogText()).not.toContain('KEY-MUST-NEVER-BE-LOGGED');
  });
});

/**
 * MODULE WIRING. Everything above constructs the service by hand, which
 * proves the logic and proves nothing at all about whether Nest will
 * actually hand it a transport at runtime. The provider is injected
 * with @Optional(), so a missing registration would not fail at
 * startup — it would fail silently as FAILED/NO_PROVIDER on the first
 * real sign-in, with SMS configured and nothing arriving. That is the
 * exact failure mode this project has already been bitten by once, so
 * it gets a test.
 */
describe('NotificationModule — the transport is really wired to the port', () => {
  it('injects SmsGatewayHubProvider into OtpSmsService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotificationModule],
    })
      .overrideProvider(ConfigService)
      .useValue({ get: () => undefined })
      .compile();

    const service = moduleRef.get(OtpSmsService);
    const gateway = moduleRef.get(SmsGatewayHubProvider);

    expect(service).toBeInstanceOf(OtpSmsService);
    expect(gateway).toBeInstanceOf(SmsGatewayHubProvider);
    // The private field is the thing under test; reading it is the only
    // way to assert the wiring without making a network call.
    expect((service as unknown as { smsGatewayHub?: unknown }).smsGatewayHub).toBe(gateway);

    await moduleRef.close();
  });

  it('exports the port but not the transport, so nothing can bypass the channel check', () => {
    const exported = Reflect.getMetadata('exports', NotificationModule) as unknown[];
    expect(exported).toContain(OtpSmsService);
    expect(exported).not.toContain(SmsGatewayHubProvider);
  });
});
