import type { CheerioCrawlingContext } from '@crawlee/cheerio';
import { novelUpdatesConfig, type NovelUpdatesConfig } from '../../config/sources/novelupdates.config.js';
import { BaseCrawler } from '../../core/BaseCrawler.js';
import type { ISourceAdapter } from '../../core/contracts/ISourceAdapter.js';
import type { NormalizeContext } from '../../core/contracts/INormalizer.js';
import type { CrawlContext, CrawlMode, NovelRef, SourceId } from '../../core/types.js';
import type {
  NormalizedLatestRelease,
  NormalizedNovel,
  RawLatestRelease,
  RawNovel,
} from '../../dto/index.js';
import {
  NovelUpdatesBrowseParser,
  NovelUpdatesLatestParser,
  NovelUpdatesSeriesParser,
} from '../../parsers/novelupdates/index.js';
import { NovelUpdatesNormalizer } from './NovelUpdatesNormalizer.js';

/**
 * Source Adapter ĐẦU TIÊN — NovelUpdates.
 *
 * Lưu ý về vai trò: class này KHÔNG chứa selector nào, KHÔNG chứa SQL nào, và
 * KHÔNG biết database tồn tại. Nó chỉ ghép ba thứ lại: URL nào cần lấy
 * (`config.paths`), lấy thế nào (`BaseCrawler`), và đọc ra sao (`parsers/`).
 *
 * Đó là lý do thêm nguồn thứ hai chỉ cần một class tương tự + một thư mục
 * parser, không phải sửa gì ở tầng core.
 */
export class NovelUpdatesAdapter extends BaseCrawler implements ISourceAdapter {
  readonly sourceId: SourceId = 'novelupdates';
  readonly config: NovelUpdatesConfig = novelUpdatesConfig;

  private readonly seriesParser = new NovelUpdatesSeriesParser();
  private readonly latestParser = new NovelUpdatesLatestParser();
  private readonly browseParser = new NovelUpdatesBrowseParser();
  private readonly normalizer = new NovelUpdatesNormalizer();

  supports(mode: CrawlMode): boolean {
    return this.config.modes.includes(mode);
  }

  private normalizeContext(ctx: CrawlContext): NormalizeContext {
    return { sourceId: this.sourceId, config: this.config, now: ctx.startedAt };
  }

  /**
   * Mode `latest` — đọc feed chương mới.
   *
   * Chế độ RẺ NHẤT của cả hệ thống: đúng MỘT request cho biết ~80 novel vừa có
   * chương mới. Vì vậy nó chạy 6 giờ/lần, trong khi `refresh` chỉ chạy hàng tháng.
   */
  async latest(ctx: CrawlContext): Promise<readonly NormalizedLatestRelease[]> {
    const url = new URL(this.config.paths.latestReleases, this.config.baseUrl).toString();

    const output = await this.crawl<RawLatestRelease>(ctx, [url], (crawlingContext) =>
      this.latestParser.parse(crawlingContext.$, this.parseContext(crawlingContext)),
    );

    const normalizeContext = this.normalizeContext(ctx);
    return output.items.map((raw) => this.normalizer.normalizeLatest(raw, normalizeContext));
  }

  /**
   * Mode `refresh` — lấy metadata đầy đủ cho các novel ĐÃ BIẾT.
   *
   * Nhận danh sách target từ ngoài chứ không tự quyết định crawl gì: chính sách
   * chọn việc (novel nào cũ nhất, ngân sách bao nhiêu) thuộc về RunPlanner, không
   * thuộc adapter.
   */
  async refresh(
    ctx: CrawlContext,
    targets: readonly NovelRef[],
  ): Promise<readonly NormalizedNovel[]> {
    if (targets.length === 0) return [];

    const urls = targets.map((target) => target.sourceUrl);

    const output = await this.crawl<RawNovel>(ctx, urls, (crawlingContext) => [
      this.seriesParser.parse(crawlingContext.$, this.parseContext(crawlingContext)),
    ]);

    const normalizeContext = this.normalizeContext(ctx);
    return output.items.map((raw) => this.normalizer.normalizeNovel(raw, normalizeContext));
  }

  /**
   * Mode `discover` — duyệt danh mục tìm novel MỚI.
   *
   * Chỉ trả con trỏ (NovelRef), không trả metadata: trang danh mục chỉ có tiêu đề
   * và ảnh bìa. Lấy chi tiết là việc của `refresh`.
   *
   * Phân trang được đẩy vào hàng đợi ngay trong requestHandler, nên Crawlee vẫn
   * áp rate limit cho các trang tiếp theo.
   */
  async discover(ctx: CrawlContext): Promise<readonly NovelRef[]> {
    const startUrl = new URL(this.config.paths.browse, this.config.baseUrl).toString();
    const log = this.logger(ctx);

    const output = await this.crawl<NovelRef>(
      ctx,
      [startUrl],
      (crawlingContext) =>
        this.browseParser.parse(crawlingContext.$, this.parseContext(crawlingContext)),
      async (crawlingContext) => {
        const nextUrl = this.browseParser.nextPageUrl(
          crawlingContext.$,
          this.parseContext(crawlingContext),
        );
        if (nextUrl === null) return;

        // maxRequestsPerCrawl của Crawlee vẫn là trần cứng, nên vòng lặp phân
        // trang không thể chạy vô hạn kể cả khi site trả link "next" mãi mãi.
        log.debug({ nextUrl }, 'đẩy trang kế tiếp vào hàng đợi');
        await crawlingContext.addRequests([nextUrl]);
      },
    );

    // Cùng một novel có thể xuất hiện ở nhiều trang danh mục.
    const unique = new Map<string, NovelRef>();
    for (const ref of output.items) {
      if (!unique.has(ref.externalId)) unique.set(ref.externalId, ref);
    }

    return [...unique.values()];
  }

  private parseContext(crawlingContext: CheerioCrawlingContext): {
    url: string;
    sourceId: string;
  } {
    return {
      /*
       * `loadedUrl` là URL SAU khi theo hết redirect — dùng nó chứ không dùng
       * `request.url`. Nếu NU redirect slug cũ sang slug mới, lấy URL gốc sẽ
       * sinh external_id sai và tạo bản ghi trùng ở mỗi lần crawl.
       */
      url: crawlingContext.request.loadedUrl ?? crawlingContext.request.url,
      sourceId: this.sourceId,
    };
  }
}
