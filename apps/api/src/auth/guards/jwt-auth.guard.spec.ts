import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokenService } from '../services/token.service';
import { JwtAuthGuard, type AuthenticatedRequest } from './jwt-auth.guard';

function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (() => undefined) as never,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let tokens: jest.Mocked<Pick<TokenService, 'verifyAccessToken'>>;
  let reflector: Reflector;

  beforeEach(() => {
    tokens = { verifyAccessToken: jest.fn() } as never;
    reflector = new Reflector();
  });

  it('allows a route decorated @Public() through without checking any token', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const guard = new JwtAuthGuard(reflector, tokens as unknown as TokenService);
    const ctx = contextFor({ headers: {} } as never);

    expect(guard.canActivate(ctx)).toBe(true);
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const guard = new JwtAuthGuard(reflector, tokens as unknown as TokenService);
    const ctx = contextFor({ headers: {} } as never);

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects a malformed Authorization header (not "Bearer <token>")', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const guard = new JwtAuthGuard(reflector, tokens as unknown as TokenService);
    const ctx = contextFor({ headers: { authorization: 'Basic abc123' } } as never);

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a well-formed but invalid/expired bearer token', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    tokens.verifyAccessToken.mockReturnValue(null);
    const guard = new JwtAuthGuard(reflector, tokens as unknown as TokenService);
    const ctx = contextFor({ headers: { authorization: 'Bearer bad.token.value' } } as never);

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('accepts a valid bearer token and attaches the verified principal to the request', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    tokens.verifyAccessToken.mockReturnValue({ principalType: 'STAFF', principalId: 'user-1' });
    const guard = new JwtAuthGuard(reflector, tokens as unknown as TokenService);
    const request = { headers: { authorization: 'Bearer good.token.value' } } as AuthenticatedRequest;
    const ctx = contextFor(request);

    expect(guard.canActivate(ctx)).toBe(true);
    expect(request.principal).toEqual({ principalType: 'STAFF', principalId: 'user-1' });
  });
});
