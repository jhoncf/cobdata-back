import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AUDIT_ACTION_KEY } from '../decorators';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let reflector: Reflector;
  let prisma: jest.Mocked<Pick<PrismaService, 'auditLog'>>;

  const mockAuditLogCreate = jest.fn();

  beforeEach(() => {
    reflector = new Reflector();
    prisma = {
      auditLog: {
        create: mockAuditLogCreate,
      },
    } as any;

    interceptor = new AuditInterceptor(reflector, prisma as any);
    mockAuditLogCreate.mockReset();
  });

  function createMockContext(
    user?: { id: string; accountId: string; role: string; sessionId: string },
    params?: Record<string, string>,
  ): ExecutionContext {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          user: user ?? undefined,
          params: params ?? {},
          requestId: 'test-request-id-123',
          ip: '127.0.0.1',
          method: 'POST',
          path: '/api/contracts',
        }),
      }),
    } as unknown as ExecutionContext;
  }

  function createMockCallHandler(): CallHandler {
    return {
      handle: jest.fn().mockReturnValue(of({ success: true })),
    };
  }

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  describe('when no @Audit decorator is present', () => {
    it('should pass through without making a DB call', (done) => {
      const context = createMockContext();
      const next = createMockCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(undefined);

      interceptor.intercept(context, next).subscribe({
        next: (value) => {
          expect(value).toEqual({ success: true });
        },
        complete: () => {
          expect(mockAuditLogCreate).not.toHaveBeenCalled();
          done();
        },
      });
    });
  });

  describe('when @Audit decorator is present', () => {
    const auditMeta = { action: 'CONTRACT_CREATE', resourceType: 'Contract' };
    const mockUser = {
      id: 'user-uuid-1',
      accountId: 'account-uuid-1',
      role: 'ADMIN',
      sessionId: 'session-uuid-1',
    };

    it('should create an AuditLog entry with correct fields', (done) => {
      const context = createMockContext(mockUser, { id: 'resource-uuid-1' });
      const next = createMockCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditMeta);
      mockAuditLogCreate.mockResolvedValue({});

      interceptor.intercept(context, next).subscribe({
        complete: () => {
          // Give the fire-and-forget promise time to resolve
          setImmediate(() => {
            expect(mockAuditLogCreate).toHaveBeenCalledWith({
              data: {
                action: 'CONTRACT_CREATE',
                userId: 'user-uuid-1',
                resourceType: 'Contract',
                resourceId: 'resource-uuid-1',
                requestId: 'test-request-id-123',
                ipAddress: '127.0.0.1',
                metadata: { method: 'POST', path: '/api/contracts' },
              },
            });
            done();
          });
        },
      });
    });

    it('should set userId to null when user is not authenticated', (done) => {
      const context = createMockContext(undefined, { id: 'res-123' });
      const next = createMockCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditMeta);
      mockAuditLogCreate.mockResolvedValue({});

      interceptor.intercept(context, next).subscribe({
        complete: () => {
          setImmediate(() => {
            expect(mockAuditLogCreate).toHaveBeenCalledWith(
              expect.objectContaining({
                data: expect.objectContaining({
                  userId: null,
                }),
              }),
            );
            done();
          });
        },
      });
    });

    it('should extract resourceId from walletId param when id is absent', (done) => {
      const context = createMockContext(mockUser, {
        walletId: 'wallet-uuid-1',
      });
      const next = createMockCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditMeta);
      mockAuditLogCreate.mockResolvedValue({});

      interceptor.intercept(context, next).subscribe({
        complete: () => {
          setImmediate(() => {
            expect(mockAuditLogCreate).toHaveBeenCalledWith(
              expect.objectContaining({
                data: expect.objectContaining({
                  resourceId: 'wallet-uuid-1',
                }),
              }),
            );
            done();
          });
        },
      });
    });

    it('should extract resourceId from creditorId param when id and walletId are absent', (done) => {
      const context = createMockContext(mockUser, {
        creditorId: 'creditor-uuid-1',
      });
      const next = createMockCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditMeta);
      mockAuditLogCreate.mockResolvedValue({});

      interceptor.intercept(context, next).subscribe({
        complete: () => {
          setImmediate(() => {
            expect(mockAuditLogCreate).toHaveBeenCalledWith(
              expect.objectContaining({
                data: expect.objectContaining({
                  resourceId: 'creditor-uuid-1',
                }),
              }),
            );
            done();
          });
        },
      });
    });
  });

  describe('best-effort behavior', () => {
    it('should not throw when DB write fails — request completes normally', (done) => {
      const auditMeta = {
        action: 'WALLET_CREATE',
        resourceType: 'Wallet',
      };
      const mockUser = {
        id: 'user-uuid-1',
        accountId: 'account-uuid-1',
        role: 'ADMIN',
        sessionId: 'session-uuid-1',
      };
      const context = createMockContext(mockUser);
      const next = createMockCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditMeta);
      mockAuditLogCreate.mockRejectedValue(new Error('DB connection lost'));

      interceptor.intercept(context, next).subscribe({
        next: (value) => {
          // Response still returns normally despite DB failure
          expect(value).toEqual({ success: true });
        },
        complete: () => {
          done();
        },
        error: () => {
          // Should never reach here
          done.fail('Interceptor should not propagate audit DB errors');
        },
      });
    });
  });

  describe('metadata sanitization', () => {
    it('should set metadata to Prisma.JsonNull when serialized metadata exceeds 4KB', (done) => {
      const auditMeta = {
        action: 'CONTRACT_UPDATE',
        resourceType: 'Contract',
      };
      const mockUser = {
        id: 'user-uuid-1',
        accountId: 'account-uuid-1',
        role: 'ADMIN',
        sessionId: 'session-uuid-1',
      };

      // Create a context with a very long path to test the 4KB limit
      const longPath = '/api/' + 'x'.repeat(5000);
      const context = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue({
            user: mockUser,
            params: { id: 'res-1' },
            requestId: 'req-id',
            ip: '10.0.0.1',
            method: 'PATCH',
            path: longPath,
          }),
        }),
      } as unknown as ExecutionContext;

      const next = createMockCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditMeta);
      mockAuditLogCreate.mockResolvedValue({});

      interceptor.intercept(context, next).subscribe({
        complete: () => {
          setImmediate(() => {
            expect(mockAuditLogCreate).toHaveBeenCalledWith(
              expect.objectContaining({
                data: expect.objectContaining({
                  metadata: Prisma.JsonNull,
                }),
              }),
            );
            done();
          });
        },
      });
    });

    it('should include method and path in metadata when under 4KB', (done) => {
      const auditMeta = {
        action: 'CONTRACT_CREATE',
        resourceType: 'Contract',
      };
      const mockUser = {
        id: 'user-uuid-1',
        accountId: 'account-uuid-1',
        role: 'ADMIN',
        sessionId: 'session-uuid-1',
      };
      const context = createMockContext(mockUser, { id: 'res-1' });
      const next = createMockCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditMeta);
      mockAuditLogCreate.mockResolvedValue({});

      interceptor.intercept(context, next).subscribe({
        complete: () => {
          setImmediate(() => {
            const callData = mockAuditLogCreate.mock.calls[0][0].data;
            expect(callData.metadata).toEqual({
              method: 'POST',
              path: '/api/contracts',
            });
            const serialized = JSON.stringify(callData.metadata);
            expect(serialized.length).toBeLessThanOrEqual(4096);
            done();
          });
        },
      });
    });
  });
});
