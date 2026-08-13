import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ScopeGuard } from '../src/common/guards/scope.guard';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Integration Test: RBAC Enforcement
 *
 * **Validates: Requirements 8.1, 8.2, 8.3**
 *
 * Tests RBAC using mocked guards context:
 * - ADMIN can access all endpoints (user management, provider config, delete)
 * - OPERATIONAL cannot access user management, provider config, or delete
 * - VIEWER gets denied on all write operations, scope-filtered on reads
 */
describe('Integration: RBAC Enforcement', () => {
  let rolesGuard: RolesGuard;
  let scopeGuard: ScopeGuard;
  let reflector: Reflector;
  let mockPrisma: { userScope: { findMany: jest.Mock } };

  function createMockExecutionContext(overrides: {
    user?: { id: string; accountId: string; role: string; sessionId: string };
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: Record<string, string>;
    routePath?: string;
    handlerRoles?: string[];
    isPublic?: boolean;
  }): ExecutionContext {
    const request = {
      user: overrides.user,
      params: overrides.params || {},
      query: overrides.query || {},
      body: overrides.body || {},
      route: { path: overrides.routePath || '/api/contracts' },
    };

    const handler = { name: 'testHandler' };
    const classRef = { name: 'TestController' };

    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => classRef,
    } as unknown as ExecutionContext;

    return context;
  }

  beforeEach(() => {
    reflector = new Reflector();

    mockPrisma = {
      userScope: { findMany: jest.fn() },
    };

    rolesGuard = new RolesGuard(reflector);
    scopeGuard = new ScopeGuard(
      mockPrisma as unknown as PrismaService,
      reflector,
    );
  });

  describe('ADMIN full access (Req 8.1)', () => {
    const adminUser = {
      id: 'admin-uuid',
      accountId: 'account-uuid',
      role: 'ADMIN',
      sessionId: 'session-uuid',
    };

    it('should allow ADMIN to access user management endpoints', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
      const context = createMockExecutionContext({ user: adminUser });

      expect(rolesGuard.canActivate(context)).toBe(true);
    });

    it('should allow ADMIN to access provider configuration', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
      const context = createMockExecutionContext({
        user: adminUser,
        routePath: '/api/providers',
      });

      expect(rolesGuard.canActivate(context)).toBe(true);
    });

    it('should allow ADMIN to perform delete operations', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
      const context = createMockExecutionContext({
        user: adminUser,
        routePath: '/api/creditors/:id',
      });

      expect(rolesGuard.canActivate(context)).toBe(true);
    });

    it('should allow ADMIN endpoints with any @Roles combination', () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(['ADMIN', 'OPERATIONAL']);
      const context = createMockExecutionContext({ user: adminUser });

      expect(rolesGuard.canActivate(context)).toBe(true);
    });

    it('should allow ADMIN to access endpoints without @Roles decorator', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const context = createMockExecutionContext({ user: adminUser });

      expect(rolesGuard.canActivate(context)).toBe(true);
    });
  });

  describe('OPERATIONAL restricted access (Req 8.2)', () => {
    const operationalUser = {
      id: 'op-uuid',
      accountId: 'account-uuid',
      role: 'OPERATIONAL',
      sessionId: 'session-uuid',
    };

    it('should allow OPERATIONAL to access business read/write endpoints', () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(['ADMIN', 'OPERATIONAL']);
      const context = createMockExecutionContext({ user: operationalUser });

      expect(rolesGuard.canActivate(context)).toBe(true);
    });

    it('should deny OPERATIONAL from user management (ADMIN-only)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
      const context = createMockExecutionContext({
        user: operationalUser,
        routePath: '/api/users',
      });

      expect(rolesGuard.canActivate(context)).toBe(false);
    });

    it('should deny OPERATIONAL from provider configuration (ADMIN-only)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
      const context = createMockExecutionContext({
        user: operationalUser,
        routePath: '/api/providers',
      });

      expect(rolesGuard.canActivate(context)).toBe(false);
    });

    it('should deny OPERATIONAL from delete operations (ADMIN-only)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
      const context = createMockExecutionContext({
        user: operationalUser,
        routePath: '/api/creditors/:id',
      });

      expect(rolesGuard.canActivate(context)).toBe(false);
    });

    it('should allow OPERATIONAL on endpoints without @Roles decorator', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const context = createMockExecutionContext({ user: operationalUser });

      expect(rolesGuard.canActivate(context)).toBe(true);
    });
  });

  describe('VIEWER read-only + scope-filtered (Req 8.3)', () => {
    const viewerUser = {
      id: 'viewer-uuid',
      accountId: 'account-uuid',
      role: 'VIEWER',
      sessionId: 'session-uuid',
    };

    it('should deny VIEWER on write endpoints (@Roles ADMIN, OPERATIONAL)', () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(['ADMIN', 'OPERATIONAL']);
      const context = createMockExecutionContext({ user: viewerUser });

      expect(rolesGuard.canActivate(context)).toBe(false);
    });

    it('should deny VIEWER on ADMIN-only endpoints', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
      const context = createMockExecutionContext({ user: viewerUser });

      expect(rolesGuard.canActivate(context)).toBe(false);
    });

    it('should allow VIEWER on endpoints without @Roles decorator (read)', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const context = createMockExecutionContext({ user: viewerUser });

      expect(rolesGuard.canActivate(context)).toBe(true);
    });

    it('should allow VIEWER access to wallet within their scopes via ScopeGuard', async () => {
      // ScopeGuard: return false for IS_PUBLIC_KEY
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      mockPrisma.userScope.findMany.mockResolvedValue([
        { walletId: 'wallet-1' },
        { walletId: 'wallet-2' },
      ]);

      const context = createMockExecutionContext({
        user: viewerUser,
        params: { walletId: 'wallet-1' },
      });

      const result = await scopeGuard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should deny VIEWER access to wallet outside their scopes', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      mockPrisma.userScope.findMany.mockResolvedValue([
        { walletId: 'wallet-1' },
        { walletId: 'wallet-2' },
      ]);

      const context = createMockExecutionContext({
        user: viewerUser,
        params: { walletId: 'wallet-99' },
      });

      const result = await scopeGuard.canActivate(context);
      expect(result).toBe(false);
    });

    it('should deny VIEWER with empty scopes any wallet access', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      mockPrisma.userScope.findMany.mockResolvedValue([]);

      const context = createMockExecutionContext({
        user: viewerUser,
        params: { walletId: 'wallet-1' },
      });

      const result = await scopeGuard.canActivate(context);
      expect(result).toBe(false);
    });

    it('should allow ScopeGuard to pass for non-VIEWER roles', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const adminContext = createMockExecutionContext({
        user: {
          id: 'admin-uuid',
          accountId: 'account-uuid',
          role: 'ADMIN',
          sessionId: 'session-uuid',
        },
        params: { walletId: 'any-wallet' },
      });

      const result = await scopeGuard.canActivate(adminContext);
      expect(result).toBe(true);
      // Should not even query scopes for ADMIN
      expect(mockPrisma.userScope.findMany).not.toHaveBeenCalled();
    });
  });
});
