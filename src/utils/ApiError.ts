/** Một lỗi ở mức field, khớp với phần tử trong mảng `errors` của response. */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * Lỗi có chủ đích (expected) do controller/service ném ra.
 * Error middleware nhận diện instance của lớp này để trả đúng status code;
 * mọi lỗi khác bị coi là 500 và không lộ chi tiết ra ngoài.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly errors: FieldError[];

  constructor(statusCode: number, message: string, errors: FieldError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errors = errors;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request', errors: FieldError[] = []): ApiError {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = 'Authentication required'): ApiError {
    return new ApiError(401, message);
  }

  static forbidden(message = 'You do not have permission to perform this action'): ApiError {
    return new ApiError(403, message);
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, message);
  }

  static conflict(message = 'Resource already exists'): ApiError {
    return new ApiError(409, message);
  }

  static validation(message = 'Validation failed', errors: FieldError[] = []): ApiError {
    return new ApiError(422, message, errors);
  }
}