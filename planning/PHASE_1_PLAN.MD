# Singr Central API Backend - Phase 1

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 1: Database Schema & Core Models

### 1.1 PostgreSQL + PostGIS Setup

**Objective:** Initialize database with extensions and migrations infrastructure.

**Tasks:**

1. **Create `packages/database/prisma/schema.prisma` with datasource:**
   ```prisma
   generator client {
     provider = "prisma-client-js"
     previewFeatures = ["postgresqlExtensions"]
   }
   
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
     extensions = [postgis, pgcrypto]
   }
   ```

2. **Create initial migration (`0001_init.sql`):**
   ```sql
   CREATE EXTENSION IF NOT EXISTS "pgcrypto";
   CREATE EXTENSION IF NOT EXISTS "postgis";
   
   -- Set up updated_at trigger function
   CREATE OR REPLACE FUNCTION set_updated_at()
   RETURNS trigger AS $$
   BEGIN
     NEW.updated_at = NOW();
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;
   
   -- Set up audit logging function
   CREATE OR REPLACE FUNCTION record_audit()
   RETURNS trigger AS $$
   DECLARE
     v_old JSONB;
     v_new JSONB;
   BEGIN
     IF (TG_OP = 'DELETE') THEN
       v_old = TO_JSONB(OLD);
       v_new = NULL;
     ELSIF (TG_OP = 'UPDATE') THEN
       v_old = TO_JSONB(OLD);
       v_new = TO_JSONB(NEW);
     ELSE
       v_old = NULL;
       v_new = TO_JSONB(NEW);
     END IF;
   
     INSERT INTO audit_logs (
       audit_logs_id,
       table_name,
       record_id,
       user_id,
       operation,
       old_data,
       new_data
     ) VALUES (
       GEN_RANDOM_UUID(),
       TG_TABLE_NAME,
       COALESCE(NEW.id::TEXT, NEW.*::JSONB ->> 'id', OLD.id::TEXT, OLD.*::JSONB ->> 'id'),
       COALESCE(current_setting('app.current_user_id', true), NULL),
       TG_OP,
       v_old,
       v_new
     );
   
     IF (TG_OP = 'DELETE') THEN
       RETURN OLD;
     ELSE
       RETURN NEW;
     END IF;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;
   
   -- Create ENUM types
   CREATE TYPE branding_owner_type AS ENUM ('platform', 'customer');
   CREATE TYPE branding_status AS ENUM ('active', 'suspended', 'revoked');
   CREATE TYPE organization_user_status AS ENUM ('invited', 'active', 'suspended', 'revoked');
   CREATE TYPE api_key_status AS ENUM ('active', 'revoked', 'expired', 'suspended');
   ```

3. **Add Prisma scripts to `packages/database/package.json`:**
   ```json
   {
     "scripts": {
       "db:generate": "prisma generate",
       "db:migrate:dev": "prisma migrate dev",
       "db:migrate:deploy": "prisma migrate deploy",
       "db:studio": "prisma studio",
       "db:seed": "tsx prisma/seed.ts",
       "db:reset": "prisma migrate reset --force",
       "db:push": "prisma db push"
     }
   }
   ```

4. **Create reusable Prisma client singleton:**
   ```typescript
   // packages/database/src/client.ts
   import { PrismaClient } from '@prisma/client';
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
   
   if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
   
   // Log queries in development
   if (process.env.NODE_ENV === 'development') {
     prisma.$on('query', (e) => {
       logger.debug(
         {
           duration: e.duration,
           query: e.query.substring(0, 200),
         },
         'Database query'
       );
     });
   }
   
   prisma.$on('error', (e) => {
     logger.error({ error: e }, 'Database error');
   });
   ```

**Deliverables:**
- ✅ Prisma schema matches backend-plan.MD DDL
- ✅ Migrations run successfully with PostGIS
- ✅ `prisma generate` creates typed client
- ✅ Database triggers for updated_at and audit logs
- ✅ Development and production ready

---

### 1.2 Complete Prisma Schema Implementation

**Objective:** Implement full schema from backend-plan.MD with all relationships.

**Duration:** 3-4 days  
**Team Size:** 2 developers

**Tasks:**

