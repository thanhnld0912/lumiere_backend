import type { CrawlContext, CrawlMode, NovelRef, SourceId } from '../core/types.js';
import { withTransaction } from '../database/transaction.js';
import { QueueRepository, SourceRepository } from '../repositories/index.js';
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
         * HAI nguồn việc, hàng đợi TRƯỚC.
         *
         *   1. `crawl_queue`  — novel `discover`/`latest` vừa phát hiện, CHƯA
         *                       có dòng nào trong database
         *   2. `novel_sources` — novel đã biết, chọn cũ nhất theo
         *                       `last_crawled_at` NULLS FIRST
         *
         * Hàng đợi phải đi trước vì đó là việc duy nhất chưa ai làm: một novel
         * trong hàng đợi hoàn toàn không tồn tại với người đọc, còn một novel
         * cũ thì vẫn đọc được, chỉ là metadata hơi cũ.
         */
        const { queued, stale } = await withTransaction(async (client) => {
          const fromQueue = await new QueueRepository(client).takePending(sourceUuid, maxItems);

          // Chỉ lấy thêm novel cũ khi hàng đợi chưa dùng hết ngân sách.
          const remaining = maxItems - fromQueue.length;
          const fromStale =
            remaining > 0
              ? await new SourceRepository(client).findStale(sourceUuid, remaining)
              : [];

          return { queued: fromQueue, stale: fromStale };
        });

        /*
         * Khử trùng lặp giữa hai nguồn.
         *
         * Một novel có thể vừa nằm trong hàng đợi vừa đã có trong `novel_sources`
         * (VD lần refresh trước import xong nhưng chết trước khi xoá hàng đợi).
         * Crawl hai lần trong cùng một lần chạy là lãng phí thuần tuý.
         */
        const seen = new Set(queued.map((row) => row.externalId));
        const targets = [
          ...queued,
          ...stale.filter((row) => !seen.has(row.externalId)),
        ].map((row) => ({
          sourceId,
          externalId: row.externalId,
          sourceUrl: row.sourceUrl,
        }));

        return {
          mode,
          maxItems,
          targets,
          saturated: targets.length >= maxItems,
          reason: `${queued.length} từ hàng đợi + ${targets.length - queued.length} novel cũ`,
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
