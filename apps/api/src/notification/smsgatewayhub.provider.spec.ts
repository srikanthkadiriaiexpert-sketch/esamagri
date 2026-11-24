import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '@esamagri/config';
import {
  SmsGatewayHubProvider,
  SMS_GATEWAY_HUB_ENDPOINT,
  SEND_SMS_PARAM_NAMES,
  buildSendSmsUrl,
  normaliseIndianMobile,
  normaliseErrorCode,
} from './smsgatewayhub.provider';

/**
 * Unit tests for the SMS Gateway Hub transport. NO NETWORK: `fetch` is
 * replaced in every test, and a test that forgets to arrange a response
 * fails rather than reaching the internet — see the default
 * implementation in beforeEach. No real credential, no real number and
 * no real SMS appears anywhere in this file.
 *
 * What these tests are defending, in order of how much damage the
 * failure would do:
 *
 *   1. NOTHING SECRET REACHES A LOG LINE. The request URL carries both
 *      the API key and the OTP. Several tests below put distinctive
 *      sentinel values into the configuration and the message and then
 *      assert that no log line produced by any path contains them.
 *   2. HTTP 200 IS NOT ACCEPTANCE. Every documented failure on page 11
 *      of the vendor document arrives as a 200 with a non-zero
 *      ErrorCode. A build that checked only the status code would
 *      report every one of them as a successful send.
 *   3. THE PROVIDER NEVER THROWS. A sign-in must not break because a
 *      gateway is down, slow, or answering nonsense.
 *   4. THE REQUEST MATCHES WHAT THE PROVIDER SUPPLIED. Endpoint, method
 *      and the ten GET parameters — including the two DLT identifiers
 *      the earlier XML implementation did not send at all, which is why
 *      it never delivered a message.
 */

const MOBILE = '+919000000001';
const MESSAGE = 'Your OTP for e-Samagri login is 246813. Valid for 5 minutes.';

/** Deliberately distinctive so a leak assertion cannot pass by accident. */
const API_KEY = 'sghk-TEST-KEY-MUST-NEVER-BE-LOGGED-0001';
/**
 * A FAKE sender ID, deliberately not resembling any real DLT header.
 * The approved header lives in apps/api/.env and nowhere else — if this
 * value ever has to change because a real sender ID changed, something
 * is hard-coded that should not be.
 */
const SENDER_ID = 'TESTID';

/**
 * FAKE DLT registration identifiers, shaped like real ones (all digits,
 * 19 long) but belonging to nothing. The real pair lives in
 * apps/api/.env; a test that needed the real values would be a test that
 * could only run on one machine.
 */
const ENTITY_ID = '1400000000000000001';
const DLT_TEMPLATE_ID = '1400000000000000002';

let logs: string[] = [];
let originalFetch: unknown;
let fetchMock: jest.Mock;

