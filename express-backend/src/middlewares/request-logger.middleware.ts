import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';
    const idPrefix = req.id ? `[${req.id}] ` : '';
    logger.log(level, `${idPrefix}${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
};
