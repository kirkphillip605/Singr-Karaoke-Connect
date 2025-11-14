import Stripe from 'stripe';
import crypto from 'crypto';
import { prisma } from '@singr/database';
import { config } from '@singr/config';
import { logger } from '@singr/observability';
import { AppError } from '@singr/shared';

export class StripeService {
  private stripe: Stripe;

  constructor() {
    if (!config.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is required for billing');
    }

    this.stripe = new Stripe(config.STRIPE_SECRET_KEY, {
      apiVersion: '2024-11-20.acacia' as any,
      typescript: true,
    });
  }

  /**
   * Get or create Stripe customer for customer profile
   */
  async getOrCreateStripeCustomer(customerProfileId: string) {
    const customerProfile = await prisma.customerProfile.findUnique({
      where: { id: customerProfileId },
      include: {
        user: true,
        customers: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!customerProfile) {
      throw new AppError('Customer profile not found', 404, 'NOT_FOUND');
    }

    // Check if customer already exists
    if (customerProfile.stripeCustomerId) {
      try {
        const customer = await this.stripe.customers.retrieve(
          customerProfile.stripeCustomerId
        );
        if (!customer.deleted) {
          return customer as Stripe.Customer;
        }
      } catch (error) {
        logger.warn('Stripe customer not found, creating new one', {
          stripeCustomerId: customerProfile.stripeCustomerId,
        });
      }
    }

    // Create new Stripe customer
    const customer = await this.stripe.customers.create({
      email: customerProfile.user.email,
      name: customerProfile.legalBusinessName || customerProfile.user.name,
      phone: customerProfile.user.phoneNumber || undefined,
      metadata: {
        customerProfileId,
        userId: customerProfile.userId,
      },
    });

    // Update customer profile with Stripe customer ID
    await prisma.customerProfile.update({
      where: { id: customerProfileId },
      data: { stripeCustomerId: customer.id },
    });

    // Create or update customer record
    await prisma.customer.upsert({
      where: { stripeCustomerId: customer.id },
      create: {
        id: crypto.randomUUID(),
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
    await prisma.stripeCheckoutSession.create({
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
    const subscription = await prisma.subscription.findFirst({
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
    await prisma.subscription.upsert({
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
   * Handle Stripe webhook
   */
  async handleWebhook(
    payload: string | Buffer,
    signature: string
  ): Promise<void> {
    if (!config.STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET not configured');
    }

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        config.STRIPE_WEBHOOK_SECRET
      );
    } catch (err: any) {
      logger.error('Webhook signature verification failed', { error: err.message });
      throw new AppError('Invalid webhook signature', 400, 'INVALID_SIGNATURE');
    }

    logger.info('Processing Stripe webhook', {
      type: event.type,
      id: event.id,
    });

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          await this.syncSubscription(session.subscription as string);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.syncSubscription(subscription.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'canceled',
            canceledAt: new Date(),
          },
        });
        logger.info('Subscription deleted', { subscriptionId: subscription.id });
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        logger.info('Invoice paid', {
          invoiceId: invoice.id,
          customerId: invoice.customer,
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        logger.warn('Invoice payment failed', {
          invoiceId: invoice.id,
          customerId: invoice.customer,
        });
        break;
      }

      default:
        logger.info('Unhandled webhook event type', { type: event.type });
    }
  }

  /**
   * Get available subscription plans
   */
  getPlans() {
    return [
      {
        id: 'starter',
        name: 'Starter',
        price: 19,
        currency: 'usd',
        interval: 'month',
        features: [
          'Up to 3 venues',
          'Basic analytics',
          'Email support',
          'OpenKJ integration',
        ],
        priceId: config.STRIPE_PRICE_STARTER || 'price_starter',
      },
      {
        id: 'professional',
        name: 'Professional',
        price: 49,
        currency: 'usd',
        interval: 'month',
        features: [
          'Up to 10 venues',
          'Advanced analytics',
          'Priority support',
          'Custom branding',
          'API access',
        ],
        priceId: config.STRIPE_PRICE_PROFESSIONAL || 'price_professional',
        popular: true,
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        price: 99,
        currency: 'usd',
        interval: 'month',
        features: [
          'Unlimited venues',
          'Advanced integrations',
          'Dedicated support',
          'White-label options',
          'Custom development',
        ],
        priceId: config.STRIPE_PRICE_ENTERPRISE || 'price_enterprise',
      },
    ];
  }
}

export const stripeService = new StripeService();
