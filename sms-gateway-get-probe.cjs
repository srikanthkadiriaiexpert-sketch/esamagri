#!/usr/bin/env node
'use strict';

/**
 * SMS GATEWAY HUB — GET API DIAGNOSTIC PROBE (standalone, read-only)
 * =================================================================
 *
 * WHAT THIS IS FOR
 *
 * Provider support supplied a GET form of SendSMS that carries two
 * parameters the shipped implementation does not send at all: EntityId
 * (the Principal Entity ID) and dlttemplateid (the Content Template ID).
 * This script exercises that GET form in isolation so the question "does
 * the GET format with DLT identifiers get accepted?" can be answered
 * WITHOUT touching the application.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   * It does not import, modify or read a single line of the API's source.
 *     The shipped provider (POST + XML, apps/api/src/notification/
 *     smsgatewayhub.provider.ts) is untouched and the running staging API
 *     keeps using it.
 *   * It does not change OTP_DELIVERY_PROVIDER or any other setting. It
 *     opens apps/api/.env READ-ONLY and writes nothing, anywhere.
 *   * It opens no database connection. There is no `pg` require below.
 *   * It sends nothing unless BOTH --send and --confirm are given. The
 *     default is a dry run that makes no network call at all.
 *
 * WHAT IT NEVER PRINTS
 *
 *   * The API key. Reported as a length plus a SHA-256 prefix — a
 *     fingerprint that can be compared against the provider portal
 *     without revealing the key, and that cannot be reversed.
 *   * The recipient's full number. Masked to country code + last two.
 *   * The OTP digits. The message is shown with the code masked, and
 *     correctness is proven instead by a byte-for-byte comparison against
 *     the approved template.
 *   * Anything from a gateway response other than the three documented
 *     fields, because a response can echo the request back.
 *
 * USAGE
 *
 *   node sms-gateway-get-probe.cjs                       (dry run, default)
 *   node sms-gateway-get-probe.cjs --number=91XXXXXXXXXX (dry run, one number)
 *   node sms-gateway-get-probe.cjs --number=91XXXXXXXXXX --send --confirm
 *
 * ENVIRONMENT IT READS, from apps/api/.env
 *
 *   SMS_GATEWAY_HUB_API_KEY            (already present)
 *   SMS_GATEWAY_HUB_SENDER_ID          (already present)
 *   SMS_GATEWAY_HUB_ROUTE              (already present, default 1)
 *   SMS_GATEWAY_HUB_CHANNEL            (already present, default 2)
 *   SMS_GATEWAY_HUB_DCS                (already present, default 0)
 *   SMS_GATEWAY_HUB_TIMEOUT_MS         (already present, default 10000)
 *   SMS_GATEWAY_HUB_ENTITY_ID          <-- ADD THIS (Principal Entity ID)
 *   SMS_GATEWAY_HUB_DLT_TEMPLATE_ID    <-- ADD THIS (Content Template ID)
 *
 * The last two are NOT read by the application — the config schema does
 * not declare them, so adding them to .env cannot change how the API
 * behaves. They exist for this probe alone.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------------------------------------------------------------- constants

/** The GET endpoint exactly as provider support supplied it. */
const ENDPOINT = 'https://www.smsgatewayhub.com/api/mt/SendSMS';

/**
 * THE REGISTERED TEMPLATE, EXACTLY AS APPROVED.
 *
 * `{#num#}` is the registration token. It marks the one position allowed
 * to vary and must NEVER go on the wire — sending it literally is a
 * template mismatch (ErrorCode 024). The probe substitutes the test code
 * into that position and then proves the result matches this string with
 * the same substitution applied.
 */
const APPROVED_TEMPLATE =
  'Your OTP for e-Samagri login is {#num#}. Valid for 5 minutes. ' +
  'Do not share this OTP with anyone. - Sri Lakshmi Srinivasa Mart';

/** Vendor default, and what the shipped provider hard-codes. */
const FLASH_SMS = '0';

/** Documented error codes worth naming rather than printing raw. */
const ERROR_CODE_MEANINGS = {
  '000': 'Success — the gateway accepted the message for delivery',
  '001': 'Invalid API key',
  '007': 'Invalid API key / authentication failed',
  '008': 'Account blocked',
  '009': 'Account expired',
  '010': 'API access restricted for this account',
  '011': 'IP address not allowed',
  '014': 'Account suspended',
  '020': 'Invalid sender ID',
  '024': 'Invalid template, or template mismatch (DLT)',
  '025': 'Invalid Entity ID / DLT registration',
};

