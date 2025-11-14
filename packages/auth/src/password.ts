import { hash, verify } from '@node-rs/argon2';
import { createLogger } from '@singr/observability';

const logger = createLogger('auth:password');

export const PASSWORD_CONFIG = {
  memoryCost: 19456, // 19 MB
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
  algorithm: 0, // Argon2id
};

export async function hashPassword(password: string): Promise<string> {
  try {
    return await hash(password, PASSWORD_CONFIG);
  } catch (error) {
    logger.error({ error }, 'Password hashing failed');
    throw new Error('Failed to hash password');
  }
}

export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await verify(hash, password, PASSWORD_CONFIG);
  } catch (error) {
    logger.debug({ error }, 'Password verification failed');
    return false;
  }
}

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordStrength(
  password: string
): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return { valid: errors.length === 0, errors };
}
