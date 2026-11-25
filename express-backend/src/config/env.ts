import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

const envPath = process.env.ENV_FILE
  ? path.resolve(process.cwd(), process.env.ENV_FILE)
  : path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),

  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  CORS_ORIGIN: z.string().default('*'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_ALG: z.enum(['HS256', 'RS256']).default('HS256'),
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_PRIVATE_KEY_PATH: z.string().optional(),
  JWT_PUBLIC_KEY_PATH: z.string().optional(),

  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'http', 'debug'])
    .default('info'),

  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_NAME: z.string().optional(),

  CLOUDINARY_CLOUD_NAME: z.string().default('local'),
  CLOUDINARY_API_KEY: z.string().default('local'),
  CLOUDINARY_API_SECRET: z.string().default('local'),

  CLOUDINARY_FOLDER: z.string().default('erp/resources'),

  RESOURCE_MAX_FILE_MB: z.coerce.number().int().positive().default(200),
  RESOURCE_MAX_FILES: z.coerce.number().int().positive().default(30),

  // Reverse Proxy Trust (numeric hops count: default 1 in production, 0 in development; never boolean true)
  TRUST_PROXY: z.coerce.number().int().min(0).default(process.env.NODE_ENV === 'production' ? 1 : 0),

  // Rate Limiting
  RATE_LIMIT_ENABLED: z.coerce.boolean().default(true),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WRITE_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
});

// Validate ONLY env shape
const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    '❌ Invalid environment configuration:',
    parsed.error.flatten().fieldErrors
  );
  process.exit(1);
}

export const env = parsed.data;