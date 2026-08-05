import type { CrawlMode } from '../core/types.js';
import { BaseRepository } from './BaseRepository.js';

/**
 * Bảng `sync_runs` và `sync_events`.
 *
 * ⭐ Đây là chỗ crawler KHÉP KÍN VÒNG LẶP với REST API.
 *
 * Hai bảng này đã tồn tại từ trước và đang phục vụ `GET /api/timeline` cùng
 * `GET /api/timeline/stats` — nhưng tới giờ chỉ có dữ liệu seed tĩnh. Ghi vào
 * đây là lúc màn "Library Synchronization Log" của người dùng bắt đầu có nghĩa.
 */
export class SyncRepository extends BaseRepository {
  async startRun(sourceId: string, mode: CrawlMode): Promise<string> {
    const row = await this.one<{ id: string }>(
      `INSERT INTO sync_runs (source_id, mode, status, progress_percentage, started_at)
       VALUES ($1, $2, 'running', 0, now())
       RETURNING id`,
      [sourceId, mode],
    );

    if (!row) throw new Error('INSERT sync_runs không trả về dòng nào');
    return row.id;
  }

  async updateProgress(runId: string, percentage: number): Promise<void> {
    await this.execute('UPDATE sync_runs SET progress_percentage = $2 WHERE id = $1', [
      runId,
      Math.min(100, Math.max(0, Math.round(percentage))),
    ]);
  }

  /**
   * Kết thúc một lần chạy.
   *
   * `nextRunAt` là nguồn cho `SyncStats.nextSyncCountdown` mà TimelineView hiển
   * thị. Không ghi thì đồng hồ đếm ngược trên UI sẽ đứng yên mãi.
   */
  async finishRun(
    runId: string,
    status: 'completed' | 'failed',
    nextRunAt: Date | null,
  ): Promise<void> {
    await this.execute(
      `UPDATE sync_runs
       SET status = $2::sync_run_status,
           progress_percentage = CASE WHEN $2 = 'completed' THEN 100 ELSE progress_percentage END,
           finished_at = now(),
           next_run_at = $3
       WHERE id = $1`,
      [runId, status, nextRunAt],
    );
  }

  /**
   * Ghi sự kiện "novel này vừa có N chương mới" — feed cho GET /api/timeline.
   *
   * ⚠️ CHỈ gọi khi thực sự có chương mới. Ghi cả khi `chaptersAdded = 0` sẽ làm
   * Timeline đầy rác ở mỗi lần chạy và mất hết ý nghĩa với người đọc. Ràng buộc
   * CHECK ở database cũng chặn giá trị 0.
   */
  async recordEvent(input: {
    novelId: string;
    sourceId: string;
    translationGroupId: string | null;
    chaptersAdded: number;
    occurredAt: Date;
  }): Promise<void> {
    if (input.chaptersAdded <= 0) return;

    await this.execute(
      `INSERT INTO sync_events
         (novel_id, source_id, translation_group_id, chapters_added_count, occurred_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.novelId,
        input.sourceId,
        input.translationGroupId,
        input.chaptersAdded,
        input.occurredAt,
      ],
    );
  }
}
