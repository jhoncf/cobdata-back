import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MustResetPasswordGuard } from './must-reset-password.guard';
import { IS_PUBLIC_KEY, ALLOW_MUST_RESET_KEY } from '../decorators';
import { AuthenticatedUser } from '../interfaces';

describe('MustResetPasswordGuard', () => {
  let guard: MustResetPasswordGuard;
  let reflector: Reflector;

  function createMockContext(user?: AuthenticatedUser): ExecutionContext {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = new Reflector();
    guard = new MustResetPasswordGuard(reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should return true for @Public() routes regardless of user state', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === IS_PUBLIC_KEY) return true;
        return false;
      });

      const context = createMockContext({
        id: 'user-1',
        accountId: 'acc-1',
        role: 'ADMIN',
        sessionId: 'sess-1',
        mustResetPassword: true,
      });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should return true for @AllowMustReset() routes even with restricted token', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ALLOW_MUST_RESET_KEY) return true;
        return false;
      });

      const context = createMockContext({
        id: 'user-1',
        accountId: 'acc-1',
        role: 'ADMIN',
        sessionId: 'sess-1',
        mustResetPassword: true,
      });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should throw ForbiddenException when user has mustResetPassword=true on a regular endpoint', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const context = createMockContext({
        id: 'user-1',
        accountId: 'acc-1',
        role: 'ADMIN',
        sessionId: 'sess-1',
        mustResetPassword: true,
      });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow(
        'Password reset required. Please change your password.',
      );
    });

    it('should return true for normal token (no mustResetPassword) on regular endpoints', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const context = createMockContext({
        id: 'user-1',
        accountId: 'acc-1',
        role: 'ADMIN',
        sessionId: 'sess-1',
      });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should return true when mustResetPassword is explicitly false', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const context = createMockContext({
        id: 'user-1',
        accountId: 'acc-1',
        role: 'OPERATIONAL',
        sessionId: 'sess-1',
        mustResetPassword: false,
      });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should return true when user is undefined (guard should not crash)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const context = createMockContext(undefined);

      expect(guard.canActivate(context)).toBe(true);
    });
  });
});
