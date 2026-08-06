import {
  scribbleHubConfig,
  type ScribbleHubConfig,
} from '../../config/sources/scribblehub.config.js';
import { BaseApiCrawler } from '../../core/BaseApiCrawler.js';
import type { NormalizeContext } from '../../core/contracts/INormalizer.js';
import type { ISourceAdapter } from '../../core/contracts/ISourceAdapter.js';
import type { CrawlContext, CrawlMode, NovelRef, SourceId } from '../../core/types.js';
import type { NormalizedLatestRelease, NormalizedNovel } from '../../dto/index.js';
import { profiler } from '../../utils/profiler.js';
import { ScribbleHubNormalizer } from './ScribbleHubNormalizer.js';
import { buildSeriesUrl } from './mappings.js';
import {
  isScribbleHubChapter,
  isScribbleHubStory,
  isScribbleHubUpdate,
  readEnvelope,
  type ScribbleHubChapter,
  type ScribbleHubStory,
} from './types.js';

/**
 * Trần số trang mục lục cho MỘT truyện.
 *
 * 50 chương/trang × 40 trang = 2.000 chương. Đủ cho gần như mọi web novel, và là
 * chốt chặn để một truyện có `meta.totalPages` sai không kéo dài lần chạy vô hạn.
 */
const MAX_CHAPTER_PAGES = 40;

/**
 * Source Adapter cho ScribbleHub — nguồn dùng REST API.
 *
 * Đặt cạnh `NovelUpdatesAdapter` để thấy rõ giá trị của abstraction: hai nguồn
 * này khác nhau HOÀN TOÀN về cơ chế —
 *
 *   NovelUpdates : CheerioCrawler -> parse HTML bằng selector -> normalize
 *   ScribbleHub  : fetch JSON     -> normalize
 *
 * Vậy mà `core/`, `dto/`, `database/`, `cli/` không phải sửa một dòng nào. Đúng
 * bài kiểm tra mà Phase 13 đặt ra cho kiến trúc.
 *
 * Adapter này KHÔNG BAO GIỜ gọi tới trang HTML của ScribbleHub: site trả 403 cho
 * HTML nhưng 200 cho API — đó là cách họ nói mình muốn được dùng thế nào.
 */
export class ScribbleHubAdapter extends BaseApiCrawler implements ISourceAdapter {
  readonly sourceId: SourceId = 'scribblehub';
  readonly config: ScribbleHubConfig = scribbleHubConfig;

  private readonly normalizer = new ScribbleHubNormalizer();

  supports(mode: CrawlMode): boolean {
    return this.config.modes.includes(mode);
  }

  /**
   * Mode `latest` — chế độ RẺ NHẤT.
   *
   * Một request trả 25 truyện kèm chương mới nhất của từng truyện. Còn gọn hơn
   * NovelUpdates: ở đây `latestChapter.publishedAt` là ISO 8601 thật, nên
   * `last_chapter_at` lấy được ngay mà không cần đoán.
   */
  async latest(ctx: CrawlContext): Promise<readonly NormalizedLatestRelease[]> {
    const log = this.logger(ctx);
    const normalizeContext = this.normalizeContext(ctx);

    const { items } = await this.paginate(
      ctx,
      (page) => this.url(this.config.paths.updates, { page }),
      (payload) => {
        const { items: updates, meta, skipped } = readEnvelope(payload, isScribbleHubUpdate);
        if (skipped > 0) log.warn({ skipped }, 'bỏ qua item sai hình dạng ở /updates');
        return { items: updates, totalPages: meta?.totalPages ?? 1 };
      },
    );

    return items.map((update) => this.normalizer.normalizeLatest(update, normalizeContext));
  }

  /**
   * Mode `discover` — duyệt danh mục tìm truyện mới.
   *
   * Endpoint `/stories` đã trả metadata ĐẦY ĐỦ, nên về lý thuyết có thể bỏ qua
   * `refresh` luôn. Nhưng vẫn chỉ trả `NovelRef` để giữ đúng ngữ nghĩa hai mode:
   * `discover` tìm ra cái gì tồn tại, `refresh` lấy chi tiết. Trộn hai việc sẽ
   * làm RunPlanner không còn phân biệt được đâu là việc đắt, đâu là việc rẻ.
   */
  async discover(ctx: CrawlContext): Promise<readonly NovelRef[]> {
    const log = this.logger(ctx);

    const { items } = await this.paginate(
      ctx,
      (page) => this.url(this.config.paths.stories, { page }),
      (payload) => {
        const { items: stories, meta, skipped } = readEnvelope(payload, isScribbleHubStory);
        if (skipped > 0) log.warn({ skipped }, 'bỏ qua item sai hình dạng ở /stories');
        return { items: stories, totalPages: meta?.totalPages ?? 1 };
      },
    );

    return items.map((story) => this.toNovelRef(story));
  }

