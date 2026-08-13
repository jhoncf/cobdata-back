import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class PasswordResetService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(PasswordResetService.name);

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

  private getKey(hash: string): string {
    return `password-reset:${hash}`;
  }

  /**
   * Store a password reset token hash with the associated userId.
   * @param hash - SHA-256 hash of the reset token
   * @param userId - The user's ID
   * @param ttlSeconds - Time-to-live in seconds (default: 3600 = 1 hour)
   */
  async store(hash: string, userId: string, ttlSeconds = 3600): Promise<void> {
    const key = this.getKey(hash);
    await this.redis.set(key, userId, 'EX', ttlSeconds);
    this.logger.debug(`Password reset token stored for user ${userId}`);
  }

  /**
   * Retrieve the userId associated with a token hash.
   * Returns null if token is expired or not found.
   */
  async get(hash: string): Promise<string | null> {
    const key = this.getKey(hash);
    return this.redis.get(key);
  }

  /**
   * Delete a token hash (consumed after successful reset).
   */
  async delete(hash: string): Promise<void> {
    const key = this.getKey(hash);
    await this.redis.del(key);
  }
}
