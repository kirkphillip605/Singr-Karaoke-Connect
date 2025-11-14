import { FastifyInstance } from 'fastify';
import { logger } from '@singr/observability';

export interface WebSocketMessage {
  type: 'request_created' | 'request_updated' | 'request_deleted' | 'venue_updated';
  data: any;
  venueId?: string;
  customerId?: string;
}

/**
 * WebSocket service for real-time updates
 * Uses @fastify/websocket plugin
 */
export class WebSocketService {
  private connections: Map<string, Set<any>> = new Map();

  constructor(private server: FastifyInstance) {}

  /**
   * Register a WebSocket connection for a venue
   */
  registerConnection(venueId: string, connection: any) {
    if (!this.connections.has(venueId)) {
      this.connections.set(venueId, new Set());
    }
    
    this.connections.get(venueId)!.add(connection);
    
    logger.info('WebSocket connection registered', { venueId });
  }

  /**
   * Unregister a WebSocket connection
   */
  unregisterConnection(venueId: string, connection: any) {
    const venueConnections = this.connections.get(venueId);
    if (venueConnections) {
      venueConnections.delete(connection);
      
      if (venueConnections.size === 0) {
        this.connections.delete(venueId);
      }
    }
    
    logger.info('WebSocket connection unregistered', { venueId });
  }

  /**
   * Broadcast message to all connections for a venue
   */
  broadcastToVenue(venueId: string, message: WebSocketMessage) {
    const venueConnections = this.connections.get(venueId);
    
    if (!venueConnections || venueConnections.size === 0) {
      logger.debug('No WebSocket connections for venue', { venueId });
      return;
    }

    const messageStr = JSON.stringify(message);
    let successCount = 0;
    let errorCount = 0;

    for (const connection of venueConnections) {
      try {
        if (connection.readyState === 1) { // OPEN
          connection.send(messageStr);
          successCount++;
        }
      } catch (error: any) {
        logger.error('Failed to send WebSocket message', {
          venueId,
          error: error.message,
        });
        errorCount++;
        // Remove dead connection
        this.unregisterConnection(venueId, connection);
      }
    }

    logger.debug('Broadcast to venue completed', {
      venueId,
      type: message.type,
      successCount,
      errorCount,
    });
  }

  /**
   * Broadcast message to all connections for a customer (all their venues)
   */
  broadcastToCustomer(customerVenueIds: string[], message: WebSocketMessage) {
    for (const venueId of customerVenueIds) {
      this.broadcastToVenue(venueId, message);
    }
  }

  /**
   * Get connection statistics
   */
  getStats() {
    let totalConnections = 0;
    const venueStats: Record<string, number> = {};

    for (const [venueId, connections] of this.connections.entries()) {
      const count = connections.size;
      totalConnections += count;
      venueStats[venueId] = count;
    }

    return {
      totalConnections,
      totalVenues: this.connections.size,
      venueStats,
    };
  }
}

let websocketService: WebSocketService | null = null;

export function initWebSocketService(server: FastifyInstance): WebSocketService {
  if (!websocketService) {
    websocketService = new WebSocketService(server);
  }
  return websocketService;
}

export function getWebSocketService(): WebSocketService | null {
  return websocketService;
}
