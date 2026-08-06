import { BaseRepository } from './BaseRepository.js';

export interface QueueItem {
  readonly externalId: string;
  readonly sourceUrl: string;
}

/**
 * Bảng `crawl_queue` — hàng đợi refresh, lưu bền.
 *
 * ⚠️ RANH GIỚI VẬN HÀNH: `discover` và `latest` chỉ GHI vào bảng này. `refresh`
 * là job DUY NHẤT được đọc và rút việc ra.
 *
 * Đó chính là thứ giữ cho hai job rẻ luôn rẻ. Trước khi có bảng này, hàng đợi
 * chỉ là một mảng trong bộ nhớ mà `CrawlerService` rút cạn ngay trong cùng tiến
 * trình — nên `latest` kéo theo cả một lượt refresh đầy đủ, và khi refresh bắt
 * đầu tải nội dung chương thì `latest` vượt luôn 30 phút.
 */
export class QueueRepository extends BaseRepository {
  /**
   * Thêm việc vào hàng đợi. Trả về số dòng THỰC SỰ mới.
   *
   * Trùng thì bỏ qua, không cập nhật gì: `enqueued_at` phải giữ nguyên thời điểm
   * phát hiện ĐẦU TIÊN, nếu không một novel bị enqueue lại mỗi 6 giờ sẽ luôn
   * trông như việc mới và không bao giờ tới lượt được xử lý.
   */
  async enqueue(
    sourceId: string,
    items: readonly (QueueItem & { reason: string })[],
  ): Promise<number> {
    if (items.length === 0) return 0;

    /*
     * Một câu INSERT cho cả lô, dùng unnest.
     *
     * `discover` có thể đẩy 200 item một lượt; 200 round-trip tới Supabase là
     * thứ duy nhất đắt đỏ trong một job vốn không có gì để làm.
     */
    const rows = await this.many<{ external_id: string }>(
      `INSERT INTO crawl_queue (source_id, external_id, source_url, reason)
       SELECT $1, t.external_id, t.source_url, t.reason
       FROM unnest($2::text[], $3::text[], $4::text[])
         AS t(external_id, source_url, reason)
       ON CONFLICT (source_id, external_id) DO NOTHING
       RETURNING external_id`,
      [
        sourceId,
        items.map((item) => item.externalId),
        items.map((item) => item.sourceUrl),
        items.map((item) => item.reason),
      ],
    );

    return rows.length;
  }

  /**
   * Lấy việc cần làm: ít lỗi trước, cũ trước.
   *
   * Sắp theo `attempts` TRƯỚC là có chủ đích. Một external_id hỏng vĩnh viễn
   * (truyện bị gỡ, id sai) mà chỉ sắp theo thời gian sẽ mãi mãi đứng đầu hàng
   * đợi và chặn mọi việc phía sau ở mọi lần chạy.
   *
   * `maxAttempts` là chốt chặn cuối: quá ngưỡng thì thôi hẳn, để hàng đợi không
   * phình vô hạn vì rác.
   */
  async takePending(sourceId: string, limit: number, maxAttempts = 5): Promise<QueueItem[]> {
    if (limit <= 0) return [];

    const rows = await this.many<{ external_id: string; source_url: string }>(
      `SELECT external_id, source_url
       FROM crawl_queue
       WHERE source_id = $1 AND attempts < $3
       ORDER BY attempts ASC, enqueued_at ASC
       LIMIT $2`,
      [sourceId, limit, maxAttempts],
    );

    return rows.map((row) => ({ externalId: row.external_id, sourceUrl: row.source_url }));
  }

  /** Xoá việc đã làm xong. Chỉ gọi khi import THÀNH CÔNG. */
  async remove(sourceId: string, externalIds: readonly string[]): Promise<number> {
    if (externalIds.length === 0) return 0;

    const rows = await this.many<{ external_id: string }>(
      `DELETE FROM crawl_queue
       WHERE source_id = $1 AND external_id = ANY($2::text[])
       RETURNING external_id`,
      [sourceId, [...externalIds]],
    );
    return rows.length;
  }

  /**
   * Đánh dấu thất bại: tăng `attempts` và ghi lỗi.
   *
   * KHÔNG xoá — lỗi có thể chỉ là tạm thời (nguồn 5xx, mạng chập chờn). Item
   * chìm dần xuống đáy và tự rơi ra khi vượt `maxAttempts`.
   */
  async markFailed(
    sourceId: string,
    externalIds: readonly string[],
    error: string,
  ): Promise<void> {
    if (externalIds.length === 0) return;

    await this.execute(
      `UPDATE crawl_queue
       SET attempts = attempts + 1, last_error = $3
       WHERE source_id = $1 AND external_id = ANY($2::text[])`,
      [sourceId, [...externalIds], error.slice(0, 500)],
    );
  }

  /** Số việc còn lại — in ra cuối mỗi lần chạy để hàng đợi không âm thầm phình. */
  async countPending(sourceId: string, maxAttempts = 5): Promise<number> {
    const row = await this.one<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM crawl_queue
       WHERE source_id = $1 AND attempts < $2`,
      [sourceId, maxAttempts],
    );
    return row ? Number.parseInt(row.total, 10) : 0;
  }
}
