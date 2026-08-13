import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ScopeGuard } from './scope.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators';

describe('ScopeGuard', () => {
  let guard: ScopeGuard;
  let prisma: { userScope: { findMany: jest.Mock } };
  let reflector: Reflector;

  beforeEach(() => {
    prisma = {
      userScope: {
        findMany: jest.fn(),
      },
    };
    reflector = new Reflector();
    guard = new ScopeGuard(
      prisma as unknown as PrismaService,
      reflector,
    );
  });

  function createMockContext(options: {
    user?: { id: string; role: string; accountId: string; sessionId: string } | null;
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: Record<string, string>;
    routePath?: string;
    userScopes?: string[];
  }): ExecutionContext {
    const request: any = {
      user: options.user ?? undefined,
      params: options.params ?? {},
      query: options.query ?? {},
      body: options.body ?? {},
      route: { path: options.routePath ?? '' },
    };
    if (options.userScopes) {
      request.userScopes = options.userScopes;
    }
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
      }),
    } as unknown as ExecutionContext;
  }

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('public routes', () => {
    it('should allow access on public routes (no auth required)', async () => {
      const context = createMockContext({ user: null });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('non-VIEWER roles', () => {
    it('should allow ADMIN users without checking scopes', async () => {
      const context = createMockContext({
        user: { id: 'u1', role: 'ADMIN', accountId: 'a1', sessionId: 's1' },
        params: { walletId: 'wallet-1' },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(prisma.userScope.findMany).not.toHaveBeenCalled();
    });

    it('should allow OPERATIONAL users without checking scopes', async () => {
      const context = createMockContext({
        user: { id: 'u2', role: 'OPERATIONAL', accountId: 'a1', sessionId: 's2' },
        params: { walletId: 'wallet-1' },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(prisma.userScope.findMany).not.toHaveBeenCalled();
    });
  });

  describe('VIEWER with wallet in scopes', () => {
    it('should allow VIEWER when walletId is in their scopes (params)', async () => {
      prisma.userScope.findMany.mockResolvedValue([
        { walletId: 'wallet-1' },
        { walletId: 'wallet-2' },
      ]);
      const context = createMockContext({
        user: { id: 'u3', role: 'VIEWER', accountId: 'a1', sessionId: 's3' },
        params: { walletId: 'wallet-1' },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(prisma.userScope.findMany).toHaveBeenCalledWith({
        where: { userId: 'u3' },
        select: { walletId: true },
      });
    });

    it('should allow VIEWER when walletId is in their scopes (query)', async () => {
      prisma.userScope.findMany.mockResolvedValue([
        { walletId: 'wallet-5' },
      ]);
      const context = createMockContext({
        user: { id: 'u4', role: 'VIEWER', accountId: 'a1', sessionId: 's4' },
        query: { walletId: 'wallet-5' },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow VIEWER when walletId is in their scopes (body)', async () => {
      prisma.userScope.findMany.mockResolvedValue([
        { walletId: 'wallet-3' },
      ]);
      const context = createMockContext({
        user: { id: 'u5', role: 'VIEWER', accountId: 'a1', sessionId: 's5' },
        body: { walletId: 'wallet-3' },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow VIEWER when accessing wallet by :id param on wallets route', async () => {
      prisma.userScope.findMany.mockResolvedValue([
        { walletId: 'wallet-7' },
      ]);
      const context = createMockContext({
        user: { id: 'u6', role: 'VIEWER', accountId: 'a1', sessionId: 's6' },
        params: { id: 'wallet-7' },
        routePath: '/api/wallets/:id',
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('VIEWER with wallet NOT in scopes', () => {
    it('should deny VIEWER when walletId is NOT in their scopes', async () => {
      prisma.userScope.findMany.mockResolvedValue([
        { walletId: 'wallet-1' },
        { walletId: 'wallet-2' },
      ]);
      const context = createMockContext({
        user: { id: 'u7', role: 'VIEWER', accountId: 'a1', sessionId: 's7' },
        params: { walletId: 'wallet-999' },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });
  });

  describe('VIEWER with no scopes', () => {
    it('should deny VIEWER with no scopes for any wallet access', async () => {
      prisma.userScope.findMany.mockResolvedValue([]);
      const context = createMockContext({
        user: { id: 'u8', role: 'VIEWER', accountId: 'a1', sessionId: 's8' },
        params: { walletId: 'wallet-1' },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });
  });

  describe('VIEWER on listing endpoints (no walletId)', () => {
    it('should allow VIEWER on listing endpoints without specific walletId', async () => {
      prisma.userScope.findMany.mockResolvedValue([
        { walletId: 'wallet-1' },
      ]);
      const context = createMockContext({
        user: { id: 'u9', role: 'VIEWER', accountId: 'a1', sessionId: 's9' },
        params: {},
        query: {},
        body: {},
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('scope caching', () => {
    it('should cache scopes on request and not query DB again', async () => {
      prisma.userScope.findMany.mockResolvedValue([
        { walletId: 'wallet-1' },
      ]);
      const context = createMockContext({
        user: { id: 'u10', role: 'VIEWER', accountId: 'a1', sessionId: 's10' },
        params: { walletId: 'wallet-1' },
        userScopes: ['wallet-1'],
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(prisma.userScope.findMany).not.toHaveBeenCalled();
    });
  });

  describe('no user on request', () => {
    it('should allow access when there is no user (public route fallback)', async () => {
      const context = createMockContext({ user: null });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });
});
