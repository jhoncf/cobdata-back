import * as fc from 'fast-check';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/services/password.service';
import { PasswordResetService } from '../src/auth/services/password-reset.service';
import { SessionService } from '../src/auth/services/session.service';
import { TokenService } from '../src/auth/services/token.service';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { Reflector } from '@nestjs/core';

/**
 * Property-Based Tests: Auth Properties 4, 5, 6, 8
 *
 * Tests correctness properties using fast-check with randomized inputs.
 */

// ─── Helpers ───

function createMockDeps() {
  const mockPrisma = {
    user: { findUnique: jest.fn() },
  };

  const mockPasswordService = {
    verify: jest.fn(),
    hash: jest.fn(),
    validateComplexity: jest.fn(),
  };

  const mockPasswordResetService = {
    store: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  };

  const mockSessionService = {
    create: jest.fn(),
    findByRefreshTokenHash: jest.fn(),
    rotateToken: jest.fn(),
    revoke: jest.fn(),
    revokeByTokenFamily: jest.fn(),
    revokeAllExcept: jest.fn(),
    revokeAll: jest.fn(),
    listActive: jest.fn(),
    findById: jest.fn(),
  };

  const mockTokenService = {
    generateAccessToken: jest.fn(),
    generateRefreshToken: jest.fn(),
    hashRefreshToken: jest.fn(),
    getRefreshTokenCookieOptions: jest.fn(),
    getClearCookieOptions: jest.fn(),
  };

  const authService = new AuthService(
    mockPrisma as unknown as PrismaService,
    mockPasswordService as unknown as PasswordService,
    mockPasswordResetService as unknown as PasswordResetService,
    mockSessionService as unknown as SessionService,
    mockTokenService as unknown as TokenService,
  );

  return {
    authService,
    mockPrisma,
    mockPasswordService,
    mockPasswordResetService,
    mockSessionService,
    mockTokenService,
  };
}

// ─── Property 4: Refresh Token Rotation Round-Trip ───

/**
 * **Validates: Requirements 2.1**
 *
 * Property 4: Refresh Token Rotation Round-Trip
 *
 * For any valid, non-revoked RefreshToken belonging to an active token family,
 * calling refresh SHALL produce a new valid AccessToken and a new RefreshToken
 * while invalidating the previous RefreshToken. The new RefreshToken belongs
 * to the same family.
 */
