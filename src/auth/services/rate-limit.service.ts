import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface RateLimitResult {
  blocked: boolean;
  retryAfterSeconds?: number;
}

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly MAX_ATTEMPTS = 5;
  private readonly WINDOW_SECONDS = 900; // 15 minutes

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT'),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
    });
    this.redis.connect().catch(() => {
      // Connection will be retried automatically by ioredis
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  private getKey(email: string): string {
    return `login:attempts:${email.toLowerCase()}`;
  }

  /**
   * Check if the email is rate-limited and increment the counter on failure.
   * Returns { blocked: true, retryAfterSeconds } if the limit has been reached.
   */
  async checkAndIncrement(email: string): Promise<RateLimitResult> {
    const key = this.getKey(email);

    const currentAttempts = await this.redis.get(key);
    const attempts = currentAttempts ? parseInt(currentAttempts, 10) : 0;

    if (attempts >= this.MAX_ATTEMPTS) {
      const ttl = await this.redis.ttl(key);
      return { blocked: true, retryAfterSeconds: ttl > 0 ? ttl : this.WINDOW_SECONDS };
    }

    // Increment the counter
    const newCount = await this.redis.incr(key);

    // Set TTL only on first attempt (when counter goes from 0 to 1)
    if (newCount === 1) {
      await this.redis.expire(key, this.WINDOW_SECONDS);
    }

    // Check if this increment pushed us over the limit
    if (newCount >= this.MAX_ATTEMPTS) {
      const ttl = await this.redis.ttl(key);
      return { blocked: true, retryAfterSeconds: ttl > 0 ? ttl : this.WINDOW_SECONDS };
    }

    return { blocked: false };
  }

  /**
   * Check if the email is currently rate-limited WITHOUT incrementing.
   */
  async isBlocked(email: string): Promise<RateLimitResult> {
    const key = this.getKey(email);
    const currentAttempts = await this.redis.get(key);
    const attempts = currentAttempts ? parseInt(currentAttempts, 10) : 0;

    if (attempts >= this.MAX_ATTEMPTS) {
      const ttl = await this.redis.ttl(key);
      return { blocked: true, retryAfterSeconds: ttl > 0 ? ttl : this.WINDOW_SECONDS };
    }

    return { blocked: false };
  }

  /**
   * Reset the rate limit counter for an email (called on successful login).
   */
  async reset(email: string): Promise<void> {
    const key = this.getKey(email);
    await this.redis.del(key);
  }
}
