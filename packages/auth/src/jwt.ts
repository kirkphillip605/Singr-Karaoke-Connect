import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '@singr/config';
import { createLogger } from '@singr/observability';

const logger = createLogger('auth:jwt');

export interface TokenPayload {
  sub: string; // User ID
  email: string;
  jti: string; // JWT ID for revocation
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function parseExpiry(expiry: string): number {
  const matches = expiry.match(/^(\d+)([smhd])$/);
  if (!matches || !matches[1] || !matches[2]) throw new Error(`Invalid expiry format: ${expiry}`);

  const value = matches[1];
  const unit = matches[2];
  const num = parseInt(value, 10);

  switch (unit) {
    case 's':
      return num;
    case 'm':
      return num * 60;
    case 'h':
      return num * 3600;
    case 'd':
      return num * 86400;
    default:
      throw new Error(`Invalid expiry unit: ${unit}`);
  }
}

export function generateAccessToken(userId: string, email: string): string {
  const payload: TokenPayload = {
    sub: userId,
    email,
    jti: uuidv4(),
  };

  return jwt.sign(payload, config.JWT_PRIVATE_KEY as any, {
    algorithm: 'ES256',
    expiresIn: config.JWT_ACCESS_EXPIRY,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  } as any);
}

export function generateRefreshToken(userId: string, email: string): string {
  const payload: TokenPayload = {
    sub: userId,
    email,
    jti: uuidv4(),
  };

  return jwt.sign(payload, config.JWT_PRIVATE_KEY as any, {
    algorithm: 'ES256',
    expiresIn: config.JWT_REFRESH_EXPIRY,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  } as any);
}

export function generateTokenPair(userId: string, email: string): TokenPair {
  const accessToken = generateAccessToken(userId, email);
  const refreshToken = generateRefreshToken(userId, email);
  const expiresIn = parseExpiry(config.JWT_ACCESS_EXPIRY);

  return {
    accessToken,
    refreshToken,
    expiresIn,
  };
}

export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, config.JWT_PUBLIC_KEY, {
      algorithms: ['ES256'],
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    }) as TokenPayload;

    return decoded;
  } catch (error) {
    logger.debug({ error }, 'Token verification failed');
    throw new Error('Invalid or expired token');
  }
}

export function decodeToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.decode(token) as TokenPayload;
    return decoded;
  } catch (error) {
    logger.debug({ error }, 'Token decoding failed');
    return null;
  }
}

export function getTokenExpiry(token: string): Date | null {
  const decoded = decodeToken(token);
  if (!decoded?.exp) return null;
  return new Date(decoded.exp * 1000);
}

export function isTokenExpired(token: string): boolean {
  const expiry = getTokenExpiry(token);
  if (!expiry) return true;
  return expiry.getTime() < Date.now();
}
