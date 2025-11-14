# Singr Central API - Prisma Schema

**Version:** 1.0  
**Last Updated:** 2025-11-12  
**Database:** PostgreSQL 16 with PostGIS extension

## Overview

This Prisma schema defines the complete data model for the Singr Central API backend. It includes all entities for user management, authentication, venue operations, song databases, requests, billing, and analytics.

---

## Prisma Configuration

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [postgis, pgcrypto]
}
```

---

## Enum Types

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

enum SubscriptionStatus {
  incomplete
  incomplete_expired
  trialing
  active
  past_due
  canceled
  unpaid
  paused

  @@map("subscription_status")
}
```

---

## Core Identity Models

### User Model

```prisma
model User {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @map("users_id") @db.Uuid
  email           String    @unique
  passwordHash    String?   @map("password_hash")
  passwordAlgo    String?   @default("argon2id") @map("password_algo")
  name            String?
  displayName     String?   @map("display_name")
  phoneNumber     String?   @map("phone_number")
  imageUrl        String?   @map("image_url")
  isEmailVerified Boolean   @default(false) @map("is_email_verified")
  lastLoginAt     DateTime? @map("last_login_at") @db.Timestamptz(6)
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile     CustomerProfile?
  singerProfile       SingerProfile?
  accounts            Account[]
  sessions            Session[]
  userRoles           UserRole[]
  organizationUsers   OrganizationUser[]  @relation("OrganizationUserUser")
  organizationInvites OrganizationUser[]  @relation("OrganizationUserInvitedBy")
  apiKeysCreated      ApiKey[]            @relation("ApiKeyCreatedBy")
  requestsSubmitted   Request[]           @relation("RequestSubmittedBy")
  savedReports        SavedReport[]
  reportExecutions    ReportExecution[]

  @@index([email])
  @@index([phoneNumber])
  @@map("users")
}
```

### Role Model

```prisma
model Role {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @map("roles_id") @db.Uuid
  slug        String   @unique
  description String?
  isSystem    Boolean  @default(false) @map("is_system")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  rolePermissions   RolePermission[]
  userRoles         UserRole[]
  organizationUsers OrganizationUser[]

  @@index([slug])
  @@map("roles")
}
```

### Permission Model

```prisma
model Permission {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @map("permissions_id") @db.Uuid
  slug        String   @unique
  description String?
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  rolePermissions             RolePermission[]
  organizationUserPermissions OrganizationUserPermission[]

  @@index([slug])
  @@map("permissions")
}
```

### Role Permission Junction

```prisma
model RolePermission {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @map("role_permissions_id") @db.Uuid
  roleId       String   @map("roles_id") @db.Uuid
  permissionId String   @map("permissions_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([roleId, permissionId], map: "ux_role_permissions_role_permission")
  @@index([roleId])
  @@index([permissionId])
  @@map("role_permissions")
}
```

### User Role Junction

```prisma
model UserRole {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @map("user_roles_id") @db.Uuid
  userId    String   @map("users_id") @db.Uuid
  roleId    String   @map("roles_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  role Role @relation(fields: [roleId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([userId, roleId], map: "ux_user_roles_user_role")
  @@index([userId])
  @@index([roleId])
  @@map("user_roles")
}
```

### Account Model (OAuth)

```prisma
model Account {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @map("accounts_id") @db.Uuid
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
  @@index([userId])
  @@map("accounts")
}
```

### Session Model

```prisma
model Session {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @map("sessions_id") @db.Uuid
  userId       String   @map("users_id") @db.Uuid
  sessionToken String   @unique @map("session_token")
  expiresAt    DateTime @map("expires_at") @db.Timestamptz(6)
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@index([userId])
  @@index([sessionToken])
  @@index([expiresAt])
  @@map("sessions")
}
```

### Verification Token Model

```prisma
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
```

---

## Profile Models

### Customer Profile Model