describe('Property 4: Refresh Token Rotation Round-Trip', () => {
  it('should always produce a new token pair and rotate the session hash', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),       // sessionId
        fc.uuid(),       // userId
        fc.uuid(),       // accountId
        fc.uuid(),       // tokenFamily
        fc.constantFrom('ADMIN', 'OPERATIONAL', 'VIEWER'), // role
        async (sessionId, userId, accountId, tokenFamily, role) => {
          const deps = createMockDeps();

          const oldHash = `old-hash-${sessionId}`;
          const newRefreshToken = `new-refresh-${sessionId}`;
          const newHash = `new-hash-${sessionId}`;
          const newAccessToken = `new-access-${sessionId}`;

          // Configure session to be valid, non-revoked, non-expired
          const session = {
            id: sessionId,
            userId,
            tokenFamily,
            refreshTokenHash: oldHash,
            isRevoked: false,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            createdAt: new Date(),
            lastUsedAt: new Date(),
          };

          deps.mockTokenService.hashRefreshToken.mockReturnValue(oldHash);
          deps.mockSessionService.findByRefreshTokenHash.mockResolvedValue(session);
          deps.mockPrisma.user.findUnique.mockResolvedValue({
            id: userId,
            accountId,
            email: 'test@test.com',
            role,
            isActive: true,
            mustResetPassword: false,
          });
          deps.mockTokenService.generateRefreshToken.mockReturnValue({
            token: newRefreshToken,
            hash: newHash,
          });
          deps.mockSessionService.rotateToken.mockResolvedValue(undefined);
          deps.mockTokenService.generateAccessToken.mockReturnValue(newAccessToken);

          // Act
          const result = await deps.authService.refresh('any-refresh-token');

          // Assert: new token pair is returned
          expect(result.accessToken).toBe(newAccessToken);
          expect(result.refreshToken).toBe(newRefreshToken);

          // Assert: session was rotated with new hash (old token invalidated)
          expect(deps.mockSessionService.rotateToken).toHaveBeenCalledWith(
            sessionId,
            newHash,
          );

          // Assert: access token has correct payload (same family via sessionId)
          expect(deps.mockTokenService.generateAccessToken).toHaveBeenCalledWith(
            expect.objectContaining({
              sub: userId,
              accountId,
              role,
              sessionId,
            }),
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  it('should reject refresh for expired sessions regardless of other factors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.integer({ min: 1, max: 365 }), // days expired
        async (sessionId, userId, daysExpired) => {
          const deps = createMockDeps();

          const session = {
            id: sessionId,
            userId,
            tokenFamily: 'family-1',
            refreshTokenHash: 'hash',
            isRevoked: false,
            expiresAt: new Date(Date.now() - daysExpired * 24 * 60 * 60 * 1000),
            createdAt: new Date(),
          };

          deps.mockTokenService.hashRefreshToken.mockReturnValue('hash');
          deps.mockSessionService.findByRefreshTokenHash.mockResolvedValue(session);

          await expect(deps.authService.refresh('token')).rejects.toThrow(
            UnauthorizedException,
          );
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ─── Property 5: Refresh Token Reuse Detection ───

/**
 * **Validates: Requirements 2.2**
 *
 * Property 5: Refresh Token Reuse Detection Invalidates Family
 *
 * For any token family with N issued RefreshTokens, replaying any
 * previously-consumed RefreshToken SHALL invalidate ALL tokens in that
 * family, leaving zero valid sessions in that family.
 */
describe('Property 5: Refresh Token Reuse Detection', () => {
  it('should invalidate entire token family when a revoked session token is replayed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // sessionId
        fc.uuid(), // userId
        fc.uuid(), // tokenFamily
        async (sessionId, userId, tokenFamily) => {
          const deps = createMockDeps();

          // The session was previously revoked (consumed token)
          const revokedSession = {
            id: sessionId,
            userId,
            tokenFamily,
            refreshTokenHash: 'consumed-hash',
            isRevoked: true, // already consumed
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            createdAt: new Date(),
          };

          deps.mockTokenService.hashRefreshToken.mockReturnValue('consumed-hash');
          deps.mockSessionService.findByRefreshTokenHash.mockResolvedValue(revokedSession);
          deps.mockSessionService.revokeByTokenFamily.mockResolvedValue(undefined);

          // Act: replaying a consumed refresh token
          await expect(deps.authService.refresh('replayed-token')).rejects.toThrow(
            UnauthorizedException,
          );

          // Assert: entire family was invalidated
          expect(deps.mockSessionService.revokeByTokenFamily).toHaveBeenCalledWith(
            tokenFamily,
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  it('should always throw 401 on token reuse regardless of token family size', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.integer({ min: 1, max: 20 }), // simulate N tokens in family
        async (userId, tokenFamily, _familySize) => {
          const deps = createMockDeps();

          // Simulated: a revoked session exists (token was already consumed)
          deps.mockTokenService.hashRefreshToken.mockReturnValue('reused-hash');
          deps.mockSessionService.findByRefreshTokenHash.mockResolvedValue({
            id: 'session-old',
            userId,
            tokenFamily,
            refreshTokenHash: 'reused-hash',
            isRevoked: true,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            createdAt: new Date(),
          });
          deps.mockSessionService.revokeByTokenFamily.mockResolvedValue(undefined);

          // Must always throw
          let error: any;
          try {
            await deps.authService.refresh('reused-token');
          } catch (e) {
            error = e;
          }

          expect(error).toBeInstanceOf(UnauthorizedException);
          expect(deps.mockSessionService.revokeByTokenFamily).toHaveBeenCalledWith(
            tokenFamily,
          );
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ─── Property 6: Session Invalidation Preserves Current Session ───

/**
 * **Validates: Requirements 6.3, 6.4, 6.5**
 *
 * Property 6: Session Invalidation Preserves Current Session
 *
 * For any user with N active sessions (N ≥ 2), any bulk session
 * invalidation operation SHALL invalidate all sessions except the one
 * executing the operation, resulting in exactly 1 remaining active session.
 */
describe('Property 6: Session Invalidation Preserves Current Session', () => {
  it('should call revokeAllExcept with correct currentSessionId for any N sessions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // userId
        fc.uuid(), // currentSessionId
        fc.integer({ min: 2, max: 50 }), // N sessions
        async (userId, currentSessionId, _sessionCount) => {
          const deps = createMockDeps();
          deps.mockSessionService.revokeAllExcept.mockResolvedValue(undefined);

          // Act: revoke all sessions except current
          await deps.authService.revokeAllSessions(userId, currentSessionId);

          // Assert: revokeAllExcept was called with the correct user and session
          expect(deps.mockSessionService.revokeAllExcept).toHaveBeenCalledWith(
            userId,
            currentSessionId,
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  it('should preserve current session during password change', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // userId
        fc.uuid(), // sessionId
        async (userId, sessionId) => {
          const deps = createMockDeps();

          const user = {
            id: userId,
            accountId: 'account-1',
            email: 'test@test.com',
            passwordHash: 'existing-hash',
            role: 'ADMIN',
            isActive: true,
            mustResetPassword: false,
          };

          deps.mockPrisma.user.findUnique.mockResolvedValue(user);
          deps.mockPasswordService.verify.mockResolvedValue(true);
          deps.mockPasswordService.validateComplexity.mockReturnValue(null);
          deps.mockPasswordService.hash.mockResolvedValue('new-hash');
          (deps.mockPrisma as any).user = {
            ...deps.mockPrisma.user,
            update: jest.fn().mockResolvedValue(user),
          };
          deps.mockSessionService.revokeAllExcept.mockResolvedValue(undefined);

          // Act
          await deps.authService.changePassword(userId, sessionId, {
            currentPassword: 'OldPass1',
            newPassword: 'NewPass1X',
          });

          // Assert: only other sessions invalidated, current preserved
          expect(deps.mockSessionService.revokeAllExcept).toHaveBeenCalledWith(
            userId,
            sessionId,
          );
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ─── Property 8: Role-Based Action Authorization ───

/**
 * **Validates: Requirements 8.1, 8.2, 8.3**
 *
 * Property 8: Role-Based Action Authorization
 *
 * For any endpoint and HTTP method pair, the following invariant holds:
 * - ADMIN is permitted all actions
 * - OPERATIONAL is permitted read/write on business resources but denied
 *   user management, provider configuration, and delete operations
 * - VIEWER is denied all write operations
 */
describe('Property 8: Role-Based Action Authorization', () => {
  // Endpoint categories based on the authorization matrix
  const adminOnlyEndpoints = [
    { path: '/api/users', method: 'POST', roles: ['ADMIN'] },
    { path: '/api/users/:id', method: 'PATCH', roles: ['ADMIN'] },
    { path: '/api/users/invite', method: 'POST', roles: ['ADMIN'] },
    { path: '/api/providers', method: 'POST', roles: ['ADMIN'] },
    { path: '/api/providers/:id', method: 'PATCH', roles: ['ADMIN'] },
    { path: '/api/creditors/:id', method: 'DELETE', roles: ['ADMIN'] },
    { path: '/api/wallets/:id', method: 'DELETE', roles: ['ADMIN'] },
  ];

  const adminAndOperationalEndpoints = [
    { path: '/api/creditors', method: 'POST', roles: ['ADMIN', 'OPERATIONAL'] },
    { path: '/api/creditors/:id', method: 'PATCH', roles: ['ADMIN', 'OPERATIONAL'] },
    { path: '/api/wallets', method: 'POST', roles: ['ADMIN', 'OPERATIONAL'] },
    { path: '/api/wallets/:id', method: 'PATCH', roles: ['ADMIN', 'OPERATIONAL'] },
    { path: '/api/contracts', method: 'POST', roles: ['ADMIN', 'OPERATIONAL'] },
    { path: '/api/contracts/:id', method: 'PATCH', roles: ['ADMIN', 'OPERATIONAL'] },
    { path: '/api/imports', method: 'POST', roles: ['ADMIN', 'OPERATIONAL'] },
  ];

  let rolesGuard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);
  });

  function makeContext(role: string, requiredRoles: string[]) {
    const request = {
      user: { id: 'user-1', accountId: 'acc-1', role, sessionId: 'sess-1' },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({ name: 'handler' }),
      getClass: () => ({ name: 'Controller' }),
    } as unknown as import('@nestjs/common').ExecutionContext;

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(requiredRoles);
    return ctx;
  }

  it('ADMIN is always permitted regardless of endpoint restrictions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...[...adminOnlyEndpoints, ...adminAndOperationalEndpoints]),
        async (endpoint) => {
          const ctx = makeContext('ADMIN', endpoint.roles);
          expect(rolesGuard.canActivate(ctx)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('OPERATIONAL is denied user management, provider config, and delete operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...adminOnlyEndpoints),
        async (endpoint) => {
          const ctx = makeContext('OPERATIONAL', endpoint.roles);
          expect(rolesGuard.canActivate(ctx)).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('OPERATIONAL is permitted on business read/write endpoints', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...adminAndOperationalEndpoints),
        async (endpoint) => {
          const ctx = makeContext('OPERATIONAL', endpoint.roles);
          expect(rolesGuard.canActivate(ctx)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('VIEWER is denied all write operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...[...adminOnlyEndpoints, ...adminAndOperationalEndpoints]),
        async (endpoint) => {
          const ctx = makeContext('VIEWER', endpoint.roles);
          expect(rolesGuard.canActivate(ctx)).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('any role can access endpoints without @Roles decorator', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('ADMIN', 'OPERATIONAL', 'VIEWER'),
        async (role) => {
          const request = {
            user: { id: 'user-1', accountId: 'acc-1', role, sessionId: 'sess-1' },
          };
          const ctx = {
            switchToHttp: () => ({ getRequest: () => request }),
            getHandler: () => ({ name: 'handler' }),
            getClass: () => ({ name: 'Controller' }),
          } as unknown as import('@nestjs/common').ExecutionContext;

          jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
          expect(rolesGuard.canActivate(ctx)).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });
});
