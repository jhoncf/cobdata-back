import { ConfigService } from '@nestjs/config';
import { PasswordResetService } from './password-reset.service';

// Mock ioredis
const mockRedis = {
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
};

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockRedis),
  };
});

describe('PasswordResetService', () => {
  let service: PasswordResetService;
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

    service = new PasswordResetService(configService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('store', () => {
    it('should store hash with userId and TTL', async () => {
      await service.store('abc123hash', 'user-uuid-1', 3600);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'password-reset:abc123hash',
        'user-uuid-1',
        'EX',
        3600,
      );
    });

    it('should use default TTL of 3600 when not specified', async () => {
      await service.store('abc123hash', 'user-uuid-1');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'password-reset:abc123hash',
        'user-uuid-1',
        'EX',
        3600,
      );
    });
  });

  describe('get', () => {
    it('should return userId when token exists', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');

      const result = await service.get('abc123hash');

      expect(result).toBe('user-uuid-1');
      expect(mockRedis.get).toHaveBeenCalledWith('password-reset:abc123hash');
    });

    it('should return null when token does not exist', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.get('nonexistent-hash');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete the token key', async () => {
      await service.delete('abc123hash');

      expect(mockRedis.del).toHaveBeenCalledWith('password-reset:abc123hash');
    });
  });

  describe('onModuleDestroy', () => {
    it('should close the Redis connection', async () => {
      await service.onModuleDestroy();

      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});