```prisma
model CustomerProfile {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @map("customer_profiles_id") @db.Uuid
  userId            String   @unique @map("users_id") @db.Uuid
  legalBusinessName String?  @map("legal_business_name")
  dbaName           String?  @map("dba_name")
  stripeCustomerId  String?  @map("stripe_customer_id")
  contactEmail      String?  @map("contact_email")
  contactPhone      String?  @map("contact_phone")
  timezone          String?  @default("UTC")
  billingAddress    Json?    @map("billing_address")
  metadata          Json?    @default("{}")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  user              User                @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  customers         Customer[]
  apiKeys           ApiKey[]
  state             State?
  venues            Venue[]
  systems           System[]
  songdb            SongDb[]
  subscriptions     Subscription[]
  organizationUsers OrganizationUser[]
  brandedApps       BrandedApp[]
  savedReports      SavedReport[]

  @@index([userId])
  @@index([stripeCustomerId])
  @@map("customer_profiles")
}
```

### Singer Profile Model

```prisma
model SingerProfile {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @map("singer_profiles_id") @db.Uuid
  userId      String   @unique @map("users_id") @db.Uuid
  nickname    String?
  avatarUrl   String?  @map("avatar_url")
  preferences Json?    @default("{}")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  user            User                    @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  favoriteSongs   SingerFavoriteSong[]
  favoriteVenues  SingerFavoriteVenue[]
  requestHistory  SingerRequestHistory[]
  requests        Request[]

  @@index([userId])
  @@map("singer_profiles")
}
```

---

## Organization Models

### Organization User Model

```prisma
model OrganizationUser {
  id                  String                   @id @default(dbgenerated("gen_random_uuid()")) @map("organization_users_id") @db.Uuid
  customerProfileId   String                   @map("customer_profiles_id") @db.Uuid
  userId              String                   @map("users_id") @db.Uuid
  invitedByUserId     String?                  @map("invited_by_user_id") @db.Uuid
  roleId              String?                  @map("role_id") @db.Uuid
  status              OrganizationUserStatus   @default(invited)
  invitationToken     String?                  @map("invitation_token")
  invitationExpiresAt DateTime?                @map("invitation_expires_at") @db.Timestamptz(6)
  lastAccessedAt      DateTime?                @map("last_accessed_at") @db.Timestamptz(6)
  createdAt           DateTime                 @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime                 @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile              @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  user            User                         @relation("OrganizationUserUser", fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  invitedBy       User?                        @relation("OrganizationUserInvitedBy", fields: [invitedByUserId], references: [id], onDelete: SetNull, onUpdate: Cascade)
  role            Role?                        @relation(fields: [roleId], references: [id], onDelete: SetNull, onUpdate: Cascade)
  permissions     OrganizationUserPermission[]

  @@unique([customerProfileId, userId], map: "ux_organization_users_customer_user")
  @@index([customerProfileId])
  @@index([userId])
  @@index([status])
  @@map("organization_users")
}
```

### Organization User Permission Model

```prisma
model OrganizationUserPermission {
  id                 String   @id @default(dbgenerated("gen_random_uuid()")) @map("organization_user_permissions_id") @db.Uuid
  organizationUserId String   @map("organization_users_id") @db.Uuid
  permissionId       String   @map("permissions_id") @db.Uuid
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  organizationUser OrganizationUser @relation(fields: [organizationUserId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  permission       Permission       @relation(fields: [permissionId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([organizationUserId, permissionId], map: "ux_org_user_permissions")
  @@index([organizationUserId])
  @@index([permissionId])
  @@map("organization_user_permissions")
}
```

---

## Stripe and Billing Models

### Customer Model (Stripe)

```prisma
model Customer {
  id                String                   @id @db.Uuid @map("customers_id")
  stripeCustomerId  String                   @map("stripe_customer_id")
  customerProfileId String                   @map("customer_profiles_id") @db.Uuid
  email             String?
  name              String?
  phone             String?
  description       String?
  metadata          Json                     @default("{}")
  invoiceSettings   Json                     @map("invoice_settings") @default("{}")
  shipping          Json                     @default("{}")
  taxExempt         String?                  @map("tax_exempt")
  taxIds            Json                     @map("tax_ids") @default("[]")
  livemode          Boolean                  @default(false)
  createdAt         DateTime                 @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime                 @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile  CustomerProfile           @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  apiKeys          ApiKey[]
  checkoutSessions StripeCheckoutSession[]

  @@index([stripeCustomerId])
  @@index([customerProfileId])
  @@map("customers")
}
```

