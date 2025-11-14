import type { FastifyRequest } from 'fastify';

export interface AuthenticatedUser {
  sub: string;
  email: string;
  jti: string;
  accountType?: 'singer' | 'customer';
  profileId?: string;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: AuthenticatedUser;
}

export function getAuthenticatedUser(request: FastifyRequest): AuthenticatedUser {
  return request.user as AuthenticatedUser;
}