function makeProvider(overrides: Record<string, unknown> = {}): SmsGatewayHubProvider {
  const values: Record<string, unknown> = {
    SMS_GATEWAY_HUB_API_KEY: API_KEY,
    SMS_GATEWAY_HUB_SENDER_ID: SENDER_ID,
    SMS_GATEWAY_HUB_ENTITY_ID: ENTITY_ID,
    SMS_GATEWAY_HUB_DLT_TEMPLATE_ID: DLT_TEMPLATE_ID,
    SMS_GATEWAY_HUB_ROUTE: '1',
    SMS_GATEWAY_HUB_CHANNEL: '2',
    SMS_GATEWAY_HUB_DCS: '0',
    SMS_GATEWAY_HUB_TIMEOUT_MS: 10_000,
    ...overrides,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<ApiEnv, true>;
  return new SmsGatewayHubProvider(config);
}

/** A gateway reply: HTTP status plus a body, exactly as fetch returns it. */
function reply(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

function json(payload: unknown, status = 200): Response {
  return reply(status, JSON.stringify(payload));
}

const SUCCESS_BODY = {
  ErrorCode: '000',
  ErrorMessage: 'Success',
  JobId: '375887642',
  MessageData: [{ Number: '919000000001', MessageId: 'KB9O7ys6BUKfpKUptuCfQQ', Message: MESSAGE }],
};

/** The URL of the single request made, as a string. */
function sentUrl(): string {
  return String(fetchMock.mock.calls[0]?.[0] ?? '');
}

/**
 * The query parameters actually sent, DECODED.
 *
 * Reading them back through URLSearchParams rather than string-matching
 * the raw URL is deliberate: it proves the values survive a round trip
 * through percent-encoding, which is the property that replaced the old
 * hand-rolled XML escaping.
 */
function sentParams(): URLSearchParams {
  const url = sentUrl();
  return new URLSearchParams(url.slice(url.indexOf('?') + 1));
}

function allLogText(): string {
  return logs.join('\n');
}

beforeEach(() => {
  logs = [];
  originalFetch = (globalThis as unknown as { fetch: unknown }).fetch;

  // A test that does not arrange a reply has not described what it is
  // testing, so this fails loudly rather than silently doing nothing.
  fetchMock = jest.fn(async () => {
    throw new Error('no gateway reply was arranged for this test');
  });
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
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

describe('SmsGatewayHubProvider — the request matches what the provider supplied', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(json(SUCCESS_BODY));
  });

  it('GETs the SendSMS endpoint over HTTPS', async () => {
    await makeProvider().send(MOBILE, MESSAGE);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith(`${SMS_GATEWAY_HUB_ENDPOINT}?`)).toBe(true);
    expect(url.startsWith('https://')).toBe(true);
    expect(init.method).toBe('GET');
  });

  it('sends no request body at all, because a GET has none', async () => {
    await makeProvider().send(MOBILE, MESSAGE);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
    // And therefore no content-type to get wrong.
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  /**
   * THE TEN PARAMETER NAMES, EXACTLY. Their mixed casing is what the
   * provider supplied and what was proven to deliver: APIKey, DCS and
   * EntityId capitalised, the rest lower case. Query-string names are
   * case-sensitive, so "tidying" them would stop delivery — and this is
   * the test that would catch that.
   */
  it('sends exactly the ten documented parameters, with their exact names', async () => {
    await makeProvider().send(MOBILE, MESSAGE);

    expect([...sentParams().keys()]).toEqual([...SEND_SMS_PARAM_NAMES]);
  });

  it('carries the two DLT identifiers the XML implementation never sent', async () => {
    await makeProvider().send(MOBILE, MESSAGE);

    // The whole reason this provider moved to GET. Without these two the
    // gateway accepts the message and DLT scrubbing then discards it, so
    // a send looks successful and delivers nothing.
    const params = sentParams();
    expect(params.get('EntityId')).toBe(ENTITY_ID);
    expect(params.get('dlttemplateid')).toBe(DLT_TEMPLATE_ID);
  });

  it('refuses to send when either DLT identifier is missing', async () => {
    for (const key of ['SMS_GATEWAY_HUB_ENTITY_ID', 'SMS_GATEWAY_HUB_DLT_TEMPLATE_ID']) {
      fetchMock.mockClear();
      const result = await makeProvider({ [key]: undefined }).send(MOBILE, MESSAGE);

      expect(result).toEqual({ status: 'FAILED', reason: 'NOT_CONFIGURED', errorCode: null });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('always sends flashsms=0, because a flash message is not stored on the handset', async () => {
    await makeProvider().send(MOBILE, MESSAGE);
    expect(sentParams().get('flashsms')).toBe('0');
  });

  it('inserts the API key from configuration, and from nowhere else', async () => {
    await makeProvider().send(MOBILE, MESSAGE);
    expect(sentParams().get('APIKey')).toBe(API_KEY);
  });

  it('percent-encodes the API key in the URL rather than passing it raw', async () => {
    // A key containing + or / would otherwise be corrupted in transit —
    // `+` decodes as a space — and the gateway would answer 007, which
    // reads like a wrong credential and is not.
    await makeProvider({ SMS_GATEWAY_HUB_API_KEY: 'a+b/c=d&e' }).send(MOBILE, MESSAGE);

    expect(sentUrl()).not.toContain('a+b/c=d&e');
    expect(sentParams().get('APIKey')).toBe('a+b/c=d&e');
  });

  /**
   * THE SENDER ID COMES FROM .env, NEVER FROM THIS CODEBASE. A DLT
   * header is re-approved, transferred between accounts and occasionally
   * replaced outright — a hard-coded one would mean a code change and a
   * redeploy every time, and, worse, would silently keep sending under
   * the old header until somebody noticed. Two different values are
   * asserted here precisely so that a hard-coded constant cannot pass.
   */
  it('takes the senderid from configuration — two different values, two different requests', async () => {
    await makeProvider({ SMS_GATEWAY_HUB_SENDER_ID: 'AAAAAA' }).send(MOBILE, MESSAGE);
    expect(sentParams().get('senderid')).toBe('AAAAAA');

    fetchMock.mockClear();
    await makeProvider({ SMS_GATEWAY_HUB_SENDER_ID: 'ZZZZZZ' }).send(MOBILE, MESSAGE);
    expect(sentParams().get('senderid')).toBe('ZZZZZZ');
    expect(sentUrl()).not.toContain('AAAAAA');
  });

  it('trims a sender ID that was pasted with stray whitespace', async () => {
    await makeProvider({ SMS_GATEWAY_HUB_SENDER_ID: '  SIXCHR  ' }).send(MOBILE, MESSAGE);
    expect(sentParams().get('senderid')).toBe('SIXCHR');
  });

  it('has no fallback sender ID: without one, nothing is sent at all', async () => {
    const result = await makeProvider({ SMS_GATEWAY_HUB_SENDER_ID: undefined }).send(MOBILE, MESSAGE);

    expect(result).toEqual({ status: 'FAILED', reason: 'NOT_CONFIGURED', errorCode: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the configured route, channel and DCS when the account differs from the default', async () => {
    // Page 3 of the vendor document hints at a non-numeric OTP channel,
    // which page 10 contradicts, and the provider's panel reports the
    // successful send's channel as "Trans". This is the test that proves
    // following the provider's answer will be a .env edit, not a code
    // change.
    await makeProvider({
      SMS_GATEWAY_HUB_CHANNEL: 'OTP',
      SMS_GATEWAY_HUB_ROUTE: '4',
      SMS_GATEWAY_HUB_DCS: '8',
    }).send(MOBILE, MESSAGE);

    const params = sentParams();
    expect(params.get('channel')).toBe('OTP');
    expect(params.get('route')).toBe('4');
    expect(params.get('DCS')).toBe('8');
  });

  it('falls back to the documented defaults if those settings are missing entirely', async () => {
    await makeProvider({
      SMS_GATEWAY_HUB_CHANNEL: undefined,
      SMS_GATEWAY_HUB_ROUTE: undefined,
      SMS_GATEWAY_HUB_DCS: undefined,
    }).send(MOBILE, MESSAGE);

    const params = sentParams();
    expect(params.get('channel')).toBe('2');
    expect(params.get('route')).toBe('1');
    expect(params.get('DCS')).toBe('0');
  });

  it('sends the message text it was given, unaltered through encoding', async () => {
    await makeProvider().send(MOBILE, MESSAGE);
    expect(sentParams().get('text')).toBe(MESSAGE);
  });
});

describe('SmsGatewayHubProvider — recipient normalisation', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(json(SUCCESS_BODY));
  });

  it('turns every form the app holds into the documented 91XXXXXXXXXX', () => {
    expect(normaliseIndianMobile('+919000000001')).toBe('919000000001');
    expect(normaliseIndianMobile('9000000001')).toBe('919000000001');
    expect(normaliseIndianMobile('919000000001')).toBe('919000000001');
    expect(normaliseIndianMobile('09000000001')).toBe('919000000001');
    expect(normaliseIndianMobile('+91 90000 00001')).toBe('919000000001');
  });

  it('refuses rather than guesses when the number is not an Indian mobile', () => {
    expect(normaliseIndianMobile('')).toBeNull();
    expect(normaliseIndianMobile('12345')).toBeNull();
    expect(normaliseIndianMobile('+14155550123')).toBeNull();
    expect(normaliseIndianMobile('+915000000001')).toBeNull(); // not 6-9
    expect(normaliseIndianMobile('not a number')).toBeNull();
  });

  it('reports INVALID_RECIPIENT and sends nothing for a number it cannot use', async () => {
    const result = await makeProvider().send('12345', MESSAGE);

    expect(result).toEqual({ status: 'FAILED', reason: 'INVALID_RECIPIENT', errorCode: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('SmsGatewayHubProvider — query encoding', () => {
  /**
   * WHAT REPLACED THE XML ESCAPING, AND WHY IT IS SAFER.
   *
   * The XML build escaped five metacharacters by hand, in an order that
   * mattered: `&` had to go first or `<` arrived as `&amp;lt;`. That is
   * a correct-but-fragile piece of code, and it is now gone. Encoding is
   * URLSearchParams' job, and these tests prove the properties that
   * actually matter rather than re-testing the platform.
   */
  beforeEach(() => {
    fetchMock.mockResolvedValue(json(SUCCESS_BODY));
  });

  it('encodes spaces and punctuation so the whole message survives', async () => {
    await makeProvider().send(MOBILE, MESSAGE);

    // Raw spaces would end the URL at the first one.
    expect(sentUrl()).not.toContain(' ');
    expect(sentParams().get('text')).toBe(MESSAGE);
  });

  it('encodes an ampersand in the message instead of starting a new parameter', async () => {
    // THE FAILURE THIS PREVENTS: an unencoded `&` would terminate `text`
    // early, send a truncated message, and — because the remainder would
    // be read as more parameters — could overwrite a later one entirely.
    const withAmp = 'Your OTP is 246813 & valid for 5 minutes.';

    await makeProvider().send(MOBILE, withAmp);

    const params = sentParams();
    expect(params.get('text')).toBe(withAmp);
    // Still exactly ten parameters: nothing was smuggled in.
    expect([...params.keys()]).toEqual([...SEND_SMS_PARAM_NAMES]);
  });

  it('cannot be made to add or replace a parameter through the message text', async () => {
    const hostile = 'hello&number=919999999999&route=9';

    await makeProvider().send(MOBILE, hostile);

    const params = sentParams();
    // The attacker's digits appear only as inert text.
    expect(params.get('text')).toBe(hostile);
    expect(params.get('number')).toBe('919000000001');
    expect(params.get('route')).toBe('1');
    expect(params.getAll('number')).toHaveLength(1);
    expect([...params.keys()]).toEqual([...SEND_SMS_PARAM_NAMES]);
  });

  it('carries a non-ASCII message intact, for a Unicode (DCS=8) template', async () => {
    const unicode = 'आपका OTP 246813 है।';

    await makeProvider({ SMS_GATEWAY_HUB_DCS: '8' }).send(MOBILE, unicode);

    expect(sentParams().get('text')).toBe(unicode);
  });

  it('buildSendSmsUrl is pure: the same inputs give the same URL', () => {
    const args = {
      apiKey: 'abc&def',
      senderId: SENDER_ID,
      channel: '2',
      dcs: '0',
      route: '1',
      number: '919000000001',
      text: 'hello world',
      entityId: ENTITY_ID,
      dltTemplateId: DLT_TEMPLATE_ID,
    };

    const url = buildSendSmsUrl(args);

    expect(url).toBe(buildSendSmsUrl(args));
    expect(url.startsWith(`${SMS_GATEWAY_HUB_ENDPOINT}?`)).toBe(true);
    // An ampersand in the key is encoded, not left to truncate the query.
    expect(url).not.toContain('abc&def');
    expect(new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('APIKey')).toBe('abc&def');
  });
});

describe('SmsGatewayHubProvider — the gateway said yes', () => {
  it('reports SENT, with the job and message identifiers, on ErrorCode 000', async () => {
    fetchMock.mockResolvedValue(json(SUCCESS_BODY));

    await expect(makeProvider().send(MOBILE, MESSAGE)).resolves.toEqual({
      status: 'SENT',
      jobId: '375887642',
      messageId: 'KB9O7ys6BUKfpKUptuCfQQ',
    });
  });

  it('accepts the unpadded "0" the same vendor returns from its other APIs', async () => {
    fetchMock.mockResolvedValue(json({ ErrorCode: '0', ErrorMessage: 'Success' }));

    const result = await makeProvider().send(MOBILE, MESSAGE);
    expect(result.status).toBe('SENT');
  });

  it('still reports SENT when the response carries no MessageData', async () => {
    fetchMock.mockResolvedValue(json({ ErrorCode: '000', ErrorMessage: 'Success', JobId: '1' }));

    await expect(makeProvider().send(MOBILE, MESSAGE)).resolves.toEqual({
      status: 'SENT',
      jobId: '1',
      messageId: null,
    });
  });

  it('says ACCEPTED in the log, not delivered — the gateway has not seen the handset', async () => {
    fetchMock.mockResolvedValue(json(SUCCESS_BODY));
    await makeProvider().send(MOBILE, MESSAGE);

    expect(allLogText()).toContain('accepted the message for delivery');
  });
});

describe('SmsGatewayHubProvider — the gateway said no (HTTP 200 is not acceptance)', () => {
  const cases: ReadonlyArray<[string, string, string]> = [
    ['001', 'login details cannot be blank', 'PROVIDER_KEY_REJECTED'],
    ['007', 'username or password is invalid', 'PROVIDER_KEY_REJECTED'],
    ['008', 'account not active', 'PROVIDER_ACCOUNT_BLOCKED'],
    ['009', 'account locked, contact your account manager', 'PROVIDER_ACCOUNT_BLOCKED'],
    ['010', 'api restriction', 'PROVIDER_API_RESTRICTED'],
    ['011', 'ip address restriction', 'PROVIDER_IP_NOT_ALLOWED'],
    ['013', 'mobile numbers not valid', 'PROVIDER_REQUEST'],
    ['014', 'account locked due to spam message contact support', 'PROVIDER_ACCOUNT_BLOCKED'],
    ['015', 'senderid not valid', 'PROVIDER_SENDER_ID'],
    ['021', 'insufficient credits', 'PROVIDER_CREDITS'],
    ['023', 'parameter missing', 'PROVIDER_REQUEST'],
    ['024', 'invalid template or template mismatch', 'PROVIDER_TEMPLATE'],
    ['025', '{Field} can not be blank or empty', 'PROVIDER_REQUEST'],
    ['027', 'invalid optin user', 'PROVIDER_REQUEST'],
  ];

  it.each(cases)('maps ErrorCode %s to a safe internal reason', async (code, message, reason) => {
    fetchMock.mockResolvedValue(json({ ErrorCode: code, ErrorMessage: message }));

    await expect(makeProvider().send(MOBILE, MESSAGE)).resolves.toEqual({
      status: 'FAILED',
      reason,
      errorCode: code,
    });
  });

  /**
   * THE LIVE GATEWAY DOES NOT ZERO-PAD. A real balance enquiry answered
   * `"ErrorCode":"7"` for the failure page 11 calls `007`. Before this
   * was handled, every such reply missed the lookup table and was
   * recorded as the catch-all PROVIDER_REJECTED — so the audit log said
   * "the gateway said no" when the gateway had actually said "your
   * credentials are invalid", which is a sentence that names the fix.
   */
  it.each([
    ['7', 'PROVIDER_KEY_REJECTED'],
    ['11', 'PROVIDER_IP_NOT_ALLOWED'],
    ['15', 'PROVIDER_SENDER_ID'],
    ['21', 'PROVIDER_CREDITS'],
    ['24', 'PROVIDER_TEMPLATE'],
    ['23', 'PROVIDER_REQUEST'],
  ])('maps the UNPADDED ErrorCode %s the same way as its padded form', async (code, reason) => {
    fetchMock.mockResolvedValue(json({ ErrorCode: code, ErrorMessage: 'x' }));

    const result = await makeProvider().send(MOBILE, MESSAGE);
    expect(result).toEqual({ status: 'FAILED', reason, errorCode: code });
  });

  it('normalises both spellings of every code to the same three-digit form', () => {
    expect(normaliseErrorCode('7')).toBe('007');
    expect(normaliseErrorCode('007')).toBe('007');
    expect(normaliseErrorCode(' 24 ')).toBe('024');
    expect(normaliseErrorCode('0')).toBe('000');
    expect(normaliseErrorCode('000')).toBe('000');
    expect(normaliseErrorCode('999')).toBe('999');
    // Not a number: left alone, so the lookup misses and the honest
    // catch-all applies rather than a mangled guess.
    expect(normaliseErrorCode('OTP')).toBe('OTP');
    expect(normaliseErrorCode('')).toBe('');
  });

  it('logs both spellings, so the log matches the vendor table AND the wire', async () => {
    fetchMock.mockResolvedValue(json({ ErrorCode: '7', ErrorMessage: 'username or password is invalid' }));
    await makeProvider().send(MOBILE, MESSAGE);

    expect(allLogText()).toContain('ErrorCode=007');
    expect(allLogText()).toContain('as sent: 7');
    expect(allLogText()).toContain('PROVIDER_KEY_REJECTED');
  });

  it('reports a code that is not in the table as PROVIDER_REJECTED rather than SENT', async () => {
    fetchMock.mockResolvedValue(json({ ErrorCode: '999', ErrorMessage: 'something new' }));

    await expect(makeProvider().send(MOBILE, MESSAGE)).resolves.toEqual({
      status: 'FAILED',
      reason: 'PROVIDER_REJECTED',
      errorCode: '999',
    });
  });

  it('never reports SENT on an HTTP 200 whose ErrorCode is non-zero', async () => {
    for (const [code] of cases) {
      fetchMock.mockResolvedValue(json({ ErrorCode: code, ErrorMessage: 'x' }));
      const result = await makeProvider().send(MOBILE, MESSAGE);
      expect(result.status).toBe('FAILED');
    }
  });

  it('records the code and the gateway message in the log, for the operator', async () => {
    fetchMock.mockResolvedValue(json({ ErrorCode: '024', ErrorMessage: 'invalid template' }));
    await makeProvider().send(MOBILE, MESSAGE);

    expect(allLogText()).toContain('ErrorCode=024');
    expect(allLogText()).toContain('invalid template');
    expect(allLogText()).toContain('PROVIDER_TEMPLATE');
  });

  it('truncates a runaway ErrorMessage instead of dumping it into the log', async () => {
    fetchMock.mockResolvedValue(json({ ErrorCode: '006', ErrorMessage: 'x'.repeat(5000) }));
    await makeProvider().send(MOBILE, MESSAGE);

    expect(allLogText().length).toBeLessThan(1000);
  });
});

describe('SmsGatewayHubProvider — everything that can go wrong with the call', () => {
  it('reports PROVIDER_UNAVAILABLE on a non-2xx status', async () => {
    for (const status of [400, 401, 403, 500, 502, 503]) {
      fetchMock.mockResolvedValue(reply(status, 'Service Unavailable'));
      await expect(makeProvider().send(MOBILE, MESSAGE)).resolves.toEqual({
        status: 'FAILED',
        reason: 'PROVIDER_UNAVAILABLE',
        errorCode: null,
      });
    }
  });

  it('reports MALFORMED_RESPONSE when a 200 body is not JSON', async () => {
    fetchMock.mockResolvedValue(reply(200, '<html>maintenance</html>'));

    await expect(makeProvider().send(MOBILE, MESSAGE)).resolves.toEqual({
      status: 'FAILED',
      reason: 'MALFORMED_RESPONSE',
      errorCode: null,
    });
  });

  it('reports MALFORMED_RESPONSE when the JSON carries no ErrorCode', async () => {
    fetchMock.mockResolvedValue(json({ Status: 'ok' }));

    await expect(makeProvider().send(MOBILE, MESSAGE)).resolves.toEqual({
      status: 'FAILED',
      reason: 'MALFORMED_RESPONSE',
      errorCode: null,
    });
  });

  it('does not echo an unexpected body into the log', async () => {
    fetchMock.mockResolvedValue(reply(200, 'SENSITIVE-REFLECTED-BODY'));
    await makeProvider().send(MOBILE, MESSAGE);

    expect(allLogText()).not.toContain('SENSITIVE-REFLECTED-BODY');
  });

  it('reports NETWORK when the request never completes', async () => {
    const failure = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ENOTFOUND' },
    });
    fetchMock.mockRejectedValue(failure);

    await expect(makeProvider().send(MOBILE, MESSAGE)).resolves.toEqual({
      status: 'FAILED',
      reason: 'NETWORK',
      errorCode: null,
    });
    expect(allLogText()).toContain('ENOTFOUND');
  });

  it('reports TIMEOUT, not NETWORK, when the configured timeout elapses', async () => {
    // The real provider aborts via AbortController; here the mock waits
    // for that signal and rejects the way fetch does.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, rejectPromise) => {
          init.signal?.addEventListener('abort', () =>
            rejectPromise(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );

    const result = await makeProvider({ SMS_GATEWAY_HUB_TIMEOUT_MS: 20 }).send(MOBILE, MESSAGE);

    expect(result).toEqual({ status: 'FAILED', reason: 'TIMEOUT', errorCode: null });
    expect(allLogText()).toContain('did not answer within 20ms');
  });

  it('never throws, whatever the gateway does', async () => {
    const arrangements: Array<() => void> = [
      () => fetchMock.mockResolvedValue(json(SUCCESS_BODY)),
      () => fetchMock.mockResolvedValue(reply(500, '')),
      () => fetchMock.mockResolvedValue(reply(200, 'not json')),
      () => fetchMock.mockResolvedValue(json(null)),
      () => fetchMock.mockResolvedValue(json([])),
      () => fetchMock.mockRejectedValue(new Error('socket hang up')),
      () => fetchMock.mockRejectedValue('a string, not an Error'),
    ];

    for (const arrange of arrangements) {
      arrange();
      await expect(makeProvider().send(MOBILE, MESSAGE)).resolves.toBeDefined();
    }
  });
});

describe('SmsGatewayHubProvider — missing configuration fails before the request', () => {
  it('reports NOT_CONFIGURED and sends nothing when the API key is absent', async () => {
    const result = await makeProvider({ SMS_GATEWAY_HUB_API_KEY: undefined }).send(MOBILE, MESSAGE);

    expect(result).toEqual({ status: 'FAILED', reason: 'NOT_CONFIGURED', errorCode: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(allLogText()).toContain('SMS_GATEWAY_HUB_API_KEY');
  });

  it('reports NOT_CONFIGURED and sends nothing when the sender ID is absent', async () => {
    const result = await makeProvider({ SMS_GATEWAY_HUB_SENDER_ID: '  ' }).send(MOBILE, MESSAGE);

    expect(result).toEqual({ status: 'FAILED', reason: 'NOT_CONFIGURED', errorCode: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(allLogText()).toContain('SMS_GATEWAY_HUB_SENDER_ID');
  });

  it('isConfigured() answers without reading the values out anywhere', () => {
    expect(makeProvider().isConfigured()).toBe(true);
    expect(makeProvider({ SMS_GATEWAY_HUB_API_KEY: '' }).isConfigured()).toBe(false);
    expect(makeProvider({ SMS_GATEWAY_HUB_SENDER_ID: undefined }).isConfigured()).toBe(false);
    expect(allLogText()).toBe('');
  });
});

describe('SmsGatewayHubProvider — nothing secret reaches a log line', () => {
  /** Every outcome the provider has, run against the same sentinels. */
  const everyPath: ReadonlyArray<[string, () => void]> = [
    ['success', () => fetchMock.mockResolvedValue(json(SUCCESS_BODY))],
    ['rejected', () => fetchMock.mockResolvedValue(json({ ErrorCode: '024', ErrorMessage: 'no' }))],
    ['http error', () => fetchMock.mockResolvedValue(reply(500, 'err'))],
    ['bad json', () => fetchMock.mockResolvedValue(reply(200, 'nope'))],
    ['network', () => fetchMock.mockRejectedValue(new Error('socket hang up'))],
  ];

  it.each(everyPath)('logs no API key on the %s path', async (_name, arrange) => {
    arrange();
    await makeProvider().send(MOBILE, MESSAGE);
    expect(allLogText()).not.toContain(API_KEY);
  });

  it.each(everyPath)('logs no OTP and no mobile number on the %s path', async (_name, arrange) => {
    arrange();
    await makeProvider().send(MOBILE, 'Your OTP for e-Samagri login is 246813. Valid for 5 minutes.');

    const text = allLogText();
    expect(text).not.toContain('246813');
    expect(text).not.toContain(MOBILE);
    expect(text).not.toContain('9000000001');
    expect(text).not.toContain('919000000001');
  });

  /**
   * THE REQUEST URL ITSELF MUST NEVER BE LOGGED. Under GET the URL
   * carries the API key, the recipient and the OTP all at once, which
   * makes it the single most dangerous string in this file — and the one
   * a library or a careless error message is most likely to echo.
   */
  it.each(everyPath)('logs no part of the request URL on the %s path', async (_name, arrange) => {
    arrange();
    await makeProvider().send(MOBILE, MESSAGE);

    const text = allLogText();
    expect(text).not.toContain(SMS_GATEWAY_HUB_ENDPOINT);
    expect(text).not.toContain('APIKey=');
    expect(text).not.toContain('dlttemplateid=');
    expect(text).not.toContain('text=');
  });

  it('still identifies the recipient well enough to correlate with an audit row', async () => {
    fetchMock.mockResolvedValue(json(SUCCESS_BODY));
    await makeProvider().send(MOBILE, MESSAGE);

    // Same scheme as CustomerAuthService.hashForAudit: sha256, first 16 hex.
    expect(allLogText()).toMatch(/recipient=[0-9a-f]{16}/);
  });
});
