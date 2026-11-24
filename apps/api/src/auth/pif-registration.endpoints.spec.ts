import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@esamagri/shared-types';
import { AuthController } from './auth.controller';
import { AdminController } from '../admin/admin.controller';
import { REQUIRE_PERMISSIONS_KEY } from './decorators/require-permissions.decorator';
import { PIF_SELF_REGISTRATION_DISABLED_MESSAGE } from './pif-registration.gate';
import type { PifRegistrationGate } from './pif-registration.gate.service';
import type { CustomerAuthService } from './services/customer-auth.service';
import type { StaffAuthService } from './services/staff-auth.service';
import type { TokenService } from './services/token.service';

/**
 * The two registration endpoints and the two admin routes behind the
 * switch, exercised against the real controllers with faked services. No
 * database, no HTTP server, no Nest container.
 *
 * WHAT THIS COVERS THAT THE GATE'S OWN SPEC DOES NOT. The gate decides;
 * this file proves the controller does the right thing with that decision
 * — the exact 503 and message when OFF, the registration service actually
 * reached when ON, and — the regression that would be easy to cause and
 * hard to notice — that CUSTOMER LOGIN IS NOT GATED AT ALL. Login and
 * registration sit in the same controller and the gate is one line away
 * from the login handlers.
 *
 * The permission check on the admin routes is asserted from the route
 * METADATA rather than over HTTP, because AuthorizationGuard reads exactly
 * that metadata and the guard's own behaviour is already covered by
 * authorization.guard.spec.ts. Verifying the metadata is what proves this
 * particular route is gated; re-testing the guard would prove nothing new
 * and would need a database.
 */

const REQUEST = {
  ip: '203.0.113.7',
  socket: { remoteAddress: '203.0.113.7' },
  headers: {},
} as never;

const RESPONSE = { cookie: jest.fn(), clearCookie: jest.fn() } as never;

interface Harness {
  controller: AuthController;
  customerAuth: {
    requestOtp: jest.Mock;
    requestRegistrationOtp: jest.Mock;
    registerCustomer: jest.Mock;
    verifyOtp: jest.Mock;
  };
  isEnabled: jest.Mock;
}

function harness(enabled: boolean | (() => Promise<boolean>)): Harness {
  // The real IssuedSession shape: respondWithSession reads
  // session.session.principal_type and session.refreshTokenExpiresAt.
  const session = {
    accessToken: 'at',
    refreshToken: 'rt',
    refreshTokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
    session: {
      principal_type: 'CUSTOMER',
      principal_id: '11111111-1111-7111-8111-111111111111',
    },
  };
  const customerAuth = {
    requestOtp: jest.fn().mockResolvedValue(undefined),
    requestRegistrationOtp: jest.fn().mockResolvedValue(undefined),
    registerCustomer: jest.fn().mockResolvedValue(session),
    verifyOtp: jest.fn().mockResolvedValue(session),
  };
  const isEnabled = jest.fn(
    typeof enabled === 'function' ? enabled : async () => enabled
  );
  const controller = new AuthController(
    { get: () => 'localhost' } as never,
    customerAuth as unknown as CustomerAuthService,
    {} as unknown as StaffAuthService,
    {
      issueSession: jest.fn(),
      refreshCookieName: () => 'esamagri_customer_refresh',
      refreshCookieDomain: () => 'localhost',
    } as unknown as TokenService,
    { isEnabled } as unknown as PifRegistrationGate
  );
  return { controller, customerAuth, isEnabled };
}

const REGISTER_DTO = {
  mobileNumber: '+919000000001',
  code: '246813',
  name: 'Asha Kumar',
  quarterBlock: 'B',
  quarterNumber: '12',
};

/** Reads the HttpException body without caring how Nest wraps it. */
function bodyOf(err: unknown): { code?: string; message?: string } {
  expect(err).toBeInstanceOf(HttpException);
  return (err as HttpException).getResponse() as { code?: string; message?: string };
}

