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
  /**
   * Số dòng `chapter_contents` vừa ghi.
   *
   * Tách riêng khỏi `action` là bắt buộc: một novel có metadata `unchanged` vẫn
   * có thể vừa được ghi 50 chương nội dung. Gộp vào `updated` thì số liệu về
   * update detection sai; bỏ đi thì bản tóm tắt báo "không đổi" trong khi vừa
   * ghi hàng nghìn đoạn văn.
   */
  readonly contentsWritten?: number;
  /**
   * Số chương mà adapter THỰC SỰ tải được text về.
   *
   * Cần tách khỏi `contentsWritten` để phân biệt hai tình huống nhìn giống hệt
   * nhau ở bản tóm tắt: "không tải gì vì đã đủ nội dung" (bình thường) và "tải
   * về rồi nhưng không ghi được dòng nào" (đường ghi hỏng).
   */
  readonly contentsFetched?: number;
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
    /** Tổng số dòng `chapter_contents` đã ghi trong lần chạy. */
    readonly contentsWritten: number;
    /** Tổng số chương adapter tải được text về. */
    readonly contentsFetched: number;
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
    contentsWritten: 0,
    contentsFetched: 0,
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
    contentsWritten: 0,
    contentsFetched: 0,
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
    totals.contentsWritten += outcome.contentsWritten ?? 0;
    totals.contentsFetched += outcome.contentsFetched ?? 0;
  }

  return totals;
}
