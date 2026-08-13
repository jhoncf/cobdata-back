import { ConfigService } from '@nestjs/config';
import { RateLimitService, RateLimitResult } from './rate-limit.service';

// Mock ioredis
const mockRedis = {
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue(undefined),
  get: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  del: jest.fn(),
};

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockRedis),
  };
});

describe('RateLimitService', () => {
  let service: RateLimitService;
  let configService: ConfigService;

  beforeEach(async () => {
    jest.clearAllMocks();

    configService = {
      get: jest.fn((key: string) => {
        const config: Record<string, any> = {
          REDIS_HOST: 'localhost',
          REDIS_PORT: 6379,
          REDIS_PASSWORD: '',
        };
        return config[key];
      }),
    } as any;

    service = new RateLimitService(configService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('isBlocked', () => {
    it('should return blocked: false when no attempts exist', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.isBlocked('test@example.com');
      expect(result.blocked).toBe(false);
    });

    it('should return blocked: false when attempts are below threshold', async () => {
      mockRedis.get.mockResolvedValue('3');

      const result = await service.isBlocked('test@example.com');
      expect(result.blocked).toBe(false);
    });

    it('should return blocked: true when attempts reach threshold', async () => {
      mockRedis.get.mockResolvedValue('5');
      mockRedis.ttl.mockResolvedValue(600);

      const result = await service.isBlocked('test@example.com');
      expect(result.blocked).toBe(true);
      expect(result.retryAfterSeconds).toBe(600);
    });

    it('should return blocked: true when attempts exceed threshold', async () => {
      mockRedis.get.mockResolvedValue('7');
      mockRedis.ttl.mockResolvedValue(300);

      const result = await service.isBlocked('test@example.com');
      expect(result.blocked).toBe(true);
      expect(result.retryAfterSeconds).toBe(300);
    });

    it('should normalize email to lowercase for the key', async () => {
      mockRedis.get.mockResolvedValue(null);

      await service.isBlocked('Test@Example.COM');
      expect(mockRedis.get).toHaveBeenCalledWith('login:attempts:test@example.com');
    });
  });

  describe('checkAndIncrement', () => {
    it('should increment counter and return blocked: false when below threshold', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(1);

      const result = await service.checkAndIncrement('test@example.com');
      expect(result.blocked).toBe(false);
      expect(mockRedis.incr).toHaveBeenCalledWith('login:attempts:test@example.com');
    });

    it('should set TTL on first attempt', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.incr.mockResolvedValue(1);

      await service.checkAndIncrement('test@example.com');
      expect(mockRedis.expire).toHaveBeenCalledWith(
        'login:attempts:test@example.com',
        900,
      );
    });

    it('should not set TTL on subsequent attempts', async () => {
      mockRedis.get.mockResolvedValue('2');
      mockRedis.incr.mockResolvedValue(3);

      await service.checkAndIncrement('test@example.com');
      expect(mockRedis.expire).not.toHaveBeenCalled();
    });

    it('should return blocked: true when increment reaches threshold', async () => {
      mockRedis.get.mockResolvedValue('4');
      mockRedis.incr.mockResolvedValue(5);
      mockRedis.ttl.mockResolvedValue(800);

      const result = await service.checkAndIncrement('test@example.com');
      expect(result.blocked).toBe(true);
      expect(result.retryAfterSeconds).toBe(800);
    });

    it('should return blocked: true immediately if already at threshold', async () => {
      mockRedis.get.mockResolvedValue('5');
      mockRedis.ttl.mockResolvedValue(500);

      const result = await service.checkAndIncrement('test@example.com');
      expect(result.blocked).toBe(true);
      expect(result.retryAfterSeconds).toBe(500);
      expect(mockRedis.incr).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should delete the rate limit key', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.reset('test@example.com');
      expect(mockRedis.del).toHaveBeenCalledWith('login:attempts:test@example.com');
    });

    it('should normalize email to lowercase', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.reset('Test@EXAMPLE.com');
      expect(mockRedis.del).toHaveBeenCalledWith('login:attempts:test@example.com');
    });
  });
});
