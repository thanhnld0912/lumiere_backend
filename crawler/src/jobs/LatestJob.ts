import { canLatest } from '../core/contracts/ISourceAdapter.js';
import { ConfigError } from '../core/errors/index.js';
import type { ItemOutcome } from '../core/result/index.js';
import type { CrawlMode, NovelRef } from '../core/types.js';
import { LatestReleaseImporter } from '../importers/LatestReleaseImporter.js';
import { profiler } from '../utils/profiler.js';
import { BaseJob, type JobContext, type JobResult } from './BaseJob.js';

/**
 * Mode `latest` — job RẺ NHẤT, chạy 6 giờ một lần.
 *
 * Một request cho biết hàng chục novel vừa có chương mới. Nó CHỈ ghi
 * `sync_events` (feed cho GET /api/timeline), KHÔNG đụng vào metadata novel —
 * feed không có genre, không có mô tả, ghi vào sẽ làm hỏng dữ liệu tốt.
 *
 * Novel chưa có trong database thì đưa vào hàng đợi refresh thay vì tạo bản ghi
 * thiếu thốn.
 */
export class LatestJob extends BaseJob {
  readonly name = 'latest';
  readonly mode: CrawlMode = 'latest';

  private readonly importer = new LatestReleaseImporter();

  async execute(ctx: JobContext): Promise<JobResult> {
    const log = this.logger(ctx);

    if (!canLatest(ctx.adapter)) {
      throw new ConfigError(`Nguồn '${ctx.sourceId}' không hỗ trợ mode latest`);
    }

    // Gán ra biến để giữ được kết quả thu hẹp kiểu của `canLatest` bên trong closure.
    const adapter = ctx.adapter;

    const plan = await ctx.planner.planFor(ctx, ctx.sourceUuid);
    const releases = await profiler.time('latest:feed-fetch', () => adapter.latest(ctx));

    log.info({ releases: releases.length }, 'đã lấy feed chương mới');

    const outcomes: ItemOutcome[] = [];
    const refreshQueue: NovelRef[] = [];

    for (const release of releases) {
      const result = await profiler.time('latest:sync-events', () =>
        this.importer.import(release, {
          ...ctx,
          sourceUuid: ctx.sourceUuid,
          force: ctx.force,
        }),
      );

      outcomes.push(result.outcome);

      if (result.needsRefresh) {
        refreshQueue.push({
          sourceId: ctx.sourceId,
          externalId: release.externalId,
          sourceUrl: release.sourceUrl,
        });
      }
    }

    if (refreshQueue.length > 0) {
      log.info({ queued: refreshQueue.length }, 'novel mới phát hiện — đưa vào hàng đợi refresh');
    }

    return { outcomes, truncated: releases.length >= plan.maxItems, refreshQueue };
  }
}