1. **Define all enums and models in `packages/database/prisma/schema.prisma`:**
   ```prisma
   enum BrandingOwnerType {
     platform
     customer
     @@map("branding_owner_type")
   }

   enum BrandingStatus {
     active
     suspended
     revoked
     @@map("branding_status")
   }

   enum OrganizationUserStatus {
     invited
     active
     suspended
     revoked
     @@map("organization_user_status")
   }

   enum ApiKeyStatus {
     active
     revoked
     expired
     suspended
     @@map("api_key_status")
   }

   // ========== Core Identity Models ==========

   model User {
     id              String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("users_id")
     email           String      @unique
     passwordHash    String?     @map("password_hash")
     passwordAlgo    String?     @map("password_algo")
     name            String?
     displayName     String?     @map("display_name")
     phoneNumber     String?     @map("phone_number")
     imageUrl        String?     @map("image_url")
     isEmailVerified Boolean     @default(false) @map("is_email_verified")
     lastLoginAt     DateTime?   @map("last_login_at") @db.Timestamptz(6)
     createdAt       DateTime    @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt       DateTime    @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     customerProfile      CustomerProfile?
     singerProfile        SingerProfile?
     accounts             Account[]
     sessions             Session[]
     userRoles            UserRole[]
     organizationUsers    OrganizationUser[] @relation("OrganizationUserUser")
     organizationInvites  OrganizationUser[] @relation("OrganizationUserInvitedBy")
     apiKeys              ApiKey[]           @relation("ApiKeyCreatedBy")
     requests             Request[]          @relation("RequestSubmittedBy")

     @@map("users")
   }

   model Role {
     id              String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("roles_id")
     slug            String           @unique
     description     String?
     isSystem        Boolean          @default(false) @map("is_system")
     createdAt       DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt       DateTime         @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     rolePermissions RolePermission[]
     userRoles       UserRole[]
     organizationUsers OrganizationUser[]

     @@map("roles")
   }

   model Permission {
     id          String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("permissions_id")
     slug        String            @unique
     description String?
     createdAt   DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt   DateTime          @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     rolePermissions            RolePermission[]
     organizationUserPermissions OrganizationUserPermission[]

     @@map("permissions")
   }

   model RolePermission {
     id           String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("role_permissions_id")
     roleId       String     @map("roles_id") @db.Uuid
     permissionId String     @map("permissions_id") @db.Uuid
     createdAt    DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)

     role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@unique([roleId, permissionId], map: "ux_role_permissions_role_permission")
     @@map("role_permissions")
   }

   model UserRole {
     id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("user_roles_id")
     userId    String   @map("users_id") @db.Uuid
     roleId    String   @map("roles_id") @db.Uuid
     createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

     user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     role Role @relation(fields: [roleId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@unique([userId, roleId], map: "ux_user_roles_user_role")
     @@map("user_roles")
   }

   model Account {
     id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("accounts_id")
     userId            String   @map("users_id") @db.Uuid
     provider          String
     providerAccountId String   @map("provider_account_id")
     type              String
     refreshToken      String?  @map("refresh_token")
     accessToken       String?  @map("access_token")
     expiresAt         BigInt?  @map("expires_at")
     tokenType         String?  @map("token_type")
     scope             String?
     idToken           String?  @map("id_token")
     sessionState      String?  @map("session_state")
     createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt         DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@unique([provider, providerAccountId])
     @@map("accounts")
   }

   model Session {
     id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("sessions_id")
     userId       String   @map("users_id") @db.Uuid
     sessionToken String   @unique @map("session_token")
     expiresAt    DateTime @map("expires_at") @db.Timestamptz(6)
     createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt    DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@map("sessions")
   }

   model VerificationToken {
     identifier String
     token      String
     expiresAt  DateTime @map("expires_at") @db.Timestamptz(6)
     createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt  DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     @@id([identifier, token])
     @@index([expiresAt], map: "idx_verification_tokens_expires")
     @@map("verification_tokens")
   }

   // ========== Profile Models ==========

   model CustomerProfile {
     id                String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("customer_profiles_id")
     userId            String      @unique @map("users_id") @db.Uuid
     legalBusinessName String?     @map("legal_business_name")
     dbaName           String?     @map("dba_name")
     stripeCustomerId  String?     @map("stripe_customer_id")
     contactEmail      String?     @map("contact_email")
     contactPhone      String?     @map("contact_phone")
     timezone          String?     @default("UTC")
     billingAddress    Json?       @map("billing_address")
     metadata          Json?       @default("{}")
     createdAt         DateTime    @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt         DateTime    @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     user               User                    @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     customers          Customer[]
     apiKeys            ApiKey[]
     state              State?
     venues             Venue[]
     systems            System[]
     songdb             SongDb[]
     subscriptions      Subscription[]
     organizationUsers  OrganizationUser[]
     brandedApps        BrandedApp[]

     @@map("customer_profiles")
   }

   model SingerProfile {
     id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("singer_profiles_id")
     userId      String   @unique @map("users_id") @db.Uuid
     nickname    String?
     avatarUrl   String?  @map("avatar_url")
     preferences Json?    @default("{}")
     createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     user            User                 @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     favoriteSongs   SingerFavoriteSong[]
     favoriteVenues  SingerFavoriteVenue[]
     requestHistory  SingerRequestHistory[]
     requests        Request[]

     @@map("singer_profiles")
   }

   // ========== Organization Models ==========

   model OrganizationUser {
     id                 String                 @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("organization_users_id")
     customerProfileId  String                 @map("customer_profiles_id") @db.Uuid
     userId             String                 @map("users_id") @db.Uuid
     invitedByUserId    String?                @map("invited_by_user_id") @db.Uuid
     roleId             String?                @map("role_id") @db.Uuid
     status             OrganizationUserStatus @default(invited)
     invitationToken    String?                @map("invitation_token")
     invitationExpiresAt DateTime?             @map("invitation_expires_at") @db.Timestamptz(6)
     lastAccessedAt     DateTime?              @map("last_accessed_at") @db.Timestamptz(6)
     createdAt          DateTime               @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt          DateTime               @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     user            User            @relation("OrganizationUserUser", fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     invitedBy       User?           @relation("OrganizationUserInvitedBy", fields: [invitedByUserId], references: [id], onDelete: SetNull, onUpdate: Cascade)
     role            Role?           @relation(fields: [roleId], references: [id], onDelete: SetNull, onUpdate: Cascade)
     permissions     OrganizationUserPermission[]

     @@unique([customerProfileId, userId], map: "organization_users_customer_profiles_id_users_id_key")
     @@map("organization_users")
   }

   model OrganizationUserPermission {
     id                  String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("organization_user_permissions_id")
     organizationUserId  String   @map("organization_users_id") @db.Uuid
     permissionId        String   @map("permissions_id") @db.Uuid
     createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

     organizationUser OrganizationUser @relation(fields: [organizationUserId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     permission       Permission       @relation(fields: [permissionId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@unique([organizationUserId, permissionId], map: "ux_org_user_permissions")
     @@map("organization_user_permissions")
   }
   ```

