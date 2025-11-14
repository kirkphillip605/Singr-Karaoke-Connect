# Singr API Reference

Complete API documentation for the Singr Central API Backend (Phases 0-11).

**Base URL**: `http://localhost:3000` (development)  
**API Version**: v1  
**Authentication**: Bearer JWT tokens

---

## Authentication Endpoints

### POST `/v1/auth/signup`
Create a new user account (singer or customer).

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "name": "John Doe",
  "accountType": "singer" | "customer",
  "singerData": { "nickname": "JD" },
  "customerData": { 
    "legalBusinessName": "Karaoke Palace",
    "timezone": "America/New_York"
  }
}
```

**Response** (201):
```json
{
  "user": { "id": "uuid", "email": "...", "name": "..." },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 900
}
```

### POST `/v1/auth/signin`
Authenticate and receive JWT tokens.

### POST `/v1/auth/refresh`
Refresh access token using refresh token.

### POST `/v1/auth/logout`
Revoke current token (requires authentication).

### POST `/v1/auth/forgot-password`
Request password reset email.

### POST `/v1/auth/reset-password`
Complete password reset with token.

---

## Public Endpoints

### GET `/v1/public/venues`
Search public venues.

**Query Parameters**:
- `city` (string, optional): Filter by city
- `state` (string, optional): Filter by state
- `acceptingRequests` (boolean, optional): Filter by request status
- `limit` (number, default: 20): Results per page
- `offset` (number, default: 0): Pagination offset

**Response**:
```json
{
  "venues": [
    {
      "id": "uuid",
      "name": "Karaoke Palace",
      "urlName": "karaoke-palace-nyc",
      "city": "New York",
      "state": "NY",
      "acceptingRequests": true
    }
  ],
  "pagination": {
    "total": 100,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

### GET `/v1/public/venues/:urlName`
Get venue details by URL name.

### GET `/v1/public/venues/:urlName/songdb`
Search venue's song database (requires `q` query param, min 2 chars).

### POST `/v1/public/venues/:urlName/requests`
Submit guest song request.

---

## Singer Endpoints

🔒 All endpoints require authentication

### GET `/v1/singer/profile`
Get singer profile.

### PUT `/v1/singer/profile`
Update singer profile (nickname, avatar, preferences).

### GET `/v1/singer/favorites/songs`
List favorite songs (paginated).

### POST `/v1/singer/favorites/songs`
Add song to favorites.

**Request Body**:
```json
{
  "artist": "Journey",
  "title": "Don't Stop Believin'",
  "keyChange": 0
}
```

### DELETE `/v1/singer/favorites/songs/:songId`
Remove song from favorites.

### GET `/v1/singer/favorites/venues`
List favorite venues.

### POST `/v1/singer/favorites/venues`
Add venue to favorites.

### DELETE `/v1/singer/favorites/venues/:venueId`
Remove venue from favorites.

### GET `/v1/singer/history`
Get request history with optional venue filtering.

### POST `/v1/singer/venues/:venueUrlName/requests`
Submit authenticated song request.

---

## Customer Endpoints

🔒 All endpoints require authentication and customer profile

### Profile

#### GET `/v1/customer/profile`
Get customer profile details.

### Venues

#### GET `/v1/customer/venues`
List all venues owned by customer (paginated).

#### POST `/v1/customer/venues`
Create new venue.

**Request Body**:
```json
{
  "name": "Downtown Karaoke",
  "urlName": "downtown-karaoke-nyc",
  "address": "123 Main St",
  "city": "New York",
  "state": "NY",
  "postalCode": "10001",
  "phoneNumber": "+1-212-555-0100",
  "acceptingRequests": true
}
```

#### GET `/v1/customer/venues/:venueId`
Get venue details.

#### PUT `/v1/customer/venues/:venueId`
Update venue.

#### DELETE `/v1/customer/venues/:venueId`
Delete venue.

### Requests

#### GET `/v1/customer/venues/:venueId/requests`
List requests for a venue.

**Query Parameters**:
- `processed` (boolean, optional): Filter by processed status
- `limit`, `offset`: Pagination

#### PATCH `/v1/customer/venues/:venueId/requests/:requestId`
Update request (mark as processed, add notes).

**Request Body**:
```json
{
  "processed": true,
  "notes": "Sang at 9:30 PM"
}
```

#### DELETE `/v1/customer/venues/:venueId/requests/:requestId`
Delete request.

### Systems

#### GET `/v1/customer/systems`
List all karaoke systems with song counts.

**Query Parameters**:
- `search` (string, optional): Search by name
- `limit`, `offset`: Pagination

**Response**:
```json
{
  "systems": [
    {
      "id": "uuid",
      "openkjSystemId": 1,
      "name": "Main System",
      "songCount": 15000,
      "configuration": {},
      "createdAt": "2025-11-14T...",
      "updatedAt": "2025-11-14T..."
    }
  ],
  "pagination": { ... }
}
```

#### POST `/v1/customer/systems`
Create new system (auto-generates OpenKJ ID).

**Request Body**:
```json
{
  "name": "Main Karaoke System",
  "configuration": {
    "brand": "OpenKJ",
    "version": "2.0"
  }
}
```

#### GET `/v1/customer/systems/:systemId`
Get system details with song count.

#### PUT `/v1/customer/systems/:systemId`
Update system name or configuration.

#### DELETE `/v1/customer/systems/:systemId`
Delete system (only if no songs exist).

### Song Database

#### GET `/v1/customer/songdb`
Search songs across all systems or specific system.

**Query Parameters**:
- `systemId` (uuid, optional): Filter by system
- `search` (string, min 2 chars, optional): Full-text search
- `limit`, `offset`: Pagination

**Response**:
```json
{
  "songs": [
    {
      "id": "12345",
      "artist": "Journey",
      "title": "Don't Stop Believin'",
      "combined": "Journey - Don't Stop Believin'",
      "openkjSystemId": 1,
      "createdAt": "2025-11-14T..."
    }
  ],
  "pagination": { ... }
}
```

#### GET `/v1/customer/songdb/:songId`
Get single song details.

#### POST `/v1/customer/songdb/import`
Bulk import songs (up to 10,000 per request).

**Request Body**:
```json
{
  "openkjSystemId": 1,
  "songs": [
    { "artist": "Journey", "title": "Don't Stop Believin'" },
    { "artist": "Queen", "title": "Bohemian Rhapsody" },
    ...
  ]
}
```

**Response**:
```json
{
  "imported": 1500,
  "skipped": 50,
  "errors": 0
}
```

#### GET `/v1/customer/systems/:systemId/songs/export`
Export all songs for a system.

**Headers**:
- `Accept: application/json` → JSON response
- `Accept: text/csv` → CSV file download

**CSV Response**:
```csv
Artist,Title
"Journey","Don't Stop Believin'"
"Queen","Bohemian Rhapsody"
```

#### DELETE `/v1/customer/songdb/:songId`
Delete single song.

#### DELETE `/v1/customer/systems/:systemId/songs`
Bulk delete all songs for a system.

**Response**:
```json
{
  "deletedCount": 15000
}
```

### API Keys

#### GET `/v1/customer/api-keys`
List all API keys with status filtering.

**Query Parameters**:
- `status` (enum, optional): `active`, `revoked`, `expired`, `suspended`
- `limit`, `offset`: Pagination

**Response**:
```json
{
  "apiKeys": [
    {
      "id": "uuid",
      "description": "Production OpenKJ Integration",
      "status": "active",
      "lastUsedAt": "2025-11-14T...",
      "createdAt": "2025-11-14T..."
    }
  ],
  "pagination": { ... }
}
```

#### POST `/v1/customer/api-keys`
Generate new API key.

**Request Body**:
```json
{
  "description": "Production OpenKJ Integration"
}
```

**Response** (201):
```json
{
  "id": "uuid",
  "key": "sk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "description": "Production OpenKJ Integration",
  "status": "active",
  "createdAt": "2025-11-14T...",
  "warning": "This is the only time you will see this key. Please store it securely."
}
```

⚠️ **Important**: The API key is only shown once at creation!

#### GET `/v1/customer/api-keys/:keyId`
Get API key details (without secret).

#### DELETE `/v1/customer/api-keys/:keyId`
Revoke API key (sets status to `revoked`).

---

## Error Responses

All errors follow RFC 7807 Problem Details format:

```json
{
  "type": "validation_error",
  "title": "Validation Error",
  "status": 400,
  "detail": "Invalid input provided",
  "errors": [
    { "field": "email", "message": "Invalid email address" }
  ]
}
```

**Common Error Types**:
- `validation_error` (400): Invalid input
- `authentication_required` (401): Missing/invalid token
- `insufficient_permissions` (403): Authorization failed
- `resource_not_found` (404): Resource doesn't exist
- `conflict` (409): Resource conflict (e.g., duplicate)
- `rate_limited` (429): Too many requests
- `internal_error` (500): Server error

---

## Rate Limits

- **Authenticated**: 100 requests/minute per user
- **Public**: 60 requests/minute per IP

Rate limit headers:
- `X-RateLimit-Limit`: Requests allowed per window
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Time until limit resets (seconds)

---

## Pagination

All list endpoints support pagination:

**Query Parameters**:
- `limit` (number, 1-100, default: 20): Results per page
- `offset` (number, default: 0): Skip N results

**Response Format**:
```json
{
  "data": [...],
  "pagination": {
    "total": 1000,
    "limit": 20,
    "offset": 0,
    "hasMore": true,
    "nextCursor": "20"
  }
}
```

---

## Authentication

### JWT Token Format

**Access Token** (15 minutes):
```
Authorization: ******
```

**Claims**:
```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "jti": "token-uuid",
  "iat": 1234567890,
  "exp": 1234568790,
  "iss": "https://api.singrkaraoke.com",
  "aud": "https://singrkaraoke.com"
}
```

### Token Refresh Flow

1. Sign in → receive `accessToken` + `refreshToken`
2. Use `accessToken` for requests (15 min)
3. When expired → POST `/v1/auth/refresh` with `refreshToken`
4. Receive new token pair
5. Old refresh token is revoked

---

## OpenKJ Integration

Coming in Phase 11 continuation:
- Compatible request submission endpoints
- System synchronization
- Song database import from OpenKJ format
- Real-time request updates

---

## Examples

### Complete Flow: Sign Up → Create Venue → Submit Request

```bash
# 1. Sign up as customer
curl -X POST http://localhost:3000/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner@venue.com",
    "password": "SecurePass123!",
    "accountType": "customer",
    "customerData": {
      "legalBusinessName": "Karaoke Palace"
    }
  }'

# Save accessToken from response

# 2. Create venue
curl -X POST http://localhost:3000/v1/customer/venues \
  -H "Authorization: ******" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Downtown Karaoke",
    "urlName": "downtown-karaoke-nyc",
    "address": "123 Main St",
    "city": "New York",
    "state": "NY",
    "postalCode": "10001"
  }'

# 3. Guest submits request
curl -X POST http://localhost:3000/v1/public/venues/downtown-karaoke-nyc/requests \
  -H "Content-Type: application/json" \
  -d '{
    "artist": "Journey",
    "title": "Don'\''t Stop Believin'\''",
    "keyChange": 0
  }'
```

---

**Total Endpoints**: 52  
**API Version**: 1.0  
**Last Updated**: 2025-11-14
