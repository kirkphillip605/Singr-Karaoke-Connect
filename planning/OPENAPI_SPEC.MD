# Singr Central API - OpenAPI 3.0 Specification

**Version:** 1.0.0  
**Last Updated:** 2025-11-12  
**Base URL:** https://api.singrkaraoke.com

This document contains the complete OpenAPI specification for the Singr Central API Backend, covering all endpoints across the singer web app, singer mobile apps, and customer web portal.

---

## OpenAPI Specification

```yaml
openapi: 3.0.3
info:
  title: Singr Central API
  description: |
    **Singr Central API** is a unified, stateless REST API that powers all Singr ecosystem applications:
    - **Singer Web App** - For registered and guest singers to discover venues, search songs, submit requests
    - **Singer Mobile Apps** - Native iOS/Android applications for singers
    - **Customer Web Portal** - For karaoke venue owners/managers to manage venues, staff, requests, and billing
    
    ## Authentication
    
    The API uses JWT (ES256) tokens for authentication with refresh token rotation:
    - Access tokens expire after 15 minutes
    - Refresh tokens expire after 7 days
    - Include access token in `Authorization: Bearer <token>` header
    
    ## Rate Limiting
    
    Rate limits vary by endpoint type:
    - **Public endpoints**: 60 requests per minute
    - **Authentication endpoints**: 5-10 requests per hour
    - **Authenticated endpoints**: 100 requests per minute
    - **API key endpoints**: Based on customer subscription tier
    
    ## Error Handling
    
    All errors follow RFC 7807 Problem Details format:
    ```json
    {
      "type": "https://api.singrkaraoke.com/errors/not_found",
      "title": "Resource Not Found",
      "status": 404,
      "detail": "The requested venue was not found",
      "instance": "/v1/venues/123"
    }
    ```
    
    ## Pagination
    
    List endpoints support cursor-based pagination:
    - Use `?limit=<n>` to set page size (default: 20, max: 100)
    - Use `?cursor=<cursor>` for next page
    - Response includes `pagination` object with `nextCursor` and `hasMore`
    
  version: 1.0.0
  contact:
    name: Singr Support
    email: support@singrkaraoke.com
    url: https://singrkaraoke.com
  license:
    name: Proprietary
    url: https://singrkaraoke.com/terms

servers:
  - url: https://api.singrkaraoke.com
    description: Production server
  - url: https://staging-api.singrkaraoke.com
    description: Staging server
  - url: http://localhost:3000
    description: Local development server

tags:
  - name: Authentication
    description: User authentication and session management
  - name: Public
    description: Public endpoints accessible without authentication
  - name: Singer Profile
    description: Singer account and profile management
  - name: Singer Features
    description: Singer favorites, history, and personalization
  - name: Customer Venues
    description: Venue management for customers
  - name: Customer Systems
    description: Karaoke system management
  - name: Customer Songdb
    description: Song database management
  - name: Customer Requests
    description: Request management and processing
  - name: Customer API Keys
    description: API key management
  - name: Organization
    description: Team and user management
  - name: Billing
    description: Subscription and billing
  - name: Analytics
    description: Reports and analytics
  - name: Admin
    description: Platform administration

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: JWT access token obtained from authentication endpoints
    
    apiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
      description: API key for OpenKJ-compatible requests
  
  schemas:
    # Error schemas
    ProblemDetails:
      type: object
      required:
        - type
        - title
        - status
      properties:
        type:
          type: string
          format: uri
          example: "https://api.singrkaraoke.com/errors/validation_error"
        title:
          type: string
          example: "Validation Error"
        status:
          type: integer
          example: 400
        detail:
          type: string
          example: "The request body contains invalid data"
        instance:
          type: string
          format: uri
          example: "/v1/venues"
        errors:
          type: array
          items:
            type: object
            properties:
              field:
                type: string
              message:
                type: string
    
    # Pagination schemas
    PaginationInfo:
      type: object
      properties:
        total:
          type: integer
          description: Total number of items
        limit:
          type: integer
          description: Number of items per page
        offset:
          type: integer
          description: Current offset
        hasMore:
          type: boolean
          description: Whether more items are available
        nextCursor:
          type: string
          description: Cursor for next page
          nullable: true
    
    # User schemas
    User:
      type: object
      required:
        - id
        - email
      properties:
        id:
          type: string
          format: uuid
        email:
          type: string
          format: email
        name:
          type: string
        displayName:
          type: string
        phoneNumber:
          type: string
        imageUrl:
          type: string
          format: uri
        isEmailVerified:
          type: boolean
        createdAt:
          type: string
          format: date-time
    
    # Venue schemas
    Venue:
      type: object
      required:
        - id
        - name
        - urlName
        - address
        - city
        - state
        - postalCode
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        urlName:
          type: string
          pattern: "^[a-z0-9-]+$"
        acceptingRequests:
          type: boolean
        address:
          type: string
        city:
          type: string
        state:
          type: string
        postalCode:
          type: string
        country:
          type: string
          default: "USA"
        phoneNumber:
          type: string
        website:
          type: string
          format: uri
        location:
          type: object
          properties:
            latitude:
              type: number
              format: double
            longitude:
              type: number
              format: double
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
    
    # Song schemas
    Song:
      type: object
      required:
        - songdbId
        - artist
        - title
      properties:
        songdbId:
          type: integer
          format: int64
        artist:
          type: string
        title:
          type: string
        combined:
          type: string
        normalizedCombined:
          type: string
    
    # Request schemas
    Request:
      type: object
      required:
        - id
        - venueId
        - artist
        - title
      properties:
        id:
          type: integer
          format: int64
        venueId:
          type: string
          format: uuid
        singerProfileId:
          type: string
          format: uuid
          nullable: true
        artist:
          type: string
        title:
          type: string
        keyChange:
          type: integer
          default: 0
        notes:
          type: string
        processed:
          type: boolean
          default: false
        requestedAt:
          type: string
          format: date-time
        processedAt:
          type: string
          format: date-time
          nullable: true
    
    # Singer profile schemas
    SingerProfile:
      type: object
      required:
        - id
        - userId
      properties:
        id:
          type: string
          format: uuid
        userId:
          type: string
          format: uuid
        nickname:
          type: string
        avatarUrl:
          type: string
          format: uri
        preferences:
          type: object
        createdAt:
          type: string
          format: date-time
    
    # Customer profile schemas
    CustomerProfile:
      type: object
      required:
        - id
        - userId
      properties:
        id:
          type: string
          format: uuid
        userId:
          type: string
          format: uuid
        legalBusinessName:
          type: string
        dbaName:
          type: string
        contactEmail:
          type: string
          format: email
        contactPhone:
          type: string
        timezone:
          type: string
          default: "UTC"
        createdAt:
          type: string
          format: date-time
    
    # API Key schemas
    ApiKey:
      type: object
      required:
        - id
        - description
        - status
      properties:
        id:
          type: string
          format: uuid
        description:
          type: string
        status:
          type: string
          enum: [active, revoked, expired, suspended]
        lastUsedAt:
          type: string
          format: date-time
          nullable: true
        createdAt:
          type: string
          format: date-time
    
    # Subscription schemas
    Subscription:
      type: object
      required:
        - id
        - status
      properties:
        id:
          type: string
        status:
          type: string
          enum: [incomplete, incomplete_expired, trialing, active, past_due, canceled, unpaid, paused]
        currentPeriodStart:
          type: string
          format: date-time
        currentPeriodEnd:
          type: string
          format: date-time
        cancelAtPeriodEnd:
          type: boolean

paths:
  # ========== Authentication Endpoints ==========
  
  /v1/auth/signup:
    post:
      tags:
        - Authentication
      summary: Register a new user account
      description: Creates a new user account with email and password
      operationId: signUp
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - email
                - password
                - name
                - accountType
              properties:
                email:
                  type: string
                  format: email
                password:
                  type: string
                  format: password
                  minLength: 8
                name:
                  type: string
                accountType:
                  type: string
                  enum: [singer, customer]
      responses:
        '201':
          description: User created successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  user:
                    $ref: '#/components/schemas/User'
                  accessToken:
                    type: string
                  refreshToken:
                    type: string
                  expiresIn:
                    type: integer
        '400':
          description: Invalid input
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
        '409':
          description: Email already exists
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  /v1/auth/signin:
    post:
      tags:
        - Authentication
      summary: Sign in with email and password
      description: Authenticates user and returns JWT tokens
      operationId: signIn
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - email
                - password
              properties:
                email:
                  type: string
                  format: email
                password:
                  type: string
                  format: password
      responses:
        '200':
          description: Authentication successful
          content:
            application/json:
              schema:
                type: object
                properties:
                  user:
                    $ref: '#/components/schemas/User'
                  accessToken:
                    type: string
                  refreshToken:
                    type: string
                  expiresIn:
                    type: integer
        '401':
          description: Invalid credentials
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  /v1/auth/refresh:
    post:
      tags:
        - Authentication
      summary: Refresh access token
      description: Exchanges refresh token for new access token
      operationId: refreshToken
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - refreshToken
              properties:
                refreshToken:
                  type: string
      responses:
        '200':
          description: Token refreshed successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  accessToken:
                    type: string
                  refreshToken:
                    type: string
                  expiresIn:
                    type: integer
        '401':
          description: Invalid or expired refresh token
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  /v1/auth/logout:
    post:
      tags:
        - Authentication
      summary: Sign out
      description: Invalidates current session and tokens
      operationId: signOut
      security:
        - bearerAuth: []
      responses:
        '204':
          description: Signed out successfully
        '401':
          description: Not authenticated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  /v1/auth/forgot-password:
    post:
      tags:
        - Authentication
      summary: Request password reset
      description: Sends password reset email
      operationId: forgotPassword
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - email
              properties:
                email:
                  type: string
                  format: email
      responses:
        '200':
          description: Password reset email sent
          content:
            application/json:
              schema:
                type: object
                properties:
                  message:
                    type: string
        '429':
          description: Too many requests
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  /v1/auth/reset-password:
    post:
      tags:
        - Authentication
      summary: Reset password
      description: Resets password using reset token
      operationId: resetPassword
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - token
                - newPassword
              properties:
                token:
                  type: string
                newPassword:
                  type: string
                  format: password
                  minLength: 8
      responses:
        '200':
          description: Password reset successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  message:
                    type: string
        '400':
          description: Invalid or expired token
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  # ========== Public Venue Discovery Endpoints ==========
  
  /v1/public/venues:
    get:
      tags:
        - Public
      summary: Search and discover venues
      description: Public endpoint to discover karaoke venues
      operationId: listPublicVenues
      parameters:
        - name: city
          in: query
          schema:
            type: string
        - name: state
          in: query
          schema:
            type: string
        - name: postalCode
          in: query
          schema:
            type: string
        - name: latitude
          in: query
          schema:
            type: number
            format: double
        - name: longitude
          in: query
          schema:
            type: number
            format: double
        - name: radiusMiles
          in: query
          schema:
            type: number
            default: 25
        - name: acceptingRequests
          in: query
          schema:
            type: boolean
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            minimum: 0
            default: 0
      responses:
        '200':
          description: List of venues
          content:
            application/json:
              schema:
                type: object
                properties:
                  venues:
                    type: array
                    items:
                      $ref: '#/components/schemas/Venue'
                  pagination:
                    $ref: '#/components/schemas/PaginationInfo'
  
  /v1/public/venues/{venueUrlName}:
    get:
      tags:
        - Public
      summary: Get venue details by URL name
      description: Retrieve detailed information about a specific venue
      operationId: getPublicVenue
      parameters:
        - name: venueUrlName
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Venue details
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Venue'
        '404':
          description: Venue not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  /v1/public/venues/{venueUrlName}/songdb:
    get:
      tags:
        - Public
      summary: Search venue's song database
      description: Search available songs at a venue
      operationId: searchVenueSongDb
      parameters:
        - name: venueUrlName
          in: path
          required: true
          schema:
            type: string
        - name: q
          in: query
          required: true
          schema:
            type: string
            minLength: 2
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            minimum: 0
            default: 0
      responses:
        '200':
          description: Search results
          content:
            application/json:
              schema:
                type: object
                properties:
                  songs:
                    type: array
                    items:
                      $ref: '#/components/schemas/Song'
                  pagination:
                    $ref: '#/components/schemas/PaginationInfo'
        '404':
          description: Venue not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  /v1/public/venues/{venueUrlName}/requests:
    post:
      tags:
        - Public
      summary: Submit a guest song request
      description: Submit a song request as a guest (no authentication required)
      operationId: createGuestRequest
      parameters:
        - name: venueUrlName
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - artist
                - title
              properties:
                artist:
                  type: string
                title:
                  type: string
                keyChange:
                  type: integer
                  default: 0
                notes:
                  type: string
                guestName:
                  type: string
      responses:
        '201':
          description: Request submitted
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Request'
        '400':
          description: Invalid input
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
        '403':
          description: Venue not accepting requests
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
        '429':
          description: Rate limit exceeded
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  # ========== Singer Profile Endpoints ==========
  
  /v1/singer/profile:
    get:
      tags:
        - Singer Profile
      summary: Get singer profile
      description: Retrieve the authenticated singer's profile
      operationId: getSingerProfile
      security:
        - bearerAuth: []
      responses:
        '200':
          description: Singer profile
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SingerProfile'
        '401':
          description: Not authenticated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
        '404':
          description: Singer profile not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
    
    put:
      tags:
        - Singer Profile
      summary: Update singer profile
      description: Update the authenticated singer's profile information
      operationId: updateSingerProfile
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                nickname:
                  type: string
                avatarUrl:
                  type: string
                  format: uri
                preferences:
                  type: object
      responses:
        '200':
          description: Profile updated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SingerProfile'
        '400':
          description: Invalid input
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
        '401':
          description: Not authenticated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  # ========== Singer Favorites Endpoints ==========
  
  /v1/singer/favorites/songs:
    get:
      tags:
        - Singer Features
      summary: Get favorite songs
      description: List singer's favorite songs
      operationId: getFavoriteSongs
      security:
        - bearerAuth: []
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            minimum: 0
            default: 0
      responses:
        '200':
          description: List of favorite songs
          content:
            application/json:
              schema:
                type: object
                properties:
                  songs:
                    type: array
                    items:
                      type: object
                      properties:
                        id:
                          type: string
                          format: uuid
                        artist:
                          type: string
                        title:
                          type: string
                        keyChange:
                          type: integer
                        createdAt:
                          type: string
                          format: date-time
                  pagination:
                    $ref: '#/components/schemas/PaginationInfo'
    
    post:
      tags:
        - Singer Features
      summary: Add favorite song
      description: Add a song to favorites
      operationId: addFavoriteSong
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - artist
                - title
              properties:
                artist:
                  type: string
                title:
                  type: string
                keyChange:
                  type: integer
                  default: 0
      responses:
        '201':
          description: Song added to favorites
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                    format: uuid
        '409':
          description: Song already in favorites
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  /v1/singer/favorites/songs/{songId}:
    delete:
      tags:
        - Singer Features
      summary: Remove favorite song
      description: Remove a song from favorites
      operationId: removeFavoriteSong
      security:
        - bearerAuth: []
      parameters:
        - name: songId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Song removed from favorites
        '404':
          description: Song not found in favorites
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  /v1/singer/favorites/venues:
    get:
      tags:
        - Singer Features
      summary: Get favorite venues
      description: List singer's favorite venues
      operationId: getFavoriteVenues
      security:
        - bearerAuth: []
      responses:
        '200':
          description: List of favorite venues
          content:
            application/json:
              schema:
                type: object
                properties:
                  venues:
                    type: array
                    items:
                      $ref: '#/components/schemas/Venue'
    
    post:
      tags:
        - Singer Features
      summary: Add favorite venue
      description: Add a venue to favorites
      operationId: addFavoriteVenue
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - venueId
              properties:
                venueId:
                  type: string
                  format: uuid
      responses:
        '201':
          description: Venue added to favorites
        '409':
          description: Venue already in favorites
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  /v1/singer/history:
    get:
      tags:
        - Singer Features
      summary: Get request history
      description: Retrieve singer's past song requests
      operationId: getSingerHistory
      security:
        - bearerAuth: []
      parameters:
        - name: venueId
          in: query
          schema:
            type: string
            format: uuid
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            minimum: 0
            default: 0
      responses:
        '200':
          description: Request history
          content:
            application/json:
              schema:
                type: object
                properties:
                  history:
                    type: array
                    items:
                      type: object
                      properties:
                        id:
                          type: string
                          format: uuid
                        venueId:
                          type: string
                          format: uuid
                        venueName:
                          type: string
                        artist:
                          type: string
                        title:
                          type: string
                        keyChange:
                          type: integer
                        requestedAt:
                          type: string
                          format: date-time
                  pagination:
                    $ref: '#/components/schemas/PaginationInfo'
  
  # ========== Customer Venue Management ==========
  
  /v1/customer/venues:
    get:
      tags:
        - Customer Venues
      summary: List customer's venues
      description: Retrieve all venues for the authenticated customer
      operationId: listVenues
      security:
        - bearerAuth: []
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            minimum: 0
            default: 0
      responses:
        '200':
          description: List of venues
          content:
            application/json:
              schema:
                type: object
                properties:
                  venues:
                    type: array
                    items:
                      $ref: '#/components/schemas/Venue'
                  pagination:
                    $ref: '#/components/schemas/PaginationInfo'
    
    post:
      tags:
        - Customer Venues
      summary: Create a new venue
      description: Create a new venue for the customer
      operationId: createVenue
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - name
                - urlName
                - address
                - city
                - state
                - postalCode
              properties:
                name:
                  type: string
                urlName:
                  type: string
                  pattern: "^[a-z0-9-]+$"
                address:
                  type: string
                city:
                  type: string
                state:
                  type: string
                postalCode:
                  type: string
                country:
                  type: string
                  default: "USA"
                phoneNumber:
                  type: string
                website:
                  type: string
                  format: uri
                acceptingRequests:
                  type: boolean
                  default: true
      responses:
        '201':
          description: Venue created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Venue'
        '400':
          description: Invalid input
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
        '409':
          description: URL name already exists
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  /v1/customer/venues/{venueId}:
    get:
      tags:
        - Customer Venues
      summary: Get venue details
      description: Retrieve detailed information about a specific venue
      operationId: getVenue
      security:
        - bearerAuth: []
      parameters:
        - name: venueId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Venue details
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Venue'
        '404':
          description: Venue not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
    
    put:
      tags:
        - Customer Venues
      summary: Update venue
      description: Update venue information
      operationId: updateVenue
      security:
        - bearerAuth: []
      parameters:
        - name: venueId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
                address:
                  type: string
                city:
                  type: string
                state:
                  type: string
                postalCode:
                  type: string
                phoneNumber:
                  type: string
                website:
                  type: string
                  format: uri
                acceptingRequests:
                  type: boolean
      responses:
        '200':
          description: Venue updated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Venue'
    
    delete:
      tags:
        - Customer Venues
      summary: Delete venue
      description: Delete a venue (soft delete)
      operationId: deleteVenue
      security:
        - bearerAuth: []
      parameters:
        - name: venueId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Venue deleted
        '404':
          description: Venue not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  # ========== Customer Request Management ==========
  
  /v1/customer/venues/{venueId}/requests:
    get:
      tags:
        - Customer Requests
      summary: List venue requests
      description: Get all song requests for a venue
      operationId: listVenueRequests
      security:
        - bearerAuth: []
      parameters:
        - name: venueId
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: processed
          in: query
          schema:
            type: boolean
        - name: since
          in: query
          schema:
            type: string
            format: date-time
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            minimum: 0
            default: 0
      responses:
        '200':
          description: List of requests
          content:
            application/json:
              schema:
                type: object
                properties:
                  requests:
                    type: array
                    items:
                      $ref: '#/components/schemas/Request'
                  pagination:
                    $ref: '#/components/schemas/PaginationInfo'
  
  /v1/customer/venues/{venueId}/requests/{requestId}:
    patch:
      tags:
        - Customer Requests
      summary: Update request status
      description: Mark request as processed or update notes
      operationId: updateRequest
      security:
        - bearerAuth: []
      parameters:
        - name: venueId
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: requestId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                processed:
                  type: boolean
                notes:
                  type: string
      responses:
        '200':
          description: Request updated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Request'
    
    delete:
      tags:
        - Customer Requests
      summary: Delete request
      description: Delete a song request
      operationId: deleteRequest
      security:
        - bearerAuth: []
      parameters:
        - name: venueId
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: requestId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        '204':
          description: Request deleted
  
  # ========== Customer API Keys ==========
  
  /v1/customer/api-keys:
    get:
      tags:
        - Customer API Keys
      summary: List API keys
      description: Retrieve all API keys for the customer
      operationId: listApiKeys
      security:
        - bearerAuth: []
      responses:
        '200':
          description: List of API keys
          content:
            application/json:
              schema:
                type: object
                properties:
                  apiKeys:
                    type: array
                    items:
                      $ref: '#/components/schemas/ApiKey'
    
    post:
      tags:
        - Customer API Keys
      summary: Create API key
      description: Generate a new API key
      operationId: createApiKey
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - description
              properties:
                description:
                  type: string
      responses:
        '201':
          description: API key created
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                    format: uuid
                  apiKey:
                    type: string
                    description: Raw API key (only shown once)
                  description:
                    type: string
                  createdAt:
                    type: string
                    format: date-time
  
  /v1/customer/api-keys/{keyId}:
    delete:
      tags:
        - Customer API Keys
      summary: Revoke API key
      description: Revoke an API key
      operationId: revokeApiKey
      security:
        - bearerAuth: []
      parameters:
        - name: keyId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: API key revoked
  
  # ========== Customer Song Database ==========
  
  /v1/customer/songdb:
    get:
      tags:
        - Customer Songdb
      summary: Search song database
      description: Search songs in customer's song database
      operationId: searchSongDb
      security:
        - bearerAuth: []
      parameters:
        - name: q
          in: query
          required: true
          schema:
            type: string
            minLength: 2
        - name: systemId
          in: query
          schema:
            type: string
            format: uuid
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            minimum: 0
            default: 0
      responses:
        '200':
          description: Search results
          content:
            application/json:
              schema:
                type: object
                properties:
                  songs:
                    type: array
                    items:
                      $ref: '#/components/schemas/Song'
                  pagination:
                    $ref: '#/components/schemas/PaginationInfo'
    
    post:
      tags:
        - Customer Songdb
      summary: Import songs
      description: Bulk import songs to database
      operationId: importSongs
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - systemId
                - songs
              properties:
                systemId:
                  type: integer
                songs:
                  type: array
                  items:
                    type: object
                    required:
                      - artist
                      - title
                    properties:
                      artist:
                        type: string
                      title:
                        type: string
      responses:
        '202':
          description: Import job started
          content:
            application/json:
              schema:
                type: object
                properties:
                  jobId:
                    type: string
                    format: uuid
                  message:
                    type: string
  
  # ========== Billing & Subscriptions ==========
  
  /v1/customer/subscription:
    get:
      tags:
        - Billing
      summary: Get subscription details
      description: Retrieve current subscription information
      operationId: getSubscription
      security:
        - bearerAuth: []
      responses:
        '200':
          description: Subscription details
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Subscription'
        '404':
          description: No active subscription
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProblemDetails'
  
  /v1/customer/subscription/checkout:
    post:
      tags:
        - Billing
      summary: Create checkout session
      description: Create a Stripe checkout session for subscription
      operationId: createCheckoutSession
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - priceId
              properties:
                priceId:
                  type: string
                  description: Stripe price ID
                successUrl:
                  type: string
                  format: uri
                cancelUrl:
                  type: string
                  format: uri
      responses:
        '200':
          description: Checkout session created
          content:
            application/json:
              schema:
                type: object
                properties:
                  sessionId:
                    type: string
                  url:
                    type: string
                    format: uri
  
  /v1/customer/subscription/portal:
    post:
      tags:
        - Billing
      summary: Create customer portal session
      description: Create a Stripe customer portal session
      operationId: createPortalSession
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - returnUrl
              properties:
                returnUrl:
                  type: string
                  format: uri
      responses:
        '200':
          description: Portal session created
          content:
            application/json:
              schema:
                type: object
                properties:
                  url:
                    type: string
                    format: uri
  
  # ========== Analytics ==========
  
  /v1/customer/analytics/daily-stats:
    get:
      tags:
        - Analytics
      summary: Get daily statistics
      description: Retrieve daily request statistics
      operationId: getDailyStats
      security:
        - bearerAuth: []
      parameters:
        - name: venueId
          in: query
          schema:
            type: string
            format: uuid
        - name: startDate
          in: query
          schema:
            type: string
            format: date
        - name: endDate
          in: query
          schema:
            type: string
            format: date
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 500
            default: 30
      responses:
        '200':
          description: Daily statistics
          content:
            application/json:
              schema:
                type: object
                properties:
                  stats:
                    type: array
                    items:
                      type: object
                      properties:
                        date:
                          type: string
                          format: date
                        venueId:
                          type: string
                          format: uuid
                        totalRequests:
                          type: integer
                        processedRequests:
                          type: integer
                        uniqueSingers:
                          type: integer
                        uniqueSongs:
                          type: integer
  
  /v1/customer/analytics/top-songs:
    get:
      tags:
        - Analytics
      summary: Get most requested songs
      description: Retrieve song popularity statistics
      operationId: getTopSongs
      security:
        - bearerAuth: []
      parameters:
        - name: venueId
          in: query
          schema:
            type: string
            format: uuid
        - name: startDate
          in: query
          schema:
            type: string
            format: date
        - name: endDate
          in: query
          schema:
            type: string
            format: date
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 500
            default: 50
      responses:
        '200':
          description: Top songs
          content:
            application/json:
              schema:
                type: object
                properties:
                  songs:
                    type: array
                    items:
                      type: object
                      properties:
                        artist:
                          type: string
                        title:
                          type: string
                        requestCount:
                          type: integer
                        uniqueRequesters:
                          type: integer
                        timesPerformed:
                          type: integer
  
  # ========== OpenKJ Compatibility API ==========
  
  /api/venues/list:
    get:
      tags:
        - OpenKJ Compatibility
      summary: List venues (OpenKJ format)
      description: OpenKJ-compatible venue listing endpoint
      operationId: openkjListVenues
      security:
        - apiKeyAuth: []
      responses:
        '200':
          description: List of venues in OpenKJ format
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: "success"
                  venues:
                    type: array
                    items:
                      type: object
                      properties:
                        venue_id:
                          type: integer
                        name:
                          type: string
                        accepting:
                          type: boolean
  
  /api/venues/{venueId}/requests:
    get:
      tags:
        - OpenKJ Compatibility
      summary: Get venue requests (OpenKJ format)
      description: OpenKJ-compatible requests endpoint
      operationId: openkjGetRequests
      security:
        - apiKeyAuth: []
      parameters:
        - name: venueId
          in: path
          required: true
          schema:
            type: integer
        - name: since
          in: query
          schema:
            type: integer
            description: Unix timestamp
      responses:
        '200':
          description: Requests in OpenKJ format
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: "success"
                  requests:
                    type: array
                    items:
                      type: object
                      properties:
                        request_id:
                          type: integer
                        artist:
                          type: string
                        title:
                          type: string
                        singer:
                          type: string
                        key_change:
                          type: integer
                        timestamp:
                          type: integer
    
    post:
      tags:
        - OpenKJ Compatibility
      summary: Submit request (OpenKJ format)
      description: OpenKJ-compatible request submission
      operationId: openkjSubmitRequest
      security:
        - apiKeyAuth: []
      parameters:
        - name: venueId
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - artist
                - title
              properties:
                artist:
                  type: string
                title:
                  type: string
                singer:
                  type: string
                key_change:
                  type: integer
      responses:
        '201':
          description: Request submitted
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: "success"
                  request_id:
                    type: integer
  
  /api/songdb/search:
    get:
      tags:
        - OpenKJ Compatibility
      summary: Search songs (OpenKJ format)
      description: OpenKJ-compatible song search
      operationId: openkjSearchSongs
      security:
        - apiKeyAuth: []
      parameters:
        - name: system_id
          in: query
          required: true
          schema:
            type: integer
        - name: q
          in: query
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Search results in OpenKJ format
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: "success"
                  songs:
                    type: array
                    items:
                      type: object
                      properties:
                        song_id:
                          type: integer
                        artist:
                          type: string
                        title:
                          type: string

# End of OpenAPI Specification
```