2. **Continue with Stripe and billing models:**
   ```prisma
   // ========== Stripe Models ==========

   model Customer {
     id                String    @id @db.Uuid @map("customers_id")
     stripeCustomerId  String    @map("stripe_customer_id")
     customerProfileId String    @map("customer_profiles_id") @db.Uuid
     email             String?
     name              String?
     phone             String?
     description       String?
     metadata          Json      @default("{}")
     invoiceSettings   Json      @map("invoice_settings") @default("{}")
     shipping          Json      @default("{}")
     taxExempt         String?   @map("tax_exempt")
     taxIds            Json      @map("tax_ids") @default("[]")
     livemode          Boolean   @default(false)
     createdAt         DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt         DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     customerProfile   CustomerProfile       @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     apiKeys           ApiKey[]
     checkoutSessions  StripeCheckoutSession[]

     @@map("customers")
   }

   model StripeCheckoutSession {
     id            String   @id @map("stripe_checkout_sessions_id")
     customerId    String   @map("customers_id") @db.Uuid
     paymentStatus String   @map("payment_status")
     mode          String
     amountTotal   BigInt?  @map("amount_total")
     currency      String
     url           String?
     metadata      Json      @default("{}")
     completedAt   DateTime? @map("completed_at") @db.Timestamptz(6)
     expiresAt     DateTime? @map("expires_at") @db.Timestamptz(6)
     createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

     customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@map("stripe_checkout_sessions")
   }

   model StripeProduct {
     id          String   @id @map("products_id")
     name        String?
     description String?
     active      Boolean  @default(true)
     metadata    Json     @default("{}")
     images      String[] @default([])
     livemode    Boolean  @default(false)
     createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     prices StripePrice[]

     @@map("products")
   }

   model StripePrice {
     id         String       @id @map("prices_id")
     productId  String       @map("product_id")
     active     Boolean      @default(true)
     currency   String       @db.Char(3)
     type       String
     recurring  Json?
     unitAmount BigInt?      @map("unit_amount")
     metadata   Json         @default("{}")
     livemode   Boolean      @default(false)
     createdAt  DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt  DateTime     @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     product StripeProduct @relation(fields: [productId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@index([productId], map: "idx_prices_product")
     @@index([active], map: "idx_prices_active")
     @@map("prices")
   }

   model Subscription {
     id                 String   @id @map("subscriptions_id")
     customerProfileId  String   @map("customer_profiles_id") @db.Uuid
     status             String
     currentPeriodStart DateTime @map("current_period_start") @db.Timestamptz(6)
     currentPeriodEnd   DateTime @map("current_period_end") @db.Timestamptz(6)
     cancelAtPeriodEnd  Boolean  @default(false) @map("cancel_at_period_end")
     cancelAt           DateTime? @map("cancel_at") @db.Timestamptz(6)
     canceledAt         DateTime? @map("canceled_at") @db.Timestamptz(6)
     metadata           Json     @default("{}")
     livemode           Boolean  @default(false)
     createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt          DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@index([customerProfileId], map: "idx_subscriptions_customer_profile")
     @@index([status], map: "idx_subscriptions_status")
     @@map("subscriptions")
   }

   model StripeWebhookEvent {
     id             Int      @id @default(autoincrement()) @map("stripe_webhook_events_id")
     eventId        String   @unique @map("event_id")
     eventType      String   @map("event_type")
     payload        Json
     processed      Boolean  @default(false)
     processedAt    DateTime? @map("processed_at") @db.Timestamptz(6)
     receivedAt     DateTime @default(now()) @map("received_at") @db.Timestamptz(6)
     livemode       Boolean  @default(false)
     errorMessage   String?  @map("error_message")
     requestId      String?  @map("request_id")
     endpointSecret String?  @map("endpoint_secret")

     @@map("stripe_webhook_events")
   }

   // ========== API Key Models ==========

   model ApiKey {
     id                String       @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("api_keys_id")
     customerProfileId String       @map("customer_profiles_id") @db.Uuid
     customerId        String?      @map("customers_id") @db.Uuid
     createdByUserId   String?      @map("created_by_users_id") @db.Uuid
     description       String?
     apiKeyHash        String       @map("api_key_hash")
     lastUsedAt        DateTime?    @map("last_used_at") @db.Timestamptz(6)
     status            ApiKeyStatus @default(active)
     revokedAt         DateTime?    @map("revoked_at") @db.Timestamptz(6)
     metadata          Json?        @default("{}")
     createdAt         DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt         DateTime     @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     customer        Customer?        @relation(fields: [customerId], references: [id], onDelete: SetNull, onUpdate: Cascade)
     createdBy       User?            @relation("ApiKeyCreatedBy", fields: [createdByUserId], references: [id], onDelete: SetNull, onUpdate: Cascade)

     @@index([customerProfileId], map: "idx_api_keys_customer_profile")
     @@index([customerId], map: "idx_api_keys_customer")
     @@map("api_keys")
   }

   // ========== Venue Models ==========

   model State {
     customerProfileId String @id @map("customer_profiles_id") @db.Uuid
     serial            BigInt @default(1)

     customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@map("state")
   }

   model Venue {
     id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("venues_id")
     customerProfileId String   @map("customer_profiles_id") @db.Uuid
     openkjVenueId     Int      @map("openkj_venue_id")
     urlName           String   @unique @map("url_name")
     acceptingRequests Boolean  @default(true) @map("accepting_requests")
     name              String
     address           String
     city              String
     state             String
     postalCode        String   @map("postal_code")
     country           String?
     phoneNumber       String?  @map("phone_number")
     website           String?
     location          Unsupported("geography(Point,4326)")? @map("location")
     createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt         DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     requests        Request[]
     favoriteVenues  SingerFavoriteVenue[]
     requestHistory  SingerRequestHistory[]

     @@unique([customerProfileId, openkjVenueId], map: "venues_customer_profiles_id_openkj_venue_id_key")
     @@index([customerProfileId], map: "idx_venues_customer_profile")
     @@map("venues")
   }

   model System {
     id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("systems_id")
     customerProfileId String   @map("customer_profiles_id") @db.Uuid
     openkjSystemId    Int      @map("openkj_system_id")
     name              String
     configuration     Json?    @default("{}")
     createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt         DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@unique([customerProfileId, openkjSystemId], map: "systems_customer_profiles_id_openkj_system_id_key")
     @@index([customerProfileId], map: "idx_systems_customer_profile")
     @@map("systems")
   }
   ```

