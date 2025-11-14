# Singr Central API Backend - Phase 13

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 13: Subscription & Billing Integration

**Objective**: Integrate Stripe for subscription management, payment processing, and customer portal access, following the patterns from the reference repository.

### 13.1 Stripe Service

```typescript
// src/services/stripe-service.ts

import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import type { FastifyInstance } from 'fastify';

export class StripeService {
  private stripe: Stripe;

  constructor(
    private prisma: PrismaClient,
    private server: FastifyInstance
  ) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is required');
    }

    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-11-20.acacia',
      typescript: true,
    });
  }

  /**
   * Get or create Stripe customer for customer profile
   */
  async getOrCreateStripeCustomer(customerProfileId: string) {
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { id: customerProfileId },
      include: {
        singrUser: true,
        customers: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!customerProfile) {
      throw new Error('Customer profile not found');
    }

    // Check if customer already exists
    if (customerProfile.stripeCustomerId) {
      try {
        const customer = await this.stripe.customers.retrieve(
          customerProfile.stripeCustomerId
        );
        if (!customer.deleted) {
          return customer;
        }
      } catch (error) {
        logger.warn('Stripe customer not found, creating new one', {
          stripeCustomerId: customerProfile.stripeCustomerId,
        });
      }
    }

    // Create new Stripe customer
    const customer = await this.stripe.customers.create({
      email: customerProfile.singrUser.email,
      name: customerProfile.businessName || customerProfile.singrUser.name,
      phone: customerProfile.singrUser.phoneNumber,
      metadata: {
        customerProfileId,
        singrUserId: customerProfile.singrUserId,
      },
    });

    // Update customer profile with Stripe customer ID
    await this.prisma.customerProfile.update({
      where: { id: customerProfileId },
      data: { stripeCustomerId: customer.id },
    });

    // Create or update customer record
    await this.prisma.customer.upsert({
      where: { stripeCustomerId: customer.id },
      create: {
        id: customerProfileId,
        stripeCustomerId: customer.id,
        customerProfileId,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        description: customer.description,
        metadata: customer.metadata as any,
        invoiceSettings: customer.invoice_settings as any,
        shipping: customer.shipping as any,
        taxExempt: customer.tax_exempt,
        taxIds: [] as any,
        livemode: customer.livemode,
      },
      update: {
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
      },
    });

    logger.info('Stripe customer created', {
      customerProfileId,
      stripeCustomerId: customer.id,
    });

    return customer;
  }

  /**
   * Create checkout session for subscription
   */
  async createCheckoutSession(
    customerProfileId: string,
    priceId: string,
    options: {
      successUrl: string;
      cancelUrl: string;
      trialDays?: number;
    }
  ) {
    const customer = await this.getOrCreateStripeCustomer(customerProfileId);

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customer.id,
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: options.successUrl,
      cancel_url: options.cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      metadata: {
        customerProfileId,
      },
    };

    if (options.trialDays && options.trialDays > 0) {
      sessionParams.subscription_data = {
        trial_period_days: options.trialDays,
        metadata: {
          customerProfileId,
        },
      };
    }

    const session = await this.stripe.checkout.sessions.create(sessionParams);

    // Store checkout session
    await this.prisma.stripeCheckoutSession.create({
      data: {
        id: session.id,
        customerId: customerProfileId,
        paymentStatus: session.payment_status,
        mode: session.mode || 'subscription',
        amountTotal: session.amount_total ? BigInt(session.amount_total) : null,
        currency: session.currency || 'usd',
        createdAt: new Date(session.created * 1000),
        expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
        url: session.url,
        metadata: session.metadata as any,
      },
    });

    logger.info('Checkout session created', {
      customerProfileId,
      sessionId: session.id,
      priceId,
    });

    return session;
  }

  /**
   * Create customer portal session
   */
  async createPortalSession(customerProfileId: string, returnUrl: string) {
    const customer = await this.getOrCreateStripeCustomer(customerProfileId);

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl,
    });

    logger.info('Customer portal session created', {
      customerProfileId,
      stripeCustomerId: customer.id,
    });

    return session;
  }

  /**
   * Get active subscription for customer
   */
  async getActiveSubscription(customerProfileId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        customerProfileId,
        status: {
          in: ['active', 'trialing'],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return subscription;
  }

  /**
   * Check if customer has active subscription
   */
  async hasActiveSubscription(customerProfileId: string): Promise<boolean> {
    const subscription = await this.getActiveSubscription(customerProfileId);
    return !!subscription;
  }

  /**
   * Sync subscription from Stripe
   */
  async syncSubscription(stripeSubscriptionId: string) {
    const stripeSubscription = await this.stripe.subscriptions.retrieve(
      stripeSubscriptionId,
      {
        expand: ['customer'],
      }
    );

    const customer = stripeSubscription.customer;
    if (typeof customer === 'string') {
      throw new Error('Customer not expanded');
    }

    const customerProfileId = customer.metadata?.customerProfileId;
    if (!customerProfileId) {
      throw new Error('Customer profile ID not found in metadata');
    }

    // Upsert subscription
    await this.prisma.subscription.upsert({
      where: { id: stripeSubscription.id },
      create: {
        id: stripeSubscription.id,
        customerProfileId,
        status: stripeSubscription.status,
        currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        cancelAt: stripeSubscription.cancel_at
          ? new Date(stripeSubscription.cancel_at * 1000)
          : null,
        canceledAt: stripeSubscription.canceled_at
          ? new Date(stripeSubscription.canceled_at * 1000)
          : null,
        metadata: stripeSubscription.metadata as any,
        createdAt: new Date(stripeSubscription.created * 1000),
        livemode: stripeSubscription.livemode,
      },
      update: {
        status: stripeSubscription.status,
        currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        cancelAt: stripeSubscription.cancel_at
          ? new Date(stripeSubscription.cancel_at * 1000)
          : null,
        canceledAt: stripeSubscription.canceled_at
          ? new Date(stripeSubscription.canceled_at * 1000)
          : null,
        metadata: stripeSubscription.metadata as any,
      },
    });

    logger.info('Subscription synced', {
      subscriptionId: stripeSubscription.id,
      customerProfileId,
      status: stripeSubscription.status,
    });

    return stripeSubscription;
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(
    customerProfileId: string,
    subscriptionId: string,
    cancelAtPeriodEnd: boolean = true
  ) {
    // Verify subscription belongs to customer
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        customerProfileId,
      },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    const updated = await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: cancelAtPeriodEnd,
    });

    await this.syncSubscription(subscriptionId);

    logger.info('Subscription cancelled', {
      subscriptionId,
      customerProfileId,
      cancelAtPeriodEnd,
    });

    return updated;
  }

  /**
   * Reactivate subscription
   */
  async reactivateSubscription(customerProfileId: string, subscriptionId: string) {
    // Verify subscription belongs to customer
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        customerProfileId,
      },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    const updated = await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });

    await this.syncSubscription(subscriptionId);

    logger.info('Subscription reactivated', {
      subscriptionId,
      customerProfileId,
    });

    return updated;
  }

  /**
   * List prices
   */
  async listPrices() {
    const prices = await this.stripe.prices.list({
      active: true,
      expand: ['data.product'],
    });

    return prices.data;
  }
}
```

