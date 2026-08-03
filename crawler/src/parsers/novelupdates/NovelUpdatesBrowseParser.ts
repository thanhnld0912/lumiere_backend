import type { CheerioRoot } from '../types.js';
import type { IListParser, ParseContext } from '../../core/contracts/IParser.js';
import type { NovelRef } from '../../core/types.js';
import { canonicaliseUrl, extractPathSlug, toAbsoluteUrl } from '../../extractors/url.extractor.js';
import { BROWSE } from './selectors.js';

/**
 * Trang danh mục / xếp hạng -> danh sách con trỏ novel.
 *
 * Nguồn cho mode `discover`. CHỈ trả `NovelRef`, không trả metadata: trang danh
 * mục chỉ có tiêu đề + ảnh bìa, và ở bước này ta chưa cần biết hơn thế. Lấy chi
 * tiết là việc của mode `refresh`.
 *
 * Hàm THUẦN.
 */
export class NovelUpdatesBrowseParser
  implements IListParser<CheerioRoot, NovelRef>
{
  readonly name = 'novelupdates:browse';

  parse($: CheerioRoot, ctx: ParseContext): readonly NovelRef[] {
    /*
     * Dedupe theo external_id.
     *
     * Bắt buộc: một trang danh mục thường có nhiều link tới cùng một novel
     * (ảnh bìa + tiêu đề + link "xem thêm"). Không dedupe thì hàng đợi Crawlee
     * sẽ crawl trùng và tốn quota rate-limit vô ích.
     */
    const seen = new Map<string, NovelRef>();

    $(BROWSE.seriesLinks).each((_index, element) => {
      const href = $(element).attr('href');
      const absolute = toAbsoluteUrl(href, ctx.url);
      if (absolute === null) return;

      const externalId = extractPathSlug(absolute, '/series/');
      if (externalId === null) return;
      if (seen.has(externalId)) return;

      const sourceUrl = canonicaliseUrl(absolute);
      if (sourceUrl === null) return;

      seen.set(externalId, { sourceId: ctx.sourceId, externalId, sourceUrl });
    });

    return [...seen.values()];
  }

  /**
   * URL trang kế tiếp, null nếu đã hết.
   *
   * Lọc bỏ link không cùng host để phân trang không dẫn crawler đi lạc sang tên
   * miền khác.
   */
  nextPageUrl($: CheerioRoot, ctx: ParseContext): string | null {
    const currentCanonical = canonicaliseUrl(ctx.url);

    let next: string | null = null;

    $(BROWSE.nextPage).each((_index, element) => {
      if (next !== null) return;

      const $link = $(element);
      // Bỏ qua link trang hiện tại và link đã bị disable.
      if ($link.hasClass('current') || $link.attr('aria-current') !== undefined) return;

      const absolute = toAbsoluteUrl($link.attr('href'), ctx.url);
      if (absolute === null) return;

      const canonical = canonicaliseUrl(absolute);
      if (canonical === null || canonical === currentCanonical) return;

      next = absolute;
    });

    return next;
  }
}