3. **Continue with song and request models:**
   ```prisma
   // ========== Song Database Models ==========

   model SongDb {
     id                 BigInt  @id @default(autoincrement()) @map("songdb_id")
     customerProfileId  String  @map("customer_profiles_id") @db.Uuid
     openkjSystemId     Int     @map("openkj_system_id")
     artist             String
     title              String
     combined           String
     normalizedCombined String  @map("normalized_combined")
     createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt          DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@unique([customerProfileId, openkjSystemId, combined], map: "songdb_customer_profiles_id_openkj_system_id_combined_key")
     @@unique([customerProfileId, openkjSystemId, normalizedCombined], map: "songdb_customer_profiles_id_openkj_system_id_normalized_combined_key")
     @@index([customerProfileId, openkjSystemId, artist], map: "idx_songdb_customer_system_artist")
     @@map("songdb")
   }

   // ========== Request Models ==========

   model Request {
     id                BigInt     @id @default(autoincrement()) @map("requests_id")
     venueId           String     @map("venues_id") @db.Uuid
     singerProfileId   String?    @map("singer_profiles_id") @db.Uuid
     submittedByUserId String?    @map("submitted_by_users_id") @db.Uuid
     artist            String
     title             String
     keyChange         Int        @default(0) @map("key_change")
     notes             String?
     processed         Boolean    @default(false)
     requestedAt       DateTime   @default(now()) @map("requested_at") @db.Timestamptz(6)
     processedAt       DateTime?  @map("processed_at") @db.Timestamptz(6)
     createdAt         DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt         DateTime   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     venue         Venue         @relation(fields: [venueId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     singerProfile SingerProfile? @relation(fields: [singerProfileId], references: [id], onDelete: SetNull, onUpdate: Cascade)
     submittedBy   User?          @relation("RequestSubmittedBy", fields: [submittedByUserId], references: [id], onDelete: SetNull, onUpdate: Cascade)

     @@index([venueId, processed], map: "idx_requests_venue_processed")
     @@map("requests")
   }

   // ========== Singer Feature Models ==========

   model SingerFavoriteSong {
     id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("singer_favorite_songs_id")
     singerProfileId String   @map("singer_profiles_id") @db.Uuid
     artist          String?
     title           String?
     keyChange       Int      @default(0) @map("key_change")
     metadata        Json?    @default("{}")
     createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt       DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     singerProfile SingerProfile @relation(fields: [singerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@unique([singerProfileId, artist, title, keyChange])
     @@map("singer_favorite_songs")
   }

   model SingerRequestHistory {
     id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("singer_request_history_id")
     singerProfileId String   @map("singer_profiles_id") @db.Uuid
     venueId         String   @map("venues_id") @db.Uuid
     artist          String
     title           String
     keyChange       Int      @default(0) @map("key_change")
     requestedAt     DateTime @default(now()) @map("requested_at") @db.Timestamptz(6)
     songFingerprint String   @map("song_fingerprint")
     createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt       DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     singerProfile SingerProfile @relation(fields: [singerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     venue         Venue         @relation(fields: [venueId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@index([singerProfileId, requestedAt], map: "idx_singer_request_history_profile")
     @@map("singer_request_history")
   }

   model SingerFavoriteVenue {
     singerProfileId String   @map("singer_profiles_id") @db.Uuid
     venueId         String   @map("venues_id") @db.Uuid
     createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

     singerProfile SingerProfile @relation(fields: [singerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     venue         Venue         @relation(fields: [venueId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@id([singerProfileId, venueId])
     @@map("singer_favorite_venues")
   }

   // ========== Branding Models ==========

   model BrandingProfile {
     id             String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("branding_profiles_id")
     ownerType      BrandingOwnerType @map("owner_type")
     ownerId        String?         @map("owner_id") @db.Uuid
     name           String
     logoUrl        String?         @map("logo_url")
     colorPalette   Json            @map("color_palette") @default("{}")
     poweredBySingr Boolean         @default(true) @map("powered_by_singr")
     domain         String?
     appBundleId    String?         @map("app_bundle_id")
     appPackageName String?         @map("app_package_name")
     status         BrandingStatus  @default(active)
     metadata       Json?           @default("{}")
     createdAt      DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt      DateTime        @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     brandedApps BrandedApp[]

     @@unique([ownerType, ownerId, name], map: "branding_profiles_owner_type_owner_id_name_key")
     @@map("branding_profiles")
   }

   model BrandedApp {
     id               String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("branded_apps_id")
     customerProfileId String        @map("customer_profiles_id") @db.Uuid
     brandingProfileId String        @map("branding_profiles_id") @db.Uuid
     name             String
     platform         String
     bundleIdentifier String?        @map("bundle_identifier")
     status           BrandingStatus @default(active)
     config           Json           @default("{}")
     rateLimitOverride Json?         @map("rate_limit_override")
     createdAt        DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt        DateTime       @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     brandingProfile BrandingProfile @relation(fields: [brandingProfileId], references: [id], onDelete: Restrict, onUpdate: Cascade)
     apiKeys         BrandedAppApiKey[]

     @@map("branded_apps")
   }

   model BrandedAppApiKey {
     id           String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("branded_app_api_keys_id")
     brandedAppId String         @map("branded_apps_id") @db.Uuid
     apiKeyHash   String         @map("api_key_hash")
     description  String?
     lastUsedAt   DateTime?      @map("last_used_at") @db.Timestamptz(6)
     status       BrandingStatus @default(active)
     createdAt    DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt    DateTime       @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

     brandedApp BrandedApp @relation(fields: [brandedAppId], references: [id], onDelete: Cascade, onUpdate: Cascade)

     @@unique([brandedAppId, apiKeyHash])
     @@map("branded_app_api_keys")
   }

   // ========== Audit Models ==========

   model AuditLog {
     id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid @map("audit_logs_id")
     tableName String   @map("table_name")
     recordId  String?  @map("record_id")
     userId    String?  @map("user_id") @db.Uuid
     operation String
     oldData   Json?    @map("old_data")
     newData   Json?    @map("new_data")
     createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

     @@index([tableName, recordId], map: "idx_audit_logs_table_record")
     @@index([userId, createdAt], map: "idx_audit_logs_user_created_at")
     @@map("audit_logs")
   }
   ```

