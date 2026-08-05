import { canRefresh } from '../core/contracts/ISourceAdapter.js';
import { ConfigError } from '../core/errors/index.js';
import type { ItemOutcome } from '../core/result/index.js';
import type { CrawlMode, NovelRef } from '../core/types.js';
import { NovelImporter } from '../importers/index.js';
import { BaseJob, type JobContext, type JobResult } from './BaseJob.js';

/**
 * Mode `refresh` — nạp metadata ĐẦY ĐỦ cho novel đã biết.
 *
 * Đây là job DUY NHẤT ghi vào bảng `novels`: nó là nơi duy nhất có đủ dữ liệu
 * (genre, tag, rating, status, mô tả) để làm việc đó mà không ghi đè bằng bản
 * ghi thiếu thốn.
 *
 * Idempotent nhờ `content_hash`: chạy lại mà nguồn không đổi thì mọi item ra
 * `unchanged` và không có câu UPDATE nào chạm vào `novels`.
 */
export class RefreshJob extends BaseJob {
  readonly name = 'refresh';
  readonly mode: CrawlMode = 'refresh';

  private readonly importer = new NovelImporter();

  /** Mục tiêu do job khác đưa sang (LatestJob/DiscoverJob), bỏ qua RunPlanner. */
  constructor(private readonly injectedTargets?: readonly NovelRef[]) {
    super();
  }

  async execute(ctx: JobContext): Promise<JobResult> {
    const log = this.logger(ctx);

    if (!canRefresh(ctx.adapter)) {
      throw new ConfigError(`Nguồn '${ctx.sourceId}' không hỗ trợ mode refresh`);
    }

    const plan = await ctx.planner.planFor(ctx, ctx.sourceUuid, this.injectedTargets);

    if (plan.targets.length === 0) {
      log.info('không có novel nào cần refresh');
      return this.empty();
    }

    log.info({ targets: plan.targets.length, reason: plan.reason }, 'bắt đầu refresh');

    const novels = await ctx.adapter.refresh(ctx, plan.targets);

    const outcomes: ItemOutcome[] = [];
    for (const novel of novels) {
      outcomes.push(
        await this.importer.import(novel, {
          ...ctx,
          sourceUuid: ctx.sourceUuid,
          force: ctx.force,
        }),
      );
    }

    return { outcomes, truncated: plan.saturated, refreshQueue: [] };
  }
}