// ------------------------------------------------------------------ helpers

/**
 * `"7"` and `"007"` are the same code. The live gateway sends the former
 * while the vendor table lists the latter, so an unpadded code must be
 * normalised or every documented failure falls through to a catch-all.
 * Same rule as the shipped provider's normaliseErrorCode.
 */
function normaliseErrorCode(raw) {
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) return trimmed;
  return trimmed.replace(/^0+(?=\d)/, '').padStart(3, '0');
}

/**
 * A minimal .env reader. Deliberately not `dotenv`: this script adds no
 * dependency, and it must not call `require` from inside the project's
 * node_modules for something this small.
 *
 * Handles CRLF (the file is edited on Windows), comments, blank lines and
 * single or double quoted values. It does NOT expand variables — a literal
 * value is what the gateway should receive.
 */
function readEnvFile(file) {
  const out = new Map();
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

/** A non-reversible fingerprint, for comparing against the portal. */
function fingerprint(secret) {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 8);
}

/** 919812345678 -> 91********78. Country code and last two only. */
function maskNumber(number) {
  if (typeof number !== 'string' || number.length < 6) return '<masked>';
  return `${number.slice(0, 2)}${'*'.repeat(number.length - 4)}${number.slice(-2)}`;
}

/**
 * Normalises an Indian mobile to the 91XXXXXXXXXX the gateway expects.
 * Mirrors the shipped provider so the probe is not testing a different
 * recipient format from the one production uses.
 */
