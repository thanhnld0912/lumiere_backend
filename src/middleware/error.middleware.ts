import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { sendError } from '../utils/response';
import { zodErrorToFieldErrors } from './validate.middleware';

/** Mã lỗi PostgreSQL cần dịch sang HTTP status có ý nghĩa. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';
const PG_UNDEFINED_TABLE = '42P01';

interface PostgresError {
  code?: string;
  constraint?: string;
  detail?: string;
}

function isPostgresError(error: unknown): error is Error & PostgresError {
  return error instanceof Error && typeof (error as PostgresError).code === 'string';
}

/** Route không khớp — đặt SAU tất cả route, TRƯỚC errorHandler. */
export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);
};

/**
 * Error middleware toàn cục. Mọi response lỗi đều đi qua đây nên format luôn là:
 *   { success: false, message: string, errors: FieldError[] }
 *
 * Express nhận diện error middleware bằng SỐ LƯỢNG THAM SỐ (phải đúng 4),
 * nên `_next` bắt buộc phải có mặt dù không dùng tới.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Lỗi có chủ đích do chính mình ném ra.
  if (err instanceof ApiError) {
    sendError(res, err.statusCode, err.message, err.errors);
    return;
  }

  // ZodError lọt tới đây (validate ở tầng service thay vì middleware).
  if (err instanceof ZodError) {
    sendError(res, 422, 'Validation failed', zodErrorToFieldErrors(err));
    return;
  }

  // JSON body sai cú pháp — express.json() ném SyntaxError có kèm `body`.
  if (err instanceof SyntaxError && 'body' in err) {
    sendError(res, 400, 'Malformed JSON in request body');
    return;
  }

  // Lỗi tầng PostgreSQL.
  if (isPostgresError(err)) {
    switch (err.code) {
      case PG_UNIQUE_VIOLATION:
        sendError(res, 409, 'Resource already exists');
        return;
      case PG_FOREIGN_KEY_VIOLATION:
        sendError(res, 409, 'Referenced resource does not exist');
        return;
      case PG_CHECK_VIOLATION:
        sendError(res, 422, 'Value violates a database constraint');
        return;
      case PG_UNDEFINED_TABLE:
        // Gần như luôn là do quên chạy migration — nói thẳng ra sẽ đỡ mất thời gian.
        console.error('[error] Bảng không tồn tại. Đã chạy `npm run db:schema` chưa?', err.message);
        sendError(res, 500, 'Database schema is not initialised');
        return;
      default:
        break;
    }
  }

  // Ngoài dự kiến: log đầy đủ ở server, trả tối thiểu cho client.
  console.error(`[error] Lỗi ngoài dự kiến tại ${req.method} ${req.originalUrl}:`, err);

  const message =
    env.isProduction || !(err instanceof Error)
      ? 'Internal server error'
      : err.message || 'Internal server error';

  sendError(res, 500, message);
};