### Stripe Checkout Session Model

```prisma
model StripeCheckoutSession {
  id            String    @id @map("stripe_checkout_sessions_id")
  customerId    String    @map("customers_id") @db.Uuid
  paymentStatus String    @map("payment_status")
  mode          String
  amountTotal   BigInt?   @map("amount_total")
  currency      String    @db.Char(3)
  url           String?
  metadata      Json      @default("{}")
  completedAt   DateTime? @map("completed_at") @db.Timestamptz(6)
  expiresAt     DateTime? @map("expires_at") @db.Timestamptz(6)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@index([customerId])
  @@index([paymentStatus])
  @@map("stripe_checkout_sessions")
}
```

### Stripe Product Model

```prisma
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

  @@index([active])
  @@map("products")
}
```

### Stripe Price Model

```prisma
model StripePrice {
  id         String   @id @map("prices_id")
  productId  String   @map("product_id")
  active     Boolean  @default(true)
  currency   String   @db.Char(3)
  type       String
  recurring  Json?
  unitAmount BigInt?  @map("unit_amount")
  metadata   Json     @default("{}")
  livemode   Boolean  @default(false)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt  DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  product StripeProduct @relation(fields: [productId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@index([productId])
  @@index([active])
  @@map("prices")
}
```

### Subscription Model

```prisma
model Subscription {
  id                 String             @id @map("subscriptions_id")
  customerProfileId  String             @map("customer_profiles_id") @db.Uuid
  status             SubscriptionStatus
  currentPeriodStart DateTime           @map("current_period_start") @db.Timestamptz(6)
  currentPeriodEnd   DateTime           @map("current_period_end") @db.Timestamptz(6)
  cancelAtPeriodEnd  Boolean            @default(false) @map("cancel_at_period_end")
  cancelAt           DateTime?          @map("cancel_at") @db.Timestamptz(6)
  canceledAt         DateTime?          @map("canceled_at") @db.Timestamptz(6)
  metadata           Json               @default("{}")
  livemode           Boolean            @default(false)
  createdAt          DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime           @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@index([customerProfileId])
  @@index([status])
  @@map("subscriptions")
}
```

### Stripe Webhook Event Model

```prisma
model StripeWebhookEvent {
  id             Int       @id @default(autoincrement()) @map("stripe_webhook_events_id")
  eventId        String    @unique @map("event_id")
  eventType      String    @map("event_type")
  payload        Json
  processed      Boolean   @default(false)
  processedAt    DateTime? @map("processed_at") @db.Timestamptz(6)
  receivedAt     DateTime  @default(now()) @map("received_at") @db.Timestamptz(6)
  livemode       Boolean   @default(false)
  errorMessage   String?   @map("error_message")
  requestId      String?   @map("request_id")
  endpointSecret String?   @map("endpoint_secret")

  @@index([eventId])
  @@index([processed])
  @@index([eventType])
  @@map("stripe_webhook_events")
}
```

---

## API Key Models

### API Key Model

```prisma
model ApiKey {
  id                String       @id @default(dbgenerated("gen_random_uuid()")) @map("api_keys_id") @db.Uuid
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
  customer        Customer?       @relation(fields: [customerId], references: [id], onDelete: SetNull, onUpdate: Cascade)
  createdBy       User?           @relation("ApiKeyCreatedBy", fields: [createdByUserId], references: [id], onDelete: SetNull, onUpdate: Cascade)

  @@index([customerProfileId])
  @@index([customerId])
  @@index([apiKeyHash])
  @@index([status])
  @@map("api_keys")
}
```

---

## Venue Models

