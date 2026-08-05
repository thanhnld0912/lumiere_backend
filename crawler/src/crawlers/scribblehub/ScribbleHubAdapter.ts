import {
  scribbleHubConfig,
  type ScribbleHubConfig,
} from '../../config/sources/scribblehub.config.js';
import { BaseApiCrawler } from '../../core/BaseApiCrawler.js';
import type { NormalizeContext } from '../../core/contracts/INormalizer.js';
import type { ISourceAdapter } from '../../core/contracts/ISourceAdapter.js';
import type { CrawlContext, CrawlMode, NovelRef, SourceId } from '../../core/types.js';
import type { NormalizedLatestRelease, NormalizedNovel } from '../../dto/index.js';
import { ScribbleHubNormalizer } from './ScribbleHubNormalizer.js';
import { buildSeriesUrl } from './mappings.js';
import {
  isScribbleHubStory,
  isScribbleHubUpdate,
  readEnvelope,
  type ScribbleHubStory,
} from './types.js';

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

    for (const target of targets.slice(0, ctx.maxItems)) {
      const url = this.url(this.config.paths.storyDetail.replace('{id}', target.externalId), {});

      try {
        const payload = await this.fetchJson<unknown>(url, log);
        const story = (payload as { data?: unknown }).data;

        if (!isScribbleHubStory(story)) {
          log.warn({ externalId: target.externalId }, 'response sai hình dạng, bỏ qua');
          continue;
        }

        results.push(this.normalizer.normalizeNovel(story, normalizeContext));
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
