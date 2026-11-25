import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import type { Request, Response, NextFunction } from 'express';

const bypassMiddleware = (_req: Request, _res: Response, next: NextFunction) => next();

/**
 * Strict rate limiter for authentication attempts (e.g. login).
 * Default: 20 attempts per 15 minutes per IP.
 */
export const loginRateLimiter = env.RATE_LIMIT_ENABLED
  ? rateLimit({
      windowMs: env.RATE_LIMIT_LOGIN_WINDOW_MS,
      max: env.RATE_LIMIT_LOGIN_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: {
          message: 'Too many login attempts. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
        },
      },
    })
  : bypassMiddleware;

/**
 * Rate limiter for write/mutation endpoints (POST, PUT, PATCH, DELETE).
 * Default: 60 requests per minute per IP.
 */
export const writeRateLimiter = env.RATE_LIMIT_ENABLED
  ? rateLimit({
      windowMs: env.RATE_LIMIT_WRITE_WINDOW_MS,
      max: env.RATE_LIMIT_WRITE_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req: Request) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
      message: {
        error: {
          message: 'Too many write requests. Please slow down.',
          code: 'RATE_LIMIT_EXCEEDED',
        },
      },
    })
  : bypassMiddleware;