  /**
   * Mode `refresh` — lấy metadata đầy đủ cho các truyện đã biết.
   *
   * Gọi `/stories/{id}` cho từng mục tiêu. Endpoint này có thêm `chaptersPerWeek`
   * (khớp thẳng `novels.release_rate_per_week`) mà endpoint danh sách không có.
   *
   * Một truyện lỗi KHÔNG được làm hỏng cả lô: ghi log rồi đi tiếp.
   */
  async refresh(
    ctx: CrawlContext,
    targets: readonly NovelRef[],
  ): Promise<readonly NormalizedNovel[]> {
    const log = this.logger(ctx);
    const normalizeContext = this.normalizeContext(ctx);
    const results: NormalizedNovel[] = [];

    const planned = targets.slice(0, ctx.maxItems);

    for (const target of planned) {
      /*
       * Hết giờ -> dừng lấy việc MỚI và trả về những gì đã có.
       *
       * Kiểm tra ở đầu vòng lặp chứ không giữa chừng: một novel đã tải xong mục
       * lục và 40 chương thì phải để nó hoàn thành, bỏ dở là vứt đi công sức đã
       * bỏ ra mà chẳng được gì.
       */
      if (ctx.deadline !== undefined && Date.now() >= ctx.deadline.getTime()) {
        log.warn(
          { xong: results.length, boLai: planned.length - results.length },
          'chạm hạn chót — dừng lấy thêm, ghi những gì đã có',
        );
        break;
      }

      const url = this.url(this.config.paths.storyDetail.replace('{id}', target.externalId), {});

      try {
        const payload = await profiler.time('refresh:story-detail', () =>
          this.fetchJson<unknown>(url, log),
        );
        const story = (payload as { data?: unknown }).data;

        if (!isScribbleHubStory(story)) {
          log.warn({ externalId: target.externalId }, 'response sai hình dạng, bỏ qua');
          continue;
        }

        /*
         * Lấy TOÀN BỘ mục lục, không chỉ chương mới nhất.
         *
         * Thiếu bước này thì mỗi novel chỉ có một dòng trong bảng `chapters` và
         * người đọc thấy mục lục trống rỗng dù truyện có hàng trăm chương.
         */
        const chapters = await profiler.time('refresh:toc', () =>
          this.fetchAllChapters(target.externalId, log),
        );
        log.info(
          { externalId: target.externalId, discovered: chapters.length },
          '[1/5] phát hiện chương',
        );

        /*
         * Nội dung chương nằm ở endpoint RIÊNG.
         *
         * `/stories/{id}/chapters` trả `content: ""` cho mọi chương — đo được
         * trên dữ liệu thật. Chỉ `/chapters/{id}` mới có text. Nghĩa là mỗi
         * chương tốn MỘT request, nên phải có trần chi phí (xem contentBudget).
         */
        const covered = await profiler.time(
          'refresh:content-coverage',
          async () => (await ctx.contentCoverage?.(target.externalId)) ?? new Set<number>(),
        );
        const contents = await profiler.time('refresh:chapter-bodies', () =>
          this.fetchChapterContents(chapters, covered, log),
        );

        results.push(
          this.normalizer.normalizeNovel(story, normalizeContext, chapters, contents),
        );
      } catch (error) {
        /*
         * BlockedError là fatal — ném tiếp để dừng cả run. Lỗi khác thì chỉ bỏ
         * qua truyện này.
         */
        if (isFatal(error)) throw error;
        log.warn(
          { externalId: target.externalId, err: String(error).slice(0, 150) },
          'không lấy được truyện, bỏ qua',
        );
      }
    }

    return results;
  }

  /**
   * Lấy toàn bộ mục lục của một truyện, tự duyệt hết các trang.
   *
   * Endpoint trả `per_page` tối đa 50, nên truyện 300 chương cần 6 request. Đó
   * là lý do việc này chỉ làm ở mode `refresh` (hàng tháng) chứ không ở `latest`
   * (6 giờ một lần).
   *
   * Lỗi ở đây KHÔNG làm hỏng cả novel: trả về mảng rỗng thì importer giữ nguyên
   * danh sách chương đang có, và metadata vẫn được cập nhật bình thường.
   */
  private async fetchAllChapters(
    externalId: string,
    log: ReturnType<BaseApiCrawler['logger']>,
  ): Promise<ScribbleHubChapter[]> {
    const path = this.config.paths.storyChapters.replace('{id}', externalId);
    const chapters: ScribbleHubChapter[] = [];

    let page = 1;
    let totalPages = 1;

    try {
      while (page <= totalPages && page <= MAX_CHAPTER_PAGES) {
        const url = this.url(path, { page });
        const payload = await this.fetchJson<unknown>(url, log);
        const { items, meta, skipped } = readEnvelope(payload, isScribbleHubChapter);

        if (skipped > 0) {
          log.warn({ externalId, skipped, page }, 'bỏ qua chương sai hình dạng');
        }

        chapters.push(...items);
        totalPages = meta?.totalPages ?? 1;

        // Trang rỗng -> hết. Thoát để không lặp vô hạn nếu meta sai.
        if (items.length === 0) break;
        page += 1;
      }

      if (page > MAX_CHAPTER_PAGES) {
        log.warn(
          { externalId, fetched: chapters.length, maxPages: MAX_CHAPTER_PAGES },
          'chạm trần số trang mục lục — danh sách chương bị cắt bớt',
        );
      }
    } catch (error) {
      if (isFatal(error)) throw error;
      log.warn(
        { externalId, err: String(error).slice(0, 150) },
        'không lấy được mục lục — giữ nguyên danh sách chương đang có',
      );
      return [];
    }

    return chapters;
  }

