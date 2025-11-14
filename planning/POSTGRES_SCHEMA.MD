# Singr Central API - PostgreSQL Database Schema

**Version:** 1.0  
**Database:** PostgreSQL 16 with PostGIS extension  
**Last Updated:** 2025-11-12

## Table of Contents

1. [Extensions](#extensions)
2. [Functions and Triggers](#functions-and-triggers)
3. [Enum Types](#enum-types)
4. [Core Identity Tables](#core-identity-tables)
5. [Profile Tables](#profile-tables)
6. [Organization Tables](#organization-tables)
7. [Stripe and Billing Tables](#stripe-and-billing-tables)
8. [API Key Tables](#api-key-tables)
9. [Venue Tables](#venue-tables)
10. [Song Database Tables](#song-database-tables)
11. [Request Tables](#request-tables)
12. [Singer Feature Tables](#singer-feature-tables)
13. [Branding Tables](#branding-tables)
14. [Audit Tables](#audit-tables)
15. [Analytics Views](#analytics-views)
16. [Indexes](#indexes)

---

## Extensions

```sql
-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

---

## Functions and Triggers

### Update Timestamp Function

```sql
-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Audit Logging Function

```sql
-- Function to record audit logs for data changes
CREATE OR REPLACE FUNCTION record_audit()
RETURNS TRIGGER AS $$
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
    gen_random_uuid(),
    TG_TABLE_NAME,
    COALESCE(NEW.id::TEXT, OLD.id::TEXT),
    COALESCE(current_setting('app.current_user_id', true)::UUID, NULL),
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
```

---

## Enum Types

```sql
-- Branding owner type
CREATE TYPE branding_owner_type AS ENUM ('platform', 'customer');

-- Branding status
CREATE TYPE branding_status AS ENUM ('active', 'suspended', 'revoked');

-- Organization user status
CREATE TYPE organization_user_status AS ENUM ('invited', 'active', 'suspended', 'revoked');

-- API key status
CREATE TYPE api_key_status AS ENUM ('active', 'revoked', 'expired', 'suspended');

-- Subscription status (Stripe compatible)
CREATE TYPE subscription_status AS ENUM (
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused'
);
```

---

## Core Identity Tables

### Users Table

```sql
CREATE TABLE users (
  users_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT,
  password_algo VARCHAR(50) DEFAULT 'argon2id',
  name VARCHAR(255),
  display_name VARCHAR(255),
  phone_number VARCHAR(50),
  image_url TEXT,
  is_email_verified BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone_number) WHERE phone_number IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Roles Table

```sql
CREATE TABLE roles (
  roles_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_roles_slug ON roles(slug);

CREATE TRIGGER update_roles_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Permissions Table

```sql
CREATE TABLE permissions (
  permissions_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_permissions_slug ON permissions(slug);

CREATE TRIGGER update_permissions_updated_at
  BEFORE UPDATE ON permissions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Role Permissions Table

```sql
CREATE TABLE role_permissions (
  role_permissions_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roles_id UUID NOT NULL REFERENCES roles(roles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  permissions_id UUID NOT NULL REFERENCES permissions(permissions_id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ux_role_permissions_role_permission UNIQUE (roles_id, permissions_id)
);

CREATE INDEX idx_role_permissions_role ON role_permissions(roles_id);
CREATE INDEX idx_role_permissions_permission ON role_permissions(permissions_id);
```

### User Roles Table

```sql
CREATE TABLE user_roles (
  user_roles_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id UUID NOT NULL REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  roles_id UUID NOT NULL REFERENCES roles(roles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ux_user_roles_user_role UNIQUE (users_id, roles_id)
);

CREATE INDEX idx_user_roles_user ON user_roles(users_id);
CREATE INDEX idx_user_roles_role ON user_roles(roles_id);
```

### Accounts Table (OAuth)

```sql
CREATE TABLE accounts (
  accounts_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id UUID NOT NULL REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  provider VARCHAR(100) NOT NULL,
  provider_account_id VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  token_type VARCHAR(50),
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ux_accounts_provider UNIQUE (provider, provider_account_id)
);

CREATE INDEX idx_accounts_user ON accounts(users_id);

CREATE TRIGGER update_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Sessions Table

```sql
CREATE TABLE sessions (
  sessions_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id UUID NOT NULL REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  session_token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(users_id);
CREATE INDEX idx_sessions_token ON sessions(session_token);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Verification Tokens Table

```sql
CREATE TABLE verification_tokens (
  identifier VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (identifier, token)
);

CREATE INDEX idx_verification_tokens_expires ON verification_tokens(expires_at);
```

---

## Profile Tables

### Customer Profiles Table

```sql
CREATE TABLE customer_profiles (
  customer_profiles_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id UUID UNIQUE NOT NULL REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  legal_business_name VARCHAR(255),
  dba_name VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  timezone VARCHAR(100) DEFAULT 'UTC',
  billing_address JSONB,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customer_profiles_user ON customer_profiles(users_id);
CREATE INDEX idx_customer_profiles_stripe ON customer_profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

CREATE TRIGGER update_customer_profiles_updated_at
  BEFORE UPDATE ON customer_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Singer Profiles Table

```sql
CREATE TABLE singer_profiles (
  singer_profiles_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  users_id UUID UNIQUE NOT NULL REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  nickname VARCHAR(255),
  avatar_url TEXT,
  preferences JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_singer_profiles_user ON singer_profiles(users_id);

CREATE TRIGGER update_singer_profiles_updated_at
  BEFORE UPDATE ON singer_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

## Organization Tables

### Organization Users Table

```sql
CREATE TABLE organization_users (
  organization_users_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  users_id UUID NOT NULL REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  invited_by_user_id UUID REFERENCES users(users_id) ON DELETE SET NULL ON UPDATE CASCADE,
  role_id UUID REFERENCES roles(roles_id) ON DELETE SET NULL ON UPDATE CASCADE,
  status organization_user_status DEFAULT 'invited',
  invitation_token VARCHAR(255),
  invitation_expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ux_organization_users_customer_user UNIQUE (customer_profiles_id, users_id)
);

CREATE INDEX idx_organization_users_customer ON organization_users(customer_profiles_id);
CREATE INDEX idx_organization_users_user ON organization_users(users_id);
CREATE INDEX idx_organization_users_status ON organization_users(status);

CREATE TRIGGER update_organization_users_updated_at
  BEFORE UPDATE ON organization_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Organization User Permissions Table

```sql
CREATE TABLE organization_user_permissions (
  organization_user_permissions_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_users_id UUID NOT NULL REFERENCES organization_users(organization_users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  permissions_id UUID NOT NULL REFERENCES permissions(permissions_id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ux_org_user_permissions UNIQUE (organization_users_id, permissions_id)
);

CREATE INDEX idx_org_user_permissions_org_user ON organization_user_permissions(organization_users_id);
CREATE INDEX idx_org_user_permissions_permission ON organization_user_permissions(permissions_id);
```

---

## Stripe and Billing Tables

### Customers Table (Stripe)

```sql
CREATE TABLE customers (
  customers_id UUID PRIMARY KEY,
  stripe_customer_id VARCHAR(255) NOT NULL,
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  email VARCHAR(255),
  name VARCHAR(255),
  phone VARCHAR(50),
  description TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  invoice_settings JSONB DEFAULT '{}'::JSONB,
  shipping JSONB DEFAULT '{}'::JSONB,
  tax_exempt VARCHAR(50),
  tax_ids JSONB DEFAULT '[]'::JSONB,
  livemode BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customers_stripe ON customers(stripe_customer_id);
CREATE INDEX idx_customers_customer_profile ON customers(customer_profiles_id);

CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Stripe Checkout Sessions Table

```sql
CREATE TABLE stripe_checkout_sessions (
  stripe_checkout_sessions_id VARCHAR(255) PRIMARY KEY,
  customers_id UUID REFERENCES customers(customers_id) ON DELETE CASCADE ON UPDATE CASCADE,
  payment_status VARCHAR(50) NOT NULL,
  mode VARCHAR(50) NOT NULL,
  amount_total BIGINT,
  currency CHAR(3) NOT NULL,
  url TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stripe_checkout_sessions_customer ON stripe_checkout_sessions(customers_id);
CREATE INDEX idx_stripe_checkout_sessions_status ON stripe_checkout_sessions(payment_status);
```

### Products Table (Stripe)

```sql
CREATE TABLE products (
  products_id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255),
  description TEXT,
  active BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}'::JSONB,
  images TEXT[] DEFAULT ARRAY[]::TEXT[],
  livemode BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_products_active ON products(active);

CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Prices Table (Stripe)

```sql
CREATE TABLE prices (
  prices_id VARCHAR(255) PRIMARY KEY,
  product_id VARCHAR(255) NOT NULL REFERENCES products(products_id) ON DELETE CASCADE ON UPDATE CASCADE,
  active BOOLEAN DEFAULT TRUE,
  currency CHAR(3) NOT NULL,
  type VARCHAR(50) NOT NULL,
  recurring JSONB,
  unit_amount BIGINT,
  metadata JSONB DEFAULT '{}'::JSONB,
  livemode BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prices_product ON prices(product_id);
CREATE INDEX idx_prices_active ON prices(active);

CREATE TRIGGER update_prices_updated_at
  BEFORE UPDATE ON prices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Subscriptions Table

```sql
CREATE TABLE subscriptions (
  subscriptions_id VARCHAR(255) PRIMARY KEY,
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  status subscription_status NOT NULL,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  cancel_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::JSONB,
  livemode BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_customer_profile ON subscriptions(customer_profiles_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Stripe Webhook Events Table

```sql
CREATE TABLE stripe_webhook_events (
  stripe_webhook_events_id SERIAL PRIMARY KEY,
  event_id VARCHAR(255) UNIQUE NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  livemode BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  request_id VARCHAR(255),
  endpoint_secret VARCHAR(255)
);

CREATE INDEX idx_stripe_webhook_events_event_id ON stripe_webhook_events(event_id);
CREATE INDEX idx_stripe_webhook_events_processed ON stripe_webhook_events(processed);
CREATE INDEX idx_stripe_webhook_events_event_type ON stripe_webhook_events(event_type);
```

---

## API Key Tables

### API Keys Table

```sql
CREATE TABLE api_keys (
  api_keys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  customers_id UUID REFERENCES customers(customers_id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_by_users_id UUID REFERENCES users(users_id) ON DELETE SET NULL ON UPDATE CASCADE,
  description TEXT,
  api_key_hash TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  status api_key_status DEFAULT 'active',
  revoked_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_keys_customer_profile ON api_keys(customer_profiles_id);
CREATE INDEX idx_api_keys_customer ON api_keys(customers_id) WHERE customers_id IS NOT NULL;
CREATE INDEX idx_api_keys_hash ON api_keys(api_key_hash);
CREATE INDEX idx_api_keys_status ON api_keys(status);

CREATE TRIGGER update_api_keys_updated_at
  BEFORE UPDATE ON api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

## Venue Tables

### State Table (Request Counter)

```sql
CREATE TABLE state (
  customer_profiles_id UUID PRIMARY KEY REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  serial BIGINT DEFAULT 1 NOT NULL
);
```

### Venues Table

```sql
CREATE TABLE venues (
  venues_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  openkj_venue_id INTEGER NOT NULL,
  url_name VARCHAR(255) UNIQUE NOT NULL,
  accepting_requests BOOLEAN DEFAULT TRUE,
  name VARCHAR(255) NOT NULL,
  address VARCHAR(500) NOT NULL,
  city VARCHAR(255) NOT NULL,
  state VARCHAR(100) NOT NULL,
  postal_code VARCHAR(20) NOT NULL,
  country VARCHAR(100) DEFAULT 'USA',
  phone_number VARCHAR(50),
  website VARCHAR(500),
  location GEOGRAPHY(POINT, 4326),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ux_venues_customer_openkj UNIQUE (customer_profiles_id, openkj_venue_id)
);

CREATE INDEX idx_venues_customer_profile ON venues(customer_profiles_id);
CREATE INDEX idx_venues_url_name ON venues(url_name);
CREATE INDEX idx_venues_location ON venues USING GIST(location) WHERE location IS NOT NULL;
CREATE INDEX idx_venues_city_state ON venues(city, state);

CREATE TRIGGER update_venues_updated_at
  BEFORE UPDATE ON venues
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Systems Table

```sql
CREATE TABLE systems (
  systems_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  openkj_system_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  configuration JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ux_systems_customer_openkj UNIQUE (customer_profiles_id, openkj_system_id)
);

CREATE INDEX idx_systems_customer_profile ON systems(customer_profiles_id);

CREATE TRIGGER update_systems_updated_at
  BEFORE UPDATE ON systems
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

## Song Database Tables

### SongDB Table

```sql
CREATE TABLE songdb (
  songdb_id BIGSERIAL PRIMARY KEY,
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  openkj_system_id INTEGER NOT NULL,
  artist VARCHAR(500) NOT NULL,
  title VARCHAR(500) NOT NULL,
  combined VARCHAR(1000) NOT NULL,
  normalized_combined VARCHAR(1000) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ux_songdb_customer_system_combined UNIQUE (customer_profiles_id, openkj_system_id, combined),
  CONSTRAINT ux_songdb_customer_system_normalized UNIQUE (customer_profiles_id, openkj_system_id, normalized_combined)
);

CREATE INDEX idx_songdb_customer_system ON songdb(customer_profiles_id, openkj_system_id);
CREATE INDEX idx_songdb_customer_system_artist ON songdb(customer_profiles_id, openkj_system_id, artist);
CREATE INDEX idx_songdb_customer_system_title ON songdb(customer_profiles_id, openkj_system_id, title);
CREATE INDEX idx_songdb_normalized ON songdb USING GIN(to_tsvector('english', normalized_combined));

CREATE TRIGGER update_songdb_updated_at
  BEFORE UPDATE ON songdb
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

## Request Tables

### Requests Table

```sql
CREATE TABLE requests (
  requests_id BIGSERIAL PRIMARY KEY,
  venues_id UUID NOT NULL REFERENCES venues(venues_id) ON DELETE CASCADE ON UPDATE CASCADE,
  singer_profiles_id UUID REFERENCES singer_profiles(singer_profiles_id) ON DELETE SET NULL ON UPDATE CASCADE,
  submitted_by_users_id UUID REFERENCES users(users_id) ON DELETE SET NULL ON UPDATE CASCADE,
  artist VARCHAR(500) NOT NULL,
  title VARCHAR(500) NOT NULL,
  key_change INTEGER DEFAULT 0,
  notes TEXT,
  processed BOOLEAN DEFAULT FALSE,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_requests_venue ON requests(venues_id);
CREATE INDEX idx_requests_singer ON requests(singer_profiles_id) WHERE singer_profiles_id IS NOT NULL;
CREATE INDEX idx_requests_venue_processed ON requests(venues_id, processed);
CREATE INDEX idx_requests_requested_at ON requests(requested_at DESC);

CREATE TRIGGER update_requests_updated_at
  BEFORE UPDATE ON requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

## Singer Feature Tables

### Singer Favorite Songs Table

```sql
CREATE TABLE singer_favorite_songs (
  singer_favorite_songs_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singer_profiles_id UUID NOT NULL REFERENCES singer_profiles(singer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  artist VARCHAR(500),
  title VARCHAR(500),
  key_change INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ux_singer_favorite_songs UNIQUE (singer_profiles_id, artist, title, key_change)
);

CREATE INDEX idx_singer_favorite_songs_singer ON singer_favorite_songs(singer_profiles_id);

CREATE TRIGGER update_singer_favorite_songs_updated_at
  BEFORE UPDATE ON singer_favorite_songs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Singer Request History Table

```sql
CREATE TABLE singer_request_history (
  singer_request_history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singer_profiles_id UUID NOT NULL REFERENCES singer_profiles(singer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  venues_id UUID NOT NULL REFERENCES venues(venues_id) ON DELETE CASCADE ON UPDATE CASCADE,
  artist VARCHAR(500) NOT NULL,
  title VARCHAR(500) NOT NULL,
  key_change INTEGER DEFAULT 0,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  song_fingerprint VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_singer_request_history_singer ON singer_request_history(singer_profiles_id);
CREATE INDEX idx_singer_request_history_singer_requested ON singer_request_history(singer_profiles_id, requested_at DESC);
CREATE INDEX idx_singer_request_history_venue ON singer_request_history(venues_id);

CREATE TRIGGER update_singer_request_history_updated_at
  BEFORE UPDATE ON singer_request_history
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Singer Favorite Venues Table

```sql
CREATE TABLE singer_favorite_venues (
  singer_profiles_id UUID NOT NULL REFERENCES singer_profiles(singer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  venues_id UUID NOT NULL REFERENCES venues(venues_id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (singer_profiles_id, venues_id)
);

CREATE INDEX idx_singer_favorite_venues_singer ON singer_favorite_venues(singer_profiles_id);
CREATE INDEX idx_singer_favorite_venues_venue ON singer_favorite_venues(venues_id);
```

---

## Branding Tables

### Branding Profiles Table

```sql
CREATE TABLE branding_profiles (
  branding_profiles_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type branding_owner_type NOT NULL,
  owner_id UUID,
  name VARCHAR(255) NOT NULL,
  logo_url TEXT,
  color_palette JSONB DEFAULT '{}'::JSONB,
  powered_by_singr BOOLEAN DEFAULT TRUE,
  domain VARCHAR(255),
  app_bundle_id VARCHAR(255),
  app_package_name VARCHAR(255),
  status branding_status DEFAULT 'active',
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ux_branding_profiles_owner UNIQUE (owner_type, owner_id, name)
);

CREATE INDEX idx_branding_profiles_owner ON branding_profiles(owner_type, owner_id);
CREATE INDEX idx_branding_profiles_status ON branding_profiles(status);

CREATE TRIGGER update_branding_profiles_updated_at
  BEFORE UPDATE ON branding_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Branded Apps Table

```sql
CREATE TABLE branded_apps (
  branded_apps_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  branding_profiles_id UUID NOT NULL REFERENCES branding_profiles(branding_profiles_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  name VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  bundle_identifier VARCHAR(255),
  status branding_status DEFAULT 'active',
  config JSONB DEFAULT '{}'::JSONB,
  rate_limit_override JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_branded_apps_customer ON branded_apps(customer_profiles_id);
CREATE INDEX idx_branded_apps_branding_profile ON branded_apps(branding_profiles_id);

CREATE TRIGGER update_branded_apps_updated_at
  BEFORE UPDATE ON branded_apps
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Branded App API Keys Table

```sql
CREATE TABLE branded_app_api_keys (
  branded_app_api_keys_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branded_apps_id UUID NOT NULL REFERENCES branded_apps(branded_apps_id) ON DELETE CASCADE ON UPDATE CASCADE,
  api_key_hash TEXT NOT NULL,
  description TEXT,
  last_used_at TIMESTAMPTZ,
  status branding_status DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ux_branded_app_api_keys UNIQUE (branded_apps_id, api_key_hash)
);

CREATE INDEX idx_branded_app_api_keys_app ON branded_app_api_keys(branded_apps_id);
CREATE INDEX idx_branded_app_api_keys_hash ON branded_app_api_keys(api_key_hash);

CREATE TRIGGER update_branded_app_api_keys_updated_at
  BEFORE UPDATE ON branded_app_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

## Audit Tables

### Audit Logs Table

```sql
CREATE TABLE audit_logs (
  audit_logs_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(255) NOT NULL,
  record_id VARCHAR(255),
  user_id UUID,
  operation VARCHAR(20) NOT NULL,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
```

---

## Analytics Views

### Daily Request Statistics Materialized View

```sql
CREATE MATERIALIZED VIEW daily_request_stats AS
SELECT
  v.customer_profiles_id,
  r.venues_id,
  v.name AS venue_name,
  DATE(r.requested_at) AS date,
  COUNT(r.requests_id) AS total_requests,
  COUNT(r.requests_id) FILTER (WHERE r.processed = TRUE) AS processed_requests,
  COUNT(DISTINCT r.singer_profiles_id) AS unique_singers,
  COUNT(DISTINCT LOWER(r.artist || ' - ' || r.title)) AS unique_songs
FROM requests r
JOIN venues v ON r.venues_id = v.venues_id
GROUP BY v.customer_profiles_id, r.venues_id, v.name, DATE(r.requested_at);

CREATE UNIQUE INDEX idx_daily_request_stats_unique 
  ON daily_request_stats(customer_profiles_id, venues_id, date);

CREATE INDEX idx_daily_request_stats_customer 
  ON daily_request_stats(customer_profiles_id);

CREATE INDEX idx_daily_request_stats_venue 
  ON daily_request_stats(venues_id);

CREATE INDEX idx_daily_request_stats_date 
  ON daily_request_stats(date DESC);

COMMENT ON MATERIALIZED VIEW daily_request_stats IS 
  'Daily aggregated request statistics per venue. Refresh nightly.';
```

### Song Popularity Statistics Materialized View

```sql
CREATE MATERIALIZED VIEW song_popularity_stats AS
SELECT
  v.customer_profiles_id,
  r.venues_id,
  v.name AS venue_name,
  r.artist,
  r.title,
  LOWER(r.artist || ' - ' || r.title) AS normalized_song,
  COUNT(r.requests_id) AS request_count,
  COUNT(DISTINCT r.singer_profiles_id) AS unique_requesters,
  COUNT(r.requests_id) FILTER (WHERE r.processed = TRUE) AS times_performed,
  MAX(r.requested_at) AS last_requested_at,
  MIN(r.requested_at) AS first_requested_at
FROM requests r
JOIN venues v ON r.venues_id = v.venues_id
GROUP BY v.customer_profiles_id, r.venues_id, v.name, r.artist, r.title;

CREATE UNIQUE INDEX idx_song_popularity_stats_unique 
  ON song_popularity_stats(customer_profiles_id, venues_id, normalized_song);

CREATE INDEX idx_song_popularity_stats_customer 
  ON song_popularity_stats(customer_profiles_id);

CREATE INDEX idx_song_popularity_stats_venue 
  ON song_popularity_stats(venues_id);

CREATE INDEX idx_song_popularity_stats_request_count 
  ON song_popularity_stats(request_count DESC);

COMMENT ON MATERIALIZED VIEW song_popularity_stats IS 
  'Aggregated statistics for song popularity per venue. Refresh nightly.';
```

### Singer Activity Statistics Materialized View

```sql
CREATE MATERIALIZED VIEW singer_activity_stats AS
SELECT
  v.customer_profiles_id,
  r.singer_profiles_id,
  u.name AS singer_name,
  u.email AS singer_email,
  r.venues_id,
  v.name AS venue_name,
  COUNT(r.requests_id) AS total_requests,
  COUNT(r.requests_id) FILTER (WHERE r.processed = TRUE) AS requests_performed,
  COUNT(DISTINCT DATE(r.requested_at)) AS days_active,
  MAX(r.requested_at) AS last_request_at,
  MIN(r.requested_at) AS first_request_at
FROM requests r
JOIN venues v ON r.venues_id = v.venues_id
JOIN singer_profiles sp ON r.singer_profiles_id = sp.singer_profiles_id
JOIN users u ON sp.users_id = u.users_id
WHERE r.singer_profiles_id IS NOT NULL
GROUP BY v.customer_profiles_id, r.singer_profiles_id, u.name, u.email, r.venues_id, v.name;

CREATE UNIQUE INDEX idx_singer_activity_stats_unique 
  ON singer_activity_stats(customer_profiles_id, singer_profiles_id, venues_id);

CREATE INDEX idx_singer_activity_stats_customer 
  ON singer_activity_stats(customer_profiles_id);

CREATE INDEX idx_singer_activity_stats_singer 
  ON singer_activity_stats(singer_profiles_id);

CREATE INDEX idx_singer_activity_stats_venue 
  ON singer_activity_stats(venues_id);

CREATE INDEX idx_singer_activity_stats_total_requests 
  ON singer_activity_stats(total_requests DESC);

COMMENT ON MATERIALIZED VIEW singer_activity_stats IS 
  'Aggregated singer activity statistics per venue. Refresh nightly.';
```

### Platform Analytics Materialized View

```sql
CREATE MATERIALIZED VIEW platform_analytics AS
SELECT
  COUNT(DISTINCT cp.customer_profiles_id) AS total_customers,
  COUNT(DISTINCT cp.customer_profiles_id) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM subscriptions s 
      WHERE s.customer_profiles_id = cp.customer_profiles_id 
      AND s.status IN ('active', 'trialing')
    )
  ) AS active_customers,
  COUNT(DISTINCT v.venues_id) AS total_venues,
  COUNT(DISTINCT sp.singer_profiles_id) AS total_singers,
  COUNT(r.requests_id) AS total_requests,
  COUNT(r.requests_id) FILTER (WHERE r.processed = TRUE) AS total_processed,
  COUNT(r.requests_id) FILTER (
    WHERE r.requested_at >= CURRENT_DATE
  ) AS requests_today,
  COUNT(r.requests_id) FILTER (
    WHERE r.requested_at >= DATE_TRUNC('month', CURRENT_DATE)
  ) AS requests_this_month
FROM customer_profiles cp
LEFT JOIN venues v ON v.customer_profiles_id = cp.customer_profiles_id
LEFT JOIN requests r ON r.venues_id = v.venues_id
LEFT JOIN singer_profiles sp ON r.singer_profiles_id = sp.singer_profiles_id;

CREATE UNIQUE INDEX idx_platform_analytics_single_row 
  ON platform_analytics ((1));

COMMENT ON MATERIALIZED VIEW platform_analytics IS 
  'Platform-wide statistics for admin dashboard. Refresh hourly.';
```

### Function to Refresh All Analytics Views

```sql
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY daily_request_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY song_popularity_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY singer_activity_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY platform_analytics;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_analytics_views IS 
  'Refresh all analytics materialized views. Schedule to run daily at 1 AM UTC.';
```

---

## Saved Reports Tables

### Saved Reports Table

```sql
CREATE TABLE saved_reports (
  saved_reports_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profiles_id UUID NOT NULL REFERENCES customer_profiles(customer_profiles_id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_by_users_id UUID NOT NULL REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  report_type VARCHAR(100) NOT NULL,
  filters JSONB DEFAULT '{}'::JSONB,
  columns TEXT[] DEFAULT ARRAY[]::TEXT[],
  sort_by JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_saved_reports_customer ON saved_reports(customer_profiles_id);
CREATE INDEX idx_saved_reports_created_by ON saved_reports(created_by_users_id);

CREATE TRIGGER update_saved_reports_updated_at
  BEFORE UPDATE ON saved_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Report Executions Table

```sql
CREATE TABLE report_executions (
  report_executions_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_reports_id UUID NOT NULL REFERENCES saved_reports(saved_reports_id) ON DELETE CASCADE ON UPDATE CASCADE,
  executed_by_users_id UUID NOT NULL REFERENCES users(users_id) ON DELETE CASCADE ON UPDATE CASCADE,
  report_type VARCHAR(100) NOT NULL,
  filters JSONB DEFAULT '{}'::JSONB,
  format VARCHAR(20) NOT NULL,
  row_count INTEGER,
  execution_time_ms INTEGER,
  file_url TEXT,
  file_size_bytes BIGINT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_report_executions_report ON report_executions(saved_reports_id);
CREATE INDEX idx_report_executions_executed_by ON report_executions(executed_by_users_id);
CREATE INDEX idx_report_executions_created_at ON report_executions(created_at DESC);
CREATE INDEX idx_report_executions_expires ON report_executions(expires_at) 
  WHERE expires_at IS NOT NULL;
```

---

## Summary

This PostgreSQL schema provides:

1. **Complete user management** with roles and permissions
2. **Multi-tenancy** through customer profiles
3. **OAuth support** via accounts table
4. **Stripe integration** for billing and subscriptions
5. **Venue and system management** for karaoke operations
6. **Song database** with full-text search capabilities
7. **Request tracking** for karaoke song requests
8. **Singer features** including favorites and history
9. **Branding and white-labeling** support
10. **Comprehensive audit logging**
11. **Analytics materialized views** for reporting
12. **PostGIS support** for location-based features
13. **Automatic timestamp management** via triggers
14. **Proper indexing** for performance optimization

The schema is designed to support:
- High-volume request processing
- Multi-tenant isolation
- Scalable analytics
- Flexible branding
- Comprehensive auditing
- OAuth and JWT authentication
- Stripe payment processing
- Geographic venue search

**Maintenance Notes:**
- Run `refresh_analytics_views()` daily at 1 AM UTC
- Monitor index usage and query performance
- Regular vacuum and analyze operations recommended
- Consider partitioning requests table by date for high-volume environments
