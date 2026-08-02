import type { Response } from 'express';
import type { FieldError } from './ApiError';

/** Envelope thành công dùng chung cho mọi endpoint. */
export interface SuccessResponse<T> {
  success: true;
  data: T;
}

/** Envelope lỗi — đúng format đã thống nhất trong BACKEND_REQUIREMENTS.md §6. */
export interface ErrorResponse {
  success: false;
  message: string;
  errors: FieldError[];
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): Response {
  const body: SuccessResponse<T> = { success: true, data };
  return res.status(statusCode).json(body);
}

export function sendError(
  res: Response,
  statusCode: number,
  message: string,
  errors: FieldError[] = [],
): Response {
  const body: ErrorResponse = { success: false, message, errors };
  return res.status(statusCode).json(body);
}