/**
 * Global test setup
 * Runs before all tests
 */

import { prisma } from '@singr/database';
import { logger } from '@singr/observability';

// Suppress logs during tests
logger.level = 'silent';

beforeAll(async () => {
  // Setup test database connection
  await prisma.$connect();
});

afterAll(async () => {
  // Cleanup and disconnect
  await prisma.$disconnect();
});

afterEach(async () => {
  // Clear test data between tests
  // Only truncate tables that are used in tests
  const tables = [
    'Request',
    'RequestHistory',
    'FavoriteSong',
    'FavoriteVenue',
    'SongDb',
    'System',
    'Venue',
    'ApiKey',
    'Subscription',
    'OrganizationUser',
    'SingerProfile',
    'CustomerProfile',
    'Account',
    'Session',
    'User',
  ];

  // Disable foreign key checks temporarily
  await prisma.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');

  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
    } catch (error) {
      // Table might not exist or be empty, continue
      console.warn(`Could not truncate ${table}:`, (error as Error).message);
    }
  }

  // Re-enable foreign key checks
  await prisma.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
});