---

## Implementation Notes

### Authentication Flow

1. **Sign up**: `POST /v1/auth/signup` → Returns access + refresh tokens
2. **Sign in**: `POST /v1/auth/signin` → Returns access + refresh tokens
3. **Use API**: Include `Authorization: Bearer <access_token>` header
4. **Refresh**: `POST /v1/auth/refresh` with refresh token when access expires
5. **Sign out**: `POST /v1/auth/logout` to invalidate tokens

### Rate Limiting

Rate limits are enforced per IP address and/or user account:
- Public endpoints: 60 req/min
- Auth endpoints: 5-10 req/hour
- Authenticated: 100 req/min
- API keys: Variable based on plan

### Pagination

Use `limit` and `offset` parameters:
```
GET /v1/customer/venues?limit=20&offset=40
```

Response includes pagination info:
```json
{
  "venues": [...],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 40,
    "hasMore": true
  }
}
```

### Error Responses

All errors follow RFC 7807:
```json
{
  "type": "https://api.singrkaraoke.com/errors/validation_error",
  "title": "Validation Error",
  "status": 400,
  "detail": "The request contains invalid data",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

### Webhooks

Stripe webhooks are received at:
```
POST /webhooks/stripe
```

Verify webhook signatures using Stripe's webhook secret.

---

## Security Considerations

1. **HTTPS Only**: All production traffic must use HTTPS
2. **JWT Validation**: Verify ES256 signatures on all JWT tokens
3. **CORS**: Configure appropriate CORS origins
4. **Rate Limiting**: Enforce rate limits to prevent abuse
5. **Input Validation**: Validate all inputs using Zod schemas
6. **SQL Injection**: Use parameterized queries (Prisma handles this)
7. **XSS Prevention**: Sanitize user-generated content
8. **CSRF Protection**: Use SameSite cookies where applicable
9. **Password Storage**: Use Argon2id for password hashing
10. **API Key Security**: Hash API keys before storage

---

## Testing

### Test Environments

- **Local**: `http://localhost:3000`
- **Staging**: `https://staging-api.singrkaraoke.com`
- **Production**: `https://api.singrkaraoke.com`

### Test Credentials

Use the following test accounts in staging:

**Singer Account**:
- Email: `singer@test.singrkaraoke.com`
- Password: `TestPassword123!`

**Customer Account**:
- Email: `customer@test.singrkaraoke.com`
- Password: `TestPassword123!`

### Testing Tools

- **Postman Collection**: Available in `docs/postman/`
- **Swagger UI**: Available at `/docs` endpoint
- **API Playground**: Available at `/playground` endpoint

---

## Changelog

### Version 1.0.0 (2025-11-12)
- Initial OpenAPI specification
- Covers all 17 development phases
- Includes authentication, public, singer, customer, and admin endpoints
- OpenKJ compatibility layer included
- Analytics and reporting endpoints defined
- Comprehensive error handling and pagination
