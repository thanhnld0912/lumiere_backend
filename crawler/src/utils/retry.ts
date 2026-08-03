import type { Logger } from 'pino';
import { sleep } from './sleep.js';

/**
 * Retry cho thao tác NGOÀI Crawlee.
 *
 * ⚠️ KHÔNG dùng cho HTTP request. Crawlee đã có retry + backoff + session
 * handling riêng (`maxRequestRetries`); bọc thêm một lớp nữa sẽ nhân số lần gọi
 * lên và phá vỡ rate limit đang cấu hình.
 *
 * Dùng cho: ghi database gặp deadlock/serialization failure, hoặc mất kết nối
 * tạm thời tới Supabase.
 */

export interface RetryOptions {
  /** Tổng số lần thử, tính cả lần đầu. */
  attempts?: number;
  /** Độ trễ ban đầu (ms), nhân đôi sau mỗi lần thất bại. */
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Trả false để dừng retry ngay (lỗi vĩnh viễn, thử lại vô ích). */
  isRetryable?: (error: unknown) => boolean;
  logger?: Logger;
  label?: string;
}

/**
 * Mã lỗi PostgreSQL đáng retry. Các mã khác (vi phạm ràng buộc, sai cú pháp…)
 * là lỗi vĩnh viễn — retry chỉ tổ chậm.
 */
const RETRYABLE_PG_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '53300', // too_many_connections
  '57P03', // cannot_connect_now (DB đang khởi động lại)
  '08000', // connection_exception
  '08006', // connection_failure
]);

export function isRetryableDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && RETRYABLE_PG_CODES.has(code);
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    initialDelayMs = 250,
    maxDelayMs = 5_000,
    isRetryable = isRetryableDatabaseError,
    logger,
    label = 'operation',
  } = options;

  let delay = initialDelayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const canRetry = attempt < attempts && isRetryable(error);
      if (!canRetry) break;

      logger?.warn(
        {
          label,
          attempt,
          attempts,
          delayMs: delay,
          error: error instanceof Error ? error.message : String(error),
        },
        'thao tác thất bại, sẽ thử lại',
      );

      await sleep(delay);
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }

  throw lastError;
}
