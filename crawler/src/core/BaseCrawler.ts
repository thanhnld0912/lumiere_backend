import { CheerioCrawler, Configuration, type CheerioCrawlingContext } from '@crawlee/cheerio';
import type { Logger } from 'pino';
import { crawlerConfig } from '../config/crawler.config.js';
import type { SourceConfig } from '../config/sources/types.js';
import { BlockedError, ParseError, SchemaDriftError } from './errors/index.js';

/** Nhận diện 403/429 và thông báo chặn của Crawlee. */
function isBlockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = (error as { statusCode?: unknown }).statusCode;

  if (statusCode === 403 || statusCode === 429) return true;
  return /blocked by status code|status code 40[13]|status code 429/i.test(message);
}
import type { CrawlContext, CrawlMode, SourceId } from './types.js';
import { childLogger } from '../utils/logger.js';

/**
 * Kết quả một lần chạy CheerioCrawler.
 *
 * `failures` được giữ lại thay vì chỉ đếm: khi tỉ lệ hỏng cao, thông tin để
 * chẩn đoán nằm ở URL và thông báo lỗi cụ thể, không nằm ở con số.
 */
export interface CrawlOutput<T> {
  readonly items: readonly T[];
  readonly failures: readonly { url: string; message: string }[];
  readonly requestsHandled: number;
}

/**
 * Lớp cha cho mọi Source Adapter.
 *
 * Gánh toàn bộ phần chung: dựng CheerioCrawler theo cấu hình lịch sự của nguồn,
 * gắn User-Agent, gom lỗi, phát hiện trôi selector. Lớp con chỉ việc khai báo
 * URL cần crawl và hàm parse — không phải đụng tới Crawlee.
 *
 * Nhờ vậy thêm nguồn mới không phải viết lại logic rate limit / retry / logging.
 */
export abstract class BaseCrawler {
  abstract readonly sourceId: SourceId;
  abstract readonly config: SourceConfig;

  abstract supports(mode: CrawlMode): boolean;

  protected logger(ctx: CrawlContext): Logger {
    return childLogger({ source: this.sourceId, mode: ctx.mode, runId: ctx.runId });
  }