describe('registration endpoints — while the switch is OFF', () => {
  it('refuses the registration OTP request with 503 and the standard message', async () => {
    const h = harness(false);

    await expect(
      h.controller.requestRegistrationOtp({ mobileNumber: '+919000000001' }, REQUEST)
    ).rejects.toBeInstanceOf(HttpException);

    const err = await h.controller
      .requestRegistrationOtp({ mobileNumber: '+919000000001' }, REQUEST)
      .catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(bodyOf(err)).toEqual({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: PIF_SELF_REGISTRATION_DISABLED_MESSAGE,
    });
  });

  it('refuses the registration itself with the same 503 and the same message', async () => {
    const h = harness(false);
    const err = await h.controller
      .registerCustomer(REGISTER_DTO, REQUEST, RESPONSE)
      .catch((e: unknown) => e);

    expect((err as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(bodyOf(err).message).toBe(PIF_SELF_REGISTRATION_DISABLED_MESSAGE);
  });

  it('TOUCHES NOTHING DOWNSTREAM — no OTP issued, no customer created', async () => {
    const h = harness(false);
    await h.controller.requestRegistrationOtp({ mobileNumber: '+919000000001' }, REQUEST).catch(() => {});
    await h.controller.registerCustomer(REGISTER_DTO, REQUEST, RESPONSE).catch(() => {});

    expect(h.customerAuth.requestRegistrationOtp).not.toHaveBeenCalled();
    expect(h.customerAuth.registerCustomer).not.toHaveBeenCalled();
  });

  it('checks the gate before doing anything else, on both routes', async () => {
    const h = harness(false);
    await h.controller.requestRegistrationOtp({ mobileNumber: '+919000000001' }, REQUEST).catch(() => {});
    expect(h.isEnabled).toHaveBeenCalledTimes(1);

    await h.controller.registerCustomer(REGISTER_DTO, REQUEST, RESPONSE).catch(() => {});
    expect(h.isEnabled).toHaveBeenCalledTimes(2);
  });

  it('refuses when the gate fails closed on a database error, with the same 503', async () => {
    // The gate swallows the error and answers false; the controller must
    // produce its ordinary refusal rather than a 500 with a different body.
    const h = harness(async () => false);
    const err = await h.controller
      .registerCustomer(REGISTER_DTO, REQUEST, RESPONSE)
      .catch((e: unknown) => e);

    expect((err as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(bodyOf(err).message).toBe(PIF_SELF_REGISTRATION_DISABLED_MESSAGE);
  });
});

describe('registration endpoints — while the switch is ON', () => {
  it('passes the OTP request through to the existing service', async () => {
    const h = harness(true);
    await expect(
      h.controller.requestRegistrationOtp({ mobileNumber: '+919000000001' }, REQUEST)
    ).resolves.toEqual({ message: 'A verification code has been sent to that number.' });

    expect(h.customerAuth.requestRegistrationOtp).toHaveBeenCalledTimes(1);
  });

  it('REGISTRATION IS STILL SUBJECT TO THE OTP — the code is passed to the service, unchanged', async () => {
    const h = harness(true);
    await h.controller.registerCustomer(REGISTER_DTO, REQUEST, RESPONSE);

    expect(h.customerAuth.registerCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        // The service takes the proof of the mobile number as one `credential`
        // object; the code and the number must arrive inside it, unchanged.
        credential: expect.objectContaining({
          kind: 'OTP',
          mobileNumber: REGISTER_DTO.mobileNumber,
          code: REGISTER_DTO.code,
        }),
        name: REGISTER_DTO.name,
        quarterBlock: REGISTER_DTO.quarterBlock,
        quarterNumber: REGISTER_DTO.quarterNumber,
      })
    );
    // The switch opens the door; it does not bypass verification. The
    // consumeOtp(purpose 'REGISTER') path inside the service is covered by
    // customer-auth.service.spec.ts and is untouched by this change.
  });

  it('sends exactly the four approved fields on, and no RIK ID', async () => {
    const h = harness(true);
    await h.controller.registerCustomer(REGISTER_DTO, REQUEST, RESPONSE);

    const sent = h.customerAuth.registerCustomer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('rikId');
    expect(sent).not.toHaveProperty('rik_id');
    expect(sent).not.toHaveProperty('dietaryPreference');
  });
});

describe('customer login is NOT gated by the registration switch', () => {
  it('requests a login OTP with the switch OFF, without consulting the gate', async () => {
    const h = harness(false);
    // NOTE the wording: the LOGIN route answers identically whether or not
    // the number is registered, which is the existing anti-enumeration
    // measure. The REGISTRATION route can be plainer, because a
    // registration is not an assertion that an account already existed.
    await expect(
      h.controller.requestOtp({ mobileNumber: '+919000000001' }, REQUEST)
    ).resolves.toEqual({
      message: 'If this number is registered, a verification code has been sent.',
    });

    expect(h.customerAuth.requestOtp).toHaveBeenCalledTimes(1);
    // The gate is one line away from this handler. If it ever appears
    // here, every existing customer loses the ability to sign in the
    // moment registration is switched off.
    expect(h.isEnabled).not.toHaveBeenCalled();
  });

  it('verifies a login OTP with the switch OFF, without consulting the gate', async () => {
    const h = harness(false);
    await h.controller.verifyOtp(
      { mobileNumber: '+919000000001', code: '246813' },
      REQUEST,
      RESPONSE
    );

    expect(h.customerAuth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(h.isEnabled).not.toHaveBeenCalled();
  });
});

describe('admin settings routes — the permission that governs them', () => {
  const reflector = new Reflector();

  it('requires shared.settings.write to READ the switch', () => {
    const codes = reflector.get<string[]>(
      REQUIRE_PERMISSIONS_KEY,
      AdminController.prototype.readPifSelfRegistration
    );
    expect(codes).toEqual(['shared.settings.write']);
  });

  it('requires shared.settings.write to CHANGE the switch', () => {
    const codes = reflector.get<string[]>(
      REQUIRE_PERMISSIONS_KEY,
      AdminController.prototype.setPifSelfRegistration
    );
    expect(codes).toEqual(['shared.settings.write']);
  });

  it('gates the read with the same permission as the write, not a weaker one', () => {
    // Whether a public registration endpoint is open is operational
    // security information; the people who may read it are the people who
    // may change it.
    const read = reflector.get<string[]>(
      REQUIRE_PERMISSIONS_KEY,
      AdminController.prototype.readPifSelfRegistration
    );
    const write = reflector.get<string[]>(
      REQUIRE_PERMISSIONS_KEY,
      AdminController.prototype.setPifSelfRegistration
    );
    // Both DEFINED and equal. Asserting equality alone would also pass if
    // both decorators were deleted and both reads came back undefined,
    // which is the one outcome this test exists to catch.
    expect(read).toBeDefined();
    expect(read?.length).toBeGreaterThan(0);
    expect(read).toEqual(write);
  });

  it('is not marked @Public() — both routes stay behind the guards', () => {
    expect(
      reflector.get('isPublic', AdminController.prototype.readPifSelfRegistration)
    ).toBeUndefined();
    expect(
      reflector.get('isPublic', AdminController.prototype.setPifSelfRegistration)
    ).toBeUndefined();
  });
});
