import { FastifyInstance, FastifyRequest } from 'fastify';
import { logger } from '@singr/observability';
import { getWebSocketService } from '../services/websocket.service';
import { verifyToken } from '@singr/auth';

/**
 * WebSocket routes for real-time updates
 * Clients connect to /ws?venueId=xxx&token=jwt
 */
export default async function websocketRoutes(server: FastifyInstance) {
  server.get(
    '/ws',
    { websocket: true },
    (connection, request: FastifyRequest) => {
      const wsService = getWebSocketService();
      
      if (!wsService) {
        logger.error('WebSocket service not initialized');
        connection.socket.close(1011, 'Service unavailable');
        return;
      }

      // Parse query parameters
      const venueId = (request.query as any)?.venueId;
      const token = (request.query as any)?.token;

      if (!venueId) {
        logger.warn('WebSocket connection missing venueId');
        connection.socket.close(1008, 'venueId required');
        return;
      }

      // Verify token if provided (optional for public requests view)
      let authenticated = false;
      let userId: string | null = null;

      if (token) {
        try {
          const payload = verifyToken(token);
          authenticated = true;
          userId = payload.sub;
        } catch (error) {
          logger.warn('WebSocket connection with invalid token', {
            venueId,
            error: (error as Error).message,
          });
          // Allow unauthenticated connections for public request displays
        }
      }

      // Register connection
      wsService.registerConnection(venueId, connection.socket);

      logger.info('WebSocket connection established', {
        venueId,
        authenticated,
        userId,
      });

      // Send welcome message
      connection.socket.send(
        JSON.stringify({
          type: 'connected',
          venueId,
          authenticated,
          timestamp: new Date().toISOString(),
        })
      );

      // Handle incoming messages (ping/pong, etc.)
      connection.socket.on('message', (message: any) => {
        try {
          const data = JSON.parse(message.toString());
          
          if (data.type === 'ping') {
            connection.socket.send(
              JSON.stringify({
                type: 'pong',
                timestamp: new Date().toISOString(),
              })
            );
          }
        } catch (error) {
          logger.error('Error processing WebSocket message', {
            error: (error as Error).message,
            venueId,
          });
        }
      });

      // Handle connection close
      connection.socket.on('close', () => {
        wsService.unregisterConnection(venueId, connection.socket);
        logger.info('WebSocket connection closed', { venueId, userId });
      });

      // Handle errors
      connection.socket.on('error', (error: any) => {
        logger.error('WebSocket error', {
          error: error.message,
          venueId,
          userId,
        });
        wsService.unregisterConnection(venueId, connection.socket);
      });
    }
  );

  // WebSocket stats endpoint (authenticated)
  server.get(
    '/ws/stats',
    {
      preHandler: server.authenticate,
      schema: {
        tags: ['websocket'],
        description: 'Get WebSocket connection statistics',
      },
    },
    async (request, reply) => {
      const wsService = getWebSocketService();
      
      if (!wsService) {
        return reply.code(503).send({
          type: 'service_unavailable',
          title: 'WebSocket Service Unavailable',
          detail: 'WebSocket service is not initialized',
        });
      }

      const stats = wsService.getStats();
      return reply.code(200).send(stats);
    }
  );
}
