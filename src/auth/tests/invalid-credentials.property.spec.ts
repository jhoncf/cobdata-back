import * as fc from 'fast-check';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../services/password.service';
import { PasswordResetService } from '../services/password-reset.service';
import { SessionService } from '../services/session.service';
import { TokenService } from '../services/token.service';

/**
 * Feature: cobdata-backend-mvp, Property 2: Invalid Credentials Produce Uniform Response
 *
 * **Validates: Requirements 1.2, 1.3**
 *
 * For any login attempt with incorrect email, incorrect password, or inactive user status,
 * the API SHALL return HTTP 401 with an identical generic error message structure,
 * making it impossible to distinguish which credential component failed.
 */
describe('Property 2: Invalid Credentials Produce Uniform Response', () => {
  let authService: AuthService;
  let mockPrisma: { user: { findUnique: jest.Mock } };
  let mockPasswordService: { verify: jest.Mock };
  let mockPasswordResetService: { store: jest.Mock; get: jest.Mock; delete: jest.Mock };
  let mockSessionService: { create: jest.Mock };
  let mockTokenService: {
    generateAccessToken: jest.Mock;
    generateRefreshToken: jest.Mock;
  };

  beforeEach(() => {
    mockPrisma = {
      user: { findUnique: jest.fn() },
    };

    mockPasswordService = {
      verify: jest.fn(),
    };

    mockPasswordResetService = {
      store: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
    };

    mockSessionService = {
      create: jest.fn(),
    };

    mockTokenService = {
      generateAccessToken: jest.fn(),
      generateRefreshToken: jest.fn(),
    };

    authService = new AuthService(
      mockPrisma as unknown as PrismaService,
      mockPasswordService as unknown as PasswordService,
      mockPasswordResetService as unknown as PasswordResetService,
      mockSessionService as unknown as SessionService,
      mockTokenService as unknown as TokenService,
    );
  });

  it('should return identical UnauthorizedException for any failure scenario', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('wrong_email', 'wrong_password', 'inactive_user'),
        fc.emailAddress(),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (scenario, email, password) => {
          // Configure mocks based on scenario
          switch (scenario) {
            case 'wrong_email':
              // User not found in database
              mockPrisma.user.findUnique.mockResolvedValue(null);
              break;

            case 'wrong_password':
              // User exists & active, but password is wrong
              mockPrisma.user.findUnique.mockResolvedValue({
                id: 'user-id',
                accountId: 'account-id',
                email: email.toLowerCase(),
                passwordHash: 'some-hash',
                role: 'OPERATIONAL',
                isActive: true,
              });
              mockPasswordService.verify.mockResolvedValue(false);
              break;

            case 'inactive_user':
              // User exists but is inactive
              mockPrisma.user.findUnique.mockResolvedValue({
                id: 'user-id',
                accountId: 'account-id',
                email: email.toLowerCase(),
                passwordHash: 'some-hash',
                role: 'ADMIN',
                isActive: false,
              });
              break;
          }

          // Attempt login — should always throw
          let caughtError: UnauthorizedException | null = null;
          try {
            await authService.login({ email, password });
          } catch (error) {
            caughtError = error as UnauthorizedException;
          }

          // MUST throw an UnauthorizedException
          expect(caughtError).toBeInstanceOf(UnauthorizedException);

          // The HTTP status must be 401
          expect(caughtError!.getStatus()).toBe(401);

          // The error message MUST be identical for ALL scenarios
          // so an attacker cannot determine which credential component failed
          expect(caughtError!.message).toBe('Invalid email or password');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should produce indistinguishable error responses across all failure scenarios', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (email, password) => {
          const errors: Array<{ status: number; message: string; response: object }> = [];

          // Scenario 1: wrong email
          mockPrisma.user.findUnique.mockResolvedValue(null);
          try {
            await authService.login({ email, password });
          } catch (e: any) {
            errors.push({
              status: e.getStatus(),
              message: e.message,
              response: e.getResponse(),
            });
          }

          // Scenario 2: wrong password
          mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-id',
            accountId: 'account-id',
            email: email.toLowerCase(),
            passwordHash: 'valid-hash',
            role: 'ADMIN',
            isActive: true,
          });
          mockPasswordService.verify.mockResolvedValue(false);
          try {
            await authService.login({ email, password });
          } catch (e: any) {
            errors.push({
              status: e.getStatus(),
              message: e.message,
              response: e.getResponse(),
            });
          }

          // Scenario 3: inactive user
          mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-id',
            accountId: 'account-id',
            email: email.toLowerCase(),
            passwordHash: 'valid-hash',
            role: 'OPERATIONAL',
            isActive: false,
          });
          try {
            await authService.login({ email, password });
          } catch (e: any) {
            errors.push({
              status: e.getStatus(),
              message: e.message,
              response: e.getResponse(),
            });
          }

          // All 3 scenarios must have thrown
          expect(errors).toHaveLength(3);

          // All must be 401
          for (const err of errors) {
            expect(err.status).toBe(401);
          }

          // All messages must be IDENTICAL (indistinguishable)
          const messages = errors.map((e) => e.message);
          expect(messages[0]).toBe(messages[1]);
          expect(messages[1]).toBe(messages[2]);

          // All response bodies must be structurally identical
          const responses = errors.map((e) => JSON.stringify(e.response));
          expect(responses[0]).toBe(responses[1]);
          expect(responses[1]).toBe(responses[2]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
