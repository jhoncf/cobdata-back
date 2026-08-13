import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

// Mock ioredis — default export is a class
const mockPing = jest.fn().mockResolvedValue('PONG');
jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      ping: mockPing,
      disconnect: jest.fn(),
      quit: jest.fn(),
      status: 'ready',
    })),
  };
});

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    mockPing.mockResolvedValue('PONG');

    const mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          npm_package_version: '0.1.0',
          REDIS_HOST: 'localhost',
          REDIS_PORT: 6379,
          REDIS_PASSWORD: '',
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('live', () => {
    it('should return service info with uptime', () => {
      const result = controller.live();

      expect(result).toEqual({
        service: 'cobdata-api',
        version: '0.1.0',
        uptime: expect.any(Number),
      });
    });

    it('should have uptime >= 0', () => {
      const result = controller.live();
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should return fixed service name', () => {
      const result = controller.live();
      expect(result.service).toBe('cobdata-api');
    });
  });

  describe('ready', () => {
    it('should return 200 status when all dependencies are up', async () => {
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await controller.ready(mockRes as any);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          dependencies: expect.objectContaining({
            postgresql: expect.objectContaining({ status: 'up' }),
            redis: expect.objectContaining({ status: 'up' }),
            bullmq: expect.objectContaining({ status: 'up' }),
          }),
        }),
      );
    });

    it('should return 503 when PostgreSQL is down', async () => {
      // Override prisma to fail
      const failingPrisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error('Connection refused')),
      };
      const mockConfigService = {
        get: jest.fn().mockReturnValue('localhost'),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [
          { provide: PrismaService, useValue: failingPrisma },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const ctrl = module.get<HealthController>(HealthController);
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await ctrl.ready(mockRes as any);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'degraded',
          dependencies: expect.objectContaining({
            postgresql: expect.objectContaining({ status: 'down' }),
          }),
        }),
      );
    });
  });
});
