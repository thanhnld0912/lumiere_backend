import type { SourceId } from '../core/types.js';

/**
 * Dữ liệu THÔ ngay sau khi parse HTML — chưa chuẩn hoá gì cả.
 *
 * Quy tắc: **mọi field đều là string hoặc string[]**, và giữ nguyên đúng những
 * gì trang web hiển thị. Không ép kiểu, không map, không suy diễn ở tầng này.
 *
 * Vì sao: parser chỉ có một việc là ĐỌC ĐÚNG. Trộn thêm việc diễn giải vào đó sẽ
 * khiến khi NovelUpdates đổi cách viết status, ta phải sửa parser thay vì sửa
 * bảng mapping. Tách ra thì mỗi bên hỏng độc lập và sửa độc lập.
 *
 * `raw` giữ lại để re-parse khi cải tiến extractor mà không phải crawl lại.
 */
export interface RawNovel {
  readonly sourceId: SourceId;
  readonly externalId: string;
  readonly sourceUrl: string;

  readonly title: string | null;
  readonly altTitles: readonly string[];
  readonly coverUrl: string | null;

  readonly authors: readonly string[];
  readonly artists: readonly string[];

  readonly genres: readonly string[];
  readonly tags: readonly string[];

  /** VD 'Completed (243 chapters)' — chưa tách, chưa map. */
  readonly status: string | null;
  readonly description: string | null;
  readonly language: string | null;
  readonly originalPublisher: string | null;
  readonly translationGroups: readonly string[];

  /** VD '4.2 / 5 from 1,234 ratings' — chưa tách thành số. */
  readonly rating: string | null;

  /** VD 'v5c243' hoặc 'Chapter 243: Return' — chưa tách volume/number/part. */
  readonly latestChapterLabel: string | null;
  readonly latestChapterUrl: string | null;
  /** VD '2 days ago' — chưa đổi sang Date. */
  readonly latestChapterDate: string | null;

  readonly crawledAt: Date;
}
