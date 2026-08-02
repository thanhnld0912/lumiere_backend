import type { RequestHandler } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { ApiError, type FieldError } from '../utils/ApiError';

type ValidationTarget = 'body' | 'query' | 'params';

/** Chuyển ZodError thành mảng errors của response envelope. */
export function zodErrorToFieldErrors(error: ZodError): FieldError[] {
  return error.errors.map((issue) => ({
    field: issue.path.join('.') || '_root',
    message: issue.message,
  }));
}

/**
 * Validate + ép kiểu một phần của request bằng zod.
 *
 * Ghi đè lại `req[target]` bằng dữ liệu đã parse để controller nhận được giá trị
 * đã chuẩn hoá (email lowercase/trim, limit là number thay vì string…) chứ
 * không phải input thô.
 */
export function validate(schema: ZodTypeAny, target: ValidationTarget = 'body'): RequestHandler {
  return (req, _res, next) => {
    try {
      const parsed = schema.parse(req[target]);
      // req.query là getter chỉ đọc trên một số phiên bản Express, nên gán qua
      // defineProperty để an toàn ở cả ba target.
      Object.defineProperty(req, target, {
        value: parsed,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(ApiError.validation('Validation failed', zodErrorToFieldErrors(error)));
        return;
      }
      next(error);
    }
  };
}