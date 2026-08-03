import type { CheerioRoot } from '../types.js';
import type { IParser, ParseContext } from '../../core/contracts/IParser.js';
import type { RawLatestRelease } from '../../dto/RawLatestRelease.dto.js';
import { cleanText } from '../../extractors/text.extractor.js';
import { extractPathSlug, toAbsoluteUrl } from '../../extractors/url.extractor.js';
import { FULL_VALUE_ATTRIBUTE, LATEST } from './selectors.js';

/**
 * Trang chủ NovelUpdates -> danh sách chương mới phát hành.
 *
 * Đây là nguồn cho mode `latest` — chế độ RẺ NHẤT của toàn hệ thống: một trang
 * duy nhất cho biết ~80 novel vừa có chương mới, thay vì phải crawl lại từng
 * novel một.
 *
 * Bảng được render sẵn từ server (`table#myTable.tablesorter`) nên
 * CheerioCrawler đọc được — không cần Playwright.
 *
 * Hàm THUẦN.
 */
export class NovelUpdatesLatestParser
  implements IParser<CheerioRoot, readonly RawLatestRelease[]>
{
  readonly name = 'novelupdates:latest';

  parse($: CheerioRoot, ctx: ParseContext): readonly RawLatestRelease[] {
    const crawledAt = new Date();
    const releases: RawLatestRelease[] = [];

    $(LATEST.rows).each((_index, row) => {
      const release = this.parseRow($(row), ctx, crawledAt);
      if (release !== null) releases.push(release);
    });

    return releases;
  }

  /**
   * Nhận selection ĐÃ BỌC (`Cheerio<…>`) thay vì node thô: `each` nằm trên
   * `Cheerio<T>` chứ không phải `CheerioRoot`, nên lấy kiểu của node qua
   * `CheerioRoot` sẽ không biên dịch được.
   */
  private parseRow(
    $row: ReturnType<CheerioRoot>,
    ctx: ParseContext,
    crawledAt: Date,
  ): RawLatestRelease | null {
    const seriesLink = $row.find(LATEST.seriesCell).first();
    const novelUrl = toAbsoluteUrl(seriesLink.attr('href'), ctx.url);
    if (novelUrl === null) return null; // dòng header hoặc dòng rác

    const externalId = extractPathSlug(novelUrl, '/series/');
    if (externalId === null) return null;

    const chapterSpan = $row.find(LATEST.chapterCell).first();
    const groupLink = $row.find(LATEST.groupCell).first();

    return {
      sourceId: ctx.sourceId,
      externalId,
      novelUrl,

      /*
       * Đọc attribute `title` TRƯỚC, text chỉ là dự phòng.
       *
       * Bảng này cắt ngắn tiêu đề dài — 'The Imperial Consort Was Born With a
       * Seductive...' — nhưng attribute giữ nguyên bản đầy đủ. Đọc text sẽ lưu
       * tiêu đề cụt kèm dấu ba chấm vào database.
       */
      novelTitle:
        cleanText(seriesLink.attr(FULL_VALUE_ATTRIBUTE)) ?? cleanText(seriesLink.text()),

      chapterLabel:
        cleanText(chapterSpan.attr(FULL_VALUE_ATTRIBUTE)) ?? cleanText(chapterSpan.text()),
      chapterUrl: toAbsoluteUrl(chapterSpan.find('a').first().attr('href'), ctx.url),

      translationGroup:
        cleanText(groupLink.attr(FULL_VALUE_ATTRIBUTE)) ?? cleanText(groupLink.text()),

      /*
       * Bảng ở TRANG CHỦ không có cột thời gian — khác bảng ở trang series.
       * Nên `last_chapter_at` phải lấy từ trang series (mode refresh), hoặc dùng
       * thời điểm crawl làm xấp xỉ. Trả null ở đây là trung thực, không đoán.
       */
      releasedAt: null,

      crawledAt,
    };
  }
}
