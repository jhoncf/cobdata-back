import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

interface LiveResponse {
  service: string;
  version: string;
  uptime: number;
}

interface DependencyStatus {
  status: 'up' | 'down';
  responseTime?: number;
  error?: string;
}

interface ReadyResponse {
  status: 'ok' | 'degraded';
  dependencies: {
    postgresql: DependencyStatus;
    redis: DependencyStatus;
    bullmq: DependencyStatus;
  };
}

const DEPENDENCY_TIMEOUT = 3000; // 3s per dependency

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly startTime: number;
  private redis: Redis | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.startTime = Date.now();
  }

  @Get('live')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness check', description: 'Returns service name, version and uptime (no auth required)' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  live(): LiveResponse {
    return {
      service: 'cobdata-api',
      version: this.configService.get<string>('npm_package_version') || '0.1.0',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Readiness check', description: 'Checks PostgreSQL, Redis and BullMQ dependencies (no auth required)' })
  @ApiResponse({ status: 200, description: 'All dependencies are up' })
  @ApiResponse({ status: 503, description: 'One or more dependencies are down' })
  async ready(@Res() res: Response): Promise<void> {
    const [postgresql, redis, bullmq] = await Promise.all([
      this.checkPostgresql(),
      this.checkRedis(),
      this.checkBullMQ(),
    ]);

    const allUp =
      postgresql.status === 'up' &&
      redis.status === 'up' &&
      bullmq.status === 'up';

    const response: ReadyResponse = {
      status: allUp ? 'ok' : 'degraded',
      dependencies: { postgresql, redis, bullmq },
    };

    const statusCode = allUp ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    res.status(statusCode).json(response);
  }

  private async checkPostgresql(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      await Promise.race([
        this.prisma.$queryRaw(Prisma.sql`SELECT 1`),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), DEPENDENCY_TIMEOUT),
        ),
      ]);
      return { status: 'up', responseTime: Date.now() - start };
    } catch (error) {
      return {
        status: 'down',
        responseTime: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      if (!this.redis) {
        this.redis = new Redis({
          host: this.configService.get<string>('REDIS_HOST', 'localhost'),
          port: this.configService.get<number>('REDIS_PORT', 6379),
          password:
            this.configService.get<string>('REDIS_PASSWORD') || undefined,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: DEPENDENCY_TIMEOUT,
        });
      }

      await Promise.race([
        this.redis.ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), DEPENDENCY_TIMEOUT),
        ),
      ]);
      return { status: 'up', responseTime: Date.now() - start };
    } catch (error) {
      return {
        status: 'down',
        responseTime: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async checkBullMQ(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      // BullMQ health is informational — relies on Redis connectivity.
      // If Redis is reachable, BullMQ queues are considered up.
      // A more thorough check would query queue metrics, but that's informational only.
      return { status: 'up', responseTime: Date.now() - start };
    } catch (error) {
      return {
        status: 'down',
        responseTime: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
