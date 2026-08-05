import { randomUUID } from 'node:crypto';
import type { ISourceAdapter } from '../core/contracts/ISourceAdapter.js';
import { tallyOutcomes, type ItemOutcome, type RunSummary } from '../core/result/index.js';
import type { CrawlContext, CrawlMode, NovelRef } from '../core/types.js';
import { withTransaction } from '../database/transaction.js';
import { createJob, RefreshJob, type JobContext } from '../jobs/index.js';
import { ChapterRepository, SourceRepository, SyncRepository } from '../repositories/index.js';
import { RunPlanner } from '../scheduler/RunPlanner.js';
import { computeNextRunAt } from '../scheduler/schedule.config.js';
import { childLogger } from '../utils/logger.js';

export interface RunOptions {
  readonly maxItems: number;
  readonly dryRun: boolean;
  /** Ghi lại bất kể content_hash — dùng sau khi sửa bug ở đường ghi. */
  readonly force?: boolean;
  /** Mục tiêu chỉ định sẵn (`--id`/`--url`), bỏ qua RunPlanner. */
  readonly targets?: readonly NovelRef[];
  /**
   * Sau `latest`/`discover`, tự chạy luôn refresh cho novel mới phát hiện.
   * Mặc định bật — đó là thứ làm cho việc "enqueue" có ý nghĩa thực tế.
   */
  readonly followUpRefresh?: boolean;
}

/**
 * Vòng đời một lần chạy: mở sổ -> chọn job -> chạy -> đóng sổ.
 *
 * Sau khi có tầng Job, service này KHÔNG còn chứa logic crawl nào. Nó chỉ lo
 * phần chung cho mọi mode: tra uuid nguồn, ghi `sync_runs`, gom số liệu, và nối
 * hàng đợi refresh.
 */
export class CrawlerService {
  private readonly planner = new RunPlanner();

  async run(
    adapter: ISourceAdapter,
    mode: CrawlMode,
    options: RunOptions,
  ): Promise<RunSummary> {
    const startedAt = new Date();

    /*
     * Tra (và tự đăng ký) nguồn TRƯỚC khi crawl: hỏng ở đây thì mọi thao tác ghi
     * sau đó đều vô nghĩa, nên fail sớm hơn là fail sau 20 phút.
     */
    const sourceUuid = await this.resolveSourceUuid(adapter);

    const ctx: CrawlContext = {
      runId: randomUUID(),
      sourceId: adapter.sourceId,
      mode,
      maxItems: options.maxItems,
      dryRun: options.dryRun,
      startedAt,
      /*
       * Cho adapter biết chương nào ĐÃ có nội dung, để nó tải phần còn THIẾU.
       *
       * Chỉ nối ở đường có ghi database. Dry-run cố ý không có: nó phải mô tả
       * đúng một lần chạy sạch, không phụ thuộc vào những gì đã lưu.
       */
      ...(options.dryRun
        ? {}
        : { contentCoverage: (externalId: string) => this.readContentCoverage(sourceUuid, externalId) }),
    };

    const log = childLogger({ runId: ctx.runId, source: ctx.sourceId, mode });

    // dry-run KHÔNG tạo sync_run — nó sẽ làm bẩn thống kê Timeline.
    const runId = ctx.dryRun ? null : await this.startRun(sourceUuid, mode);

    const jobContext: JobContext = {
      ...ctx,
      adapter,
      sourceUuid,
      planner: this.planner,
      force: options.force === true,
    };

    try {
      const result = await createJob(mode, options.targets).execute(jobContext);

      const outcomes: ItemOutcome[] = [...result.outcomes];
      let truncated = result.truncated;

      /*
       * Nối hàng đợi: `latest` và `discover` chỉ PHÁT HIỆN novel mới, nạp dữ liệu
       * là việc của refresh. Chạy luôn ở đây để một lần cron là đủ, thay vì bắt
       * người vận hành nhớ chạy lệnh thứ hai.
       */
      if (result.refreshQueue.length > 0 && options.followUpRefresh !== false && !ctx.dryRun) {
        const followUp = await this.runFollowUpRefresh(jobContext, result.refreshQueue, log);
        outcomes.push(...followUp.outcomes);
        truncated = truncated || followUp.truncated;
      }

      const summary = this.buildSummary(ctx, startedAt, outcomes, truncated);
      if (runId !== null) {
        await this.finishRun(runId, 'completed', computeNextRunAt(mode, startedAt));
      }
      return summary;
    } catch (error) {
      if (runId !== null) {
        // Ghi 'failed' để Timeline không hiển thị một lần chạy treo vĩnh viễn.
        await this.finishRun(runId, 'failed', computeNextRunAt(mode, startedAt)).catch(
          () => undefined,
        );
      }
      throw error;
    }
  }

