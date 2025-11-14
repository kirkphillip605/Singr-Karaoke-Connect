import { PrismaClient, Prisma } from '@prisma/client';
import { createLogger } from '@singr/observability';

const logger = createLogger('prisma');

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Log queries in development
if (process.env.NODE_ENV === 'development') {
  (prisma as any).$on('query', (e: Prisma.QueryEvent) => {
    logger.debug(
      {
        duration: e.duration,
        query: e.query.substring(0, 200),
      },
      'Database query'
    );
  });
}

(prisma as any).$on('error', (e: { message: string; target: string }) => {
  logger.error({ error: e }, 'Database error');
});

export * from '@prisma/client';
