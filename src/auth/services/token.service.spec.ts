import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenService, REFRESH_TOKEN_COOKIE_NAME } from './token.service';

describe('TokenService', () => {
  let service: TokenService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const JWT_SECRET = 'test-secret-key-for-testing';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        {
          provide: JwtService,
          useValue: new JwtService({
            secret: JWT_SECRET,
            signOptions: { expiresIn: '15m' },
          }),
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                NODE_ENV: 'development',
                JWT_SECRET: JWT_SECRET,
                JWT_EXPIRES_IN: '15m',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('REFRESH_TOKEN_COOKIE_NAME', () => {
    it('should export the cookie name constant', () => {
      expect(REFRESH_TOKEN_COOKIE_NAME).toBe('cobdata_refresh_token');
    });
  });

  describe('generateAccessToken', () => {
    const payload = {
      sub: '550e8400-e29b-41d4-a716-446655440000',
      accountId: '660e8400-e29b-41d4-a716-446655440000',
      role: 'ADMIN',
      sessionId: '770e8400-e29b-41d4-a716-446655440000',
    };

    it('should return a valid JWT string', () => {
      const token = service.generateAccessToken(payload);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // header.payload.signature
    });

    it('should contain correct payload fields in the decoded token', () => {
      const token = service.generateAccessToken(payload);
      const decoded = jwtService.verify(token);

      expect(decoded.sub).toBe(payload.sub);
      expect(decoded.accountId).toBe(payload.accountId);
      expect(decoded.role).toBe(payload.role);
      expect(decoded.sessionId).toBe(payload.sessionId);
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should contain ONLY sub, accountId, role, sessionId, iat, exp fields for normal tokens', () => {
      const token = service.generateAccessToken(payload);
      const decoded = jwtService.verify(token);
      const keys = Object.keys(decoded).sort();

      expect(keys).toEqual(
        ['accountId', 'exp', 'iat', 'role', 'sessionId', 'sub'].sort(),
      );
    });

    it('should set exp to approximately 15 minutes after iat', () => {
      const token = service.generateAccessToken(payload);
      const decoded = jwtService.verify(token);

      const diffSeconds = decoded.exp - decoded.iat;
      expect(diffSeconds).toBe(15 * 60); // 900 seconds = 15 minutes
    });

    it('should include mustResetPassword field when set to true (restricted token)', () => {
      const restrictedPayload = { ...payload, mustResetPassword: true as const };
      const token = service.generateAccessToken(restrictedPayload);
      const decoded = jwtService.verify(token);

      expect(decoded.mustResetPassword).toBe(true);
      const keys = Object.keys(decoded).sort();
      expect(keys).toEqual(
        ['accountId', 'exp', 'iat', 'mustResetPassword', 'role', 'sessionId', 'sub'].sort(),
      );
    });

    it('should NOT include mustResetPassword field when set to false', () => {
      const normalPayload = { ...payload, mustResetPassword: false as const };
      const token = service.generateAccessToken(normalPayload);
      const decoded = jwtService.verify(token);

      expect(decoded.mustResetPassword).toBeUndefined();
      const keys = Object.keys(decoded).sort();
      expect(keys).toEqual(
        ['accountId', 'exp', 'iat', 'role', 'sessionId', 'sub'].sort(),
      );
    });

    it('should NOT include mustResetPassword field when undefined', () => {
      const normalPayload = { ...payload, mustResetPassword: undefined };
      const token = service.generateAccessToken(normalPayload);
      const decoded = jwtService.verify(token);

      expect(decoded.mustResetPassword).toBeUndefined();
      const keys = Object.keys(decoded).sort();
      expect(keys).toEqual(
        ['accountId', 'exp', 'iat', 'role', 'sessionId', 'sub'].sort(),
      );
    });
  });

  describe('generateRefreshToken', () => {
    it('should return an object with token and hash', () => {
      const result = service.generateRefreshToken();
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('hash');
      expect(typeof result.token).toBe('string');
      expect(typeof result.hash).toBe('string');
    });

    it('should produce a base64url encoded token', () => {
      const result = service.generateRefreshToken();
      // base64url only contains [A-Za-z0-9_-]
      expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should produce a SHA-256 hex hash (64 chars)', () => {
      const result = service.generateRefreshToken();
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce the correct SHA-256 hash of the token', () => {
      const result = service.generateRefreshToken();
      const expectedHash = service.hashRefreshToken(result.token);
      expect(result.hash).toBe(expectedHash);
    });

    it('should produce different tokens on each call', () => {
      const result1 = service.generateRefreshToken();
      const result2 = service.generateRefreshToken();
      expect(result1.token).not.toBe(result2.token);
      expect(result1.hash).not.toBe(result2.hash);
    });
  });

  describe('hashRefreshToken', () => {
    it('should produce a consistent hash for the same input', () => {
      const token = 'test-refresh-token-value';
      const hash1 = service.hashRefreshToken(token);
      const hash2 = service.hashRefreshToken(token);
      expect(hash1).toBe(hash2);
    });

    it('should produce a 64-character hex string', () => {
      const hash = service.hashRefreshToken('any-token');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = service.hashRefreshToken('token-a');
      const hash2 = service.hashRefreshToken('token-b');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('getRefreshTokenCookieOptions', () => {
    it('should return SameSite=lax in development', () => {
      const options = service.getRefreshTokenCookieOptions();
      expect(options.sameSite).toBe('lax');
      expect(options.secure).toBe(false);
    });

    it('should return SameSite=strict in production', () => {
      jest.spyOn(configService, 'get').mockReturnValue('production');
      const options = service.getRefreshTokenCookieOptions();
      expect(options.sameSite).toBe('strict');
      expect(options.secure).toBe(true);
    });

    it('should always set httpOnly to true', () => {
      const options = service.getRefreshTokenCookieOptions();
      expect(options.httpOnly).toBe(true);
    });

    it('should set path to /api/auth', () => {
      const options = service.getRefreshTokenCookieOptions();
      expect(options.path).toBe('/api/auth');
    });

    it('should set maxAge to 7 days in milliseconds', () => {
      const options = service.getRefreshTokenCookieOptions();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(options.maxAge).toBe(sevenDaysMs);
    });
  });

  describe('getClearCookieOptions', () => {
    it('should return SameSite=lax in development', () => {
      const options = service.getClearCookieOptions();
      expect(options.sameSite).toBe('lax');
      expect(options.secure).toBe(false);
    });

    it('should return SameSite=strict in production', () => {
      jest.spyOn(configService, 'get').mockReturnValue('production');
      const options = service.getClearCookieOptions();
      expect(options.sameSite).toBe('strict');
      expect(options.secure).toBe(true);
    });

    it('should always set httpOnly to true', () => {
      const options = service.getClearCookieOptions();
      expect(options.httpOnly).toBe(true);
    });

    it('should set path to /api/auth', () => {
      const options = service.getClearCookieOptions();
      expect(options.path).toBe('/api/auth');
    });

    it('should not include maxAge property', () => {
      const options = service.getClearCookieOptions();
      expect(options).not.toHaveProperty('maxAge');
    });
  });
});
