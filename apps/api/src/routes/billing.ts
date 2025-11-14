import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { stripeService } from '../services/stripe.service.js';
import { AppError } from '@singr/shared';
import { logger } from '@singr/observability';

// Validation schemas
const createCheckoutSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  trialDays: z.number().int().min(0).max(90).optional(),
});

const createPortalSchema = z.object({
  returnUrl: z.string().url(),
});

export default async function billingRoutes(server: FastifyInstance) {
  // Create checkout session
  server.post(
    '/billing/checkout',
    {
      preHandler: server.authenticate,
      schema: {
        tags: ['billing'],
        description: 'Create Stripe checkout session for subscription',
        body: {
          type: 'object',
          required: ['priceId', 'successUrl', 'cancelUrl'],
          properties: {
            priceId: { type: 'string' },
            successUrl: { type: 'string', format: 'uri' },
            cancelUrl: { type: 'string', format: 'uri' },
            trialDays: { type: 'number', minimum: 0, maximum: 90 },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: z.infer<typeof createCheckoutSchema>;
      }>,
      reply: FastifyReply
    ) => {
      const body = createCheckoutSchema.parse(request.body);

      if (request.user?.accountType !== 'customer') {
        throw new AppError(400, "bad_request", "Bad Request", 'Only customers can subscribe', 403, 'FORBIDDEN');
      }

      if (!(request.user as any).profileId) {
        throw new AppError(400, "bad_request", "Bad Request", 'Customer profile not found', 404, 'NOT_FOUND');
      }

      const session = await stripeService.createCheckoutSession(
        (request.user as any).profileId,
        body.priceId,
        {
          successUrl: body.successUrl,
          cancelUrl: body.cancelUrl,
          trialDays: body.trialDays,
        }
      );

      return reply.code(200).send({
        sessionId: session.id,
        url: session.url,
      });
    }
  );

  // Create customer portal session
  server.post(
    '/billing/portal',
    {
      preHandler: server.authenticate,
      schema: {
        tags: ['billing'],
        description: 'Create Stripe customer portal session',
        body: {
          type: 'object',
          required: ['returnUrl'],
          properties: {
            returnUrl: { type: 'string', format: 'uri' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: z.infer<typeof createPortalSchema>;
      }>,
      reply: FastifyReply
    ) => {
      const body = createPortalSchema.parse(request.body);

      if (request.user?.accountType !== 'customer') {
        throw new AppError(400, "bad_request", "Bad Request", 'Only customers can access billing portal', 403, 'FORBIDDEN');
      }

      if (!(request.user as any).profileId) {
        throw new AppError(400, "bad_request", "Bad Request", 'Customer profile not found', 404, 'NOT_FOUND');
      }

      const session = await stripeService.createPortalSession(
        (request.user as any).profileId,
        body.returnUrl
      );

      return reply.code(200).send({
        url: session.url,
      });
    }
  );

  // Get active subscription
  server.get(
    '/billing/subscription',
    {
      preHandler: server.authenticate,
      schema: {
        tags: ['billing'],
        description: 'Get active subscription for customer',
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.user?.accountType !== 'customer') {
        throw new AppError(400, "bad_request", "Bad Request", 'Only customers have subscriptions', 403, 'FORBIDDEN');
      }

      if (!(request.user as any).profileId) {
        throw new AppError(400, "bad_request", "Bad Request", 'Customer profile not found', 404, 'NOT_FOUND');
      }

      const subscription = await stripeService.getActiveSubscription(
        (request.user as any).profileId
      );

      if (!subscription) {
        return reply.code(404).send({
          type: 'not_found',
          title: 'No Active Subscription',
          detail: 'Customer does not have an active subscription',
        });
      }

      return reply.code(200).send({
        id: subscription.id,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        cancelAt: subscription.cancelAt,
        canceledAt: subscription.canceledAt,
      });
    }
  );

  // Get available plans
  server.get(
    '/billing/plans',
    {
      schema: {
        tags: ['billing'],
        description: 'Get available subscription plans',
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const plans = stripeService.getPlans();
      return reply.code(200).send({ plans });
    }
  );

  // Stripe webhook endpoint (no authentication)
  server.post(
    '/webhooks/stripe',
    {
      config: {
        rawBody: true,
      },
      schema: {
        tags: ['webhooks'],
        description: 'Handle Stripe webhooks',
        hide: true,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const signature = request.headers['stripe-signature'];

      if (!signature || typeof signature !== 'string') {
        throw new AppError(400, "bad_request", "Bad Request", 'Missing stripe-signature header', 400, 'BAD_REQUEST');
      }

      try {
        await stripeService.handleWebhook(
          request.rawBody || request.body,
          signature
        );

        return reply.code(200).send({ received: true });
      } catch (error: any) {
        logger.error('Webhook processing failed', { error: error.message });
        throw error;
      }
    }
  );
}
