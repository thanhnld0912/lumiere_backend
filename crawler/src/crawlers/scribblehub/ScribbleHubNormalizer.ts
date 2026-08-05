import type { NormalizeContext } from '../../core/contracts/INormalizer.js';
import type {
  NormalizedChapterRef,
  NormalizedLatestRelease,
  NormalizedNovel,
} from '../../dto/index.js';
import { cleanMultilineText, cleanText } from '../../extractors/text.extractor.js';
import { hashContent } from '../../utils/hash.js';
import { chapterSlug } from '../../utils/slugify.js';
import { computeSortIndex } from '../../utils/sortIndex.js';
import { buildSeriesUrl, mapSlug, mapStoryStatus, mapTranslationGroup } from './mappings.js';
import type { ScribbleHubChapter, ScribbleHubStory, ScribbleHubUpdate } from './types.js';

/**
 * ScribbleHub API -> DTO canonical.
 *
 * Ngắn hơn hẳn một normalizer cho nguồn HTML, vì API đã trả dữ liệu có kiểu:
 * không phải bóc '4.2 / 5 from 1,234 ratings', không phải đoán '2 days ago'.
 * Việc còn lại chỉ là ánh xạ vựng từ và ép về ràng buộc của database.
 *
 * Hàm THUẦN — `ctx.now` truyền vào thay vì gọi `new Date()`, để test tất định.
 */
export class ScribbleHubNormalizer {
  readonly name = 'scribblehub:normalizer';

  /**
   * @param chapterList danh sách chương đầy đủ từ /stories/{id}/chapters.
   *   Bỏ trống thì chỉ dựng được một tham chiếu tối thiểu từ `chapterCount` —
   *   đủ cho `last_chapter_at` nhưng mục lục sẽ chỉ có một dòng.
   */
  normalizeNovel(
    story: ScribbleHubStory,
    ctx: NormalizeContext,
    chapterList: readonly ScribbleHubChapter[] = [],
  ): NormalizedNovel {
    const slug = mapSlug(story.slug, story.id);
    const statusMapping = mapStoryStatus(story.status);

    const chapters = chapterList.map((chapter) => this.normalizeChapter(chapter));

    /*
     * Chương mới nhất = chương có sortIndex lớn nhất trong danh sách thật.
     * Không có danh sách thì mới suy từ `chapterCount`.
     */
    const latestChapter =
      chapters.length > 0
        ? chapters.reduce((newest, current) =>
            BigInt(current.sortIndex) > BigInt(newest.sortIndex) ? current : newest,
          )
        : this.buildLatestChapterFromStory(story);

    /*
     * Hash được tính trên các field NGHĨA, cố ý BỎ những thứ đổi liên tục
     * (readCount, crawledAt). Nếu không, lượt đọc nhích lên vài đơn vị sẽ khiến
     * mọi novel bị coi là "đã thay đổi" ở mỗi lần chạy, làm `sync_events` đầy rác
     * và Timeline của người dùng trở nên vô nghĩa.
     */
    const contentHash = hashContent({
      title: story.title,
      description: story.description,
      status: statusMapping.status,
      genres: story.genres.map((genre) => genre.name).sort(),
      tags: story.tags.map((tag) => tag.name).sort(),
      coverUrl: story.coverUrl,
      author: story.author.displayName,
      chapterCount: story.chapterCount,
      latestChapterSlug: latestChapter?.slug ?? null,
    });

    return {
      sourceId: ctx.sourceId,
      externalId: String(story.id),
      sourceUrl: buildSeriesUrl(ctx.config.baseUrl, story.id, story.slug),

      slug,
      title: cleanText(story.title) ?? `Story ${story.id}`,
      // ScribbleHub không có trường "tên khác".
      altTitles: [],

      author: cleanText(story.author.displayName) ?? 'Unknown',
      artist: null,

      coverUrl: story.coverUrl,
      synopsis: cleanMultilineText(story.description) ?? '',
      status: statusMapping.status,
      // Toàn bộ ScribbleHub là tác phẩm gốc tiếng Anh (không phải bản dịch).
      language: 'English',
      originalPublisher: null,

      genres: story.genres.map((genre) => genre.name),
      tags: story.tags.map((tag) => tag.name),
      translationGroup: mapTranslationGroup(),

      // Kẹp về [0,5] cho khớp CHECK của cột numeric(3,2).
      rating: clamp(story.ratingAverage, 0, 5),
      ratingsCount: Math.max(0, Math.trunc(story.ratingCount)),

      totalChapters: Math.max(0, Math.trunc(story.chapterCount)),
      latestChapter,
      chapters,

      contentHash,
      crawledAt: ctx.now,
    };
  }

