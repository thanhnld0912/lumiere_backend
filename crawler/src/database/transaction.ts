import type { PoolClient } from 'pg';
import { pool } from './pool.js';
import { isRetryableDatabaseError, retry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

/**
 * Chạy một callback trong transaction. Tự COMMIT khi xong, ROLLBACK khi ném lỗi.
 *
 * Đơn vị transaction của crawler là MỘT NOVEL: upsert novel -> alt titles ->
 * genres -> tags -> group -> chapters -> novel_sources rồi commit.
 *
 * Vì sao không gộp cả lô vào một transaction: một novel có dữ liệu lỗi sẽ kéo
 * ngược cả 50 novel khác, và transaction dài giữ khoá lâu trên Supabase.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Rollback hỏng thường nghĩa là connection đã chết. Ghi lại nhưng vẫn ném
      // lỗi GỐC — đó mới là thứ nói lên chuyện gì đã xảy ra.
      logger.error(
        { err: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) },
        'ROLLBACK thất bại',
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Như `withTransaction` nhưng thử lại khi gặp deadlock / serialization failure.
 *
 * Chỉ retry các mã lỗi tạm thời (40001, 40P01, …). Vi phạm ràng buộc hay sai cú
 * pháp là lỗi vĩnh viễn — thử lại chỉ tổ chậm.
 */
export async function withRetryableTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  label = 'transaction',
): Promise<T> {
  return retry(() => withTransaction(fn), {
    attempts: 3,
    initialDelayMs: 200,
    isRetryable: isRetryableDatabaseError,
    logger,
    label,
  });
}