### State Model (Request Counter)

```prisma
model State {
  customerProfileId String @id @map("customer_profiles_id") @db.Uuid
  serial            BigInt @default(1)

  customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@map("state")
}
```

### Venue Model

```prisma
model Venue {
  id                String                               @id @default(dbgenerated("gen_random_uuid()")) @map("venues_id") @db.Uuid
  customerProfileId String                               @map("customer_profiles_id") @db.Uuid
  openkjVenueId     Int                                  @map("openkj_venue_id")
  urlName           String                               @unique @map("url_name")
  acceptingRequests Boolean                              @default(true) @map("accepting_requests")
  name              String
  address           String
  city              String
  state             String
  postalCode        String                               @map("postal_code")
  country           String?                              @default("USA")
  phoneNumber       String?                              @map("phone_number")
  website           String?
  location          Unsupported("geography(Point,4326)")?
  createdAt         DateTime                             @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime                             @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile         @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  requests        Request[]
  favoriteVenues  SingerFavoriteVenue[]
  requestHistory  SingerRequestHistory[]

  @@unique([customerProfileId, openkjVenueId], map: "ux_venues_customer_openkj")
  @@index([customerProfileId])
  @@index([urlName])
  @@index([city, state])
  @@map("venues")
}
```

### System Model

```prisma
model System {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @map("systems_id") @db.Uuid
  customerProfileId String   @map("customer_profiles_id") @db.Uuid
  openkjSystemId    Int      @map("openkj_system_id")
  name              String
  configuration     Json?    @default("{}")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([customerProfileId, openkjSystemId], map: "ux_systems_customer_openkj")
  @@index([customerProfileId])
  @@map("systems")
}
```

---

## Song Database Models

### SongDb Model

```prisma
model SongDb {
  id                 BigInt   @id @default(autoincrement()) @map("songdb_id")
  customerProfileId  String   @map("customer_profiles_id") @db.Uuid
  openkjSystemId     Int      @map("openkj_system_id")
  artist             String
  title              String
  combined           String
  normalizedCombined String   @map("normalized_combined")
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([customerProfileId, openkjSystemId, combined], map: "ux_songdb_customer_system_combined")
  @@unique([customerProfileId, openkjSystemId, normalizedCombined], map: "ux_songdb_customer_system_normalized")
  @@index([customerProfileId, openkjSystemId])
  @@index([customerProfileId, openkjSystemId, artist])
  @@index([customerProfileId, openkjSystemId, title])
  @@map("songdb")
}
```

---

## Request Models

### Request Model

```prisma
model Request {
  id                BigInt        @id @default(autoincrement()) @map("requests_id")
  venueId           String        @map("venues_id") @db.Uuid
  singerProfileId   String?       @map("singer_profiles_id") @db.Uuid
  submittedByUserId String?       @map("submitted_by_users_id") @db.Uuid
  artist            String
  title             String
  keyChange         Int           @default(0) @map("key_change")
  notes             String?
  processed         Boolean       @default(false)
  requestedAt       DateTime      @default(now()) @map("requested_at") @db.Timestamptz(6)
  processedAt       DateTime?     @map("processed_at") @db.Timestamptz(6)
  createdAt         DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime      @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  venue         Venue          @relation(fields: [venueId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  singerProfile SingerProfile? @relation(fields: [singerProfileId], references: [id], onDelete: SetNull, onUpdate: Cascade)
  submittedBy   User?          @relation("RequestSubmittedBy", fields: [submittedByUserId], references: [id], onDelete: SetNull, onUpdate: Cascade)

  @@index([venueId])
  @@index([singerProfileId])
  @@index([venueId, processed])
  @@index([requestedAt])
  @@map("requests")
}
```

---

## Singer Feature Models

### Singer Favorite Song Model

