import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { Role } from '../models/User';

export interface JwtPayload {
  sub: string;
  role: Role;
  status: 'pending' | 'active' | 'rejected';
}

const findKeyFile = (relativePath: string): string => {
  const candidates = [
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), '..', relativePath),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return fs.readFileSync(c, 'utf-8');
    }
  }
  return '';
};

const getPrivateKey = (): string => {
  if (env.JWT_PRIVATE_KEY) return env.JWT_PRIVATE_KEY;
  if (env.JWT_PRIVATE_KEY_PATH) return fs.readFileSync(env.JWT_PRIVATE_KEY_PATH, 'utf-8');
  const found = findKeyFile('keys/jwtRS256.key');
  if (found) return found;
  throw new Error('RS256 enabled but no JWT_PRIVATE_KEY provided');
};

const getPublicKey = (): string => {
  if (env.JWT_PUBLIC_KEY) return env.JWT_PUBLIC_KEY;
  if (env.JWT_PUBLIC_KEY_PATH) return fs.readFileSync(env.JWT_PUBLIC_KEY_PATH, 'utf-8');
  const found = findKeyFile('keys/jwtRS256.key.pub');
  if (found) return found;
  throw new Error('RS256 enabled but no JWT_PUBLIC_KEY provided');
};

export const hashPassword = async (plain: string): Promise<string> => {
  return bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);
};

export const verifyPassword = async (plain: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(plain, hash);
};

export const signAccessToken = (payload: JwtPayload): string => {
  if (env.JWT_ALG === 'RS256') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return jwt.sign(payload, getPrivateKey(), { algorithm: 'RS256', expiresIn: env.JWT_EXPIRES_IN as any });
  }
  // Default HS256
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign(payload, env.JWT_SECRET as jwt.Secret, { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN as any });
};

export const verifyAccessToken = (token: string): JwtPayload => {
  if (env.JWT_ALG === 'RS256') {
    const decoded = jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] });
    if (typeof decoded === 'string') throw new Error('Invalid token payload');
    return decoded as JwtPayload;
  }
  // Default HS256
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') {
    throw new Error('Invalid token payload');
  }
  return decoded as JwtPayload;
};