  /**
   * Tải nội dung cho từng chương, trả map chapterId -> HTML.
   *
   * ⚠️ MỖI CHƯƠNG LÀ MỘT REQUEST. Với novel 991 chương và rate limit lịch sự
   * 30 req/phút thì riêng một novel đã mất 33 phút. Vì vậy có trần
   * `contentChaptersPerNovel`: vượt trần thì phần còn lại để lượt refresh sau
   * lấy tiếp, thay vì làm job chạy quá 6 giờ và bị GitHub Actions giết.
   *
   * Chương nào lấy được thì có nội dung ngay; chương chưa tới lượt vẫn hiển thị
   * đúng trạng thái "chưa đồng bộ" — không có gì hỏng.
   */
  private async fetchChapterContents(
    chapters: readonly ScribbleHubChapter[],
    covered: ReadonlySet<number>,
    log: ReturnType<BaseApiCrawler['logger']>,
  ): Promise<Map<number, string>> {
    const contents = new Map<number, string>();
    const budget = this.config.contentChaptersPerNovel;

    if (budget <= 0) {
      log.warn({ budget }, '[2/5] BỎ QUA nội dung — contentChaptersPerNovel = 0');
      return contents;
    }

    /*
     * Bỏ chương ĐÃ có nội dung, rồi ưu tiên chương ĐẦU trong phần còn lại.
     *
     * Không lọc `covered` thì trần luôn cắn vào cùng 50 chương đầu ở mọi lần
     * chạy, và chương 51 trở đi không bao giờ có nội dung. Lọc rồi thì mỗi lượt
     * refresh tiến thêm 50 chương — sau đủ lượt là đầy mục lục.
     */
    const missing = chapters
      .filter((chapter) => !covered.has(chapter.number))
      .sort((a, b) => a.number - b.number);
    const targets = missing.slice(0, budget);

    log.info(
      { total: chapters.length, daCo: covered.size, conThieu: missing.length, seTai: targets.length },
      '[2/5] chọn chương cần tải nội dung',
    );

    for (const chapter of targets) {
      const url = `${this.config.apiBase}${this.config.paths.chapterDetail.replace(
        '{id}',
        String(chapter.id),
      )}`;

      try {
        log.debug({ chapterId: chapter.id, number: chapter.number, url }, '[3/5] đang tải nội dung');
        const payload = await this.fetchJson<unknown>(url, log);
        const detail = (payload as { data?: unknown }).data ?? payload;

        if (!isScribbleHubChapter(detail)) {
          log.warn(
            { chapterId: chapter.id, number: chapter.number },
            '[3/5] response chương sai hình dạng — không lấy được nội dung',
          );
          continue;
        }

        if (typeof detail.content !== 'string' || detail.content.length === 0) {
          log.warn(
            { chapterId: chapter.id, number: chapter.number },
            '[3/5] nguồn trả nội dung RỖNG — bỏ qua, không ghi đè',
          );
          continue;
        }

        contents.set(chapter.id, detail.content);
        log.debug(
          { chapterId: chapter.id, number: chapter.number, htmlLength: detail.content.length },
          '[3/5] đã tải nội dung',
        );
      } catch (error) {
        // Bị chặn thì dừng cả run; chương lỗi lẻ thì bỏ qua, phần còn lại vẫn ghi.
        if (isFatal(error)) throw error;
        log.warn(
          { chapterId: chapter.id, err: String(error).slice(0, 120) },
          '[3/5] không lấy được nội dung chương, bỏ qua',
        );
      }
    }

    if (missing.length > targets.length) {
      log.warn(
        { conLai: missing.length - targets.length, budget },
        '[3/5] chạm trần nội dung mỗi novel — phần còn lại để lượt refresh sau',
      );
    }

    return contents;
  }

  private toNovelRef(story: ScribbleHubStory): NovelRef {
    return {
      sourceId: this.sourceId,
      externalId: String(story.id),
      sourceUrl: buildSeriesUrl(this.config.baseUrl, story.id, story.slug),
    };
  }

  private normalizeContext(ctx: CrawlContext): NormalizeContext {
    return {
      sourceId: this.sourceId,
      config: this.config,
      // Truyền `now` vào thay vì để normalizer tự gọi — điều kiện để test tất định.
      now: ctx.startedAt,
    };
  }

  private url(path: string, params: { page?: number }): string {
    const url = new URL(this.config.apiBase + path);
    url.searchParams.set('per_page', String(this.config.perPage));
    if (params.page !== undefined) url.searchParams.set('page', String(params.page));
    return url.toString();
  }
}

function isFatal(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { isFatal?: unknown }).isFatal === true
  );
}
