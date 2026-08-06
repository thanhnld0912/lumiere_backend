import type { Logger } from 'pino';
import { crawlerConfig } from '../config/crawler.config.js';
import type { SourceConfig } from '../config/sources/types.js';
import { BlockedError, CrawlerError } from './errors/index.js';
import type { CrawlContext, CrawlMode, SourceId } from './types.js';
import { childLogger } from '../utils/logger.js';
import { profiler } from '../utils/profiler.js';
import { sleep } from '../utils/sleep.js';

/** Nguồn trả về lỗi HTTP không mong đợi. Không fatal — item khác vẫn chạy tiếp. */
export class ApiRequestError extends CrawlerError {
  readonly isFatal = false;

  constructor(
    readonly url: string,
    readonly statusCode: number,
    body: string,
  ) {
    super(`HTTP ${statusCode} khi gọi ${url}`, {
      url,
      statusCode,
      body: body.slice(0, 200),
    });
  }
}

/**
 * Lớp cha cho nguồn có REST API — song song với `BaseCrawler` (nguồn HTML).
 *
 * Vì sao KHÔNG dùng lại CheerioCrawler: Crawlee được thiết kế quanh hàng đợi URL
 * và kho lưu trữ, hợp với việc rà quét trang web. Còn ở đây là API có phân trang
 * tường minh (`{data, meta:{page,totalPages}}`), nên vòng lặp "gọi tới khi đủ N
 * item" viết thẳng vẫn rõ ràng hơn nhiều so với việc uốn theo mô hình hàng đợi.
 *
 * Đổi lại phải tự lo phần lịch sự, nên lớp này làm đúng những việc đó:
 * giới hạn tần suất, backoff luỹ thừa, tôn trọng `Retry-After`, và DỪNG NGAY khi
 * bị chặn.
 */
export abstract class BaseApiCrawler {
  abstract readonly sourceId: SourceId;
  abstract readonly config: SourceConfig;

  abstract supports(mode: CrawlMode): boolean;

  /** Mốc thời gian request gần nhất — dùng để giữ khoảng cách tối thiểu. */
  private lastRequestAt = 0;

  protected logger(ctx: CrawlContext): Logger {
    return childLogger({ source: this.sourceId, mode: ctx.mode, runId: ctx.runId });
  }

  /**
   * Gọi API và trả JSON đã parse.
   *
   * Tự retry khi gặp 429/5xx, KHÔNG retry khi gặp 403 — site đã từ chối thì thử
   * lại chỉ làm tăng nguy cơ bị cấm IP. Đây là cùng nguyên tắc đã áp cho
   * `BaseCrawler` sau khi phát hiện `retryOnBlocked` gửi 11 request tới một
   * nguồn vừa trả 403.
   */
  protected async fetchJson<T>(url: string, log: Logger): Promise<T> {
    const maxAttempts = this.config.http.maxRequestRetries + 1;
    let delayMs = 500;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.respectRateLimit();

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            'user-agent': crawlerConfig.userAgent,
            accept: 'application/json',
            'accept-language': 'en-US,en;q=0.9',
          },
          signal: AbortSignal.timeout(this.config.http.requestTimeoutSecs * 1000),
        });
      } catch (error) {
        // Lỗi mạng / timeout — đáng thử lại.
        if (attempt === maxAttempts) throw error;
        log.warn({ url, attempt, err: String(error).slice(0, 120) }, 'lỗi mạng, thử lại');
        await sleep(delayMs);
        delayMs *= 2;
        continue;
      }

      if (response.ok) {
        return (await response.json()) as T;
      }

      // 403 = bị chặn. DỪNG toàn bộ run, không thử lại.
      if (response.status === 403) {
        throw new BlockedError(this.sourceId, { url, statusCode: 403 });
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        throw new ApiRequestError(url, response.status, await response.text());
      }

      /*
       * Tôn trọng `Retry-After` khi nguồn có gửi. Tự chọn thời gian chờ ngắn hơn
       * mức nguồn yêu cầu là cách chắc chắn để bị chặn.
       */
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
      const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : delayMs;

      log.warn({ url, status: response.status, waitMs, attempt }, 'nguồn yêu cầu chờ, thử lại');
      await sleep(waitMs);
      delayMs *= 2;
    }

    throw new ApiRequestError(url, 0, 'hết số lần thử');
  }

  /**
   * Duyệt hết các trang cho tới khi đủ `maxItems` hoặc hết dữ liệu.
   *
   * `maxItems` là trần CỨNG (D4) — kể cả khi nguồn còn 28 trang nữa thì vẫn dừng.
   * Đây là điều kiện để một lần chạy trên GitHub Actions có chi phí đoán trước được.
   */
  protected async paginate<TItem>(
    ctx: CrawlContext,
    buildUrl: (page: number) => string,
    readPage: (payload: unknown) => { items: readonly TItem[]; totalPages: number },
  ): Promise<{ items: TItem[]; truncated: boolean }> {
    const log = this.logger(ctx);
    const items: TItem[] = [];

    let page = 1;
    let totalPages = 1;

    while (items.length < ctx.maxItems && page <= totalPages) {
      const url = buildUrl(page);
      const payload = await this.fetchJson<unknown>(url, log);
      const { items: pageItems, totalPages: pages } = readPage(payload);

      totalPages = pages;
      items.push(...pageItems);

      log.debug({ page, totalPages, got: pageItems.length, total: items.length }, 'đã lấy trang');

      // Trang rỗng nghĩa là hết — thoát để không lặp vô hạn nếu meta sai.
      if (pageItems.length === 0) break;
      page += 1;
    }

    const truncated = items.length >= ctx.maxItems && page <= totalPages;
    if (truncated) {
      /*
       * Ghi log tường minh khi cắt bớt. "Xong 1.000/8.000" và "xong toàn bộ 1.000"
       * nhìn giống hệt nhau trong log nếu không nói rõ.
       */
      log.warn(
        { collected: items.length, maxItems: ctx.maxItems, pagesRemaining: totalPages - page + 1 },
        'chạm trần maxItems — dữ liệu bị cắt bớt',
      );
    }

    return { items: items.slice(0, ctx.maxItems), truncated };
  }

  /** Giữ khoảng cách tối thiểu giữa hai request, theo cấu hình lịch sự của nguồn. */
  private async respectRateLimit(): Promise<void> {
    const minGapMs = Math.max(
      this.config.politeness.minDelayMs,
      Math.ceil(60_000 / this.config.politeness.maxRequestsPerMinute),
    );

    const elapsed = Date.now() - this.lastRequestAt;
    if (this.lastRequestAt > 0 && elapsed < minGapMs) {
      const waitMs = minGapMs - elapsed;
      /*
       * Đo riêng phần CHỜ.
       *
       * Không tách ra thì mọi giai đoạn có gọi mạng đều trông như "chậm vì
       * mạng", trong khi thực tế phần lớn thời gian là ta tự ngồi chờ cho lịch
       * sự. Hai thứ đó cần cách chữa hoàn toàn khác nhau: một bên là giảm SỐ
       * request, bên kia là đổi rate limit.
       */
      profiler.add('(trong đó) chờ rate-limit', waitMs);
      await sleep(waitMs);
    }
    this.lastRequestAt = Date.now();
  }
}
