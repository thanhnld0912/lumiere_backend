import type { CrawlMode, SourceId } from '../types.js';

/**
 * Kết quả của MỘT item sau khi đi hết pipeline.
 *
 * Phân biệt `unchanged` với `updated` là điểm mấu chốt: nhờ so content_hash mà
 * đa số item ở lần refresh sẽ là `unchanged`, và chỉ `created`/`updated` mới
 * sinh ra sync_event. Nếu không tách hai trạng thái này, Timeline của người dùng
 * sẽ đầy rác "vừa cập nhật" ở mọi lần chạy.
 */
export type ImportAction = 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed';

export interface ItemOutcome {
  readonly action: ImportAction;
  readonly externalId: string;
  readonly sourceUrl: string;
  /** Slug nội bộ sau khi import — vắng mặt nếu failed/skipped. */
  readonly slug?: string;
  /** Số chương mới phát hiện — nguồn cho sync_events.chapters_added_count. */
  readonly chaptersAdded?: number;
  readonly reason?: string;
  readonly error?: Error;
}

/** Tổng kết một lần chạy — ghi vào sync_runs và in ra cuối job. */
export interface RunSummary {
  readonly runId: string;
  readonly sourceId: SourceId;
  readonly mode: CrawlMode;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly durationMs: number;

  readonly totals: {
    readonly seen: number;
    readonly created: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly skipped: number;
    readonly failed: number;
    readonly chaptersAdded: number;
  };

  /**
   * Trần bị chạm hay không. Ghi ra tường minh vì "xong 1.000/8.000 novel" và
   * "xong toàn bộ 1.000 novel" nhìn giống hệt nhau trong log nếu không nói rõ.
   */
  readonly truncated: boolean;
  readonly failures: readonly ItemOutcome[];
}

export function emptyTotals(): RunSummary['totals'] {
  return {
    seen: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    chaptersAdded: 0,
  };
}

/** Gom danh sách ItemOutcome thành số liệu tổng. */
export function tallyOutcomes(outcomes: readonly ItemOutcome[]): RunSummary['totals'] {
  const totals = {
    seen: outcomes.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    chaptersAdded: 0,
  };

  for (const outcome of outcomes) {
    switch (outcome.action) {
      case 'created':
        totals.created += 1;
        break;
      case 'updated':
        totals.updated += 1;
        break;
      case 'unchanged':
        totals.unchanged += 1;
        break;
      case 'skipped':
        totals.skipped += 1;
        break;
      case 'failed':
        totals.failed += 1;
        break;
    }
    totals.chaptersAdded += outcome.chaptersAdded ?? 0;
  }

  return totals;
}
