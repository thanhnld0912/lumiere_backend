import type { CheerioRoot } from '../types.js';
import type { IParser, ParseContext } from '../../core/contracts/IParser.js';
import { ParseError } from '../../core/errors/index.js';
import type { RawNovel } from '../../dto/RawNovel.dto.js';
import { cleanMultilineText, cleanText } from '../../extractors/text.extractor.js';
import { extractList } from '../../extractors/list.extractor.js';
import { extractPathSlug, toAbsoluteUrl } from '../../extractors/url.extractor.js';
import { FULL_VALUE_ATTRIBUTE, SERIES } from './selectors.js';

/**
 * Trang chi tiết series -> RawNovel.
 *
 * Hàm THUẦN trên chuỗi HTML: không network, không database, không side effect.
 * Nhờ vậy test được toàn bộ bằng fixture lưu sẵn.
 *
 * KHÔNG diễn giải gì ở đây — mọi field ra vẫn là string thô đúng như trang hiển
 * thị. Việc tách số, map trạng thái, sinh slug là của normalizer.
 */
export class NovelUpdatesSeriesParser implements IParser<CheerioRoot, RawNovel> {
  readonly name = 'novelupdates:series';

  parse($: CheerioRoot, ctx: ParseContext): RawNovel {
    const externalId = extractPathSlug(ctx.url, '/series/');
    if (externalId === null) {
      throw new ParseError(
        'Không tách được external_id từ URL — không phải trang series?',
        ctx.url,
        'externalId',
      );
    }

    const title = cleanText($(SERIES.title).first().text());
    if (title === null) {
      /*
       * Tiêu đề là field DUY NHẤT bắt buộc. Thiếu nó gần như chắc chắn là trang
       * lỗi/redirect chứ không phải novel thiếu dữ liệu — ném lỗi để item này bị
       * bỏ qua và tính vào tỉ lệ schema drift, thay vì ghi bản ghi rỗng đè lên
       * dữ liệu tốt đang có.
       */
      throw new ParseError('Không tìm thấy tiêu đề series', ctx.url, 'title');
    }

    return {
      sourceId: ctx.sourceId,
      externalId,
      sourceUrl: ctx.url,

      title,
      altTitles: this.parseAssociatedNames($),
      coverUrl: toAbsoluteUrl($(SERIES.coverImage).first().attr('src'), ctx.url),

      authors: this.parseLinkList($, SERIES.authors),
      artists: this.parseLinkList($, SERIES.artists),

      genres: this.parseLinkList($, SERIES.genres),
      tags: this.parseLinkList($, SERIES.tags),

      status: cleanText($(SERIES.status).first().text()),
      description: cleanMultilineText(this.blockText($, SERIES.description)),
      language: cleanText($(SERIES.language).first().text()),
      originalPublisher: cleanText($(SERIES.originalPublisher).first().text()),
      translationGroups: this.parseReleaseGroups($),

      rating: cleanText($(SERIES.rating).first().text()),

      ...this.parseLatestRelease($, ctx),

      crawledAt: new Date(),
    };
  }

  /**
   * Lấy text NHƯNG giữ ranh giới khối.
   *
   * `.text()` của Cheerio nối text của các thẻ con mà KHÔNG chèn xuống dòng, nên:
   *   <div id="editassociated">The Great Sage of Humanity<br>人道大圣</div>
   *     -> 'The Great Sage of Humanity人道大圣'   (hai tên dính liền)
   *   <p>Đoạn một.</p><p>Đoạn hai.</p>
   *     -> 'Đoạn một. Đoạn hai.'                  (mất ngắt đoạn)
   *
   * Phải thay thẻ khối bằng ký tự xuống dòng TRƯỚC khi lấy text.
   */
  private blockText($: CheerioRoot, selector: string): string | null {
    const element = $(selector).first();
    if (element.length === 0) return null;

    const html = (element.html() ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n\n');

    return $.load(`<div>${html}</div>`)('div').text();
  }

  /**
   * Tên khác nằm trong MỘT div, phân tách bằng <br>:
   *   <div id="editassociated">The Great Sage of Humanity<br>人道大圣</div>
   */
  private parseAssociatedNames($: CheerioRoot): readonly string[] {
    const text = this.blockText($, SERIES.associatedNames);
    if (text === null) return [];

    return extractList(text, { separators: /\n/ });
  }

  /** Danh sách thẻ <a> -> mảng text. Dùng cho author/artist/genre/tag. */
  private parseLinkList($: CheerioRoot, selector: string): readonly string[] {
    const values: string[] = [];
    $(selector).each((_index, element) => {
      const value = cleanText($(element).text());
      if (value !== null) values.push(value);
    });
    return extractList(values);
  }

  /** Nhóm dịch xuất hiện ở cột Group của bảng phát hành; lấy tập hợp không trùng. */
  private parseReleaseGroups($: CheerioRoot): readonly string[] {
    const groups: string[] = [];
    $(SERIES.releaseRows).each((_index, row) => {
      const value = cleanText($(row).find(SERIES.releaseGroupCell).first().text());
      if (value !== null) groups.push(value);
    });
    return extractList(groups);
  }

  /**
   * Dòng ĐẦU TIÊN của bảng phát hành là chương mới nhất.
   *
   * Bảng ở trang series có cột Date (VD '08/03/26') — khác bảng ở trang chủ vốn
   * không có ngày. Đây là nguồn để tính `novels.last_chapter_at`.
   */
  private parseLatestRelease(
    $: CheerioRoot,
    ctx: ParseContext,
  ): Pick<RawNovel, 'latestChapterLabel' | 'latestChapterUrl' | 'latestChapterDate'> {
    const firstRow = $(SERIES.releaseRows).first();
    if (firstRow.length === 0) {
      return { latestChapterLabel: null, latestChapterUrl: null, latestChapterDate: null };
    }

    const chapterCell = firstRow.find(SERIES.releaseChapterCell).first();

    return {
      // Attribute `title` giữ nhãn đầy đủ; text có thể bị cắt.
      latestChapterLabel:
        cleanText(chapterCell.attr(FULL_VALUE_ATTRIBUTE)) ?? cleanText(chapterCell.text()),
      latestChapterUrl: toAbsoluteUrl(
        firstRow.find(`${SERIES.releaseChapterCell} a`).first().attr('href') ??
          chapterCell.parent().find('a').first().attr('href'),
        ctx.url,
      ),
      latestChapterDate: cleanText(firstRow.find(SERIES.releaseDateCell).first().text()),
    };
  }
}