**Deliverables:**
- ✅ Complete Prisma schema with all entities
- ✅ All foreign keys, cascades, and indexes defined
- ✅ Schema validates with `prisma validate`
- ✅ TypeScript types generated from schema
- ✅ Multi-tenancy support through CustomerProfile
- ✅ Full audit trail capability

---

### 1.3 Database Seed Script

**Objective:** Populate database with baseline data for development.

**Duration:** 2 days  
**Team Size:** 1 developer

**Tasks:**

1. **Create `packages/database/prisma/seed.ts`:**
   ```typescript
   import { prisma } from '../src/client';
   import { createLogger } from '@singr/observability';
   import { hashPassword } from '@singr/auth';
   import { DEFAULT_ROLES, DEFAULT_PERMISSIONS } from '@singr/config';

   const logger = createLogger('seed');

   async function seed() {
     logger.info('Starting database seed...');

     try {
       // Clear existing data (in development only)
       if (process.env.NODE_ENV !== 'production') {
         logger.info('Clearing existing data...');
         // Order matters for foreign keys
         await prisma.organizationUserPermission.deleteMany();
         await prisma.organizationUser.deleteMany();
         await prisma.userRole.deleteMany();
         await prisma.rolePermission.deleteMany();
         await prisma.role.deleteMany();
         await prisma.permission.deleteMany();
         await prisma.user.deleteMany();
       }

       // Create system roles
       logger.info('Creating system roles...');
       const roles = await Promise.all(
         DEFAULT_ROLES.map((role) =>
           prisma.role.upsert({
             where: { slug: role.slug },
             update: {},
             create: role,
           })
         )
       );

       logger.info(`Created ${roles.length} roles`);

       // Create permissions
       logger.info('Creating permissions...');
       const permissions = await Promise.all(
         DEFAULT_PERMISSIONS.map((permission) =>
           prisma.permission.upsert({
             where: { slug: permission.slug },
             update: {},
             create: permission,
           })
         )
       );

       logger.info(`Created ${permissions.length} permissions`);

       // Attach permissions to roles
       logger.info('Attaching permissions to roles...');
       const adminRole = roles.find((r) => r.slug === 'admin')!;
       const customerOwnerRole = roles.find((r) => r.slug === 'customer_owner')!;
       const singerRole = roles.find((r) => r.slug === 'singer')!;

       // Admin gets all permissions
       await prisma.rolePermission.createMany({
         data: permissions.map((p) => ({
           roleId: adminRole.id,
           permissionId: p.id,
         })),
         skipDuplicates: true,
       });

       // Customer owner gets customer-related permissions
       const customerPermissions = permissions.filter(
         (p) =>
           p.slug.includes('venues:') ||
           p.slug.includes('systems:') ||
           p.slug.includes('api_keys:') ||
           p.slug.includes('songdb:') ||
           p.slug.includes('requests:') ||
           p.slug.includes('organization:') ||
           p.slug.includes('billing:') ||
           p.slug.includes('branding:')
       );

       await prisma.rolePermission.createMany({
         data: customerPermissions.map((p) => ({
           roleId: customerOwnerRole.id,
           permissionId: p.id,
         })),
         skipDuplicates: true,
       });

       logger.info('Permissions attached to roles');

       // Create platform branding profile
       logger.info('Creating platform branding profile...');
       const brandingProfile = await prisma.brandingProfile.upsert({
         where: {
           branding_profiles_owner_type_owner_id_name_key: {
             ownerType: 'platform',
             ownerId: null,
             name: 'Singr Default',
           },
         },
         update: {},
         create: {
           ownerType: 'platform',
           name: 'Singr Default',
           colorPalette: {
             primary: '#6366F1',
             secondary: '#8B5CF6',
             accent: '#EC4899',
           },
           poweredBySingr: true,
           status: 'active',
         },
       });

       logger.info('Platform branding profile created');

       // Create test admin user
       logger.info('Creating test admin user...');
       const adminUser = await prisma.user.upsert({
         where: { email: 'admin@singrkaraoke.com' },
         update: {},
         create: {
           email: 'admin@singrkaraoke.com',
           passwordHash: await hashPassword('Admin123!'),
           passwordAlgo: 'argon2id',
           name: 'Admin User',
           isEmailVerified: true,
           userRoles: {
             create: { roleId: adminRole.id },
           },
         },
       });

       logger.info(`Admin user created: ${adminUser.id}`);

       // Create test customer
       logger.info('Creating test customer...');
       const customerUser = await prisma.user.upsert({
         where: { email: 'customer@example.com' },
         update: {},
         create: {
           email: 'customer@example.com',
           passwordHash: await hashPassword('Customer123!'),
           passwordAlgo: 'argon2id',
           name: 'Test Customer',
           isEmailVerified: true,
           customerProfile: {
             create: {
               legalBusinessName: 'Test Karaoke LLC',
               contactEmail: 'customer@example.com',
               timezone: 'America/New_York',
             },
           },
           userRoles: {
             create: { roleId: customerOwnerRole.id },
           },
         },
         include: { customerProfile: true },
       });

       logger.info(`Customer user created: ${customerUser.id}`);
       logger.info(`Customer profile created: ${customerUser.customerProfile?.id}`);

       // Create test singer
       logger.info('Creating test singer...');
       const singerUser = await prisma.user.upsert({
         where: { email: 'singer@example.com' },
         update: {},
         create: {
           email: 'singer@example.com',
           passwordHash: await hashPassword('Singer123!'),
           passwordAlgo: 'argon2id',
           name: 'Test Singer',
           isEmailVerified: true,
           singerProfile: {
             create: {
               nickname: 'RockStar',
               preferences: {
                 language: 'en',
                 notificationsEnabled: true,
               },
             },
           },
           userRoles: {
             create: { roleId: singerRole.id },
           },
         },
         include: { singerProfile: true },
       });

       logger.info(`Singer user created: ${singerUser.id}`);
       logger.info(`Singer profile created: ${singerUser.singerProfile?.id}`);

       // Create test system for customer
       logger.info('Creating test system...');
       const system = await prisma.system.create({
         data: {
           customerProfileId: customerUser.customerProfile!.id,
           openkjSystemId: 1,
           name: 'Test Karaoke System',
           configuration: {
             region: 'us-east-1',
             venue_count: 1,
           },
         },
       });

       logger.info(`System created: ${system.id}`);

       // Create test venue for customer
       logger.info('Creating test venue...');
       const venue = await prisma.venue.create({
         data: {
           customerProfileId: customerUser.customerProfile!.id,
           openkjVenueId: 1001,
           urlName: 'test-karaoke-bar',
           name: 'Test Karaoke Bar',
           address: '123 Main Street',
           city: 'Nashville',
           state: 'TN',
           postalCode: '37201',
           country: 'USA',
           phoneNumber: '+1-615-555-1234',
           website: 'https://example.com',
           acceptingRequests: true,
         },
       });

       logger.info(`Venue created: ${venue.id}`);

       // Create test songs
       logger.info('Creating test songs...');
       const songs = await prisma.songDb.createMany({
         data: [
           {
             customerProfileId: customerUser.customerProfile!.id,
             openkjSystemId: 1,
             artist: 'Queen',
             title: 'Bohemian Rhapsody',
             combined: 'Queen - Bohemian Rhapsody',
             normalizedCombined: 'queen - bohemian rhapsody',
           },
           {
             customerProfileId: customerUser.customerProfile!.id,
             openkjSystemId: 1,
             artist: 'The Beatles',
             title: 'Hey Jude',
             combined: 'The Beatles - Hey Jude',
             normalizedCombined: 'the beatles - hey jude',
           },
           {
             customerProfileId: customerUser.customerProfile!.id,
             openkjSystemId: 1,
             artist: 'Elton John',
             title: 'Rocket Man',
             combined: 'Elton John - Rocket Man',
             normalizedCombined: 'elton john - rocket man',
           },
         ],
       });

       logger.info(`Created ${songs.count} test songs`);

       logger.info('✅ Database seeded successfully!');
       logger.info('Test credentials:');
       logger.info('  Admin: admin@singrkaraoke.com / Admin123!');
       logger.info('  Customer: customer@example.com / Customer123!');
       logger.info('  Singer: singer@example.com / Singer123!');
     } catch (error) {
       logger.error({ error }, 'Seed failed');
       throw error;
     }
   }

   seed()
     .catch((e) => {
       console.error(e);
       process.exit(1);
     })
     .finally(async () => {
       await prisma.$disconnect();
     });
   ```