  /** Một dòng /updates -> NormalizedLatestRelease. */
  normalizeLatest(update: ScribbleHubUpdate, ctx: NormalizeContext): NormalizedLatestRelease {
    const { story, latestChapter } = update;

    return {
      sourceId: ctx.sourceId,
      externalId: String(story.id),
      sourceUrl: buildSeriesUrl(ctx.config.baseUrl, story.id, story.slug),

      novelTitle: cleanText(story.title),
      novelSlug: mapSlug(story.slug, story.id),

      chapter: this.buildChapterRef({
        number: latestChapter.number,
        title: latestChapter.title,
        publishedAt: latestChapter.publishedAt,
        id: latestChapter.id,
      }),

      // ScribbleHub là nền tảng đăng gốc — không có nhóm dịch.
      translationGroupName: null,
      translationGroupSlug: null,

      crawledAt: ctx.now,
    };
  }

  /** Chương lấy từ endpoint /stories/{id}/chapters. */
  normalizeChapter(chapter: ScribbleHubChapter): NormalizedChapterRef {
    return this.buildChapterRef({
      number: chapter.number,
      title: chapter.title,
      publishedAt: chapter.publishedAt,
      id: chapter.id,
      wordCount: chapter.wordCount,
    });
  }

  /**
   * `/stories` chỉ cho biết SỐ chương và thời điểm cập nhật cuối, không cho nhãn
   * chương. Dựng một tham chiếu tối thiểu từ `chapterCount` để `last_chapter_at`
   * có giá trị mà không phải gọi thêm request.
   */
  private buildLatestChapterFromStory(story: ScribbleHubStory): NormalizedChapterRef | null {
    if (story.chapterCount <= 0) return null;

    return this.buildChapterRef({
      number: story.chapterCount,
      // KHÔNG bịa tên chương — nguồn không cho biết ở endpoint này.
      title: '',
      publishedAt: story.lastUpdated,
      id: null,
    });
  }

  private buildChapterRef(input: {
    number: number;
    title: string;
    publishedAt: string;
    id: number | null;
    wordCount?: number;
  }): NormalizedChapterRef {
    const number = Math.max(0, Math.trunc(input.number));
    const title = cleanText(input.title) ?? '';

    const ref: NormalizedChapterRef = {
      slug: chapterSlug({ number }),
      // API trả tiêu đề đã sạch, không có chuỗi thô nào để giữ lại.
      rawTitle: input.title.length > 0 ? input.title : null,
      displayTitle: title.length > 0 ? `Chapter ${number}: ${title}` : `Chapter ${number}`,
      title,
      number,
      // ScribbleHub đánh số chương phẳng — không có tập, không có phần, không có ngoại truyện.
      volumeNumber: null,
      partNumber: null,
      isExtra: false,
      sortIndex: computeSortIndex({ number }),
      publishedAt: parseIsoDate(input.publishedAt),
      sourceUrl: null,
      translationGroupSlug: null,
    };

    return ref;
  }
}

/**
 * ScribbleHub trả ISO 8601 có múi giờ ('2026-08-04T11:32:17+00:00') nên `new Date`
 * xử lý đúng và không phụ thuộc giờ địa phương — khác hẳn '10/12/23' của
 * NovelUpdates vốn phải tự parse.
 */
function parseIsoDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