### 13.2 Billing Routes

```typescript
// src/routes/v1/customer/billing.ts

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { StripeService } from '../../../services/stripe-service';

const CreateCheckoutSessionSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  trialDays: z.number().int().min(0).max(90).optional(),
});

const CancelSubscriptionSchema = z.object({
  subscriptionId: z.string().min(1),
  cancelAtPeriodEnd: z.boolean().default(true),
});

const billingRoutes: FastifyPluginAsync = async (server) => {
  const stripeService = new StripeService(server.prisma, server);

  // Get subscription status
  server.get(
    '/billing/subscription',
    {
      schema: {
        tags: ['customer'],
        summary: 'Get subscription status',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Subscription details',
            type: 'object',
            properties: {
              hasActiveSubscription: { type: 'boolean' },
              subscription: {
                type: 'object',
                nullable: true,
                properties: {
                  id: { type: 'string' },
                  status: { type: 'string' },
                  currentPeriodStart: { type: 'string', format: 'date-time' },
                  currentPeriodEnd: { type: 'string', format: 'date-time' },
                  cancelAtPeriodEnd: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext?.id;

      if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
        return reply.code(403).send({
          type: 'authorization_denied',
          title: 'Customer Context Required',
        });
      }

      const subscription = await stripeService.getActiveSubscription(customerProfileId);

      return reply.send({
        hasActiveSubscription: !!subscription,
        subscription: subscription || null,
      });
    }
  );

  // List available prices
  server.get(
    '/billing/prices',
    {
      schema: {
        tags: ['customer'],
        summary: 'List available subscription prices',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'List of prices',
            type: 'object',
            properties: {
              prices: {
                type: 'array',
                items: { type: 'object' },
              },
            },
          },
        },
      },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      const prices = await stripeService.listPrices();

      return reply.send({ prices });
    }
  );

  // Create checkout session
  server.post(
    '/billing/create-checkout-session',
    {
      schema: {
        tags: ['customer'],
        summary: 'Create Stripe checkout session',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['priceId', 'successUrl', 'cancelUrl'],
          properties: {
            priceId: { type: 'string' },
            successUrl: { type: 'string', format: 'uri' },
            cancelUrl: { type: 'string', format: 'uri' },
            trialDays: { type: 'integer', minimum: 0, maximum: 90 },
          },
        },
        response: {
          200: {
            description: 'Checkout session created',
            type: 'object',
            properties: {
              url: { type: 'string' },
              sessionId: { type: 'string' },
            },
          },
        },
      },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext?.id;

      if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
        return reply.code(403).send({
          type: 'authorization_denied',
          title: 'Customer Context Required',
        });
      }

      try {
        const data = CreateCheckoutSessionSchema.parse(request.body);
        
        const session = await stripeService.createCheckoutSession(
          customerProfileId,
          data.priceId,
          {
            successUrl: data.successUrl,
            cancelUrl: data.cancelUrl,
            trialDays: data.trialDays,
          }
        );

        return reply.send({
          url: session.url,
          sessionId: session.id,
        });
      } catch (error) {
        if (error instanceof Error) {
          return reply.code(400).send({
            type: 'invalid_request',
            title: 'Checkout Failed',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );

  // Create customer portal session
  server.post(
    '/billing/create-portal-session',
    {
      schema: {
        tags: ['customer'],
        summary: 'Create customer portal session',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['returnUrl'],
          properties: {
            returnUrl: { type: 'string', format: 'uri' },
          },
        },
        response: {
          200: {
            description: 'Portal session created',
            type: 'object',
            properties: {
              url: { type: 'string' },
            },
          },
        },
      },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext?.id;

      if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
        return reply.code(403).send({
          type: 'authorization_denied',
          title: 'Customer Context Required',
        });
      }

      const { returnUrl } = request.body as { returnUrl: string };

      try {
        const session = await stripeService.createPortalSession(
          customerProfileId,
          returnUrl
        );

        return reply.send({ url: session.url });
      } catch (error) {
        if (error instanceof Error) {
          return reply.code(400).send({
            type: 'invalid_request',
            title: 'Portal Session Failed',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );

  // Cancel subscription
  server.post(
    '/billing/cancel-subscription',
    {
      schema: {
        tags: ['customer'],
        summary: 'Cancel subscription',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['subscriptionId'],
          properties: {
            subscriptionId: { type: 'string' },
            cancelAtPeriodEnd: { type: 'boolean', default: true },
          },
        },
        response: {
          200: {
            description: 'Subscription cancelled',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              cancelAtPeriodEnd: { type: 'boolean' },
            },
          },
        },
      },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext?.id;

      if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
        return reply.code(403).send({
          type: 'authorization_denied',
          title: 'Customer Context Required',
        });
      }

      try {
        const data = CancelSubscriptionSchema.parse(request.body);
        
        await stripeService.cancelSubscription(
          customerProfileId,
          data.subscriptionId,
          data.cancelAtPeriodEnd
        );

        return reply.send({
          success: true,
          cancelAtPeriodEnd: data.cancelAtPeriodEnd,
        });
      } catch (error) {
        if (error instanceof Error) {
          return reply.code(400).send({
            type: 'invalid_request',
            title: 'Cancellation Failed',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );

  // Reactivate subscription
  server.post(
    '/billing/reactivate-subscription',
    {
      schema: {
        tags: ['customer'],
        summary: 'Reactivate cancelled subscription',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['subscriptionId'],
          properties: {
            subscriptionId: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'Subscription reactivated',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
            },
          },
        },
      },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext?.id;

      if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
        return reply.code(403).send({
          type: 'authorization_denied',
          title: 'Customer Context Required',
        });
      }

      const { subscriptionId } = request.body as { subscriptionId: string };

      try {
        await stripeService.reactivateSubscription(customerProfileId, subscriptionId);

        return reply.send({ success: true });
      } catch (error) {
        if (error instanceof Error) {
          return reply.code(400).send({
            type: 'invalid_request',
            title: 'Reactivation Failed',
            detail: error.message,
          });
        }
        throw error;
      }
    }
  );
};

export default billingRoutes;
```

