import { randomUUID } from 'node:crypto';
import { crawlerConfig } from '../config/crawler.config.js';
import type { ISourceAdapter } from '../core/contracts/ISourceAdapter.js';
import { tallyOutcomes, type ItemOutcome, type RunSummary } from '../core/result/index.js';
import type { CrawlContext, CrawlMode, NovelRef } from '../core/types.js';
import { withTransaction } from '../database/transaction.js';
import { createJob, type JobContext } from '../jobs/index.js';
import {
  ChapterRepository,
  QueueRepository,
  SourceRepository,
  SyncRepository,
} from '../repositories/index.js';
import { RunPlanner } from '../scheduler/RunPlanner.js';
import { computeNextRunAt } from '../scheduler/schedule.config.js';
import { childLogger } from '../utils/logger.js';
import { profiler } from '../utils/profiler.js';

export interface RunOptions {
  readonly maxItems: number;
  readonly dryRun: boolean;
  /** Ghi lại bất kể content_hash — dùng sau khi sửa bug ở đường ghi. */
  readonly force?: boolean;
  /** Mục tiêu chỉ định sẵn (`--id`/`--url`), bỏ qua RunPlanner. */
  readonly targets?: readonly NovelRef[];
}

/**
 * Vòng đời một lần chạy: mở sổ -> chọn job -> chạy -> đóng sổ.
 *
 * Sau khi có tầng Job, service này KHÔNG còn chứa logic crawl nào. Nó chỉ lo
 * phần chung cho mọi mode: tra uuid nguồn, ghi `sync_runs`, gom số liệu, và GHI
 * hàng đợi refresh xuống database.
 *
 * ⚠️ Service KHÔNG chạy job thứ hai trong cùng một lần chạy.
 *
 * Trước đây nó làm: `latest`/`discover` xong thì gọi luôn `RefreshJob` cho các
 * novel vừa phát hiện. Nghe thì tiện — một lần cron là đủ — nhưng nó xoá sạch
 * ranh giới chi phí giữa các mode. Khi `refresh` học được cách tải nội dung
 * chương (mỗi chương MỘT request), `latest` từ vài giây thành hơn 30 phút và bị
 * GitHub Actions giết, dù bản thân `LatestJob` không hề đổi một dòng nào.
 *
 * Giờ hàng đợi được GHI xuống `crawl_queue` và lần `refresh` kế tiếp rút ra.
 * Mỗi workflow lại có ngân sách thời gian riêng, đúng như tên gọi của nó.
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
      ...(crawlerConfig.maxRunMinutes > 0
        ? { deadline: new Date(startedAt.getTime() + crawlerConfig.maxRunMinutes * 60_000) }
        : {}),
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

      /*
       * GHI hàng đợi, KHÔNG chạy nó.
       *
       * `latest` và `discover` chỉ phát hiện novel mới; nạp dữ liệu là việc của
       * `refresh`, và đó là một job có ngân sách thời gian hoàn toàn khác. Chạy
       * nó ở đây sẽ làm mọi thay đổi chi phí của refresh âm thầm chảy ngược vào
       * hai job vốn phải rẻ.
       */
      const queued = ctx.dryRun
        ? 0
        : await profiler.time('queue:enqueue', () =>
            this.enqueueForRefresh(sourceUuid, mode, result.refreshQueue),
          );

      const pending = ctx.dryRun ? 0 : await this.countQueue(sourceUuid);

      if (result.refreshQueue.length > 0 || pending > 0) {
        log.info(
          { phatHien: result.refreshQueue.length, moiThem: queued, dangCho: pending },
          'đã ghi hàng đợi refresh — chạy `--mode refresh` để xử lý',
        );
      }

      const summary = this.buildSummary(ctx, startedAt, outcomes, result.truncated, {
        queued,
        pending,
      });
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

  /**
   * Ghi novel mới phát hiện vào `crawl_queue`.
   *
   * Chi phí là MỘT câu INSERT cho cả lô, bất kể hàng đợi dài bao nhiêu. Đó là
   * điểm mấu chốt: `latest` và `discover` có chi phí không phụ thuộc vào việc
   * refresh phải làm gì với những novel đó.
   */
  private async enqueueForRefresh(
    sourceUuid: string,
    mode: CrawlMode,
    queue: readonly NovelRef[],
  ): Promise<number> {
    if (queue.length === 0) return 0;

    return withTransaction((client) =>
      new QueueRepository(client).enqueue(
        sourceUuid,
        queue.map((ref) => ({
          externalId: ref.externalId,
          sourceUrl: ref.sourceUrl,
          reason: mode,
        })),
      ),
    );
  }

  /** Số việc còn chờ — in ra cuối mỗi lần chạy để hàng đợi không âm thầm phình. */
  private countQueue(sourceUuid: string): Promise<number> {
    return withTransaction((client) => new QueueRepository(client).countPending(sourceUuid)).catch(
      () => 0,
    );
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
    queue: { queued: number; pending: number },
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
      queue,
      failures: outcomes.filter((outcome) => outcome.action === 'failed'),
    };
  }
}