  /**
   * Crawl danh sách URL và parse từng trang.
   *
   * `handler` là hàm THUẦN chạy trên `$` — mọi thứ liên quan tới mạng, retry,
   * rate limit đều do Crawlee lo, cấu hình lấy từ `config.politeness`.
   *
   * @param handler trả mảng item; ném ParseError nếu trang không đúng cấu trúc.
   * @param onPage  gọi sau mỗi trang, dùng để đẩy thêm URL vào hàng đợi (phân trang).
   */
  protected async crawl<T>(
    ctx: CrawlContext,
    urls: readonly string[],
    handler: (crawlingContext: CheerioCrawlingContext) => readonly T[],
    onPage?: (crawlingContext: CheerioCrawlingContext) => Promise<void>,
  ): Promise<CrawlOutput<T>> {
    const log = this.logger(ctx);

    const items: T[] = [];
    const failures: { url: string; message: string }[] = [];
    let requestsHandled = 0;
    let parseFailures = 0;
    let blocked = false;

    /*
     * Configuration RIÊNG cho mỗi lần chạy, với `persistStorage: false`.
     *
     * Crawlee mặc định ghi RequestQueue/Dataset xuống ./storage. Ta không cần:
     * mọi state bền vững nằm ở PostgreSQL (novel_sources.last_crawled_at), và
     * trên GitHub Actions thư mục đó là ephemeral nên ghi xuống là vô nghĩa.
     * Chạy hoàn toàn trong bộ nhớ vừa nhanh hơn vừa không để lại rác.
     */
    const configuration = new Configuration({
      persistStorage: false,
      purgeOnStart: true,
    });

    const crawler = new CheerioCrawler(
      {
        // Rate limit + throttling: dùng của Crawlee, KHÔNG tự viết lại.
        maxRequestsPerMinute: this.config.politeness.maxRequestsPerMinute,
        maxConcurrency: this.config.politeness.maxConcurrency,
        minConcurrency: 1,

        // Retry + backoff luỹ thừa cũng đã có sẵn.
        maxRequestRetries: this.config.http.maxRequestRetries,
        requestHandlerTimeoutSecs: this.config.http.requestTimeoutSecs,

        // Trần cứng cho một lần chạy (D4).
        maxRequestsPerCrawl: ctx.maxItems,

        useSessionPool: true,

        /*
         * ⚠️ PHẢI để false.
         *
         * `retryOnBlocked: true` khiến Crawlee coi 403/429 là lỗi session và
         * XOAY SESSION RỒI THỬ LẠI — bỏ qua `maxRequestRetries`. Thực tế đo được:
         * đặt maxRequestRetries = 3 nhưng nó vẫn gửi 11 request tới một site vừa
         * trả 403.
         *
         * Site đã nói "không" thì thử lại 10 lần vừa vô ích vừa là hành vi xấu,
         * và với IP dùng chung của GitHub Actions thì đó là cách nhanh nhất để bị
         * chặn vĩnh viễn. Bị chặn phải DỪNG NGAY và báo cho người vận hành.
         */
        retryOnBlocked: false,

        preNavigationHooks: [
          async (_crawlingContext, gotOptions) => {
            /*
             * User-Agent định danh rõ ràng kèm cách liên hệ.
             *
             * Vừa là phép lịch sự vừa là tự bảo vệ: IP của GitHub Actions runner
             * dùng chung, bị chặn thì không có cách nào tự gỡ.
             */
            gotOptions.headers = {
              ...gotOptions.headers,
              'user-agent': crawlerConfig.userAgent,
              'accept-language': 'en-US,en;q=0.9',
            };
          },
        ],

        requestHandler: async (crawlingContext) => {
          requestsHandled += 1;
          const url = crawlingContext.request.loadedUrl ?? crawlingContext.request.url;

          try {
            items.push(...handler(crawlingContext));
          } catch (error) {
            /*
             * Một trang hỏng KHÔNG được giết cả job đang xử lý hàng nghìn novel.
             * Ghi lại, tính vào tỉ lệ trôi selector, rồi đi tiếp.
             */
            parseFailures += 1;
            const message = error instanceof Error ? error.message : String(error);
            failures.push({ url, message });
            log.warn({ url, err: message }, 'parse thất bại');
          }

          if (onPage) await onPage(crawlingContext);
        },

        errorHandler: ({ request }, error) => {
          /*
           * Bị chặn là lỗi VĨNH VIỄN, không phải lỗi tạm thời. Đánh dấu
           * `noRetry` để Crawlee thôi thử lại URL này ngay lập tức.
           */
          if (isBlockedError(error)) {
            blocked = true;
            request.noRetry = true;
          }
        },

        failedRequestHandler: ({ request }, error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (isBlockedError(error)) blocked = true;
          failures.push({ url: request.url, message });
          log.error({ url: request.url, err: message }, 'request thất bại');
        },
      },
      configuration,
    );

    log.info({ urls: urls.length, maxItems: ctx.maxItems }, 'bắt đầu crawl');
    await crawler.run([...urls]);

    if (blocked) {
      throw new BlockedError(this.sourceId, {
        requestsHandled,
        failures: failures.length,
      });
    }

    this.assertNoSchemaDrift(requestsHandled, parseFailures);

    log.info(
      { items: items.length, failures: failures.length, requestsHandled },
      'crawl xong',
    );

    return { items, failures, requestsHandled };
  }

  /**
   * Quá nhiều trang parse hỏng nghĩa là nguồn đã đổi HTML.
   *
   * Ném lỗi FATAL là có chủ đích: thà dừng và báo động còn hơn âm thầm ghi đè
   * dữ liệu tốt bằng vài nghìn bản ghi rỗng. Chỉ áp dụng khi đã đủ mẫu — 3 trang
   * hỏng trong 5 trang không nói lên điều gì.
   */
  private assertNoSchemaDrift(handled: number, parseFailures: number): void {
    if (handled < this.config.schemaDriftMinSamples) return;

    const rate = parseFailures / handled;
    if (rate > this.config.schemaDriftThreshold) {
      throw new SchemaDriftError(this.sourceId, rate, this.config.schemaDriftThreshold, {
        handled,
        parseFailures,
      });
    }
  }

  /** Ghi log rồi nuốt ParseError của MỘT item, trả null để người gọi bỏ qua item đó. */
  protected swallowParseError<T>(fn: () => T, log: Logger): T | null {
    try {
      return fn();
    } catch (error) {
      if (error instanceof ParseError) {
        log.warn({ url: error.url, field: error.field }, error.message);
        return null;
      }
      throw error;
    }
  }
}
