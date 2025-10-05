import { ServiceResult } from "../types/index.js";

export { ServiceResult };

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Authorization failed') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND_ERROR');
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super(`${service} error: ${message}`, 503, 'EXTERNAL_SERVICE_ERROR');
  }
}

export function handleServiceError(error: unknown): ServiceResult {
  console.error('Service error:', error);
  
  if (error instanceof AppError) {
    return {
      success: false,
      error: error.message
    };
  }
  
  if (error instanceof Error) {
    return {
      success: false,
      error: error.message
    };
  }
  
  return {
    success: false,
    error: 'An unknown error occurred'
  };
}

export function createSuccessResult<T>(data: T): ServiceResult<T> {
  return {
    success: true,
    data
  };
}

export function createErrorResult(error: string): ServiceResult {
  return {
    success: false,
    error
  };
}