```prisma
model SingerFavoriteSong {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @map("singer_favorite_songs_id") @db.Uuid
  singerProfileId String   @map("singer_profiles_id") @db.Uuid
  artist          String?
  title           String?
  keyChange       Int      @default(0) @map("key_change")
  metadata        Json?    @default("{}")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  singerProfile SingerProfile @relation(fields: [singerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([singerProfileId, artist, title, keyChange])
  @@index([singerProfileId])
  @@map("singer_favorite_songs")
}
```

### Singer Request History Model

```prisma
model SingerRequestHistory {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @map("singer_request_history_id") @db.Uuid
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

  @@index([singerProfileId])
  @@index([singerProfileId, requestedAt])
  @@index([venueId])
  @@map("singer_request_history")
}
```

### Singer Favorite Venue Model

```prisma
model SingerFavoriteVenue {
  singerProfileId String   @map("singer_profiles_id") @db.Uuid
  venueId         String   @map("venues_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  singerProfile SingerProfile @relation(fields: [singerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  venue         Venue         @relation(fields: [venueId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@id([singerProfileId, venueId])
  @@index([singerProfileId])
  @@index([venueId])
  @@map("singer_favorite_venues")
}
```

---

## Branding Models

### Branding Profile Model

```prisma
model BrandingProfile {
  id             String            @id @default(dbgenerated("gen_random_uuid()")) @map("branding_profiles_id") @db.Uuid
  ownerType      BrandingOwnerType @map("owner_type")
  ownerId        String?           @map("owner_id") @db.Uuid
  name           String
  logoUrl        String?           @map("logo_url")
  colorPalette   Json              @map("color_palette") @default("{}")
  poweredBySingr Boolean           @default(true) @map("powered_by_singr")
  domain         String?
  appBundleId    String?           @map("app_bundle_id")
  appPackageName String?           @map("app_package_name")
  status         BrandingStatus    @default(active)
  metadata       Json?             @default("{}")
  createdAt      DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime          @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  brandedApps BrandedApp[]

  @@unique([ownerType, ownerId, name], map: "ux_branding_profiles_owner")
  @@index([ownerType, ownerId])
  @@index([status])
  @@map("branding_profiles")
}
```

### Branded App Model

```prisma
model BrandedApp {
  id                String         @id @default(dbgenerated("gen_random_uuid()")) @map("branded_apps_id") @db.Uuid
  customerProfileId String         @map("customer_profiles_id") @db.Uuid
  brandingProfileId String         @map("branding_profiles_id") @db.Uuid
  name              String
  platform          String
  bundleIdentifier  String?        @map("bundle_identifier")
  status            BrandingStatus @default(active)
  config            Json           @default("{}")
  rateLimitOverride Json?          @map("rate_limit_override")
  createdAt         DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime       @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile    @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  brandingProfile BrandingProfile    @relation(fields: [brandingProfileId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  apiKeys         BrandedAppApiKey[]

  @@index([customerProfileId])
  @@index([brandingProfileId])
  @@map("branded_apps")
}
```

### Branded App API Key Model

```prisma
model BrandedAppApiKey {
  id           String         @id @default(dbgenerated("gen_random_uuid()")) @map("branded_app_api_keys_id") @db.Uuid
  brandedAppId String         @map("branded_apps_id") @db.Uuid
  apiKeyHash   String         @map("api_key_hash")
  description  String?
  lastUsedAt   DateTime?      @map("last_used_at") @db.Timestamptz(6)
  status       BrandingStatus @default(active)
  createdAt    DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime       @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  brandedApp BrandedApp @relation(fields: [brandedAppId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([brandedAppId, apiKeyHash])
  @@index([brandedAppId])
  @@index([apiKeyHash])
  @@map("branded_app_api_keys")
}
```

---

## Audit Models

### Audit Log Model

```prisma
model AuditLog {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @map("audit_logs_id") @db.Uuid
  tableName String   @map("table_name")
  recordId  String?  @map("record_id")
  userId    String?  @map("user_id") @db.Uuid
  operation String
  oldData   Json?    @map("old_data")
  newData   Json?    @map("new_data")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tableName, recordId])
  @@index([userId, createdAt])
  @@index([createdAt])
  @@map("audit_logs")
}
```

