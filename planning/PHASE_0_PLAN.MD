# Singr Central API Backend - Phase 0

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 0: Project Foundation & Infrastructure Setup

### 0.1 Repository & Tooling Initialization

**Objective:** Establish project structure, tooling, and development environment.

**Duration:** 2-3 days  
**Team Size:** 1-2 developers

**Tasks:**

1. **Initialize monorepo structure:**
   ```
   singr-backend/
   ├── apps/
   │   ├── api/                    # Main Fastify API service
   │   │   ├── src/
   │   │   │   ├── server.ts       # Fastify server setup
   │   │   │   ├── index.ts        # Entry point
   │   │   │   └── routes/         # Route modules
   │   │   ├── tests/              # Integration tests
   │   │   └── package.json
   │   └── worker/                 # BullMQ background worker
   │       ├── src/
   │       │   ├── index.ts
   │       │   ├── jobs/           # Job processors
   │       │   └── handlers/
   │       └── package.json
   ├── packages/
   │   ├── database/               # Prisma schema, migrations
   │   │   ├── prisma/
   │   │   │   ├── schema.prisma
   │   │   │   └── migrations/
   │   │   ├── src/
   │   │   │   └── client.ts
   │   │   └── package.json
   │   ├── auth/                   # JWT, session, RBAC utilities
   │   │   ├── src/
   │   │   │   ├── jwt.ts
   │   │   │   ├── password.ts
   │   │   │   ├── rbac.ts
   │   │   │   └── index.ts
   │   │   └── package.json
   │   ├── config/                 # Environment validation
   │   │   ├── src/
   │   │   │   ├── index.ts
   │   │   │   └── constants.ts
   │   │   └── package.json
   │   ├── shared/                 # DTOs, types, utilities, services
   │   │   ├── src/
   │   │   │   ├── validation/
   │   │   │   ├── services/
   │   │   │   ├── types/
   │   │   │   └── utils/
   │   │   └── package.json
   │   └── observability/          # Logging, Sentry, metrics
   │       ├── src/
   │       │   ├── logger.ts
   │       │   ├── sentry.ts
   │       │   └── metrics.ts
   │       └── package.json
   ├── docker/
   │   ├── api.Dockerfile
   │   ├── worker.Dockerfile
   │   └── docker-compose.yml
   ├── docs/
   │   ├── openapi.yaml
   │   ├── README.md
   │   └── ARCHITECTURE.md
   ├── scripts/
   │   ├── generate-postman.ts
   │   └── seed-database.ts
   ├── pnpm-workspace.yaml
   ├── tsconfig.base.json
   ├── .eslintrc.js
   ├── .prettierrc
   ├── Makefile
   └── package.json
   ```

2. **Configure package manager (pnpm workspace):**
   ```json
   {
     "name": "singr-backend",
     "version": "1.0.0",
     "private": true,
     "description": "Singr Central API Backend",
     "scripts": {
       "dev": "pnpm --recursive dev",
       "build": "pnpm --recursive build",
       "test": "pnpm --recursive test",
       "lint": "eslint . --ext .ts",
       "format": "prettier --write .",
       "type-check": "tsc --noEmit",
       "prepare": "husky install"
     },
     "devDependencies": {
       "@typescript-eslint/eslint-plugin": "^6.x",
       "@typescript-eslint/parser": "^6.x",
       "eslint": "^8.x",
       "husky": "^8.x",
       "lint-staged": "^15.x",
       "prettier": "^3.x",
       "typescript": "^5.x",
       "vitest": "^1.x"
     }
   }
   ```

3. **Set up core dependencies** (in root `package.json`):
   ```json
   {
     "dependencies": {
       "fastify": "^4.x",
       "@fastify/cors": "^9.x",
       "@fastify/helmet": "^11.x",
       "@fastify/jwt": "^7.x",
       "@fastify/rate-limit": "^9.x",
       "@fastify/swagger": "^8.x",
       "@fastify/swagger-ui": "^3.x",
       "@prisma/client": "^5.x",
       "prisma": "^5.x",
       "zod": "^3.x",
       "pino": "^8.x",
       "pino-pretty": "^10.x",
       "@node-rs/argon2": "^1.x",
       "bullmq": "^5.x",
       "ioredis": "^5.x",
       "@sentry/node": "^7.x",
       "envsafe": "^2.x",
       "jsonwebtoken": "^9.x",
       "uuid": "^9.x"
     }
   }
   ```

4. **Initialize Git with `.gitignore`:**
   ```
   # Dependencies
   node_modules/
   .pnpm-store/
   
   # Build outputs
   dist/
   build/
   *.tsbuildinfo
   
   # Environment variables
   .env
   .env.local
   .env.*.local
   
   # IDE
   .vscode/
   .idea/
   *.swp
   *.swo
   *~
   
   # OS
   .DS_Store
   Thumbs.db
   
   # Logs
   logs/
   *.log
   npm-debug.log*
   
   # Prisma
   prisma/*.db
   prisma/*.db-journal
   
   # Test coverage
   coverage/
   .nyc_output/
   ```

5. **Create TypeScript configuration:**
   ```json
   {
     "compilerOptions": {
       "target": "ES2020",
       "module": "ESNext",
       "lib": ["ES2020"],
       "jsx": "react",
       "declaration": true,
       "declarationMap": true,
       "sourceMap": true,
       "outDir": "./dist",
       "rootDir": "./src",
       "strict": true,
       "esModuleInterop": true,
       "skipLibCheck": true,
       "forceConsistentCasingInFileNames": true,
       "resolveJsonModule": true,
       "moduleResolution": "node",
       "allowSyntheticDefaultImports": true,
       "baseUrl": ".",
       "paths": {
         "@singr/database": ["packages/database/src"],
         "@singr/auth": ["packages/auth/src"],
         "@singr/config": ["packages/config/src"],
         "@singr/shared/*": ["packages/shared/src/*"],
         "@singr/observability": ["packages/observability/src"]
       }
     },
     "include": ["src/**/*"],
     "exclude": ["node_modules", "dist"]
   }
   ```

**Deliverables:**
- ✅ Functional monorepo with all packages scaffolded
- ✅ `pnpm install` runs cleanly
- ✅ TypeScript compilation works across all packages
- ✅ Linting and formatting rules enforced
- ✅ Git repository initialized with proper .gitignore
- ✅ CI/CD configuration ready for setup

---

### 0.2 Docker & Local Development Environment

**Objective:** Provide consistent local dev environment with all dependencies.

