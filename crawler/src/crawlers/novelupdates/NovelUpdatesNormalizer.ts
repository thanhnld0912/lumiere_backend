import type { NormalizeContext } from '../../core/contracts/INormalizer.js';
import type {
  NormalizedChapterRef,
  NormalizedLatestRelease,
  NormalizedNovel,
  RawLatestRelease,
  RawNovel,
} from '../../dto/index.js';
import { buildDisplayTitle, extractChapterLabel } from '../../extractors/chapter.extractor.js';
import { parseDate } from '../../extractors/date.extractor.js';
import { firstOrNull } from '../../extractors/list.extractor.js';
import { extractRating } from '../../extractors/rating.extractor.js';
import { extractStatus } from '../../extractors/status.extractor.js';
import { hashContent } from '../../utils/hash.js';
import { chapterSlug, slugify } from '../../utils/slugify.js';
import { computeSortIndex } from '../../utils/sortIndex.js';
import { mapLanguage, mapNovelStatus } from './mappings.js';

/**
 * RawNovel (chuỗi thô từ HTML) -> DTO canonical.
 *
 * Đây là nơi diễn giải dữ liệu, và nó KHÔNG chứa selector nào — parser đã làm
 * xong phần đọc DOM. Nhờ tách vậy, khi NovelUpdates đổi CÁCH VIẾT (không đổi
 * HTML) thì chỉ file này và `mappings.ts` phải sửa.
 *
 * Hàm THUẦN — `ctx.now` truyền vào để test tất định.
 */
export class NovelUpdatesNormalizer {
  readonly name = 'novelupdates:normalizer';

  normalizeNovel(raw: RawNovel, ctx: NormalizeContext): NormalizedNovel {
    const status = extractStatus(raw.status);
    const statusMapping = mapNovelStatus(status.statusText);
    const rating = extractRating(raw.rating);

    const latestChapter = this.buildLatestChapter(raw, ctx);

    const title = raw.title ?? `Novel ${raw.externalId}`;

    /*
     * Hash tính trên field NGHĨA, bỏ `crawledAt` và mọi thứ biến động. Nếu
     * không, mỗi lần refresh đều bị coi là "đã thay đổi" và sync_events sẽ đầy rác.
     */
    const contentHash = hashContent({
      title,
      synopsis: raw.description,
      status: statusMapping.status,
      genres: [...raw.genres].sort(),
      tags: [...raw.tags].sort(),
      coverUrl: raw.coverUrl,
      author: firstOrNull(raw.authors),
      totalChapters: status.totalChapters,
      latestChapterSlug: latestChapter?.slug ?? null,
    });

    const translationGroupName = firstOrNull(raw.translationGroups);

    return {
      sourceId: raw.sourceId,
      externalId: raw.externalId,
      sourceUrl: raw.sourceUrl,

      slug: slugify(raw.externalId, { fallbackSeed: raw.sourceUrl }),
      title,
      altTitles: raw.altTitles,

      /*
       * `novels.author` chỉ giữ MỘT tác giả trong khi NU liệt kê nhiều.
       * Lấy tên đầu tiên và chấp nhận mất phần còn lại — cần đủ thì phải thêm
       * bảng novel_authors, chứ không nhồi hết vào một cột varchar.
       */
      author: firstOrNull(raw.authors) ?? 'Unknown',
      artist: firstOrNull(raw.artists),

      coverUrl: raw.coverUrl,
      synopsis: raw.description ?? '',
      status: statusMapping.status,
      language: mapLanguage(raw.language),
      originalPublisher: raw.originalPublisher,

      genres: raw.genres,
      tags: raw.tags,
      translationGroup:
        translationGroupName === null
          ? null
          : {
              slug: slugify(translationGroupName, { maxLength: 120 }),
              name: translationGroupName,
              siteUrl: null,
            },

      rating: rating.rating ?? 0,
      ratingsCount: rating.ratingsCount ?? 0,

      totalChapters: status.totalChapters,
      latestChapter,

      contentHash,
      crawledAt: ctx.now,
    };
  }

  normalizeLatest(raw: RawLatestRelease, ctx: NormalizeContext): NormalizedLatestRelease {
    const groupName = raw.translationGroup;

    return {
      sourceId: raw.sourceId,
      externalId: raw.externalId,
      sourceUrl: raw.novelUrl,

      novelTitle: raw.novelTitle,
      novelSlug: slugify(raw.externalId, { fallbackSeed: raw.novelUrl }),

      chapter: this.buildChapterRef(raw.chapterLabel, raw.releasedAt, raw.chapterUrl, ctx),

      translationGroupName: groupName,
      translationGroupSlug: groupName === null ? null : slugify(groupName, { maxLength: 120 }),

      crawledAt: ctx.now,
    };
  }

  private buildLatestChapter(raw: RawNovel, ctx: NormalizeContext): NormalizedChapterRef | null {
    return this.buildChapterRef(
      raw.latestChapterLabel,
      raw.latestChapterDate,
      raw.latestChapterUrl,
      ctx,
    );
  }

  /**
   * Nhãn chương -> tham chiếu có cấu trúc (quyết định D1).
   *
   * Trả null khi không bóc được số: `sort_index` bắt buộc phải có `number`, và
   * đoán bừa một con số sẽ làm sai thứ tự đọc — tệ hơn là không có chương.
   */
  private buildChapterRef(
    label: string | null,
    dateText: string | null,
    url: string | null,
    ctx: NormalizeContext,
  ): NormalizedChapterRef | null {
    if (label === null) return null;

    const parts = extractChapterLabel(label);
    if (parts.number === null) return null;

    return {
      slug: chapterSlug({
        number: parts.number,
        volumeNumber: parts.volumeNumber,
        partNumber: parts.partNumber,
        isExtra: parts.isExtra,
      }),
      rawTitle: parts.raw,
      displayTitle: buildDisplayTitle(parts),
      title: parts.title,
      number: parts.number,
      volumeNumber: parts.volumeNumber,
      partNumber: parts.partNumber,
      isExtra: parts.isExtra,
      sortIndex: computeSortIndex({
        number: parts.number,
        volumeNumber: parts.volumeNumber,
        partNumber: parts.partNumber,
        isExtra: parts.isExtra,
      }),
      // NovelUpdates dùng MM/DD/YY ở bảng phát hành trên trang series.
      publishedAt: parseDate(dateText, ctx.now),
      sourceUrl: url,
      translationGroupSlug: null,
    };
  }
}
