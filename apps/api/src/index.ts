import { config } from '@singr/config';
import { logger } from '@singr/observability';
import { buildServer } from './server.js';

async function start() {
  try {
    const server = await buildServer();

    await server.listen({
      port: config.PORT,
      host: config.HOST,
    });

    logger.info(
      {
        port: config.PORT,
        host: config.HOST,
        env: config.NODE_ENV,
      },
      '🎤 Singr API server started'
    );

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down gracefully...');
      await server.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();