**Duration:** 1-2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create `docker-compose.yml`:**
   ```yaml
   version: '3.8'
   
   services:
     postgres:
       image: postgis/postgis:16-3.3
       container_name: singr-postgres
       environment:
         POSTGRES_USER: singr
         POSTGRES_PASSWORD: password
         POSTGRES_DB: singr_dev
       ports:
         - "5432:5432"
       volumes:
         - postgres_data:/var/lib/postgresql/data
       healthcheck:
         test: ["CMD-SHELL", "pg_isready -U singr"]
         interval: 10s
         timeout: 5s
         retries: 5
   
     redis:
       image: redis:7-alpine
       container_name: singr-redis
       ports:
         - "6379:6379"
       command: redis-server --appendonly yes
       volumes:
         - redis_data:/data
       healthcheck:
         test: ["CMD", "redis-cli", "ping"]
         interval: 10s
         timeout: 5s
         retries: 5
   
     minio:
       image: minio/minio:latest
       container_name: singr-minio
       environment:
         MINIO_ROOT_USER: minioadmin
         MINIO_ROOT_PASSWORD: minioadmin
       ports:
         - "9000:9000"
         - "9001:9001"
       volumes:
         - minio_data:/data
       command: server /data --console-address ":9001"
       healthcheck:
         test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
         interval: 10s
         timeout: 5s
         retries: 5
   
     mailpit:
       image: axllent/mailpit:latest
       container_name: singr-mailpit
       ports:
         - "1025:1025"
         - "8025:8025"
   
   volumes:
     postgres_data:
     redis_data:
     minio_data:
   ```

2. **Write `Makefile` with commands:**
   ```makefile
   .PHONY: help dev-up dev-down dev-logs db-migrate db-seed db-reset test lint format type-check
   
   help:
   	@echo "Singr Backend Development Commands"
   	@echo "===================================="
   	@echo "make dev-up        - Start all Docker services"
   	@echo "make dev-down      - Stop and remove containers"
   	@echo "make dev-logs      - Tail service logs"
   	@echo "make db-migrate    - Run Prisma migrations"
   	@echo "make db-seed       - Seed database with test data"
   	@echo "make db-reset      - Drop, migrate, and seed"
   	@echo "make test          - Run test suite"
   	@echo "make lint          - Run linters"
   	@echo "make format        - Format code"
   	@echo "make type-check    - Type check without emit"
   
   dev-up:
   	docker-compose -f docker/docker-compose.yml up -d
   	@echo "Waiting for services to be healthy..."
   	@sleep 5
   	@echo "✅ All services started"
   	@echo "Services:"
   	@echo "  PostgreSQL: localhost:5432 (singr/password)"
   	@echo "  Redis: localhost:6379"
   	@echo "  MinIO: localhost:9000 (minioadmin/minioadmin)"
   	@echo "  Mailpit: http://localhost:8025"
   
   dev-down:
   	docker-compose -f docker/docker-compose.yml down
   
   dev-logs:
   	docker-compose -f docker/docker-compose.yml logs -f
   
   db-migrate:
   	pnpm --filter database db:migrate:dev
   
   db-seed:
   	pnpm --filter database db:seed
   
   db-reset: dev-down dev-up db-migrate db-seed
   	@echo "✅ Database reset complete"
   
   test:
   	pnpm --recursive test
   
   lint:
   	pnpm lint
   
   format:
   	pnpm format
   
   type-check:
   	pnpm type-check
   ```

3. **Configure environment variables template (`.env.example`):**
   ```bash
   # Application
   NODE_ENV=development
   PORT=3000
   LOG_LEVEL=debug
   
   # Database
   DATABASE_URL=postgresql://singr:password@localhost:5432/singr_dev
   
   # Redis
   REDIS_URL=redis://localhost:6379
   
   # Storage (S3/MinIO)
   S3_ENDPOINT=http://localhost:9000
   S3_ACCESS_KEY_ID=minioadmin
   S3_SECRET_ACCESS_KEY=minioadmin
   S3_BUCKET=singr-assets
   S3_REGION=us-east-1
   
   # JWT
   JWT_PRIVATE_KEY=-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----
   JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
   JWT_ISSUER=system.singrkaraoke.com
   JWT_AUDIENCE=system.singrkaraoke.com
   JWT_ACCESS_TTL=900
   JWT_REFRESH_TTL=604800
   
   # Session & Secrets
   AUTH_SECRET=your-256-bit-secret-key-here
   
   # Sentry
   SENTRY_DSN=
   
   # Stripe
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   
   # Email
   EMAIL_FROM=noreply@singrkaraoke.com
   EMAIL_PROVIDER=mailpit
   SMTP_HOST=localhost
   SMTP_PORT=1025
   SMTP_USER=
   SMTP_PASSWORD=
   
   # CORS
   CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002
   
   # Logging
   ENABLE_REQUEST_LOGGING=true
   ```

