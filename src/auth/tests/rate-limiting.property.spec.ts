/* eslint-disable @typescript-eslint/no-require-imports */
import * as fc from 'fast-check';

/**
 * Feature: cobdata-backend-mvp, Property 3: Rate Limiting Blocks After Threshold
 *
 * **Validates: Requirements 1.5, 1.6**
 *
 * For any email address, after exactly 5 consecutive failed login attempts within a
 * 15-minute window, the next login attempt SHALL return HTTP 429 with a `retryAfterSeconds`
 * value that correctly reflects the remaining blocking time.
 */

/**
 * In-memory Redis mock that simulates Redis behavior (INCR, GET, TTL, EXPIRE, DEL).
 * Keeps the test fast and deterministic without needing a real Redis instance.
 */
class InMemoryRedisMock {
  private store = new Map<string, { value: string; ttl: number; createdAt: number }>();

  connect = jest.fn().mockResolvedValue(undefined);
  quit = jest.fn().mockResolvedValue(undefined);

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async incr(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      this.store.set(key, { value: '1', ttl: -1, createdAt: Date.now() });
      return 1;
    }
    const newVal = parseInt(entry.value, 10) + 1;
    entry.value = String(newVal);
    return newVal;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.ttl = seconds;
    entry.createdAt = Date.now();
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (entry.ttl === -1) return -1;
    const elapsed = (Date.now() - entry.createdAt) / 1000;
    const remaining = Math.ceil(entry.ttl - elapsed);
    return remaining > 0 ? remaining : -2;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  clear(): void {
    this.store.clear();
  }

  private isExpired(entry: { ttl: number; createdAt: number }): boolean {
    if (entry.ttl === -1) return false;
    const elapsed = (Date.now() - entry.createdAt) / 1000;
    return elapsed >= entry.ttl;
  }
}

const redisMock = new InMemoryRedisMock();

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => redisMock),
}));

describe('Property 3: Rate Limiting Blocks After Threshold', () => {
  // Lazy-load the service after mock is in place
  let RateLimitService: any;
  let service: any;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    RateLimitService = require('../services/rate-limit.service').RateLimitService;
  });

  beforeEach(() => {
    redisMock.clear();

    const configService = {
      get: jest.fn((key: string) => {
        const config: Record<string, any> = {
          REDIS_HOST: 'localhost',
          REDIS_PORT: 6379,
          REDIS_PASSWORD: '',
        };
        return config[key];
      }),
    };

    service = new RateLimitService(configService);
  });

  afterEach(async () => {
    redisMock.clear();
    await service.onModuleDestroy();
  });

  it('should block after exactly 5 consecutive failures for any email', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        async (email) => {
          // Reset state for this email
          redisMock.clear();

          // Call checkAndIncrement 4 times — should NOT be blocked
          for (let i = 0; i < 4; i++) {
            const result = await service.checkAndIncrement(email);
            expect(result.blocked).toBe(false);
          }

          // 5th call — SHOULD become blocked (threshold = 5)
          const fifthResult = await service.checkAndIncrement(email);
          expect(fifthResult.blocked).toBe(true);
          expect(fifthResult.retryAfterSeconds).toBeDefined();
          expect(fifthResult.retryAfterSeconds).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should not block before reaching 5 failures for any email', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.integer({ min: 1, max: 4 }), // attempts < 5
        async (email, attempts) => {
          // Reset state for this email
          redisMock.clear();

          // Call checkAndIncrement `attempts` times (1 to 4)
          let lastResult: { blocked: boolean; retryAfterSeconds?: number } = { blocked: false };
          for (let i = 0; i < attempts; i++) {
            lastResult = await service.checkAndIncrement(email);
          }

          // The last result should NOT be blocked (below threshold)
          expect(lastResult.blocked).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should remain blocked after threshold is reached for any subsequent check', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.integer({ min: 1, max: 5 }), // additional checks after being blocked
        async (email, additionalChecks) => {
          // Reset state
          redisMock.clear();

          // Trigger the block (5 consecutive failures)
          for (let i = 0; i < 5; i++) {
            await service.checkAndIncrement(email);
          }

          // Subsequent isBlocked checks should all remain blocked
          for (let i = 0; i < additionalChecks; i++) {
            const result = await service.isBlocked(email);
            expect(result.blocked).toBe(true);
            expect(result.retryAfterSeconds).toBeDefined();
            expect(result.retryAfterSeconds).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return retryAfterSeconds within the 15-minute window', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        async (email) => {
          // Reset state
          redisMock.clear();

          // Trigger the block
          for (let i = 0; i < 5; i++) {
            await service.checkAndIncrement(email);
          }

          // Check blocked status
          const result = await service.isBlocked(email);
          expect(result.blocked).toBe(true);
          // retryAfterSeconds must be between 1 and 900 (15 minutes = 900 seconds)
          expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
          expect(result.retryAfterSeconds).toBeLessThanOrEqual(900);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should unblock after reset for any email', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        async (email) => {
          // Reset state
          redisMock.clear();

          // Trigger the block
          for (let i = 0; i < 5; i++) {
            await service.checkAndIncrement(email);
          }

          // Verify blocked
          const blockedResult = await service.isBlocked(email);
          expect(blockedResult.blocked).toBe(true);

          // Reset (simulates successful login resetting the counter)
          await service.reset(email);

          // Should no longer be blocked
          const afterResetResult = await service.isBlocked(email);
          expect(afterResetResult.blocked).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
