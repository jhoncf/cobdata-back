import { z } from 'zod';

export const envSchema = z.object({
  // App
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  // JWT
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),

  // S3/MinIO
  S3_ENDPOINT: z.string().default('localhost'),
  S3_PORT: z.coerce.number().default(9000),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_BUCKET: z.string().default('cobdata-imports'),
  S3_USE_SSL: z.string().default('false').transform(v => v === 'true'),

  // Serasa
  SERASA_API_URL: z.string().url().optional(),
  SERASA_API_KEY: z.string().optional().default(''),
  SERASA_WEBHOOK_SECRET: z.string().optional().default(''),
  SERASA_TIMEOUT: z.coerce.number().default(30000),

  // Seed
  SEED_ADMIN_EMAIL: z.string().email().default('admin@cobdata.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin@123'),
});

export type Env = z.infer<typeof envSchema>;
