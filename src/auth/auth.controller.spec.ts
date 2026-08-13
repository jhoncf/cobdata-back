import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, GoneException, UnprocessableEntityException, ConflictException, NotFoundException, HttpStatus } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RateLimitService } from './services/rate-limit.service';
import { TokenService, REFRESH_TOKEN_COOKIE_NAME } from './services/token.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;
  let rateLimitService: RateLimitService;
  let tokenService: TokenService;

  const mockRequest = {
    headers: { 'user-agent': 'Mozilla/5.0' },
    socket: { remoteAddress: '127.0.0.1' },
  } as any;

  const mockResponse = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn(),
            refresh: jest.fn(),
            logout: jest.fn(),
            changePassword: jest.fn(),
            forgotPassword: jest.fn(),
            resetPassword: jest.fn(),
            getMe: jest.fn(),
            getSessions: jest.fn(),
            revokeSession: jest.fn(),
            revokeAllSessions: jest.fn(),
          },
        },
        {
          provide: RateLimitService,
          useValue: {
            isBlocked: jest.fn(),
            checkAndIncrement: jest.fn(),
            reset: jest.fn(),
          },
        },
        {
          provide: TokenService,
          useValue: {
            getRefreshTokenCookieOptions: jest.fn().mockReturnValue({
              httpOnly: true,
              secure: false,
              sameSite: 'lax',
              path: '/api/auth',
              maxAge: 604800000,
            }),
            getClearCookieOptions: jest.fn().mockReturnValue({
              httpOnly: true,
              secure: false,
              sameSite: 'lax',
              path: '/api/auth',
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
    rateLimitService = module.get<RateLimitService>(RateLimitService);
    tokenService = module.get<TokenService>(TokenService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    const loginDto = { email: 'user@example.com', password: 'ValidPass1' };

    it('should return accessToken on successful login', async () => {
      (rateLimitService.isBlocked as jest.Mock).mockResolvedValue({ blocked: false });
      (authService.login as jest.Mock).mockResolvedValue({
        accessToken: 'jwt-access-token',
        refreshToken: 'refresh-token-value',
      });

      const result = await controller.login(loginDto, mockRequest, mockResponse);

      expect(result).toEqual({ accessToken: 'jwt-access-token' });
    });

    it('should set refresh token cookie on successful login', async () => {
      (rateLimitService.isBlocked as jest.Mock).mockResolvedValue({ blocked: false });
      (authService.login as jest.Mock).mockResolvedValue({
        accessToken: 'jwt-access-token',
        refreshToken: 'refresh-token-value',
      });

      await controller.login(loginDto, mockRequest, mockResponse);

      expect(mockResponse.cookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE_NAME,
        'refresh-token-value',
        expect.objectContaining({
          httpOnly: true,
          path: '/api/auth',
        }),
      );
    });

    it('should reset rate limit counter on successful login', async () => {
      (rateLimitService.isBlocked as jest.Mock).mockResolvedValue({ blocked: false });
      (authService.login as jest.Mock).mockResolvedValue({
        accessToken: 'jwt-access-token',
        refreshToken: 'refresh-token-value',
      });

      await controller.login(loginDto, mockRequest, mockResponse);

      expect(rateLimitService.reset).toHaveBeenCalledWith('user@example.com');
    });

    it('should return 429 when email is already blocked', async () => {
      (rateLimitService.isBlocked as jest.Mock).mockResolvedValue({
        blocked: true,
        retryAfterSeconds: 600,
      });

      await controller.login(loginDto, mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 429,
          retryAfterSeconds: 600,
        }),
      );
      expect(authService.login).not.toHaveBeenCalled();
    });

    it('should increment rate limit on failed login', async () => {
      (rateLimitService.isBlocked as jest.Mock).mockResolvedValue({ blocked: false });
      (rateLimitService.checkAndIncrement as jest.Mock).mockResolvedValue({
        blocked: false,
      });
      (authService.login as jest.Mock).mockRejectedValue(
        new UnauthorizedException('Invalid email or password'),
      );

      await expect(
        controller.login(loginDto, mockRequest, mockResponse),
      ).rejects.toThrow(UnauthorizedException);

      expect(rateLimitService.checkAndIncrement).toHaveBeenCalledWith(
        'user@example.com',
      );
    });

    it('should return 429 when failed attempt triggers rate limit', async () => {
      (rateLimitService.isBlocked as jest.Mock).mockResolvedValue({ blocked: false });
      (rateLimitService.checkAndIncrement as jest.Mock).mockResolvedValue({
        blocked: true,
        retryAfterSeconds: 900,
      });
      (authService.login as jest.Mock).mockRejectedValue(
        new UnauthorizedException('Invalid email or password'),
      );

      await controller.login(loginDto, mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 429,
          retryAfterSeconds: 900,
        }),
      );
    });

    it('should extract IP address from x-forwarded-for header', async () => {
      const reqWithForwarded = {
        ...mockRequest,
        headers: {
          ...mockRequest.headers,
          'x-forwarded-for': '203.0.113.50, 70.41.3.18',
        },
      };
      (rateLimitService.isBlocked as jest.Mock).mockResolvedValue({ blocked: false });
      (authService.login as jest.Mock).mockResolvedValue({
        accessToken: 'token',
        refreshToken: 'refresh',
      });

      await controller.login(loginDto, reqWithForwarded, mockResponse);

      expect(authService.login).toHaveBeenCalledWith(
        loginDto,
        'Mozilla/5.0',
        '203.0.113.50',
      );
    });

    it('should re-throw non-UnauthorizedException errors', async () => {
      (rateLimitService.isBlocked as jest.Mock).mockResolvedValue({ blocked: false });
      (authService.login as jest.Mock).mockRejectedValue(
        new Error('Internal server error'),
      );

      await expect(
        controller.login(loginDto, mockRequest, mockResponse),
      ).rejects.toThrow('Internal server error');

      expect(rateLimitService.checkAndIncrement).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('should return new accessToken on valid refresh token', async () => {
      const reqWithCookie = {
        cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'valid-refresh-token' },
      } as any;

      (authService.refresh as jest.Mock).mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      const result = await controller.refresh(reqWithCookie, mockResponse);

      expect(result).toEqual({ accessToken: 'new-access-token' });
    });

    it('should set new refresh token cookie on successful refresh', async () => {
      const reqWithCookie = {
        cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'valid-refresh-token' },
      } as any;

      (authService.refresh as jest.Mock).mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      await controller.refresh(reqWithCookie, mockResponse);

      expect(mockResponse.cookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE_NAME,
        'new-refresh-token',
        expect.objectContaining({
          httpOnly: true,
          path: '/api/auth',
        }),
      );
    });

    it('should call authService.refresh with the token from cookie', async () => {
      const reqWithCookie = {
        cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'my-refresh-token' },
      } as any;

      (authService.refresh as jest.Mock).mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      await controller.refresh(reqWithCookie, mockResponse);

      expect(authService.refresh).toHaveBeenCalledWith('my-refresh-token');
    });

    it('should throw UnauthorizedException when cookie is missing', async () => {
      const reqNoCookie = { cookies: {} } as any;

      await expect(controller.refresh(reqNoCookie, mockResponse)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when cookies object is undefined', async () => {
      const reqNoCookies = {} as any;

      await expect(controller.refresh(reqNoCookies, mockResponse)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when cookie value is empty string', async () => {
      const reqEmptyCookie = {
        cookies: { [REFRESH_TOKEN_COOKIE_NAME]: '' },
      } as any;

      await expect(controller.refresh(reqEmptyCookie, mockResponse)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('should propagate UnauthorizedException from authService.refresh', async () => {
      const reqWithCookie = {
        cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'invalid-token' },
      } as any;

      (authService.refresh as jest.Mock).mockRejectedValue(
        new UnauthorizedException('Invalid or expired refresh token'),
      );

      await expect(controller.refresh(reqWithCookie, mockResponse)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should call authService.logout with the refresh token from cookie', async () => {
      const reqWithCookie = {
        cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'my-refresh-token' },
      } as any;

      await controller.logout(reqWithCookie, mockResponse);

      expect(authService.logout).toHaveBeenCalledWith('my-refresh-token');
    });

    it('should clear the refresh token cookie', async () => {
      const reqWithCookie = {
        cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'my-refresh-token' },
      } as any;

      await controller.logout(reqWithCookie, mockResponse);

      expect(mockResponse.clearCookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE_NAME,
        expect.objectContaining({
          httpOnly: true,
          path: '/api/auth',
        }),
      );
    });

    it('should not call authService.logout when no cookie is present', async () => {
      const reqNoCookie = { cookies: {} } as any;

      await controller.logout(reqNoCookie, mockResponse);

      expect(authService.logout).not.toHaveBeenCalled();
    });

    it('should still clear the cookie when no refresh token is present', async () => {
      const reqNoCookie = { cookies: {} } as any;

      await controller.logout(reqNoCookie, mockResponse);

      expect(mockResponse.clearCookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE_NAME,
        expect.objectContaining({
          httpOnly: true,
          path: '/api/auth',
        }),
      );
    });

    it('should still clear the cookie when cookies object is undefined', async () => {
      const reqNoCookies = {} as any;

      await controller.logout(reqNoCookies, mockResponse);

      expect(authService.logout).not.toHaveBeenCalled();
      expect(mockResponse.clearCookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE_NAME,
        expect.objectContaining({
          httpOnly: true,
          path: '/api/auth',
        }),
      );
    });

    it('should return void (no response body)', async () => {
      const reqWithCookie = {
        cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'my-refresh-token' },
      } as any;

      const result = await controller.logout(reqWithCookie, mockResponse);

      expect(result).toBeUndefined();
    });
  });

  describe('resetPassword', () => {
    const resetDto = { token: 'valid-token-base64url', newPassword: 'NewSecure1' };

    it('should call authService.resetPassword and return success message', async () => {
      (authService.resetPassword as jest.Mock).mockResolvedValue(undefined);

      const result = await controller.resetPassword(resetDto);

      expect(authService.resetPassword).toHaveBeenCalledWith(resetDto);
      expect(result).toEqual({ message: 'Password reset successfully' });
    });

    it('should propagate GoneException from authService (invalid/expired token)', async () => {
      (authService.resetPassword as jest.Mock).mockRejectedValue(
        new GoneException('Reset link is no longer valid'),
      );

      await expect(controller.resetPassword(resetDto)).rejects.toThrow(GoneException);
    });

    it('should propagate UnprocessableEntityException from authService (weak password)', async () => {
      (authService.resetPassword as jest.Mock).mockRejectedValue(
        new UnprocessableEntityException('Password must be at least 8 characters long'),
      );

      await expect(controller.resetPassword(resetDto)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('getMe', () => {
    const mockAuthenticatedUser = {
      id: 'user-uuid-1',
      accountId: 'account-uuid-1',
      role: 'ADMIN' as const,
      sessionId: 'session-uuid-1',
    };

    it('should call authService.getMe with the user id', async () => {
      (authService.getMe as jest.Mock).mockResolvedValue({
        id: 'user-uuid-1',
        email: 'admin@example.com',
        role: 'ADMIN',
        scopes: [],
      });

      await controller.getMe(mockAuthenticatedUser);

      expect(authService.getMe).toHaveBeenCalledWith('user-uuid-1');
    });

    it('should return the MeResponseDto from authService', async () => {
      const expectedResponse = {
        id: 'user-uuid-1',
        email: 'admin@example.com',
        role: 'ADMIN',
        scopes: [],
      };
      (authService.getMe as jest.Mock).mockResolvedValue(expectedResponse);

      const result = await controller.getMe(mockAuthenticatedUser);

      expect(result).toEqual(expectedResponse);
    });

    it('should propagate UnauthorizedException from authService.getMe', async () => {
      (authService.getMe as jest.Mock).mockRejectedValue(
        new UnauthorizedException(),
      );

      await expect(controller.getMe(mockAuthenticatedUser)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getSessions', () => {
    const mockAuthenticatedUser = {
      id: 'user-uuid-1',
      accountId: 'account-uuid-1',
      role: 'ADMIN' as const,
      sessionId: 'session-uuid-1',
    };

    it('should call authService.getSessions with userId and sessionId', async () => {
      (authService.getSessions as jest.Mock).mockResolvedValue([]);

      await controller.getSessions(mockAuthenticatedUser);

      expect(authService.getSessions).toHaveBeenCalledWith('user-uuid-1', 'session-uuid-1');
    });

    it('should return sessions list from authService', async () => {
      const mockSessions = [
        {
          id: 'session-uuid-1',
          userAgent: 'Mozilla/5.0',
          ipAddress: '127.0.0.1',
          createdAt: new Date('2024-01-01'),
          isCurrent: true,
        },
        {
          id: 'session-uuid-2',
          userAgent: 'Chrome/120',
          ipAddress: '10.0.0.1',
          createdAt: new Date('2024-01-02'),
          isCurrent: false,
        },
      ];
      (authService.getSessions as jest.Mock).mockResolvedValue(mockSessions);

      const result = await controller.getSessions(mockAuthenticatedUser);

      expect(result).toEqual(mockSessions);
      expect(result).toHaveLength(2);
    });
  });

  describe('revokeSession', () => {
    const mockAuthenticatedUser = {
      id: 'user-uuid-1',
      accountId: 'account-uuid-1',
      role: 'ADMIN' as const,
      sessionId: 'current-session-id',
    };

    it('should call authService.revokeSession with correct parameters', async () => {
      (authService.revokeSession as jest.Mock).mockResolvedValue(undefined);

      await controller.revokeSession('other-session-id', mockAuthenticatedUser);

      expect(authService.revokeSession).toHaveBeenCalledWith(
        'user-uuid-1',
        'other-session-id',
        'current-session-id',
      );
    });

    it('should return void on successful revocation', async () => {
      (authService.revokeSession as jest.Mock).mockResolvedValue(undefined);

      const result = await controller.revokeSession('other-session-id', mockAuthenticatedUser);

      expect(result).toBeUndefined();
    });

    it('should propagate ConflictException when revoking current session', async () => {
      (authService.revokeSession as jest.Mock).mockRejectedValue(
        new ConflictException('Cannot revoke current session. Use POST /auth/logout instead.'),
      );

      await expect(
        controller.revokeSession('current-session-id', mockAuthenticatedUser),
      ).rejects.toThrow(ConflictException);
    });

    it('should propagate NotFoundException when session not found', async () => {
      (authService.revokeSession as jest.Mock).mockRejectedValue(
        new NotFoundException('Session not found'),
      );

      await expect(
        controller.revokeSession('nonexistent-id', mockAuthenticatedUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('revokeAllSessions', () => {
    const mockAuthenticatedUser = {
      id: 'user-uuid-1',
      accountId: 'account-uuid-1',
      role: 'ADMIN' as const,
      sessionId: 'current-session-id',
    };

    it('should call authService.revokeAllSessions with userId and sessionId', async () => {
      (authService.revokeAllSessions as jest.Mock).mockResolvedValue(undefined);

      await controller.revokeAllSessions(mockAuthenticatedUser);

      expect(authService.revokeAllSessions).toHaveBeenCalledWith(
        'user-uuid-1',
        'current-session-id',
      );
    });

    it('should return void on successful revocation', async () => {
      (authService.revokeAllSessions as jest.Mock).mockResolvedValue(undefined);

      const result = await controller.revokeAllSessions(mockAuthenticatedUser);

      expect(result).toBeUndefined();
    });
  });
});
