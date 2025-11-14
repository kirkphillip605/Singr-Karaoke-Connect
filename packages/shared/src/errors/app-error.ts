/**
 * Base application error following RFC 7807 Problem Details
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly type: string;
  public readonly title: string;
  public readonly detail: string;
  public readonly instance?: string;
  public readonly errors?: Array<{ field: string; message: string }>;

  constructor(
    statusCode: number,
    type: string,
    title: string,
    detail: string,
    errors?: Array<{ field: string; message: string }>,
    instance?: string
  ) {
    super(detail);
    this.statusCode = statusCode;
    this.type = type;
    this.title = title;
    this.detail = detail;
    this.errors = errors;
    this.instance = instance;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      type: this.type,
      title: this.title,
      status: this.statusCode,
      detail: this.detail,
      ...(this.errors && { errors: this.errors }),
      ...(this.instance && { instance: this.instance }),
    };
  }
}

export class ValidationError extends AppError {
  constructor(
    detail: string,
    errors?: Array<{ field: string; message: string }>
  ) {
    super(400, 'validation_error', 'Validation Error', detail, errors);
  }
}

export class AuthenticationError extends AppError {
  constructor(detail: string = 'Authentication required') {
    super(401, 'authentication_required', 'Unauthorized', detail);
  }
}

export class AuthorizationError extends AppError {
  constructor(detail: string = 'Insufficient permissions') {
    super(403, 'insufficient_permissions', 'Forbidden', detail);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, detail?: string) {
    super(
      404,
      'resource_not_found',
      'Not Found',
      detail || `${resource} not found`
    );
  }
}

export class ConflictError extends AppError {
  constructor(detail: string) {
    super(409, 'conflict', 'Conflict', detail);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter: number) {
    super(
      429,
      'rate_limit_exceeded',
      'Too Many Requests',
      `Rate limit exceeded. Retry after ${retryAfter} seconds`
    );
  }
}

export class InternalError extends AppError {
  constructor(detail: string = 'An unexpected error occurred') {
    super(500, 'internal_error', 'Internal Server Error', detail);
  }
}
