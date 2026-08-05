import type { PoolClient, QueryResultRow } from 'pg';

/**
 * Lớp cha cho mọi repository.
 *
 * ⚠️ Repository BẮT BUỘC nhận `PoolClient`, không tự lấy connection từ pool.
 *
 * Lý do: importer ghi một novel qua 7 bảng và tất cả phải nằm trong CÙNG MỘT
 * transaction. Nếu repository tự `pool.connect()` thì mỗi câu lệnh sẽ chạy trên
 * connection khác nhau, ROLLBACK không thu hồi được gì, và một lỗi giữa chừng sẽ
 * để lại novel có genre nhưng thiếu chapter.
 *
 * Đây cũng là ranh giới kiến trúc: SQL CHỈ được viết trong thư mục này.
 */
export abstract class BaseRepository {
  constructor(protected readonly client: PoolClient) {}

  protected async many<T extends QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.client.query<T>(text, params as unknown[]);
    return result.rows;
  }

  protected async one<T extends QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.many<T>(text, params);
    return rows[0] ?? null;
  }

  /** Dùng cho câu lệnh chỉ ghi, không cần đọc lại. Trả số dòng bị ảnh hưởng. */
  protected async execute(text: string, params: readonly unknown[] = []): Promise<number> {
    const result = await this.client.query(text, params as unknown[]);
    return result.rowCount ?? 0;
  }
}
