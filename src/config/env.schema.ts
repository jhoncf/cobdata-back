import { z } from 'zod';

export const envSchema = z.object({
  // App
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  // Email - Amazon SES
  SES_REGION: z.string().default('us-east-1'),
  SES_FROM_EMAIL: z.string().email().optional(),

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

  // Communications - LigueLead
  LIGUELEAD_API_URL: z.string().url().default('https://api.liguelead.com.br'),
  LIGUELEAD_API_TOKEN: z.string().optional().default(''),
  LIGUELEAD_APP_ID: z.string().uuid().optional(),
  LIGUELEAD_WEBHOOK_TOKEN: z.string().min(32).optional(),
  LIGUELEAD_TIMEOUT: z.coerce.number().default(30000),
  PUBLIC_PAYMENT_URL: z.string().url().default('https://crm.maisqpago.com.br/regularize'),

  // WhatsApp / Chatwoot bot
  CHATWOOT_API_URL: z.string().url().optional(),
  CHATWOOT_API_ACCESS_TOKEN: z.string().optional().default(''),
  CHATWOOT_ACCOUNT_ID: z.string().optional().default('1'),
  CHATWOOT_INBOX_ID: z.string().optional().default(''),
  WHATSAPP_BOT_ACCOUNT_ID: z.string().min(1).default('00000000-0000-0000-0000-000000000001'),
  CHATWOOT_WEBHOOK_TOKEN: z.string().min(32).optional(),
  BEDROCK_REGION: z.string().default('us-east-1'),
  BEDROCK_CHAT_MODEL_ID: z.string().default('us.amazon.nova-2-lite-v1:0'),

  // Payment - Banco do Brasil
  BB_CLIENT_ID: z.string().optional().default(''),
  BB_CLIENT_SECRET: z.string().optional().default(''),
  BB_DEVELOPER_KEY: z.string().optional().default(''),
  BB_PIX_KEY: z.string().optional().default(''),
  BB_CERTIFICATE_BASE64: z.string().optional().default(''),
  BB_CERTIFICATE_PASSWORD: z.string().optional().default(''),
  BB_WEBHOOK_ALLOWED_IPS: z.string().optional().default(''),
  BB_WEBHOOK_TOKEN: z.string().min(32).optional(),

  // Payment - Configuration
  PIX_EXPIRATION_HOURS: z.coerce.number().optional().default(24),
  CHARGE_LIFECYCLE_JOB_INTERVAL_MS: z.coerce.number().optional().default(300000),
  CHARGE_LIFECYCLE_JOB_BATCH_SIZE: z.coerce.number().optional().default(50),
  PAYMENT_PROVIDER_TIMEOUT_MS: z.coerce.number().optional().default(30000),
  PAYMENT_PROVIDER_MAX_RETRIES: z.coerce.number().optional().default(3),
  PAYMENT_GATEWAY_ENVIRONMENT: z
    .enum(['SANDBOX', 'PRODUCTION'])
    .default('SANDBOX'),

  // Seed
  SEED_ADMIN_EMAIL: z.string().email().default('admin@cobdata.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin@123'),
});

export type Env = z.infer<typeof envSchema>;