4. **Document setup in `README.md`:**
   ```markdown
   # Singr Backend

   Central API backend for the Singr karaoke platform.

   ## Prerequisites

   - Node.js 20+
   - pnpm 8+
   - Docker and Docker Compose
   - Git

   ## Quick Start

   1. **Clone repository:**
      \`\`\`bash
      git clone https://github.com/kirkphillip605/singr-backend.git
      cd singr-backend
      \`\`\`

   2. **Install dependencies:**
      \`\`\`bash
      pnpm install
      \`\`\`

   3. **Set up environment:**
      \`\`\`bash
      cp .env.example .env
      \`\`\`

   4. **Start services:**
      \`\`\`bash
      make dev-up
      \`\`\`

   5. **Run migrations:**
      \`\`\`bash
      make db-migrate
      \`\`\`

   6. **Seed database:**
      \`\`\`bash
      make db-seed
      \`\`\`

   7. **Start development server:**
      \`\`\`bash
      pnpm dev
      \`\`\`

   API will be available at `http://localhost:3000`

   ## Architecture

   See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for detailed architecture documentation.

   ## Contributing

   See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.
   ```

**Deliverables:**
- ✅ `docker-compose.yml` starts all services with health checks
- ✅ PostgreSQL accessible with PostGIS enabled
- ✅ Redis accessible and responding to PING
- ✅ MinIO accessible with bucket auto-created
- ✅ Mailpit accessible for email testing
- ✅ `make` commands for common tasks
- ✅ Comprehensive README with setup instructions

---

### 0.3 Configuration & Secrets Management

**Objective:** Type-safe, validated configuration system with email and SMS provider credentials.

**Duration:** 1-2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create `packages/config/src/index.ts`:**
   ```typescript
   import { envsafe, str, url, port, num, bool } from 'envsafe';

   export const config = envsafe({
     // Application
     NODE_ENV: str({
       choices: ['development', 'test', 'production'],
       default: 'development',
     }),
     PORT: port({ default: 3000 }),
     LOG_LEVEL: str({
       choices: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
       default: 'info',
     }),

     // Database
     DATABASE_URL: url(),

     // Cache & Session
     REDIS_URL: url(),

     // Storage
     S3_ENDPOINT: url(),
     S3_ACCESS_KEY_ID: str(),
     S3_SECRET_ACCESS_KEY: str(),
     S3_BUCKET: str(),
     S3_REGION: str({ default: 'us-east-1' }),

     // JWT
     JWT_PRIVATE_KEY: str(),
     JWT_PUBLIC_KEY: str(),
     JWT_ISSUER: str({ default: 'system.singrkaraoke.com' }),
     JWT_AUDIENCE: str({ default: 'system.singrkaraoke.com' }),
     JWT_ACCESS_TTL: num({ default: 900 }), // 15 minutes
     JWT_REFRESH_TTL: num({ default: 604800 }), // 7 days

     // Session & Magic Links
     AUTH_SECRET: str(),
     MAGIC_LINK_TTL: num({ default: 900 }), // 15 minutes

     // 2FA Settings
     TWO_FACTOR_ISSUER: str({ default: 'Singr' }),
     TWO_FACTOR_WINDOW: num({ default: 1 }), // TOTP window tolerance

     // Observability
     SENTRY_DSN: str({ default: '' }),
     ENABLE_REQUEST_LOGGING: bool({ default: true }),

     // Stripe
     STRIPE_SECRET_KEY: str(),
     STRIPE_WEBHOOK_SECRET: str(),
     STRIPE_PUBLISHABLE_KEY: str(),

     // Mailjet Email Service
     MAILJET_API_KEY: str(),
     MAILJET_SECRET_KEY: str(),
     MAILJET_FROM_EMAIL: str({ default: 'noreply@singrkaraoke.com' }),
     MAILJET_FROM_NAME: str({ default: 'Singr' }),
     MAILJET_TEMPLATE_VERIFICATION: num({ default: 0 }), // Template IDs
     MAILJET_TEMPLATE_PASSWORD_RESET: num({ default: 0 }),
     MAILJET_TEMPLATE_MAGIC_LINK: num({ default: 0 }),
     MAILJET_TEMPLATE_TWO_FACTOR: num({ default: 0 }),
     MAILJET_TEMPLATE_WELCOME: num({ default: 0 }),
     MAILJET_TEMPLATE_INVITATION: num({ default: 0 }),

     // Twilio SMS Service
     TWILIO_ACCOUNT_SID: str(),
     TWILIO_AUTH_TOKEN: str(),
     TWILIO_PHONE_NUMBER: str(), // E.164 format
     TWILIO_VERIFY_SERVICE_SID: str({ default: '' }), // Optional: Use Twilio Verify API

     // Email/SMS Feature Flags
     ENABLE_EMAIL_SENDING: bool({ default: true }),
     ENABLE_SMS_SENDING: bool({ default: true }),
     EMAIL_PROVIDER: str({
       choices: ['mailjet', 'console'],
       default: 'mailjet',
     }), // 'console' for dev
     SMS_PROVIDER: str({
       choices: ['twilio', 'console'],
       default: 'twilio',
     }), // 'console' for dev

     // Rate Limiting for Communication
     EMAIL_RATE_LIMIT_MAX: num({ default: 10 }), // Per user per hour
     SMS_RATE_LIMIT_MAX: num({ default: 5 }), // Per user per hour

     // Application URLs (for email links)
     APP_URL_WEB: url({ default: 'http://localhost:3000' }),
     APP_URL_CUSTOMER: url({ default: 'http://localhost:3001' }),
     APP_URL_API: url({ default: 'http://localhost:3000' }),

     // CORS
     CORS_ORIGINS: str({
       default: 'http://localhost:3000,http://localhost:3001,http://localhost:3002',
     }),
   });
   ```

2. **Create `packages/config/src/constants.ts`:**
   ```typescript
   export const RATE_LIMITS = {
     AUTH_SIGNIN: { max: 5, window: '1m' },
     AUTH_REGISTER: { max: 3, window: '1h' },
     AUTH_PASSWORD_RESET: { max: 5, window: '1h' },
     AUTH_MAGIC_LINK: { max: 5, window: '1h' },
     AUTH_TWO_FACTOR_REQUEST: { max: 5, window: '1h' },
     AUTH_TWO_FACTOR_VERIFY: { max: 10, window: '15m' },
     PUBLIC_VENUES: { max: 60, window: '1m' },
     PUBLIC_SONGS_SEARCH: { max: 60, window: '1m' },
     PUBLIC_REQUESTS: { max: 10, window: '1h' },
     SINGER_REQUEST: { max: 10, window: '1h' },
     SINGER_QUICK_REQUEST: { max: 10, window: '1h' },
     CUSTOMER_API: { max: 100, window: '1m' },
     CUSTOMER_SONGDB_IMPORT: { max: 10, window: '1h' },
     ADMIN_API: { max: 200, window: '1m' },
   };

   export const CACHE_TTL = {
     VENUES_LIST: 300, // 5 minutes
     VENUE_DETAIL: 600, // 10 minutes
     SONGDB_SEARCH: 300, // 5 minutes
     PERMISSIONS: 1800, // 30 minutes
     PUBLIC_BRANDING: 3600, // 1 hour
     TWO_FACTOR_CODE: 300, // 5 minutes
   };

   export const PAGINATION = {
     DEFAULT_LIMIT: 20,
     MAX_LIMIT: 100,
     MIN_LIMIT: 1,
   };

   export const PAGINATION_LIMITS = {
     VENUES: { default: 20, max: 100 },
     SONGS: { default: 20, max: 100 },
     REQUESTS: { default: 20, max: 100 },
     USERS: { default: 20, max: 50 },
   };

   export const PASSWORD_CONFIG = {
     memoryCost: 19456, // 19 MB
     timeCost: 2,
     outputLen: 32,
     parallelism: 1,
   };

   export const API_KEY_PREFIX = 'sk_live_';

   export const TOKEN_EXPIRY = {
     INVITATION: 7 * 24 * 60 * 60 * 1000, // 7 days
     EMAIL_VERIFICATION: 24 * 60 * 60 * 1000, // 24 hours
     PASSWORD_RESET: 60 * 60 * 1000, // 1 hour
     MAGIC_LINK: 15 * 60 * 1000, // 15 minutes
     TWO_FACTOR_BACKUP: 0, // Never expires until used
   };

   export const TWO_FACTOR = {
     TOTP_WINDOW: 1, // Allow 1 step before/after for clock skew
     TOTP_STEP: 30, // 30 second intervals
     SMS_CODE_LENGTH: 6,
     SMS_CODE_TTL: 300, // 5 minutes
     BACKUP_CODE_COUNT: 10,
     BACKUP_CODE_LENGTH: 8,
   };

   export const EMAIL_TYPES = {
     VERIFICATION: 'email_verification',
     PASSWORD_RESET: 'password_reset',
     MAGIC_LINK: 'magic_link',
     TWO_FACTOR_CODE: 'two_factor_code',
     WELCOME: 'welcome',
     INVITATION: 'invitation',
     REQUEST_NOTIFICATION: 'request_notification',
   };

   export const SMS_TYPES = {
     VERIFICATION: 'sms_verification',
     TWO_FACTOR_CODE: 'two_factor_code',
     MAGIC_LINK: 'magic_link',
   };

   export const DEFAULT_ROLES = [
     { slug: 'admin', description: 'Platform administrator', isSystem: true },
     { slug: 'support_admin', description: 'Support team admin', isSystem: true },
     { slug: 'customer_owner', description: 'Customer account owner', isSystem: true },
     { slug: 'customer_manager', description: 'Customer manager', isSystem: true },
     { slug: 'customer_staff', description: 'Customer staff member', isSystem: true },
     { slug: 'singer', description: 'Singer user', isSystem: true },
   ];

   export const DEFAULT_PERMISSIONS = [
     // Venue permissions
     { slug: 'venues:read', description: 'View venues' },
     { slug: 'venues:write', description: 'Create/edit venues' },
     { slug: 'venues:delete', description: 'Delete venues' },

     // System permissions
     { slug: 'systems:read', description: 'View systems' },
     { slug: 'systems:write', description: 'Create/edit systems' },

     // API key permissions
     { slug: 'api_keys:read', description: 'View API keys' },
     { slug: 'api_keys:write', description: 'Create/rotate API keys' },
     { slug: 'api_keys:revoke', description: 'Revoke API keys' },

     // Songdb permissions
     { slug: 'songdb:read', description: 'View songdb' },
     { slug: 'songdb:write', description: 'Manage songdb' },

     // Request permissions
     { slug: 'requests:read', description: 'View requests' },
     { slug: 'requests:process', description: 'Process requests' },

     // Organization permissions
     { slug: 'organization:read', description: 'View organization members' },
     { slug: 'organization:write', description: 'Manage organization members' },

     // Billing permissions
     { slug: 'billing:read', description: 'View billing' },
     { slug: 'billing:write', description: 'Manage subscriptions' },

     // Branding permissions
     { slug: 'branding:read', description: 'View branding' },
     { slug: 'branding:write', description: 'Edit branding' },
   ];

   export const MAILJET_SANDBOX_MODE = {
     enabled: process.env.NODE_ENV === 'development',
     testEmail: 'test@singrkaraoke.com',
   };

   export const COMMUNICATION_RETRY = {
     maxAttempts: 3,
     backoffMs: 1000, // Start with 1 second
     backoffMultiplier: 2, // Double each retry
   };
   ```

3. **Update `.env.example`:**
   ```bash
   # Application
   NODE_ENV=development
   PORT=3000
   LOG_LEVEL=debug

   # Database
   DATABASE_URL=postgresql://singr:password@localhost:5432/singr_dev

   # Redis
   REDIS_URL=redis://localhost:6379

   # Storage (S3/MinIO)
   S3_ENDPOINT=http://localhost:9000
   S3_ACCESS_KEY_ID=minioadmin
   S3_SECRET_ACCESS_KEY=minioadmin
   S3_BUCKET=singr-assets
   S3_REGION=us-east-1

   # JWT (Generate with: openssl ecparam -genkey -name prime256v1 -noout -out jwt-private.pem)
   JWT_PRIVATE_KEY=-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----
   JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
   JWT_ISSUER=system.singrkaraoke.com
   JWT_AUDIENCE=system.singrkaraoke.com
   JWT_ACCESS_TTL=900
   JWT_REFRESH_TTL=604800

   # Session & Magic Links
   AUTH_SECRET=your-256-bit-secret-key-here-generate-with-openssl-rand-hex-32
   MAGIC_LINK_TTL=900

   # 2FA Settings
   TWO_FACTOR_ISSUER=Singr
   TWO_FACTOR_WINDOW=1

   # Sentry
   SENTRY_DSN=

   # Stripe
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...

   # Mailjet Configuration
   # Get credentials from: https://app.mailjet.com/account/api_keys
   MAILJET_API_KEY=your-mailjet-api-key
   MAILJET_SECRET_KEY=your-mailjet-secret-key
   MAILJET_FROM_EMAIL=noreply@singrkaraoke.com
   MAILJET_FROM_NAME=Singr

   # Mailjet Template IDs (create templates in Mailjet dashboard)
   MAILJET_TEMPLATE_VERIFICATION=0
   MAILJET_TEMPLATE_PASSWORD_RESET=0
   MAILJET_TEMPLATE_MAGIC_LINK=0
   MAILJET_TEMPLATE_TWO_FACTOR=0
   MAILJET_TEMPLATE_WELCOME=0
   MAILJET_TEMPLATE_INVITATION=0

   # Twilio Configuration
   # Get credentials from: https://console.twilio.com/
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your-auth-token
   TWILIO_PHONE_NUMBER=+15555551234
   TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxx

   # Communication Feature Flags
   ENABLE_EMAIL_SENDING=true
   ENABLE_SMS_SENDING=true
   EMAIL_PROVIDER=mailjet
   SMS_PROVIDER=twilio

   # Communication Rate Limits
   EMAIL_RATE_LIMIT_MAX=10
   SMS_RATE_LIMIT_MAX=5

   # Application URLs (used in email/SMS links)
   APP_URL_WEB=http://localhost:3000
   APP_URL_CUSTOMER=http://localhost:3001
   APP_URL_API=http://localhost:3000

   # CORS
   CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002

   # Logging
   ENABLE_REQUEST_LOGGING=true
   ```

4. **Create configuration documentation in `docs/CONFIGURATION.md`:**
   ````markdown
   # Configuration Guide

   ## Environment Variables

   ### Required Variables

   All variables in `.env.example` marked as required must be set before starting the application.

   ### Email Configuration (Mailjet)

   1. **Sign up for Mailjet**: https://app.mailjet.com/signup
   2. **Get API credentials**: Navigate to Account Settings → API Key Management
   3. **Create email templates**:
      - Go to Transactional → Templates
      - Create templates for each email type
      - Note the template IDs and add to `.env`

   **Template Variables Required:**

   - **Verification Email** (`MAILJET_TEMPLATE_VERIFICATION`):
     - `{{user_name}}` - User's name
     - `{{verification_link}}` - Full verification URL
     - `{{verification_code}}` - 6-digit code (backup)

   - **Password Reset** (`MAILJET_TEMPLATE_PASSWORD_RESET`):
     - `{{user_name}}` - User's name
     - `{{reset_link}}` - Full password reset URL
     - `{{expiry_minutes}}` - Link expiration time

   - **Magic Link** (`MAILJET_TEMPLATE_MAGIC_LINK`):
     - `{{user_email}}` - User's email
     - `{{magic_link}}` - One-time sign-in URL
     - `{{expiry_minutes}}` - Link expiration time
     - `{{ip_address}}` - Request IP (security)

   - **2FA Code** (`MAILJET_TEMPLATE_TWO_FACTOR`):
     - `{{user_name}}` - User's name
     - `{{code}}` - 6-digit verification code
     - `{{expiry_minutes}}` - Code expiration time

   ### SMS Configuration (Twilio)

   1. **Sign up for Twilio**: https://www.twilio.com/try-twilio
   2. **Get Account SID and Auth Token**: Console Dashboard
   3. **Buy a phone number**: Phone Numbers → Buy a Number
   4. **Optional - Set up Verify API**:
      - More efficient for OTP codes
      - Navigate to Verify → Services
      - Create a service and note the Service SID

   ### JWT Key Generation

   Generate ES256 keys for production:

   ```bash
   # Generate private key
   openssl ecparam -genkey -name prime256v1 -noout -out jwt-private.pem

   # Generate public key
   openssl ec -in jwt-private.pem -pubout -out jwt-public.pem

   # View keys for .env (copy entire output including headers)
   cat jwt-private.pem
   cat jwt-public.pem
   ```

   ### Auth Secret Generation

   ```bash
   openssl rand -hex 32
   ```

   ## Development vs Production

   ### Development Settings

   ```bash
   NODE_ENV=development
   EMAIL_PROVIDER=console  # Logs emails to console
   SMS_PROVIDER=console    # Logs SMS to console
   ENABLE_EMAIL_SENDING=false
   ENABLE_SMS_SENDING=false
   ```

   ### Production Settings

   ```bash
   NODE_ENV=production
   EMAIL_PROVIDER=mailjet
   SMS_PROVIDER=twilio
   ENABLE_EMAIL_SENDING=true
   ENABLE_SMS_SENDING=true
   ```

   ## Rate Limiting

   Communication rate limits prevent abuse:

   - **Email**: 10 per user per hour (configurable via `EMAIL_RATE_LIMIT_MAX`)
   - **SMS**: 5 per user per hour (configurable via `SMS_RATE_LIMIT_MAX`)

   ## Troubleshooting

   ### Mailjet Issues

   - **401 Unauthorized**: Check API key and secret
   - **Template not found**: Verify template IDs in Mailjet dashboard
   - **Emails not sending**: Check sender domain verification
   - **Sandbox mode**: In development, Mailjet may require domain verification

   ### Twilio Issues

   - **403 Forbidden**: Check account status and auth token
   - **Invalid phone number**: Ensure E.164 format (+15555551234)
   - **SMS not delivered**: Check phone number verification (trial accounts)
   - **Rate limits**: Twilio has its own rate limits separate from application

   ## Security Best Practices

   1. **Never commit `.env` files**
   2. **Rotate API keys regularly** (every 90 days)
   3. **Use different keys per environment**
   4. **Monitor usage in Mailjet/Twilio dashboards**
   5. **Set up webhook security** (verify signatures)
   6. **Use environment-specific sending domains**
   ````

**Deliverables:**
- ✅ Validated environment variables with `envsafe`
- ✅ Mailjet API credentials configuration
- ✅ Twilio API credentials configuration
- ✅ Email template ID management
- ✅ SMS configuration with Twilio Verify support
- ✅ Feature flags for email/SMS providers
- ✅ Development vs production provider switching
- ✅ Rate limit configurations for communications
- ✅ Application URLs for email/SMS links
- ✅ 2FA configuration constants
- ✅ Magic link TTL configuration
- ✅ Comprehensive documentation with setup guides
- ✅ Token expiry constants
- ✅ Communication retry configuration

---

### 0.4 Observability Foundation

**Objective:** Set up structured logging, error tracking, and metrics.

**Duration:** 1-2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create `packages/observability/src/logger.ts`:**
   ```typescript
   import pino from 'pino';
   import { config } from '@singr/config';
   
   const isDevelopment = config.NODE_ENV === 'development';
   
   export const logger = pino({
     level: config.LOG_LEVEL,
     formatters: {
       level: (label) => ({ level: label.toUpperCase() }),
       bindings: (bindings) => ({
         pid: bindings.pid,
         hostname: bindings.hostname,
       }),
     },
     timestamp: pino.stdTimeFunctions.isoTime,
     redact: {
       paths: [
         'req.headers.authorization',
         'req.headers["x-api-key"]',
         'password',
         'passwordHash',
         'apiKeyHash',
         'refreshToken',
         'accessToken',
       ],
       remove: true,
     },
     serializers: {
       req: (req: any) => ({
         method: req.method,
         url: req.url,
         headers: {
           host: req.headers.host,
           'user-agent': req.headers['user-agent'],
         },
       }),
       res: (res: any) => ({
         statusCode: res.statusCode,
       }),
       err: pino.stdSerializers.err,
     },
     ...(isDevelopment && {
       transport: {
         target: 'pino-pretty',
         options: {
           colorize: true,
           singleLine: false,
           translateTime: 'SYS:standard',
           ignore: 'pid,hostname',
         },
       },
     }),
   });
   
   // Create child loggers by module
   export function createLogger(module: string) {
     return logger.child({ module });
   }
   ```

2. **Initialize Sentry in `packages/observability/src/sentry.ts`:**
   ```typescript
   import * as Sentry from '@sentry/node';
   import { config } from '@singr/config';
   import { logger } from './logger';
   
   export function initSentry() {
     if (!config.SENTRY_DSN) {
       logger.debug('Sentry not configured (SENTRY_DSN not set)');
       return;
     }
   
     Sentry.init({
       dsn: config.SENTRY_DSN,
       environment: config.NODE_ENV,
       tracesSampleRate: config.NODE_ENV === 'production' ? 0.1 : 1.0,
       integrations: [
         new Sentry.Integrations.Http({ tracing: true }),
         new Sentry.Integrations.OnUncaughtException(),
         new Sentry.Integrations.OnUnhandledRejection(),
       ],
       beforeSend(event, hint) {
         // Filter out known non-critical errors
         if (event.exception) {
           const error = hint.originalException;
           if (error instanceof Error) {
             if (error.message.includes('ECONNREFUSED')) {
               return null; // Skip connection errors in development
             }
           }
         }
         return event;
       },
     });
   
     logger.info('Sentry initialized');
   }
   
   export { Sentry };
   ```

3. **Create correlation ID middleware for request tracing:**
   ```typescript
   // packages/observability/src/middleware/correlation-id.ts
   import { randomUUID } from 'crypto';
   import { FastifyRequest, FastifyReply } from 'fastify';
   
   export async function correlationIdMiddleware(
     request: FastifyRequest,
     reply: FastifyReply
   ) {
     const correlationId =
       (request.headers['x-request-id'] as string) || randomUUID();
   
     request.headers['x-request-id'] = correlationId;
     reply.header('x-request-id', correlationId);
   
     // Enhance logger with correlation ID
     request.log = request.log.child({ correlationId });
   
     // Make available in Sentry
     if (request.user) {
       Sentry.setTag('correlationId', correlationId);
       Sentry.setUser({
         id: request.user.sub,
         email: request.user.email,
       });
     }
   }
   ```

4. **Create metrics endpoint:**
   ```typescript
   // packages/observability/src/metrics.ts
   import { FastifyInstance } from 'fastify';
   
   export class MetricsCollector {
     private requestCount = 0;
     private errorCount = 0;
     private totalLatency = 0;
     private requestCounts: Record<string, number> = {};
   
     recordRequest(method: string, path: string, statusCode: number, duration: number) {
       this.requestCount++;
       this.totalLatency += duration;
   
       const key = `${method} ${path}`;
       this.requestCounts[key] = (this.requestCounts[key] || 0) + 1;
   
       if (statusCode >= 400) {
         this.errorCount++;
       }
     }
   
     getMetrics() {
       return {
         uptime: process.uptime(),
         memory: process.memoryUsage(),
         totalRequests: this.requestCount,
         totalErrors: this.errorCount,
         avgLatency: this.requestCount > 0 ? this.totalLatency / this.requestCount : 0,
         requestsByEndpoint: this.requestCounts,
       };
     }
   
     toPrometheusFormat() {
       const metrics = this.getMetrics();
       return [
         `# HELP singr_requests_total Total number of requests`,
         `# TYPE singr_requests_total counter`,
         `singr_requests_total ${metrics.totalRequests}`,
         `# HELP singr_errors_total Total number of errors`,
         `# TYPE singr_errors_total counter`,
         `singr_errors_total ${metrics.totalErrors}`,
         `# HELP singr_latency_avg Average request latency in ms`,
         `# TYPE singr_latency_avg gauge`,
         `singr_latency_avg ${metrics.avgLatency}`,
       ].join('\n');
     }
   }
   
   export function registerMetricsEndpoint(
     fastify: FastifyInstance,
     collector: MetricsCollector
   ) {
     fastify.get('/metrics', async (request, reply) => {
       return reply
         .type('text/plain; version=0.0.4')
         .send(collector.toPrometheusFormat());
     });
   }
   ```

**Deliverables:**
- ✅ Structured JSON logging with pino
- ✅ Sentry error tracking configured
- ✅ Correlation IDs in all requests
- ✅ Sensitive data redacted from logs
- ✅ Prometheus-compatible metrics endpoint
- ✅ Request/error/latency metrics

---


### 0.5: Communication Infrastructure

**Objective:** Set up Mailjet, Twilio, email templates, SMS formatting, and BullMQ worker for async delivery.

**Duration:** 3-4 days  
**Team Size:** 1-2 developers

### 0.5.1 Mailjet Email Service

**Tasks:**

1. **Create Mailjet client in `packages/shared/src/services/email/mailjet-client.ts`:**
   ```typescript
   import Mailjet from 'node-mailjet';
   import { config } from '@singr/config';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('services:mailjet');

   export const mailjetClient = Mailjet.apiConnect(
     config.MAILJET_API_KEY,
     config.MAILJET_SECRET_KEY
   );

   export interface SendEmailParams {
     to: string;
     toName?: string;
     subject: string;
     templateId?: number;
     variables?: Record<string, any>;
     htmlPart?: string;
     textPart?: string;
   }

   export async function sendEmail(params: SendEmailParams): Promise<boolean> {
     try {
       if (!config.ENABLE_EMAIL_SENDING) {
         logger.info(
           {
             to: params.to,
             subject: params.subject,
             templateId: params.templateId,
           },
           'Email sending disabled - would have sent'
         );
         return true;
       }

       if (config.EMAIL_PROVIDER === 'console') {
         logger.info(
           {
             to: params.to,
             toName: params.toName,
             subject: params.subject,
             templateId: params.templateId,
             variables: params.variables,
           },
           '📧 EMAIL (Console Provider)'
         );
         return true;
       }

       const request = mailjetClient.post('send', { version: 'v3.1' });

       const message: any = {
         From: {
           Email: config.MAILJET_FROM_EMAIL,
           Name: config.MAILJET_FROM_NAME,
         },
         To: [
           {
             Email: params.to,
             Name: params.toName || params.to,
           },
         ],
         Subject: params.subject,
       };

       if (params.templateId) {
         message.TemplateID = params.templateId;
         message.TemplateLanguage = true;
         message.Variables = params.variables || {};
       } else {
         message.HTMLPart = params.htmlPart;
         message.TextPart = params.textPart;
       }

       const result = await request.request({
         Messages: [message],
       });

       logger.info(
         {
           to: params.to,
           subject: params.subject,
           messageId: result.body.Messages[0]?.To[0]?.MessageID,
         },
         'Email sent via Mailjet'
       );

       return true;
     } catch (error) {
       logger.error(
         {
           error,
           to: params.to,
           subject: params.subject,
         },
         'Failed to send email via Mailjet'
       );
       throw new Error('Failed to send email');
     }
   }

   export async function sendBulkEmail(
     emails: SendEmailParams[]
   ): Promise<boolean> {
     try {
       if (!config.ENABLE_EMAIL_SENDING || config.EMAIL_PROVIDER === 'console') {
         logger.info({ count: emails.length }, 'Bulk email (console mode)');
         return true;
       }

       const request = mailjetClient.post('send', { version: 'v3.1' });

       const messages = emails.map((params) => ({
         From: {
           Email: config.MAILJET_FROM_EMAIL,
           Name: config.MAILJET_FROM_NAME,
         },
         To: [
           {
             Email: params.to,
             Name: params.toName || params.to,
           },
         ],
         Subject: params.subject,
         TemplateID: params.templateId,
         TemplateLanguage: true,
         Variables: params.variables || {},
       }));

       await request.request({ Messages: messages });

       logger.info({ count: emails.length }, 'Bulk emails sent via Mailjet');

       return true;
     } catch (error) {
       logger.error({ error, count: emails.length }, 'Failed to send bulk emails');
       throw new Error('Failed to send bulk emails');
     }
   }
   ```

2. **Create email service with templates in `packages/shared/src/services/email/email-service.ts`:**
   ```typescript
   import { config, TOKEN_EXPIRY } from '@singr/config';
   import { sendEmail } from './mailjet-client';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('services:email');

   export class EmailService {
     async sendVerificationEmail(
       to: string,
       name: string,
       verificationToken: string
     ): Promise<void> {
       const verificationLink = `${config.APP_URL_WEB}/verify-email?token=${verificationToken}`;

       await sendEmail({
         to,
         toName: name,
         subject: 'Verify your Singr account',
         templateId: config.MAILJET_TEMPLATE_VERIFICATION,
         variables: {
           user_name: name,
           verification_link: verificationLink,
           verification_code: verificationToken.substring(0, 6).toUpperCase(),
           expiry_hours: Math.floor(TOKEN_EXPIRY.EMAIL_VERIFICATION / (1000 * 60 * 60)),
         },
       });

       logger.info({ to, name }, 'Verification email queued');
     }

     async sendPasswordResetEmail(
       to: string,
       name: string,
       resetToken: string
     ): Promise<void> {
       const resetLink = `${config.APP_URL_WEB}/reset-password?token=${resetToken}`;

       await sendEmail({
         to,
         toName: name,
         subject: 'Reset your Singr password',
         templateId: config.MAILJET_TEMPLATE_PASSWORD_RESET,
         variables: {
           user_name: name,
           reset_link: resetLink,
           expiry_minutes: Math.floor(TOKEN_EXPIRY.PASSWORD_RESET / (1000 * 60)),
         },
       });

       logger.info({ to, name }, 'Password reset email queued');
     }

     async sendMagicLinkEmail(
       to: string,
       magicToken: string,
       ipAddress: string
     ): Promise<void> {
       const magicLink = `${config.APP_URL_WEB}/auth/magic?token=${magicToken}`;

       await sendEmail({
         to,
         subject: 'Sign in to Singr',
         templateId: config.MAILJET_TEMPLATE_MAGIC_LINK,
         variables: {
           user_email: to,
           magic_link: magicLink,
           expiry_minutes: Math.floor(config.MAGIC_LINK_TTL / 60),
           ip_address: ipAddress,
         },
       });

       logger.info({ to, ipAddress }, 'Magic link email queued');
     }

     async sendTwoFactorEmail(
       to: string,
       name: string,
       code: string
     ): Promise<void> {
       await sendEmail({
         to,
         toName: name,
         subject: 'Your Singr verification code',
         templateId: config.MAILJET_TEMPLATE_TWO_FACTOR,
         variables: {
           user_name: name,
           code,
           expiry_minutes: 5,
         },
       });

       logger.info({ to, name }, '2FA code email queued');
     }

     async sendWelcomeEmail(
       to: string,
       name: string,
       accountType: 'customer' | 'singer'
     ): Promise<void> {
       await sendEmail({
         to,
         toName: name,
         subject: 'Welcome to Singr!',
         templateId: config.MAILJET_TEMPLATE_WELCOME,
         variables: {
           user_name: name,
           account_type: accountType,
           dashboard_link:
             accountType === 'customer'
               ? config.APP_URL_CUSTOMER
               : config.APP_URL_WEB,
         },
       });

       logger.info({ to, name, accountType }, 'Welcome email queued');
     }

     async sendInvitationEmail(
       to: string,
       inviterName: string,
       organizationName: string,
       invitationToken: string
     ): Promise<void> {
       const invitationLink = `${config.APP_URL_CUSTOMER}/invitation?token=${invitationToken}`;

       await sendEmail({
         to,
         subject: `${inviterName} invited you to ${organizationName}`,
         templateId: config.MAILJET_TEMPLATE_INVITATION,
         variables: {
           inviter_name: inviterName,
           organization_name: organizationName,
           invitation_link: invitationLink,
           expiry_days: Math.floor(TOKEN_EXPIRY.INVITATION / (1000 * 60 * 60 * 24)),
         },
       });

       logger.info({ to, inviterName, organizationName }, 'Invitation email queued');
     }

     async sendRequestNotification(
       to: string,
       venueName: string,
       artist: string,
       title: string,
       singerName?: string
     ): Promise<void> {
       await sendEmail({
         to,
         subject: `New song request at ${venueName}`,
         htmlPart: `
           <h2>New Song Request</h2>
           <p><strong>Venue:</strong> ${venueName}</p>
           <p><strong>Song:</strong> ${artist} - ${title}</p>
           ${singerName ? `<p><strong>Requested by:</strong> ${singerName}</p>` : ''}
           <p><a href="${config.APP_URL_CUSTOMER}/requests">View Request</a></p>
         `,
         textPart: `New song request at ${venueName}: ${artist} - ${title}${
           singerName ? ` (by ${singerName})` : ''
         }`,
       });

       logger.info({ to, venueName, artist, title }, 'Request notification email queued');
     }
   }
   ```

### 0.5.2 Twilio SMS Service

**Tasks:**

1. **Create Twilio client in `packages/shared/src/services/sms/twilio-client.ts`:**
   ```typescript
   import twilio from 'twilio';
   import { config } from '@singr/config';
   import { createLogger } from '@singr/observability';

   const logger = createLogger('services:twilio');

   export const twilioClient = twilio(
     config.TWILIO_ACCOUNT_SID,
     config.TWILIO_AUTH_TOKEN
   );

   export interface SendSMSParams {
     to: string;
     body: string;
   }

   export async function sendSMS(params: SendSMSParams): Promise<boolean> {
     try {
       if (!config.ENABLE_SMS_SENDING) {
         logger.info(
           {
             to: params.to,
             body: params.body,
           },
           'SMS sending disabled - would have sent'
         );
         return true;
       }

       if (config.SMS_PROVIDER === 'console') {
         logger.info(
           {
             to: params.to,
             body: params.body,
           },
           '📱 SMS (Console Provider)'
         );
         return true;
       }

       const message = await twilioClient.messages.create({
         body: params.body,
         from: config.TWILIO_PHONE_NUMBER,
         to: params.to,
       });

       logger.info(
         {
           to: params.to,
           messageSid: message.sid,
           status: message.status,
         },
         'SMS sent via Twilio'
       );

       return true;
     } catch (error) {
       logger.error(
         {
           error,
           to: params.to,
         },
         'Failed to send SMS via Twilio'
       );
       throw new Error('Failed to send SMS');
     }
   }

   export async function sendVerificationCode(
     to: string,
     channel: 'sms' | 'call' = 'sms'
   ): Promise<string> {
     try {
       if (!config.TWILIO_VERIFY_SERVICE_SID) {
         throw new Error('Twilio Verify Service SID not configured');
       }

       if (config.SMS_PROVIDER === 'console') {
         const mockCode = '123456';
         logger.info({ to, channel }, `📱 Verification Code: ${mockCode}`);
         return mockCode;
       }

       const verification = await twilioClient.verify.v2
         .services(config.TWILIO_VERIFY_SERVICE_SID)
         .verifications.create({ to, channel });

       logger.info(
         {
           to,
           channel,
           status: verification.status,
         },
         'Verification code sent via Twilio Verify'
       );

       return verification.sid;
     } catch (error) {
       logger.error({ error, to, channel }, 'Failed to send verification code');
       throw new Error('Failed to send verification code');
     }
   }

   export async function checkVerificationCode(
     to: string,
     code: string
   ): Promise<boolean> {
     try {
       if (!config.TWILIO_VERIFY_SERVICE_SID) {
         throw new Error('Twilio Verify Service SID not configured');
       }

       if (config.SMS_PROVIDER === 'console') {
         logger.info({ to, code }, '📱 Verification check (console - always true)');
         return code === '123456';
       }

       const verificationCheck = await twilioClient.verify.v2
         .services(config.TWILIO_VERIFY_SERVICE_SID)
         .verificationChecks.create({ to, code });

       logger.info(
         {
           to,
           status: verificationCheck.status,
         },
         'Verification code checked'
       );

       return verificationCheck.status === 'approved';
     } catch (error) {
       logger.error({ error, to }, 'Failed to check verification code');
       return false;
     }
   }
   ```

2. **Create SMS service in `packages/shared/src/services/sms/sms-service.ts`:**
   ```typescript
   import { sendSMS, sendVerificationCode, checkVerificationCode } from './twilio-client';
   import { config, TWO_FACTOR } from '@singr/config';
   import { createLogger } from '@singr/observability';
   import { randomInt } from 'crypto';

   const logger = createLogger('services:sms');

   export class SMSService {
     async sendVerificationSMS(to: string, code: string): Promise<void> {
       await sendSMS({
         to,
         body: `Your Singr verification code is: ${code}. Valid for 5 minutes.`,
       });

       logger.info({ to }, 'Verification SMS queued');
     }

     async sendTwoFactorSMS(to: string, code: string): Promise<void> {
       await sendSMS({
         to,
         body: `Your Singr 2FA code is: ${code}. Valid for 5 minutes. Do not share this code.`,
       });

       logger.info({ to }, '2FA SMS queued');
     }

     async sendMagicLinkSMS(to: string, magicToken: string): Promise<void> {
       const magicLink = `${config.APP_URL_WEB}/auth/magic?token=${magicToken}`;

       await sendSMS({
         to,
         body: `Sign in to Singr: ${magicLink} (expires in ${Math.floor(
           config.MAGIC_LINK_TTL / 60
         )} minutes)`,
       });

       logger.info({ to }, 'Magic link SMS queued');
     }

     generateVerificationCode(): string {
       return randomInt(0, 999999).toString().padStart(6, '0');
     }

     async sendVerificationCodeViaTwilioVerify(
       to: string,
       channel: 'sms' | 'call' = 'sms'
     ): Promise<void> {
       await sendVerificationCode(to, channel);
       logger.info({ to, channel }, 'Twilio Verify code sent');
     }

     async verifyCodeViaTwilioVerify(to: string, code: string): Promise<boolean> {
       return await checkVerificationCode(to, code);
     }
   }
   ```

### 0.5.3 BullMQ Worker Setup

**Tasks:**

1. **Create job types in `packages/shared/src/types/jobs.ts`:**
   ```typescript
   export interface EmailJob {
     type: 'email';
     to: string;
     toName?: string;
     subject: string;
     templateId?: number;
     variables?: Record<string, any>;
     htmlPart?: string;
     textPart?: string;
   }

   export interface SMSJob {
     type: 'sms';
     to: string;
     body: string;
   }

   export interface TwoFactorJob {
     type: 'two_factor';
     userId: string;
     method: 'email' | 'sms';
     code: string;
   }

   export type CommunicationJob = EmailJob | SMSJob | TwoFactorJob;
   ```

2. **Create queue setup in `packages/shared/src/queues/communication-queue.ts`:**
   ```typescript
   import { Queue } from 'bullmq';
   import { Redis } from 'ioredis';
   import { config, COMMUNICATION_RETRY } from '@singr/config';
   import { createLogger } from '@singr/observability';
   import type { CommunicationJob } from '../types/jobs';

   const logger = createLogger('queues:communication');

   export function createCommunicationQueue(redis: Redis): Queue<CommunicationJob> {
     const queue = new Queue<CommunicationJob>('communication', {
       connection: redis,
       defaultJobOptions: {
         attempts: COMMUNICATION_RETRY.maxAttempts,
         backoff: {
           type: 'exponential',
           delay: COMMUNICATION_RETRY.backoffMs,
         },
         removeOnComplete: {
           age: 24 * 60 * 60, // Keep completed jobs for 24 hours
           count: 1000,
         },
         removeOnFail: {
           age: 7 * 24 * 60 * 60, // Keep failed jobs for 7 days
         },
       },
     });

     queue.on('error', (error) => {
       logger.error({ error }, 'Communication queue error');
     });

     return queue;
   }

   export async function enqueueCommunication(
     queue: Queue<CommunicationJob>,
     job: CommunicationJob,
     priority?: number
   ): Promise<void> {
     await queue.add(job.type, job, { priority });
     logger.debug({ type: job.type }, 'Communication job enqueued');
   }
   ```

3. **Create worker in `apps/worker/src/processors/communication-processor.ts`:**
   ```typescript
   import { Job } from 'bullmq';
   import { EmailService } from '@singr/shared/services/email/email-service';
   import { SMSService } from '@singr/shared/services/sms/sms-service';
   import { sendEmail } from '@singr/shared/services/email/mailjet-client';
   import { sendSMS } from '@singr/shared/services/sms/twilio-client';
   import { createLogger } from '@singr/observability';
   import type { CommunicationJob, EmailJob, SMSJob } from '@singr/shared/types/jobs';

   const logger = createLogger('worker:communication');

   export async function processCommunicationJob(
     job: Job<CommunicationJob>
   ): Promise<void> {
     const { data } = job;

     try {
       switch (data.type) {
         case 'email':
           await processEmailJob(data);
           break;

         case 'sms':
           await processSMSJob(data);
           break;

         case 'two_factor':
           await processTwoFactorJob(data);
           break;

         default:
           logger.warn({ type: (data as any).type }, 'Unknown job type');
       }

       logger.info({ jobId: job.id, type: data.type }, 'Communication job processed');
     } catch (error) {
       logger.error(
         {
           error,
           jobId: job.id,
           type: data.type,
           attempt: job.attemptsMade,
         },
         'Failed to process communication job'
       );
       throw error;
     }
   }

   async function processEmailJob(data: EmailJob): Promise<void> {
     await sendEmail({
       to: data.to,
       toName: data.toName,
       subject: data.subject,
       templateId: data.templateId,
       variables: data.variables,
       htmlPart: data.htmlPart,
       textPart: data.textPart,
     });
   }

   async function processSMSJob(data: SMSJob): Promise<void> {
     await sendSMS({
       to: data.to,
       body: data.body,
     });
   }

   async function processTwoFactorJob(data: any): Promise<void> {
     // Implementation will be added in Phase 4.6
     logger.info({ userId: data.userId, method: data.method }, '2FA job processed');
   }
   ```

4. **Create worker entry point in `apps/worker/src/index.ts`:**
   ```typescript
   import { Worker } from 'bullmq';
   import { Redis } from 'ioredis';
   import { config } from '@singr/config';
   import { createLogger, initSentry } from '@singr/observability';
   import { processCommunicationJob } from './processors/communication-processor';

   const logger = createLogger('worker');

   async function startWorker() {
     initSentry();

     const redis = new Redis(config.REDIS_URL, {
       maxRetriesPerRequest: null,
     });

     const worker = new Worker('communication', processCommunicationJob, {
       connection: redis,
       concurrency: 10,
       limiter: {
         max: 100,
         duration: 60000, // 100 jobs per minute
       },
     });

     worker.on('completed', (job) => {
       logger.info({ jobId: job.id }, 'Job completed');
     });

     worker.on('failed', (job, error) => {
       logger.error(
         {
           jobId: job?.id,
           error,
           attempts: job?.attemptsMade,
         },
         'Job failed'
       );
     });

     worker.on('error', (error) => {
       logger.error({ error }, 'Worker error');
     });

     logger.info('Communication worker started');

     // Graceful shutdown
     const shutdown = async (signal: string) => {
       logger.info(`Received ${signal}, shutting down gracefully`);
       await worker.close();
       await redis.quit();
       process.exit(0);
     };

     process.on('SIGINT', () => shutdown('SIGINT'));
     process.on('SIGTERM', () => shutdown('SIGTERM'));
   }

   startWorker().catch((error) => {
     logger.error({ error }, 'Failed to start worker');
     process.exit(1);
   });
   ```

5. **Add worker scripts to `apps/worker/package.json`:**
   ```json
   {
     "name": "@singr/worker",
     "version": "1.0.0",
     "scripts": {
       "dev": "tsx watch src/index.ts",
       "build": "tsc",
       "start": "node dist/index.js"
     },
     "dependencies": {
       "bullmq": "^5.x",
       "ioredis": "^5.x",
       "@singr/config": "workspace:*",
       "@singr/shared": "workspace:*",
       "@singr/observability": "workspace:*"
     }
   }
   ```

6. **Update docker-compose to include worker:**
   ```yaml
   # Add to docker/docker-compose.yml
   worker:
     build:
       context: ..
       dockerfile: docker/worker.Dockerfile
     container_name: singr-worker
     environment:
       - NODE_ENV=development
       - REDIS_URL=redis://redis:6379
       - DATABASE_URL=postgresql://singr:password@postgres:5432/singr_dev
     depends_on:
       - postgres
       - redis
     restart: unless-stopped
   ```

**Deliverables:**
- ✅ Mailjet client with template support
- ✅ Email service with all email types (verification, password reset, magic link, 2FA, welcome, invitation)
- ✅ Twilio client with SMS and Verify API support
- ✅ SMS service with verification and 2FA codes
- ✅ BullMQ queue setup for async communication
- ✅ Worker service to process email/SMS jobs
- ✅ Retry logic with exponential backoff
- ✅ Console providers for development
- ✅ Feature flags for email/SMS sending
- ✅ Comprehensive logging and error handling
- ✅ Job persistence and cleanup
- ✅ Rate limiting at worker level

---