### 13.3 Stripe Webhook Handler

```typescript
// src/routes/webhooks/stripe.ts

import type { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { StripeService } from '../../services/stripe-service';
import { logger } from '../../lib/logger';

const stripeWebhookRoutes: FastifyPluginAsync = async (server) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2024-11-20.acacia',
  });

  const stripeService = new StripeService(server.prisma, server);

  server.post(
    '/webhooks/stripe',
    {
      config: {
        rawBody: true, // Need raw body for signature verification
      },
    },
    async (request, reply) => {
      const sig = request.headers['stripe-signature'];

      if (!sig || typeof sig !== 'string') {
        return reply.code(400).send({ error: 'Missing stripe-signature header' });
      }

      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(
          request.rawBody!,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET!
        );
      } catch (error) {
        logger.error('Webhook signature verification failed', { error });
        return reply.code(400).send({ error: 'Invalid signature' });
      }

      // Store webhook event
      await server.prisma.stripeWebhookEvent.create({
        data: {
          eventId: event.id,
          eventType: event.type,
          payload: event.data.object as any,
          livemode: event.livemode,
          requestId: event.request?.id || null,
        },
      });

      // Process event
      try {
        switch (event.type) {
          case 'customer.subscription.created':
          case 'customer.subscription.updated':
          case 'customer.subscription.deleted': {
            const subscription = event.data.object as Stripe.Subscription;
            await stripeService.syncSubscription(subscription.id);
            break;
          }

          case 'checkout.session.completed': {
            const session = event.data.object as Stripe.Checkout.Session;
            
            // Update checkout session status
            await server.prisma.stripeCheckoutSession.update({
              where: { id: session.id },
              data: {
                paymentStatus: session.payment_status,
                completedAt: new Date(),
              },
            });

            // Sync subscription if present
            if (session.subscription && typeof session.subscription === 'string') {
              await stripeService.syncSubscription(session.subscription);
            }
            break;
          }

          case 'invoice.payment_succeeded':
          case 'invoice.payment_failed': {
            const invoice = event.data.object as Stripe.Invoice;
            logger.info('Invoice payment event', {
              invoiceId: invoice.id,
              status: invoice.status,
              customerId: invoice.customer,
            });
            break;
          }

          default:
            logger.info('Unhandled webhook event type', { type: event.type });
        }

        // Mark as processed
        await server.prisma.stripeWebhookEvent.updateMany({
          where: { eventId: event.id },
          data: {
            processed: true,
            processedAt: new Date(),
          },
        });
      } catch (error) {
        logger.error('Error processing webhook event', {
          eventId: event.id,
          type: event.type,
          error,
        });

        // Store error
        await server.prisma.stripeWebhookEvent.updateMany({
          where: { eventId: event.id },
          data: {
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        });

        // Return 500 to trigger retry
        return reply.code(500).send({ error: 'Webhook processing failed' });
      }

      return reply.send({ received: true });
    }
  );
};

export default stripeWebhookRoutes;
```

---
