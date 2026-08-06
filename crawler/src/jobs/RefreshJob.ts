import { canRefresh } from '../core/contracts/ISourceAdapter.js';
import { ConfigError } from '../core/errors/index.js';
import type { ItemOutcome } from '../core/result/index.js';
import type { CrawlMode, NovelRef } from '../core/types.js';
import { withTransaction } from '../database/transaction.js';
import { NovelImporter } from '../importers/index.js';
import { QueueRepository } from '../repositories/index.js';
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

    await this.drainQueue(ctx, plan.targets, outcomes, log);

    return { outcomes, truncated: plan.saturated, refreshQueue: [] };
  }

  /**
   * Dọn `crawl_queue` sau khi xử lý xong.
   *
   * Chỉ xoá cái đã THÀNH CÔNG. Item thất bại chỉ tăng `attempts` để lần sau thử
   * lại — xoá luôn thì một sự cố mạng thoáng qua sẽ làm mất hẳn novel đó, và
   * không có gì phát hiện ra.
   *
   * `refresh` là job DUY NHẤT được rút việc khỏi hàng đợi. Đây là mặt còn lại
   * của ranh giới mà `discover`/`latest` giữ ở phía ghi.
   *
   * ⚠️ Ngoại lệ có chủ đích với luật "job không gọi repository": đây là thao tác
   * lên hàng đợi công việc, không phải lên dữ liệu truyện. Job mới là nơi duy
   * nhất biết việc nào vừa xong.
   */
  private async drainQueue(
    ctx: JobContext,
    targets: readonly NovelRef[],
    outcomes: readonly ItemOutcome[],
    log: ReturnType<BaseJob['logger']>,
  ): Promise<void> {
    if (ctx.dryRun || targets.length === 0) return;

    const failed = new Set(
      outcomes.filter((outcome) => outcome.action === 'failed').map((o) => o.externalId),
    );

    /*
     * Novel adapter không trả về (response hỏng, bị bỏ qua) cũng KHÔNG được xoá.
     * Nó không thành công, chỉ là thất bại lặng lẽ.
     */
    const seen = new Set(outcomes.map((outcome) => outcome.externalId));
    const done = targets
      .map((target) => target.externalId)
      .filter((id) => seen.has(id) && !failed.has(id));
    const retry = targets
      .map((target) => target.externalId)
      .filter((id) => !seen.has(id) || failed.has(id));

    try {
      await withTransaction(async (client) => {
        const queue = new QueueRepository(client);
        const removed = await queue.remove(ctx.sourceUuid, done);
        await queue.markFailed(ctx.sourceUuid, retry, 'refresh không hoàn tất');
        if (removed > 0 || retry.length > 0) {
          log.info({ xong: removed, thuLai: retry.length }, 'đã dọn hàng đợi refresh');
        }
      });
    } catch (error) {
      /*
       * Dọn hàng đợi hỏng KHÔNG được làm hỏng cả lần chạy: dữ liệu truyện đã ghi
       * xong rồi. Hậu quả duy nhất là lần sau crawl lại vài novel — vô hại vì
       * `content_hash` khiến chúng ra `unchanged`.
       */
      log.warn({ err: String(error).slice(0, 150) }, 'không dọn được hàng đợi, bỏ qua');
    }
  }
}