---

## Analytics Models

### Saved Report Model

```prisma
model SavedReport {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @map("saved_reports_id") @db.Uuid
  customerProfileId String   @map("customer_profiles_id") @db.Uuid
  createdByUserId   String   @map("created_by_users_id") @db.Uuid
  name              String
  description       String?
  reportType        String   @map("report_type")
  filters           Json     @default("{}")
  columns           String[] @default([])
  sortBy            Json     @map("sort_by") @default("[]")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  customerProfile CustomerProfile   @relation(fields: [customerProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  createdByUser   User              @relation(fields: [createdByUserId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  executions      ReportExecution[]

  @@index([customerProfileId])
  @@index([createdByUserId])
  @@map("saved_reports")
}
```

### Report Execution Model

```prisma
model ReportExecution {
  id               String    @id @default(dbgenerated("gen_random_uuid()")) @map("report_executions_id") @db.Uuid
  savedReportId    String    @map("saved_reports_id") @db.Uuid
  executedByUserId String    @map("executed_by_users_id") @db.Uuid
  reportType       String    @map("report_type")
  filters          Json      @default("{}")
  format           String
  rowCount         Int?      @map("row_count")
  executionTimeMs  Int?      @map("execution_time_ms")
  fileUrl          String?   @map("file_url")
  fileSizeBytes    BigInt?   @map("file_size_bytes")
  expiresAt        DateTime? @map("expires_at") @db.Timestamptz(6)
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  savedReport    SavedReport @relation(fields: [savedReportId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  executedByUser User        @relation(fields: [executedByUserId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@index([savedReportId])
  @@index([executedByUserId])
  @@index([createdAt])
  @@index([expiresAt])
  @@map("report_executions")
}
```

---

## Usage Notes

### Generating Prisma Client

```bash
# Generate the Prisma client
npx prisma generate

# Create a migration
npx prisma migrate dev --name init

# Deploy migrations to production
npx prisma migrate deploy

# Open Prisma Studio (database GUI)
npx prisma studio
```

### Key Features

1. **Type Safety**: All database operations are fully typed
2. **Relationships**: Foreign keys and relations properly defined
3. **Cascading**: Appropriate cascade rules for data integrity
4. **Indexes**: Performance indexes on frequently queried fields
5. **Defaults**: Sensible default values for fields
6. **Enums**: Type-safe enum definitions
7. **JSON Fields**: Flexible metadata storage
8. **PostGIS**: Geographic data support via `Unsupported` type
9. **Timestamps**: Automatic `createdAt` and `updatedAt` tracking
10. **Multi-tenancy**: Customer profile isolation

### Best Practices

1. Always use transactions for multi-table operations
2. Use `include` and `select` to optimize queries
3. Leverage Prisma's connection pooling
4. Use raw queries for complex analytics
5. Keep materialized views refreshed via cron jobs
6. Monitor query performance with Prisma metrics
7. Use soft deletes where appropriate
8. Implement proper error handling
9. Validate data before database operations
10. Use middleware for audit logging

### Performance Tips

- Use indexes wisely (already included in schema)
- Consider pagination for large datasets
- Use `findUnique` instead of `findFirst` when possible
- Batch operations with `createMany`, `updateMany`, `deleteMany`
- Use connection pooling in production
- Monitor slow queries
- Consider read replicas for analytics
- Use materialized views for complex aggregations

---

## Schema Maintenance

### Adding New Models

1. Add model definition to this schema
2. Run `npx prisma migrate dev --name add_model_name`
3. Update TypeScript types if needed
4. Add appropriate indexes
5. Update seed data if necessary

### Modifying Existing Models

1. Update model definition
2. Run `npx prisma migrate dev --name update_model_name`
3. Handle data migration if needed
4. Update application code
5. Test thoroughly

### Database Migrations

All migrations are stored in `prisma/migrations/` directory and should be:
- Version controlled
- Tested in development
- Reviewed before production deployment
- Applied sequentially
- Backed up before major changes
