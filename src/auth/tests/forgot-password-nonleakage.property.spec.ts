import * as fc from 'fast-check';
import { AuthService } from '../auth.service';

/**
 * Feature: cobdata-backend-mvp, Property 28: Forgot-Password Non-Leakage
 *
 * **Validates: Requirements 5.3**
 *
 * For any email (existing or not), POST /auth/forgot-password returns 202
 * with identical response. The system SHALL NOT reveal whether an email
 * exists in the database.
 */
describe('Property 28: Forgot-Password Non-Leakage', () => {
  const LOCAL_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
  const DOMAIN_CHARS = 'abcdefghijklmnopqrstuvwxyz'.split('');

  /**
   * Generator for random email-like strings
   */
  const arbEmail: fc.Arbitrary<string> = fc
    .tuple(
      fc.array(fc.constantFrom(...LOCAL_CHARS), { minLength: 1, maxLength: 20 }),
      fc.array(fc.constantFrom(...DOMAIN_CHARS), { minLength: 2, maxLength: 10 }),
      fc.constantFrom('com', 'net', 'org', 'io', 'dev'),
    )
    .map(([local, domain, tld]) => `${local.join('')}@${domain.join('')}.${tld}`);

  it('should always resolve without throwing for any email input', async () => {
    // Mock the dependencies: PrismaService always returns null (user not found)
    const mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const mockPasswordService = {} as any;
    const mockPasswordResetService = {
      store: jest.fn().mockResolvedValue(undefined),
    } as any;
    const mockSessionService = {} as any;
    const mockTokenService = {} as any;

    const authService = new AuthService(
      mockPrisma as any,
      mockPasswordService,
      mockPasswordResetService,
      mockSessionService,
      mockTokenService,
    );

    await fc.assert(
      fc.asyncProperty(arbEmail, async (email: string) => {
        // forgotPassword should NEVER throw regardless of email existence
        await expect(authService.forgotPassword(email)).resolves.not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('should return undefined (void) regardless of whether user exists or not', async () => {
    const existingUser = {
      id: 'user-123',
      email: 'existing@test.com',
      isActive: true,
      passwordHash: 'some-hash',
      accountId: 'acc-1',
      role: 'ADMIN',
    };

    // Test with existing user
    const mockPrismaExisting = {
      user: {
        findUnique: jest.fn().mockResolvedValue(existingUser),
        update: jest.fn(),
      },
    };
    const mockPasswordResetExisting = {
      store: jest.fn().mockResolvedValue(undefined),
    } as any;

    const serviceWithExisting = new AuthService(
      mockPrismaExisting as any,
      {} as any,
      mockPasswordResetExisting,
      {} as any,
      {} as any,
    );

    // Test with non-existing user
    const mockPrismaNonExisting = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const mockPasswordResetNonExisting = {
      store: jest.fn().mockResolvedValue(undefined),
    } as any;

    const serviceWithoutExisting = new AuthService(
      mockPrismaNonExisting as any,
      {} as any,
      mockPasswordResetNonExisting,
      {} as any,
      {} as any,
    );

    await fc.assert(
      fc.asyncProperty(arbEmail, async (email: string) => {
        const resultExisting = await serviceWithExisting.forgotPassword(email);
        const resultNonExisting = await serviceWithoutExisting.forgotPassword(email);

        // Both should return undefined (void)
        expect(resultExisting).toBeUndefined();
        expect(resultNonExisting).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('should never throw an error that reveals user existence', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbEmail,
        fc.boolean(), // whether user exists
        async (email: string, userExists: boolean) => {
          const mockUser = userExists
            ? {
                id: 'user-uuid',
                email: email.toLowerCase(),
                isActive: true,
                passwordHash: 'hash',
                accountId: 'acc-1',
                role: 'ADMIN',
              }
            : null;

          const mockPrisma = {
            user: {
              findUnique: jest.fn().mockResolvedValue(mockUser),
              update: jest.fn(),
            },
          };
          const mockPasswordResetService = {
            store: jest.fn().mockResolvedValue(undefined),
          } as any;

          const authService = new AuthService(
            mockPrisma as any,
            {} as any,
            mockPasswordResetService,
            {} as any,
            {} as any,
          );

          // Must never throw — regardless of whether user exists
          const result = await authService.forgotPassword(email);
          expect(result).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
