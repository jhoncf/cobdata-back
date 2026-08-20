import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import Redis from 'ioredis';

@Injectable()
export class PublicDebtRateLimitService {
  private readonly redis: Redis;
  private readonly windowSeconds = 15 * 60;
  private readonly maxLookups = 10;
  private readonly maxPixRequests = 5;

  constructor(config: ConfigService) {
    this.redis = new Redis({
      host: config.get<string>('REDIS_HOST'),
      port: config.get<number>('REDIS_PORT'),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
    });
    this.redis.connect().catch(() => undefined);
  }

  async consume(action: 'lookup' | 'pix', ip: string, document: string): Promise<void> {
    const keyPart = createHash('sha256').update(`${ip}:${document.replace(/\D/g, '')}`).digest('hex');
    const key = `public-debts:${action}:${keyPart}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, this.windowSeconds);
    const max = action === 'lookup' ? this.maxLookups : this.maxPixRequests;
    if (count > max) {
      const retryAfterSeconds = Math.max(await this.redis.ttl(key), 1);
      throw new HttpException({
        message: 'Muitas tentativas. Aguarde alguns minutos para consultar novamente.',
        retryAfterSeconds,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