function normaliseIndianMobile(raw) {
  const digits = String(raw).replace(/[^\d]/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(1)}`;
  return null;
}

/** Replaces the six digits with # so the text can be shown, the code not. */
function maskOtpIn(message, otp) {
  return message.split(otp).join('#'.repeat(otp.length));
}

function parseArgs(argv) {
  const args = { send: false, confirm: false, number: null, otp: null };
  for (const arg of argv) {
    if (arg === '--send') args.send = true;
    else if (arg === '--confirm') args.confirm = true;
    else if (arg.startsWith('--number=')) args.number = arg.slice('--number='.length);
    else if (arg.startsWith('--otp=')) args.otp = arg.slice('--otp='.length);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else {
      console.error(`Unrecognised argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

function line(label, value) {
  console.log(`  ${String(label).padEnd(32)} ${value}`);
}

// --------------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    return 0;
  }

  console.log('');
  console.log('SMS Gateway Hub — GET API diagnostic probe');
  console.log('='.repeat(62));

  // ---------------------------------------------------------- 1. the .env
  const envPath = path.join(__dirname, 'apps', 'api', '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`\nCannot find ${envPath}. Run this from the staging project root.`);
    return 2;
  }
  const env = readEnvFile(envPath);
  console.log('');
  console.log('1. CREDENTIALS (read-only; values never printed)');
  line('source', path.relative(__dirname, envPath));

  const apiKey = env.get('SMS_GATEWAY_HUB_API_KEY') || '';
  const senderId = env.get('SMS_GATEWAY_HUB_SENDER_ID') || '';
  const entityId = env.get('SMS_GATEWAY_HUB_ENTITY_ID') || '';
  const templateId = env.get('SMS_GATEWAY_HUB_DLT_TEMPLATE_ID') || '';
  const route = env.get('SMS_GATEWAY_HUB_ROUTE') || '1';
  const channel = env.get('SMS_GATEWAY_HUB_CHANNEL') || '2';
  const dcs = env.get('SMS_GATEWAY_HUB_DCS') || '0';
  const timeoutMs = Number(env.get('SMS_GATEWAY_HUB_TIMEOUT_MS') || '10000');

  line(
    'SMS_GATEWAY_HUB_API_KEY',
    apiKey ? `set (${apiKey.length} chars, sha256:${fingerprint(apiKey)})` : 'MISSING'
  );
  // The sender ID is a public DLT header, not a secret — it appears on
  // every message a customer receives — so it is shown in full. That is
  // what makes "is the right header configured?" answerable at a glance.
  line('SMS_GATEWAY_HUB_SENDER_ID', senderId ? `set: ${senderId}` : 'MISSING');
  line('SMS_GATEWAY_HUB_ENTITY_ID', entityId ? `set (${entityId.length} chars)` : 'MISSING — add to .env');
  line(
    'SMS_GATEWAY_HUB_DLT_TEMPLATE_ID',
    templateId ? `set (${templateId.length} chars)` : 'MISSING — add to .env'
  );
  line('SMS_GATEWAY_HUB_ROUTE', route);
  line('SMS_GATEWAY_HUB_CHANNEL', channel);
  line('SMS_GATEWAY_HUB_DCS', dcs);
  line('SMS_GATEWAY_HUB_TIMEOUT_MS', String(timeoutMs));
  line('flashsms', `${FLASH_SMS} (constant, as the shipped provider sends)`);

  // ---------------------------------------------------------- 2. the message
  //
  // A SYNTHETIC code, generated here. It is not a customer's OTP, it is
  // not read from the database and it is never written anywhere — and it
  // is still masked in every line below, because the rule is the rule.
  const otp = args.otp && /^\d{6}$/.test(args.otp)
    ? args.otp
    : String(crypto.randomInt(100000, 1000000));
  const message = APPROVED_TEMPLATE.replace('{#num#}', otp);

  /**
   * Checks that can actually FAIL.
   *
   * An earlier draft compared `message` against the same expression that
   * produced it and reported "byte-for-byte match" — which is always true
   * and proves nothing. These four can each fail:
   *
   *   * the token was not substituted (a typo in the token spelling);
   *   * the token survived into the text (ErrorCode 024);
   *   * the code appears more than once (a template edit);
   *   * a non-ASCII lookalike crept into the constant (the usual cause of
   *     a silent DLT mismatch).
   *
   * That the template CONSTANT above matches the application's own
   * buildOtpMessage output is a separate fact, established by inspection
   * and reported as a fingerprint below so the two can be compared.
   */
  const substituted = message !== APPROVED_TEMPLATE;
  const tokenGone = !message.includes('{#');
  const codeOnce = message.split(otp).length - 1 === 1;
  const asciiOnly = ![...message].some((c) => c.codePointAt(0) > 127);
  const templateMatches = substituted && tokenGone && codeOnce && asciiOnly;

  console.log('');
  console.log('2. MESSAGE (OTP masked; this is a synthetic test code)');
  line('text', maskOtpIn(message, otp));
  line('characters', `${message.length} (${message.length <= 160 ? 'single GSM-7 segment' : 'MULTIPART'})`);
  line('token substituted', substituted ? 'yes' : 'NO — {#num#} was not found');
  line('contains a DLT token', tokenGone ? 'no' : 'YES — WOULD BE REJECTED (024)');
  line('code appears once', codeOnce ? 'yes' : 'NO');
  line('non-ASCII characters', asciiOnly ? 'none' : 'PRESENT');
  line('template fingerprint', `sha256:${fingerprint(APPROVED_TEMPLATE)}`);
  line('all message checks', templateMatches ? 'PASS' : 'FAIL');

  // ---------------------------------------------------------- 3. the request
  const rawNumber = args.number;
  const number = rawNumber === null ? null : normaliseIndianMobile(rawNumber);
  if (rawNumber !== null && number === null) {
    console.error(
      `\n  --number is not a mobile number this gateway accepts. ` +
        `Give it as 91XXXXXXXXXX. (The value itself is not echoed.)`
    );
    return 2;
  }

  const params = new URLSearchParams({
    APIKey: apiKey,
    senderid: senderId,
    channel,
    DCS: dcs,
    flashsms: FLASH_SMS,
    number: number ?? '',
    text: message,
    route,
    EntityId: entityId,
    dlttemplateid: templateId,
  });
  const url = `${ENDPOINT}?${params.toString()}`;

  // The redacted URL is built by substitution on the ENCODED string, so
  // what is shown is the real request with three values swapped out —
  // not a hand-written approximation of it.
  let shownUrl = url;
  if (apiKey) shownUrl = shownUrl.split(encodeURIComponent(apiKey)).join(`<APIKEY:${apiKey.length}-chars>`);
  if (number) shownUrl = shownUrl.split(number).join(maskNumber(number));
  shownUrl = shownUrl.split(otp).join('######');

  console.log('');
  console.log('3. REQUEST THAT WOULD BE SENT');
  line('method', 'GET');
  line('endpoint', ENDPOINT);
  line('recipient', number ? maskNumber(number) : 'NOT SET (pass --number=91XXXXXXXXXX)');
  line('parameters', [...params.keys()].join(', '));
  console.log('');
  console.log('  URL (api key, number and OTP redacted):');
  for (const chunk of shownUrl.match(/.{1,100}/g) || []) console.log(`    ${chunk}`);

  // ---------------------------------------------------------- 4. readiness
  const blockers = [];
  if (!apiKey) blockers.push('SMS_GATEWAY_HUB_API_KEY is missing');
  if (!senderId) blockers.push('SMS_GATEWAY_HUB_SENDER_ID is missing');
  if (!entityId) blockers.push('SMS_GATEWAY_HUB_ENTITY_ID is missing — add it to apps/api/.env');
  if (!templateId) blockers.push('SMS_GATEWAY_HUB_DLT_TEMPLATE_ID is missing — add it to apps/api/.env');
  if (!number) blockers.push('no recipient — pass --number=91XXXXXXXXXX');
  if (!templateMatches) blockers.push('the composed message does not match the approved template');

  console.log('');
  console.log('4. READINESS');
  if (blockers.length === 0) {
    line('ready to send', 'YES — add --send --confirm to send ONE live SMS');
  } else {
    line('ready to send', 'NO');
    for (const b of blockers) console.log(`    - ${b}`);
  }

  // ---------------------------------------------------------- 5. send or not
  console.log('');
  if (!args.send) {
    console.log('5. DRY RUN — NO NETWORK REQUEST WAS MADE. Nothing was sent.');
    console.log('');
    return blockers.length === 0 ? 0 : 1;
  }

  if (blockers.length > 0) {
    console.log('5. REFUSED — the blockers above must be cleared first. Nothing was sent.');
    console.log('');
    return 1;
  }

  if (!args.confirm) {
    console.log('5. REFUSED — --send also requires --confirm. Nothing was sent.');
    console.log('');
    return 1;
  }

  console.log('5. SENDING ONE LIVE SMS …');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    // The error is summarised, never interpolated whole: a fetch error can
    // carry the request URL, and the URL carries the API key.
    const aborted = controller.signal.aborted;
    line('result', aborted ? `no answer within ${timeoutMs}ms` : `could not reach the gateway (${error.name})`);
    line('sent', 'NOTHING CONFIRMED SENT');
    console.log('');
    return 1;
  } finally {
    clearTimeout(timer);
  }

  line('HTTP status', String(response.status));
  const bodyText = await response.text();

  let payload = null;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    // Not echoed: a gateway returning something unexpected can return
    // anything, including a reflection of the request.
    line('body', `not JSON (${bodyText.length} bytes, not echoed)`);
    line('result', 'MALFORMED RESPONSE — nothing confirmed sent');
    console.log('');
    return 1;
  }

  // Only the three documented fields are reported. MessageData can contain
  // the recipient, so it is summarised by count alone.
  const code = payload.ErrorCode === undefined ? null : normaliseErrorCode(payload.ErrorCode);
  line('ErrorCode', code === null ? 'absent' : code);
  line('meaning', code === null ? '—' : (ERROR_CODE_MEANINGS[code] || 'not in the documented table'));
  line('ErrorMessage', typeof payload.ErrorMessage === 'string' ? payload.ErrorMessage : '—');
  line('JobId', payload.JobId === undefined ? '—' : String(payload.JobId));
  line(
    'MessageData',
    Array.isArray(payload.MessageData) ? `${payload.MessageData.length} entr(ies), not echoed` : '—'
  );

  const accepted = code === '000';
  console.log('');
  line('OUTCOME', accepted ? 'ACCEPTED by the gateway' : 'REJECTED — see ErrorCode above');
  if (accepted) {
    console.log('');
    console.log('  Acceptance is not delivery. Check the handset; if nothing arrives,');
    console.log('  the DLT scrubbing stage rejected it after the gateway accepted it.');
  }
  console.log('');
  return accepted ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\nUnexpected failure: ${error && error.name ? error.name : 'Error'}`);
    process.exit(2);
  }
);
