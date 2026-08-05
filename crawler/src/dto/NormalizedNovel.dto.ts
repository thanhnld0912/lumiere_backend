import type { NovelStatus, SourceId } from '../core/types.js';
import type { NormalizedChapterRef } from './NormalizedChapterRef.dto.js';

/** Nhóm dịch đã chuẩn hoá. */
export interface NormalizedTranslationGroup {
  readonly slug: string;
  readonly name: string;
  readonly siteUrl: string | null;
}

/**
 * Novel ở dạng CANONICAL — sẵn sàng để importer ghi xuống database.
 *
 * Khác `RawNovel` ở chỗ mọi thứ đã đúng kiểu và đúng vựng từ của Lumiere:
 * số là số, ngày là Date, status thuộc enum, slug thoả CHECK constraint.
 *
 * ⚠️ Vẫn lưu SỐ THÔ (`ratingsCount: number`, không phải '12.4k'). Việc format
 * thành chuỗi hiển thị là của presenter layer bên REST API — nguyên tắc đã chốt
 * ở Q1 và crawler không được phá vỡ nó.
 */
export interface NormalizedNovel {
  readonly sourceId: SourceId;
  readonly externalId: string;
  readonly sourceUrl: string;

  readonly slug: string;
  readonly title: string;
  readonly altTitles: readonly string[];

  /** NovelUpdates có thể liệt kê nhiều tác giả; `novels.author` chỉ giữ một. */
  readonly author: string;
  readonly artist: string | null;

  readonly coverUrl: string | null;
  readonly synopsis: string;
  readonly status: NovelStatus;
  /** D3 phase 1: chỉ 'English'. */
  readonly language: string | null;
  readonly originalPublisher: string | null;

  readonly genres: readonly string[];
  readonly tags: readonly string[];
  readonly translationGroup: NormalizedTranslationGroup | null;

  /** 0–5, đã ép về thang của cột numeric(3,2). */
  readonly rating: number;
  readonly ratingsCount: number;

  /** Null khi nguồn không cho biết tổng số chương. */
  readonly totalChapters: number | null;

  /** Chương mới nhất biết được. Null khi novel chưa có chương nào. */
  readonly latestChapter: NormalizedChapterRef | null;

  /**
   * TOÀN BỘ danh sách chương, nếu adapter lấy được.
   *
   * Mảng rỗng nghĩa là "nguồn không cho danh sách" — KHÁC với "novel không có
   * chương nào". Importer chỉ ghi khi mảng có phần tử, để một nguồn chỉ cho biết
   * chương mới nhất không xoá mất danh sách đã có.
   *
   * Vẫn KHÔNG kèm nội dung chương: `NormalizedChapterRef` không có trường text.
   */
  readonly chapters: readonly NormalizedChapterRef[];

  /**
   * sha256 của chính object này (đã bỏ các field biến động như crawledAt).
   * Bằng nhau -> bỏ qua UPDATE hoàn toàn. Đây là thứ giữ cho `updated_at` và
   * `sync_events` khỏi bị nhiễu ở mỗi lần refresh.
   */
  readonly contentHash: string;

  readonly crawledAt: Date;
}
