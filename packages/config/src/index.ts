import { envsafe, str, port, url, bool, num } from 'envsafe';

export const config = envsafe({
  // Environment
  NODE_ENV: str({
    devDefault: 'development',
    choices: ['development', 'test', 'production'],
  }),

  // Server
  PORT: port({ devDefault: 3000 }),
  HOST: str({ devDefault: '0.0.0.0' }),
  CORS_ORIGINS: str({
    devDefault: 'http://localhost:3000,http://localhost:3001,http://localhost:3002',
  }),

  // Database
  DATABASE_URL: url({
    devDefault: 'postgresql://postgres:postgres@localhost:5432/singr_dev',
  }),

  // Redis
  REDIS_URL: url({
    devDefault: 'redis://localhost:6379',
  }),

  // JWT Configuration
  JWT_ISSUER: str({ devDefault: 'https://api.singrkaraoke.com' }),
  JWT_AUDIENCE: str({ devDefault: 'https://singrkaraoke.com' }),
  JWT_ACCESS_EXPIRY: str({ devDefault: '15m' }),
  JWT_REFRESH_EXPIRY: str({ devDefault: '7d' }),
  JWT_PRIVATE_KEY: str({
    devDefault: '',
    desc: 'ES256 Private Key for JWT signing',
  }),
  JWT_PUBLIC_KEY: str({
    devDefault: '',
    desc: 'ES256 Public Key for JWT verification',
  }),

  // Stripe
  STRIPE_SECRET_KEY: str({ devDefault: '', allowEmpty: true }),
  STRIPE_PUBLISHABLE_KEY: str({ devDefault: '', allowEmpty: true }),
  STRIPE_WEBHOOK_SECRET: str({ devDefault: '', allowEmpty: true }),

  // Mailjet
  MAILJET_API_KEY: str({ devDefault: '', allowEmpty: true }),
  MAILJET_SECRET_KEY: str({ devDefault: '', allowEmpty: true }),
  MAILJET_FROM_EMAIL: str({ devDefault: 'noreply@singrkaraoke.com' }),
  MAILJET_FROM_NAME: str({ devDefault: 'Singr Karaoke' }),

  // Twilio
  TWILIO_ACCOUNT_SID: str({ devDefault: '', allowEmpty: true }),
  TWILIO_AUTH_TOKEN: str({ devDefault: '', allowEmpty: true }),
  TWILIO_PHONE_NUMBER: str({ devDefault: '', allowEmpty: true }),
  TWILIO_VERIFY_SERVICE_SID: str({ devDefault: '', allowEmpty: true }),

  // Sentry
  SENTRY_DSN: str({ devDefault: '', allowEmpty: true }),
  SENTRY_ENVIRONMENT: str({ devDefault: 'development' }),

  // S3/Storage
  S3_BUCKET: str({ devDefault: '', allowEmpty: true }),
  S3_REGION: str({ devDefault: 'us-east-1' }),
  S3_ACCESS_KEY_ID: str({ devDefault: '', allowEmpty: true }),
  S3_SECRET_ACCESS_KEY: str({ devDefault: '', allowEmpty: true }),

  // Feature Flags
  ENABLE_OAUTH: bool({ devDefault: false }),
  ENABLE_2FA: bool({ devDefault: false }),
  ENABLE_MAGIC_LINKS: bool({ devDefault: false }),

  // OpenKJ
  OPENKJ_LEGACY_API_PREFIX: str({ devDefault: '/api' }),
});

export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