2. **Add seed script to package.json:**
   ```json
   {
     "scripts": {
       "db:seed": "tsx prisma/seed.ts"
     }
   }
   ```

**Deliverables:**
- ✅ Seed script creates system roles and permissions
- ✅ Platform branding profile seeded
- ✅ Test users (admin, customer, singer) created with proper roles
- ✅ Test venue and system created
- ✅ Test songs populated
- ✅ `make db-seed` populates fresh database
- ✅ Clear credentials logged for testing

---

### 1.4 Database Audit Triggers

**Objective:** Ensure all table changes are captured in audit_logs.

**Duration:** 1 day  
**Team Size:** 1 developer

**Tasks:**

1. **Create migration `0002_audit_triggers.sql`:**
   ```sql
   -- Apply updated_at trigger to all tables
   DO $$
   DECLARE
     r RECORD;
   BEGIN
     FOR r IN SELECT tablename FROM pg_tables 
              WHERE schemaname = 'public' 
              AND tablename NOT IN ('audit_logs', '_prisma_migrations')
     LOOP
       EXECUTE format(
         'DROP TRIGGER IF EXISTS %I ON %I;',
         r.tablename || '_set_updated_at',
         r.tablename
       );
       EXECUTE format(
         'CREATE TRIGGER %I BEFORE UPDATE ON %I 
          FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
         r.tablename || '_set_updated_at',
         r.tablename
       );
     END LOOP;
   END;
   $$;

   -- Apply audit trigger to all tables except audit_logs
   DO $$
   DECLARE
     r RECORD;
   BEGIN
     FOR r IN SELECT tablename FROM pg_tables 
              WHERE schemaname = 'public' 
              AND tablename NOT IN ('audit_logs', '_prisma_migrations')
     LOOP
       EXECUTE format(
         'DROP TRIGGER IF EXISTS %I ON %I;',
         r.tablename || '_audit',
         r.tablename
       );
       EXECUTE format(
         'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I 
          FOR EACH ROW EXECUTE FUNCTION record_audit();',
         r.tablename || '_audit',
         r.tablename
       );
     END LOOP;
   END;
   $$;

   -- Create indexes for audit log performance
   CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record 
     ON audit_logs (table_name, record_id);

   CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created_at 
     ON audit_logs (user_id, created_at DESC);

   CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at 
     ON audit_logs (created_at DESC);
   ```

2. **Test audit logging:**
   - Create integration tests that verify audit trails
   - Test INSERT, UPDATE, DELETE operations
   - Verify old_data and new_data captured correctly
   - Test user_id is populated when available

**Deliverables:**
- ✅ All tables have updated_at triggers
- ✅ All tables except audit_logs have audit triggers
- ✅ Audit logs capture old_data and new_data as JSONB
- ✅ Manual testing confirms audit trail works
- ✅ Performance indexes created on audit_logs

---
