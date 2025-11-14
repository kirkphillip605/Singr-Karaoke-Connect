import Redis from 'ioredis';
import { createLogger } from '@singr/observability';

const logger = createLogger('auth:refresh-token');

export class RefreshTokenService {
  constructor(private redis: Redis) {}

  private getKey(jti: string): string {
    return `revoked:${jti}`;
  }

  /**
   * Revoke a token by JTI (JWT ID)
   */
  async revokeToken(jti: string, expirySeconds: number): Promise<void> {
    try {
      await this.redis.setex(this.getKey(jti), expirySeconds, '1');
      logger.info({ jti }, 'Token revoked');
    } catch (error) {
      logger.error({ error, jti }, 'Failed to revoke token');
      throw new Error('Failed to revoke token');
    }
  }

  /**
   * Check if a token is revoked
   */
  async isJTIRevoked(jti: string): Promise<boolean> {
    try {
      const result = await this.redis.get(this.getKey(jti));
      return result === '1';
    } catch (error) {
      logger.error({ error, jti }, 'Failed to check token revocation');
      // Fail open in case of Redis errors
      return false;
    }
  }

  /**
   * Revoke all tokens for a user
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    // Store revocation timestamp
    const key = `user:revoked:${userId}`;
    await this.redis.set(key, Date.now().toString());
    logger.info({ userId }, 'All user tokens revoked');
  }

  /**
   * Check if all user tokens are revoked
   */
  async areUserTokensRevoked(
    userId: string,
    tokenIssuedAt: number
  ): Promise<boolean> {
    const key = `user:revoked:${userId}`;
    const revokedAt = await this.redis.get(key);

    if (!revokedAt) return false;

    // If token was issued before revocation, it's revoked
    return tokenIssuedAt < parseInt(revokedAt, 10);
  }
}
