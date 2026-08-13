import * as fc from 'fast-check';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from '../services/token.service';

/**
 * Feature: cobdata-backend-mvp, Property 1: JWT Structure Invariant
 *
 * **Validates: Requirements 3.2, 1.1, 7.2**
 *
 * For any issued AccessToken JWT, the decoded payload SHALL contain exactly
 * the fields `sub`, `accountId`, `role`, `sessionId`, `iat`, and `exp` —
 * with `exp` set to 15 minutes after `iat` — and no additional fields
 * (no name, email, phone, document, or permission data).
 *
 * NOTE: Normal tokens have exactly 6 fields (sub, accountId, role, sessionId, iat, exp).
 * Restricted tokens (mustResetPassword=true) have 7 fields. This test validates normal tokens only.
 * The mustResetPassword field is an intentional extension to avoid a DB query on every request
 * for the must-reset-password check (see design doc for tradeoff rationale).
 */
describe('Property 1: JWT Structure Invariant', () => {
  const JWT_SECRET = 'test-secret-for-property-tests';
  let tokenService: TokenService;
  let jwtService: JwtService;

  beforeAll(() => {
    jwtService = new JwtService({
      secret: JWT_SECRET,
      signOptions: { expiresIn: '15m' },
    });
    tokenService = new TokenService(
      jwtService,
      { get: () => 'development' } as any,
    );
  });

  it('should contain exactly sub, accountId, role, sessionId, iat, exp fields for any valid input', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // sub (userId)
        fc.uuid(), // accountId
        fc.constantFrom('ADMIN', 'OPERATIONAL', 'VIEWER'), // role
        fc.uuid(), // sessionId
        (sub, accountId, role, sessionId) => {
          const token = tokenService.generateAccessToken({
            sub,
            accountId,
            role,
            sessionId,
          });
          const decoded = jwtService.verify(token);
          const keys = Object.keys(decoded).sort();

          // Must have exactly these 6 fields — no extras
          expect(keys).toEqual(
            ['accountId', 'exp', 'iat', 'role', 'sessionId', 'sub'].sort(),
          );

          // Values match input
          expect(decoded.sub).toBe(sub);
          expect(decoded.accountId).toBe(accountId);
          expect(decoded.role).toBe(role);
          expect(decoded.sessionId).toBe(sessionId);

          // exp = iat + 15 minutes (900 seconds)
          expect(decoded.exp - decoded.iat).toBe(900);
        },
      ),
      { numRuns: 100 },
    );
  });
});
