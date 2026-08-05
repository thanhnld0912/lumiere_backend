import type { CrawlContext, CrawlMode, NovelRef, SourceId } from '../core/types.js';
import { withTransaction } from '../database/transaction.js';
import { SourceRepository } from '../repositories/index.js';
import { SCHEDULES } from './schedule.config.js';

/**
 * Kế hoạch cho một lần chạy: crawl cái gì, bao nhiêu.
 *
 * `targets` chỉ có ý nghĩa với mode `refresh` — hai mode kia tự tìm việc từ
 * trang danh mục / feed.
 */
export interface RunPlan {
  readonly mode: CrawlMode;
  readonly maxItems: number;
  readonly targets: readonly NovelRef[];
  /** true khi kế hoạch chạm trần — nhiều khả năng còn việc chưa xử lý. */
  readonly saturated: boolean;
  readonly reason: string;
}

export interface PlanOptions {
  readonly maxItems?: number;
  /** Mục tiêu do người dùng chỉ định (`--id` / `--url`), bỏ qua việc tự chọn. */
  readonly explicitTargets?: readonly NovelRef[];
}

/**
 * Quyết định CRAWL CÁI GÌ cho mỗi mode.
 *
 * Tách khỏi adapter là có chủ đích: adapter biết cách LẤY dữ liệu, planner
 * quyết định LẤY CÁI NÀO. Trộn hai việc sẽ khiến mỗi nguồn mới phải viết lại
 * chính sách chọn việc, và không thể thay đổi chính sách ở một chỗ.
 */
export class RunPlanner {
  async plan(
    sourceId: SourceId,
    sourceUuid: string,
    mode: CrawlMode,
    options: PlanOptions = {},
  ): Promise<RunPlan> {
    const maxItems = options.maxItems ?? SCHEDULES[mode].defaultMaxItems;

    switch (mode) {
      case 'discover':
        /*
         * Không cần mục tiêu: adapter tự duyệt trang danh mục. Việc của planner
         * ở đây chỉ là đặt trần, để một lần chạy có chi phí đoán trước được.
         */
        return {
          mode,
          maxItems,
          targets: [],
          saturated: false,
          reason: 'discover tự duyệt danh mục, không cần mục tiêu',
        };

      case 'latest':
        return {
          mode,
          maxItems,
          targets: [],
          saturated: false,
          reason: 'latest đọc feed, không cần mục tiêu',
        };

      case 'refresh': {
        if (options.explicitTargets !== undefined && options.explicitTargets.length > 0) {
          return {
            mode,
            maxItems,
            targets: options.explicitTargets,
            // Người dùng xin đúng những cái này -> không phải "bị cắt".
            saturated: false,
            reason: `${options.explicitTargets.length} mục tiêu do người dùng chỉ định`,
          };
        }

        /*
         * Chọn novel CŨ NHẤT theo `novel_sources.last_crawled_at`, NULLS FIRST.
         *
         * Nhờ vậy novel chưa crawl bao giờ (do discover/latest vừa phát hiện)
         * luôn được ưu tiên, và các novel còn lại được luân phiên đều đặn thay
         * vì cùng một nhóm bị crawl mãi.
         */
        const stale = await withTransaction((client) =>
          new SourceRepository(client).findStale(sourceUuid, maxItems),
        );

        return {
          mode,
          maxItems,
          targets: stale.map((row) => ({
            sourceId,
            externalId: row.externalId,
            sourceUrl: row.sourceUrl,
          })),
          saturated: stale.length >= maxItems,
          reason: `${stale.length} novel cũ nhất theo last_crawled_at`,
        };
      }
    }
  }

  /** Tiện dụng: dựng kế hoạch từ CrawlContext đã có. */
  planFor(
    ctx: CrawlContext,
    sourceUuid: string,
    explicitTargets?: readonly NovelRef[],
  ): Promise<RunPlan> {
    return this.plan(ctx.sourceId, sourceUuid, ctx.mode, {
      maxItems: ctx.maxItems,
      ...(explicitTargets === undefined ? {} : { explicitTargets }),
    });
  }
}
