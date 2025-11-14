/**
 * Integration tests for authentication endpoints
 */

import { buildServer } from '../../src/server';
import { prisma } from '@singr/database';
import { FastifyInstance } from 'fastify';

describe('Authentication API', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('POST /v1/auth/signup', () => {
    it('should create a new singer account', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: {
          email: 'singer@example.com',
          password: 'SecurePassword123!',
          accountType: 'singer',
          name: 'Test Singer',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.user).toHaveProperty('id');
      expect(body.user.email).toBe('singer@example.com');
      expect(body).toHaveProperty('accessToken');
      expect(body).toHaveProperty('refreshToken');

      // Verify user was created in database
      const user = await prisma.user.findUnique({
        where: { email: 'singer@example.com' },
      });
      expect(user).toBeTruthy();
      expect(user?.emailVerified).toBe(false);
    });

    it('should create a new customer account', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: {
          email: 'customer@example.com',
          password: 'SecurePassword123!',
          accountType: 'customer',
          name: 'Test Customer',
          customerData: {
            legalBusinessName: 'Test Karaoke Venue',
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('customer@example.com');

      // Verify customer profile was created
      const profile = await prisma.customerProfile.findFirst({
        where: {
          user: {
            email: 'customer@example.com',
          },
        },
      });
      expect(profile).toBeTruthy();
      expect(profile?.legalBusinessName).toBe('Test Karaoke Venue');
    });

    it('should reject duplicate email', async () => {
      // Create first user
      await server.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: {
          email: 'duplicate@example.com',
          password: 'SecurePassword123!',
          accountType: 'singer',
          name: 'First User',
        },
      });

      // Try to create duplicate
      const response = await server.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: {
          email: 'duplicate@example.com',
          password: 'SecurePassword123!',
          accountType: 'singer',
          name: 'Second User',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.type).toContain('exists');
    });

    it('should reject weak password', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: {
          email: 'weak@example.com',
          password: 'weak',
          accountType: 'singer',
          name: 'Test User',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /v1/auth/signin', () => {
    const testEmail = 'signin@example.com';
    const testPassword = 'SecurePassword123!';

    beforeEach(async () => {
      // Create test user
      await server.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: {
          email: testEmail,
          password: testPassword,
          accountType: 'singer',
          name: 'Test User',
        },
      });
    });

    it('should sign in with valid credentials', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/auth/signin',
        payload: {
          email: testEmail,
          password: testPassword,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('accessToken');
      expect(body).toHaveProperty('refreshToken');
      expect(body.user.email).toBe(testEmail);
    });

    it('should reject invalid password', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/auth/signin',
        payload: {
          email: testEmail,
          password: 'WrongPassword123!',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject non-existent user', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/auth/signin',
        payload: {
          email: 'nonexistent@example.com',
          password: testPassword,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /v1/auth/refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      // Sign up to get tokens
      const signupResponse = await server.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: {
          email: 'refresh@example.com',
          password: 'SecurePassword123!',
          accountType: 'singer',
          name: 'Test User',
        },
      });

      const { refreshToken } = JSON.parse(signupResponse.body);

      // Refresh token
      const refreshResponse = await server.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: {
          refreshToken,
        },
      });

      expect(refreshResponse.statusCode).toBe(200);
      const body = JSON.parse(refreshResponse.body);
      expect(body).toHaveProperty('accessToken');
      expect(body).toHaveProperty('refreshToken');
      expect(body.refreshToken).not.toBe(refreshToken); // Token should rotate
    });

    it('should reject invalid refresh token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: {
          refreshToken: 'invalid.token.here',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /v1/auth/logout', () => {
    it('should revoke tokens on logout', async () => {
      // Sign up
      const signupResponse = await server.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: {
          email: 'logout@example.com',
          password: 'SecurePassword123!',
          accountType: 'singer',
          name: 'Test User',
        },
      });

      const { accessToken, refreshToken } = JSON.parse(signupResponse.body);

      // Logout
      const logoutResponse = await server.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          refreshToken,
        },
      });

      expect(logoutResponse.statusCode).toBe(200);

      // Try to use access token - should be revoked
      const protectedResponse = await server.inject({
        method: 'GET',
        url: '/v1/singer/profile',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(protectedResponse.statusCode).toBe(401);
    });
  });
});
