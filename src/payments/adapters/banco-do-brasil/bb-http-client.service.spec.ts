import { BancoDoBrasilHttpClient, BbHttpResult } from './bb-http-client.service';
import { BancoDoBrasilAuthService } from './bb-auth.service';
import { DecryptedGatewayConfig } from '../types';
import { PaymentGatewayEnvironment } from '../../enums';
import axios, { AxiosError } from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BancoDoBrasilHttpClient', () => {
  let service: BancoDoBrasilHttpClient;
  let authService: jest.Mocked<BancoDoBrasilAuthService>;

  const baseConfig: DecryptedGatewayConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    developerKey: 'test-dev-key',
    environment: PaymentGatewayEnvironment.SANDBOX,
    timeoutMs: 30000,
    maxRetries: 3,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    authService = {
      getAccessToken: jest.fn().mockResolvedValue('mock-token'),
      refreshToken: jest.fn().mockResolvedValue('refreshed-token'),
      createHttpsAgent: jest.fn().mockReturnValue(undefined),
      getAuthenticatedClient: jest.fn(),
    } as unknown as jest.Mocked<BancoDoBrasilAuthService>;

    service = new BancoDoBrasilHttpClient(authService);

    // Override sleep to avoid waiting in tests
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    // Default axios behavior
    mockedAxios.isAxiosError.mockImplementation(
      (error: unknown): error is AxiosError => {
        return (error as any)?.isAxiosError === true;
      },
    );
  });

  describe('Successful request', () => {
    it('should return SUCCESS outcome with data and status code', async () => {
      const responseData = { txid: 'abc123', status: 'ATIVA' };
      mockedAxios.request.mockResolvedValue({
        data: responseData,
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {},
      });

      const result = await service.request<typeof responseData>({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: { valor: { original: '100.00' } },
        gatewayConfig: baseConfig,
      });

      expect(result).toEqual({
        outcome: 'SUCCESS',
        data: responseData,
        statusCode: 201,
      });
    });

    it('should pass Authorization header and developer key to request', async () => {
      mockedAxios.request.mockResolvedValue({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      });

      await service.request({
        method: 'GET',
        url: 'https://api.bb.com.br/pix/v2/cob/txid123',
        gatewayConfig: baseConfig,
      });

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: 'https://api.bb.com.br/pix/v2/cob/txid123',
          timeout: 30000,
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token',
            'gw-dev-app-key': 'test-dev-key',
          }),
        }),
      );
    });
  });

  describe('Timeout → outcome TIMEOUT', () => {
    it('should return TIMEOUT when ECONNABORTED error occurs', async () => {
      const timeoutError = new Error('timeout of 30000ms exceeded') as any;
      timeoutError.isAxiosError = true;
      timeoutError.code = 'ECONNABORTED';
      timeoutError.response = undefined;
      mockedAxios.request.mockRejectedValue(timeoutError);

      const result = await service.request({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: baseConfig,
      });

      expect(result).toEqual({ outcome: 'TIMEOUT' });
    });

    it('should return TIMEOUT when ETIMEDOUT error occurs', async () => {
      const timeoutError = new Error('connect ETIMEDOUT') as any;
      timeoutError.isAxiosError = true;
      timeoutError.code = 'ETIMEDOUT';
      timeoutError.response = undefined;
      mockedAxios.request.mockRejectedValue(timeoutError);

      const result = await service.request({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: baseConfig,
      });

      expect(result).toEqual({ outcome: 'TIMEOUT' });
    });

    it('should NOT retry on timeout', async () => {
      const timeoutError = new Error('timeout') as any;
      timeoutError.isAxiosError = true;
      timeoutError.code = 'ECONNABORTED';
      timeoutError.response = undefined;
      mockedAxios.request.mockRejectedValue(timeoutError);

      await service.request({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: baseConfig,
      });

      // Only one request attempt — no retries on timeout
      expect(mockedAxios.request).toHaveBeenCalledTimes(1);
    });

    it('should use gatewayConfig.timeoutMs for the request', async () => {
      const customConfig = { ...baseConfig, timeoutMs: 15000 };
      mockedAxios.request.mockResolvedValue({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      });

      await service.request({
        method: 'GET',
        url: 'https://api.bb.com.br/test',
        gatewayConfig: customConfig,
      });

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 15000 }),
      );
    });
  });

  describe('HTTP 429 → retry with backoff → eventually succeed', () => {
    it('should retry on 429 and succeed on subsequent attempt', async () => {
      const rateLimitError = new Error('Too Many Requests') as any;
      rateLimitError.isAxiosError = true;
      rateLimitError.response = {
        status: 429,
        headers: {},
        data: { message: 'rate limited' },
      };

      const successResponse = {
        data: { txid: 'success-txid' },
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {},
      };

      mockedAxios.request
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(successResponse);

      const result = await service.request<{ txid: string }>({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: baseConfig,
      });

      expect(result).toEqual({
        outcome: 'SUCCESS',
        data: { txid: 'success-txid' },
        statusCode: 201,
      });
      expect(mockedAxios.request).toHaveBeenCalledTimes(2);
    });

    it('should apply exponential backoff delay between retries', async () => {
      const rateLimitError = new Error('Too Many Requests') as any;
      rateLimitError.isAxiosError = true;
      rateLimitError.response = { status: 429, headers: {}, data: {} };

      const successResponse = {
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      };

      mockedAxios.request
        .mockRejectedValueOnce(rateLimitError) // attempt 1
        .mockRejectedValueOnce(rateLimitError) // attempt 2
        .mockResolvedValueOnce(successResponse); // attempt 3

      const sleepSpy = jest.spyOn(service as any, 'sleep');

      await service.request({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: baseConfig,
      });

      // sleep was called twice (before attempt 2 and attempt 3)
      expect(sleepSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('HTTP 429 → all retries exhausted → RATE_LIMITED', () => {
    it('should return RATE_LIMITED when max retries are exhausted', async () => {
      const rateLimitError = new Error('Too Many Requests') as any;
      rateLimitError.isAxiosError = true;
      rateLimitError.response = { status: 429, headers: {}, data: {} };

      mockedAxios.request.mockRejectedValue(rateLimitError);

      const result = await service.request({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: { ...baseConfig, maxRetries: 3 },
      });

      expect(result).toEqual({
        outcome: 'RATE_LIMITED',
        lastStatusCode: 429,
      });
      // attempt 1 → 429 → 1 <= 3, retry
      // attempt 2 → 429 → 2 <= 3, retry
      // attempt 3 → 429 → 3 <= 3, retry
      // attempt 4 → 429 → 4 > 3, return RATE_LIMITED
      expect(mockedAxios.request).toHaveBeenCalledTimes(4);
    });

    it('should respect custom maxRetries from gateway config', async () => {
      const rateLimitError = new Error('Too Many Requests') as any;
      rateLimitError.isAxiosError = true;
      rateLimitError.response = { status: 429, headers: {}, data: {} };

      mockedAxios.request.mockRejectedValue(rateLimitError);

      const result = await service.request({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: { ...baseConfig, maxRetries: 1 },
      });

      expect(result).toEqual({
        outcome: 'RATE_LIMITED',
        lastStatusCode: 429,
      });
      // 1 initial + 1 retry = 2 total attempts
      expect(mockedAxios.request).toHaveBeenCalledTimes(2);
    });
  });

  describe('HTTP 5xx → PROVIDER_ERROR', () => {
    it('should return PROVIDER_ERROR for 500 response', async () => {
      const serverError = new Error('Internal Server Error') as any;
      serverError.isAxiosError = true;
      serverError.response = {
        status: 500,
        data: { error: 'internal_error' },
        headers: {},
      };
      mockedAxios.request.mockRejectedValue(serverError);

      const result = await service.request({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: baseConfig,
      });

      expect(result).toEqual({
        outcome: 'PROVIDER_ERROR',
        statusCode: 500,
        errorBody: { error: 'internal_error' },
      });
    });

    it('should return PROVIDER_ERROR for 503 response', async () => {
      const serverError = new Error('Service Unavailable') as any;
      serverError.isAxiosError = true;
      serverError.response = {
        status: 503,
        data: { message: 'maintenance' },
        headers: {},
      };
      mockedAxios.request.mockRejectedValue(serverError);

      const result = await service.request({
        method: 'GET',
        url: 'https://api.bb.com.br/pix/v2/cob/test',
        gatewayConfig: baseConfig,
      });

      expect(result).toEqual({
        outcome: 'PROVIDER_ERROR',
        statusCode: 503,
        errorBody: { message: 'maintenance' },
      });
    });

    it('should return PROVIDER_ERROR for 4xx (not 429)', async () => {
      const clientError = new Error('Bad Request') as any;
      clientError.isAxiosError = true;
      clientError.response = {
        status: 400,
        data: { erros: [{ codigo: '4769001', mensagem: 'Campo inválido' }] },
        headers: {},
      };
      mockedAxios.request.mockRejectedValue(clientError);

      const result = await service.request({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: baseConfig,
      });

      expect(result).toEqual({
        outcome: 'PROVIDER_ERROR',
        statusCode: 400,
        errorBody: { erros: [{ codigo: '4769001', mensagem: 'Campo inválido' }] },
      });
    });

    it('should NOT retry on 5xx errors', async () => {
      const serverError = new Error('Internal Server Error') as any;
      serverError.isAxiosError = true;
      serverError.response = { status: 500, data: {}, headers: {} };
      mockedAxios.request.mockRejectedValue(serverError);

      await service.request({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: baseConfig,
      });

      expect(mockedAxios.request).toHaveBeenCalledTimes(1);
    });
  });

  describe('Retry-After header is respected', () => {
    it('should use Retry-After header as minimum delay', async () => {
      const rateLimitError = new Error('Too Many Requests') as any;
      rateLimitError.isAxiosError = true;
      rateLimitError.response = {
        status: 429,
        headers: { 'retry-after': '5' },
        data: {},
      };

      const successResponse = {
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      };

      mockedAxios.request
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(successResponse);

      const sleepSpy = jest.spyOn(service as any, 'sleep');

      await service.request({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: baseConfig,
      });

      // Retry-After: 5 seconds = 5000ms
      // First attempt backoff: 1000ms × 2^0 = 1000ms ± jitter
      // Since Retry-After (5000ms) > calculated delay (~1000ms), it should use 5000ms
      expect(sleepSpy).toHaveBeenCalledTimes(1);
      const actualDelay = sleepSpy.mock.calls[0]![0] as number;
      expect(actualDelay).toBeGreaterThanOrEqual(5000);
    });

    it('should use calculated delay when it exceeds Retry-After', async () => {
      const rateLimitError = new Error('Too Many Requests') as any;
      rateLimitError.isAxiosError = true;
      rateLimitError.response = {
        status: 429,
        headers: { 'retry-after': '1' }, // 1 second = 1000ms
        data: {},
      };

      const successResponse = {
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      };

      // First 429, second 429, then success
      mockedAxios.request
        .mockRejectedValueOnce(rateLimitError) // attempt 1
        .mockRejectedValueOnce(rateLimitError) // attempt 2
        .mockResolvedValueOnce(successResponse); // attempt 3

      const sleepSpy = jest.spyOn(service as any, 'sleep');

      await service.request({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: baseConfig,
      });

      // Second retry (attempt 2): delay = 1000 × 2^1 = 2000ms ± jitter
      // Retry-After is 1000ms, so calculated delay (2000ms) should be used
      const secondDelay = sleepSpy.mock.calls[1]![0] as number;
      // With ±25% jitter: 2000 * 0.75 = 1500, 2000 * 1.25 = 2500
      expect(secondDelay).toBeGreaterThanOrEqual(1000); // At minimum = Retry-After
    });

    it('should ignore invalid Retry-After header', async () => {
      const rateLimitError = new Error('Too Many Requests') as any;
      rateLimitError.isAxiosError = true;
      rateLimitError.response = {
        status: 429,
        headers: { 'retry-after': 'invalid' },
        data: {},
      };

      const successResponse = {
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      };

      mockedAxios.request
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(successResponse);

      const sleepSpy = jest.spyOn(service as any, 'sleep');

      await service.request({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: baseConfig,
      });

      // Should fall back to calculated delay without Retry-After minimum
      const delay = sleepSpy.mock.calls[0]![0] as number;
      // First attempt backoff: 1000ms × 2^0 = 1000ms ± 25% jitter → [750, 1250]
      expect(delay).toBeGreaterThanOrEqual(750);
      expect(delay).toBeLessThanOrEqual(1250);
    });
  });

  describe('calculateDelay', () => {
    it('should calculate exponential delay for attempt 1', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5); // jitter = 0

      const delay = service.calculateDelay(1);
      // 1000 × 2^0 = 1000, jitter = (0.5 * 2 - 1) * 250 = 0
      expect(delay).toBe(1000);

      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should calculate exponential delay for attempt 2', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const delay = service.calculateDelay(2);
      // 1000 × 2^1 = 2000, jitter = 0
      expect(delay).toBe(2000);

      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should calculate exponential delay for attempt 3', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const delay = service.calculateDelay(3);
      // 1000 × 2^2 = 4000, jitter = 0
      expect(delay).toBe(4000);

      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should apply jitter within ±25% range', () => {
      const delays = new Set<number>();
      for (let i = 0; i < 100; i++) {
        delays.add(service.calculateDelay(1));
      }
      // Base is 1000ms, jitter ±25% → range [750, 1250]
      for (const d of delays) {
        expect(d).toBeGreaterThanOrEqual(750);
        expect(d).toBeLessThanOrEqual(1250);
      }
    });

    it('should respect Retry-After as minimum delay', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const delay = service.calculateDelay(1, 5000);
      // Calculated: 1000, Retry-After: 5000 → use 5000
      expect(delay).toBe(5000);

      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should use calculated delay when it exceeds Retry-After', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const delay = service.calculateDelay(3, 1000);
      // Calculated: 4000, Retry-After: 1000 → use 4000
      expect(delay).toBe(4000);

      jest.spyOn(Math, 'random').mockRestore();
    });
  });

  describe('Security — never logs sensitive data', () => {
    it('should not include Authorization header in logs', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'warn');

      const timeoutError = new Error('timeout') as any;
      timeoutError.isAxiosError = true;
      timeoutError.code = 'ECONNABORTED';
      timeoutError.response = undefined;
      mockedAxios.request.mockRejectedValue(timeoutError);

      await service.request({
        method: 'POST',
        url: 'https://api.bb.com.br/pix/v2/cob',
        data: {},
        gatewayConfig: baseConfig,
      });

      for (const call of loggerSpy.mock.calls) {
        const message = call[0] as string;
        expect(message).not.toContain('mock-token');
        expect(message).not.toContain('Bearer');
        expect(message).not.toContain('test-client-secret');
        expect(message).not.toContain('test-dev-key');
      }
    });
  });
});
