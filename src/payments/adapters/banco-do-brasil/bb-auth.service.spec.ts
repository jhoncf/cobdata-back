import { BancoDoBrasilAuthService, PIX_API_BASE_URLS } from './bb-auth.service';
import { DecryptedGatewayConfig } from '../types';
import { PaymentGatewayEnvironment } from '../../enums';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BancoDoBrasilAuthService', () => {
  let service: BancoDoBrasilAuthService;

  const baseConfig: DecryptedGatewayConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    developerKey: 'test-dev-key',
    environment: PaymentGatewayEnvironment.SANDBOX,
    timeoutMs: 30000,
    maxRetries: 3,
  };

  const configWithCert: DecryptedGatewayConfig = {
    ...baseConfig,
    certificateBase64: Buffer.from('fake-pfx-content').toString('base64'),
    certificatePassword: 'cert-password',
  };

  const mockTokenResponse = {
    data: {
      access_token: 'mock-access-token',
      token_type: 'Bearer',
      expires_in: 600,
    },
  };

  let mockPost: jest.Mock;
  let mockAxiosInstance: { post: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BancoDoBrasilAuthService();

    mockPost = jest.fn().mockResolvedValue(mockTokenResponse);
    mockAxiosInstance = { post: mockPost };
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
    mockedAxios.isAxiosError.mockReturnValue(false);
  });

  describe('getAccessToken', () => {
    it('should request a token from the sandbox endpoint with scope and gw-dev-app-key', async () => {
      const token = await service.getAccessToken(baseConfig);

      expect(token).toBe('mock-access-token');
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 30000 }),
      );
      expect(mockPost).toHaveBeenCalledWith(
        'https://oauth.hm.bb.com.br/oauth/token',
        'grant_type=client_credentials&scope=cob.read+cob.write',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          params: { 'gw-dev-app-key': 'test-dev-key' },
          auth: { username: 'test-client-id', password: 'test-client-secret' },
        }),
      );
    });

    it('should request a token from the production endpoint', async () => {
      const prodConfig: DecryptedGatewayConfig = {
        ...baseConfig,
        environment: PaymentGatewayEnvironment.PRODUCTION,
      };

      await service.getAccessToken(prodConfig);

      expect(mockPost).toHaveBeenCalledWith(
        'https://oauth.bb.com.br/oauth/token',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('should return cached token on subsequent calls', async () => {
      const token1 = await service.getAccessToken(baseConfig);
      const token2 = await service.getAccessToken(baseConfig);

      expect(token1).toBe('mock-access-token');
      expect(token2).toBe('mock-access-token');
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it('should refresh token when expired', async () => {
      // First call with a very short expiry (already past buffer)
      mockPost.mockResolvedValueOnce({
        data: {
          access_token: 'old-token',
          token_type: 'Bearer',
          expires_in: 30, // 30s < 60s buffer, will be immediately "expired"
        },
      });

      const token1 = await service.getAccessToken(baseConfig);
      expect(token1).toBe('old-token');

      // Second call should refresh since token is within expiry buffer
      mockPost.mockResolvedValueOnce({
        data: {
          access_token: 'new-token',
          token_type: 'Bearer',
          expires_in: 600,
        },
      });

      const token2 = await service.getAccessToken(baseConfig);
      expect(token2).toBe('new-token');
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('should use different cache keys for different environments', async () => {
      const prodConfig: DecryptedGatewayConfig = {
        ...baseConfig,
        environment: PaymentGatewayEnvironment.PRODUCTION,
      };

      mockPost
        .mockResolvedValueOnce({
          data: { access_token: 'sandbox-token', token_type: 'Bearer', expires_in: 600 },
        })
        .mockResolvedValueOnce({
          data: { access_token: 'production-token', token_type: 'Bearer', expires_in: 600 },
        });

      const sandboxToken = await service.getAccessToken(baseConfig);
      const prodToken = await service.getAccessToken(prodConfig);

      expect(sandboxToken).toBe('sandbox-token');
      expect(prodToken).toBe('production-token');
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('should throw on authentication failure without exposing secrets', async () => {
      const authError = new Error('Request failed') as any;
      authError.response = { status: 401 };
      mockPost.mockRejectedValue(authError);
      mockedAxios.isAxiosError.mockReturnValue(true);

      await expect(service.getAccessToken(baseConfig)).rejects.toThrow();
    });

    it('should coalesce concurrent requests (thread-safety)', async () => {
      // Simulate a slow token request
      let resolveTokenRequest: (value: any) => void;
      const slowPromise = new Promise((resolve) => {
        resolveTokenRequest = resolve;
      });
      mockPost.mockReturnValue(slowPromise);

      // Launch multiple concurrent requests
      const promise1 = service.getAccessToken(baseConfig);
      const promise2 = service.getAccessToken(baseConfig);
      const promise3 = service.getAccessToken(baseConfig);

      // Resolve the single token request
      resolveTokenRequest!({
        data: { access_token: 'coalesced-token', token_type: 'Bearer', expires_in: 600 },
      });

      const [token1, token2, token3] = await Promise.all([promise1, promise2, promise3]);

      expect(token1).toBe('coalesced-token');
      expect(token2).toBe('coalesced-token');
      expect(token3).toBe('coalesced-token');
      // Only one actual HTTP request was made
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshToken', () => {
    it('should force a new token request bypassing cache', async () => {
      // Populate cache
      await service.getAccessToken(baseConfig);

      // Force refresh
      mockPost.mockResolvedValueOnce({
        data: { access_token: 'refreshed-token', token_type: 'Bearer', expires_in: 600 },
      });

      const token = await service.refreshToken(baseConfig);
      expect(token).toBe('refreshed-token');
      expect(mockPost).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAuthenticatedClient', () => {
    it('should return an Axios instance with correct baseURL and headers', async () => {
      const mockInstance = { defaults: {} } as any;
      mockedAxios.create
        .mockReturnValueOnce(mockAxiosInstance as any) // for token request
        .mockReturnValueOnce(mockInstance); // for the authenticated client

      await service.getAuthenticatedClient(baseConfig);

      // The second create call should be for the authenticated client
      expect(mockedAxios.create).toHaveBeenCalledTimes(2);
      const calls = mockedAxios.create.mock.calls;
      const secondCallArgs = calls[1]?.[0] as Record<string, any>;
      expect(secondCallArgs).toMatchObject({
        baseURL: 'https://api-pix.hm.bb.com.br/pix/v2',
        timeout: 30000,
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-access-token',
          'gw-dev-app-key': 'test-dev-key',
        }),
      });
    });

    it('should use production Pix API URL in production environment', async () => {
      const prodConfig: DecryptedGatewayConfig = {
        ...baseConfig,
        environment: PaymentGatewayEnvironment.PRODUCTION,
      };

      const mockInstance = { defaults: {} } as any;
      mockedAxios.create
        .mockReturnValueOnce(mockAxiosInstance as any) // for token request
        .mockReturnValueOnce(mockInstance); // for the authenticated client

      await service.getAuthenticatedClient(prodConfig);

      const calls = mockedAxios.create.mock.calls;
      const secondCallArgs = calls[1]?.[0] as Record<string, any>;
      expect(secondCallArgs).toMatchObject({
        baseURL: 'https://api-pix.bb.com.br/pix/v2',
      });
    });
  });

  describe('createHttpsAgent', () => {
    it('should return undefined when no certificate is provided', () => {
      const agent = service.createHttpsAgent(baseConfig);
      expect(agent).toBeUndefined();
    });

    it('should create an HTTPS agent when certificate is provided', () => {
      const agent = service.createHttpsAgent(configWithCert);
      expect(agent).toBeDefined();
      expect(agent).toHaveProperty('options');
    });

    it('should return undefined when only certificateBase64 is provided', () => {
      const partialConfig: DecryptedGatewayConfig = {
        ...baseConfig,
        certificateBase64: 'some-base64',
      };
      const agent = service.createHttpsAgent(partialConfig);
      expect(agent).toBeUndefined();
    });

    it('should return undefined when only certificatePassword is provided', () => {
      const partialConfig: DecryptedGatewayConfig = {
        ...baseConfig,
        certificatePassword: 'some-password',
      };
      const agent = service.createHttpsAgent(partialConfig);
      expect(agent).toBeUndefined();
    });
  });

  describe('PIX_API_BASE_URLS', () => {
    it('should have correct sandbox URL', () => {
      expect(PIX_API_BASE_URLS[PaymentGatewayEnvironment.SANDBOX]).toBe(
        'https://api-pix.hm.bb.com.br/pix/v2',
      );
    });

    it('should have correct production URL', () => {
      expect(PIX_API_BASE_URLS[PaymentGatewayEnvironment.PRODUCTION]).toBe(
        'https://api-pix.bb.com.br/pix/v2',
      );
    });
  });
});