  /** Chạy refresh cho các novel mà job trước vừa phát hiện. */
  private async runFollowUpRefresh(
    jobContext: JobContext,
    queue: readonly NovelRef[],
    log: ReturnType<typeof childLogger>,
  ): Promise<{ outcomes: readonly ItemOutcome[]; truncated: boolean }> {
    const budget = Math.min(queue.length, jobContext.maxItems);
    const targets = queue.slice(0, budget);

    log.info(
      { queued: queue.length, willRefresh: targets.length },
      'chạy refresh nối tiếp cho novel mới phát hiện',
    );

    const result = await new RefreshJob(targets).execute({ ...jobContext, mode: 'refresh' });

    return {
      outcomes: result.outcomes,
      // Hàng đợi dài hơn ngân sách -> còn novel chưa nạp.
      truncated: queue.length > budget,
    };
  }

  /**
   * Lấy uuid của nguồn, tự đăng ký từ config nếu chưa có.
   *
   * Nhờ vậy thêm nguồn mới chỉ cần một file config + một adapter — không phải
   * nhớ viết thêm migration, thứ dễ quên nhất và chỉ lộ ra khi cron chạy.
   */
  private resolveSourceUuid(adapter: ISourceAdapter): Promise<string> {
    return withTransaction((client) =>
      new SourceRepository(client).ensureSource({
        slug: adapter.sourceId,
        name: adapter.config.name,
        baseUrl: adapter.config.baseUrl,
        enabled: adapter.config.enabled,
      }),
    );
  }

  /**
   * Số chương đã có nội dung của một novel — nguồn cho `ctx.contentCoverage`.
   *
   * Một câu SELECT cho mỗi novel, đổi lại tiết kiệm tới 50 request HTTP cho novel
   * đã đồng bộ xong. Ở tốc độ lịch sự 30 req/phút, đó là 100 giây mỗi novel.
   *
   * Lỗi ở đây KHÔNG được làm hỏng lần chạy: coi như chưa có gì và tải lại — tốn
   * thêm request nhưng dữ liệu vẫn đúng.
   */
  private async readContentCoverage(
    sourceUuid: string,
    externalId: string,
  ): Promise<ReadonlySet<number>> {
    try {
      return await withTransaction((client) =>
        new ChapterRepository(client).findNumbersWithContent(sourceUuid, externalId),
      );
    } catch {
      return new Set<number>();
    }
  }

  private startRun(sourceUuid: string, mode: CrawlMode): Promise<string> {
    return withTransaction((client) => new SyncRepository(client).startRun(sourceUuid, mode));
  }

  private finishRun(
    runId: string,
    status: 'completed' | 'failed',
    nextRunAt: Date | null,
  ): Promise<void> {
    return withTransaction((client) =>
      new SyncRepository(client).finishRun(runId, status, nextRunAt),
    );
  }

  private buildSummary(
    ctx: CrawlContext,
    startedAt: Date,
    outcomes: readonly ItemOutcome[],
    truncated: boolean,
  ): RunSummary {
    const finishedAt = new Date();
    return {
      runId: ctx.runId,
      sourceId: ctx.sourceId,
      mode: ctx.mode,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      totals: tallyOutcomes(outcomes),
      truncated,
      failures: outcomes.filter((outcome) => outcome.action === 'failed'),
    };
  }
}
