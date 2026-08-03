import type { CrawlMode, SourceId } from '../core/types.js';

export type CrawlRunStatus = 'running' | 'completed' | 'failed';

/**
 * Một lần chạy crawler — ánh xạ tới bảng `sync_runs` đã có.
 *
 * Bảng đó đang phục vụ `GET /api/timeline/stats` (nextSyncCountdown,
 * nextSyncPercentage) và hiện chỉ có dữ liệu seed tĩnh. Crawler chính là thứ
 * làm cho hai chỉ số đó trở thành số liệu thật.
 */
export interface CrawlRunRecord {
  readonly id: string;
  readonly sourceId: SourceId;
  readonly mode: CrawlMode;
  readonly status: CrawlRunStatus;
  readonly progressPercentage: number;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  /** Lần chạy kế tiếp dự kiến — nguồn cho SyncStats.nextSyncCountdown. */
  readonly nextRunAt: Date | null;
}

/** Một chương mới được phát hiện — ánh xạ tới `sync_events`, feed cho GET /api/timeline. */
export interface SyncEventRecord {
  readonly novelId: string;
  readonly sourceId: SourceId;
  readonly translationGroupId: string | null;
  readonly chaptersAddedCount: number;
  readonly occurredAt: Date;
}
