import type { NormalizedNovel } from '../dto/index.js';
import { BaseRepository } from './BaseRepository.js';

export interface NovelSnapshot {
  readonly id: string;
  readonly totalChapters: number;
  readonly lastChapterAt: Date | null;
}

/**
 * Bảng `novels` và `novel_alt_titles`.
 *
 * ⚠️ Chỉ ghi các cột mà crawler THỰC SỰ biết. Cố ý KHÔNG đụng tới:
 *   total_views, recommendations_count, bookmarks_count,
 *   popularity_score, trending_score
 * Ba cột đầu do nguồn/người dùng quyết định, hai cột sau do RecomputeScoresJob
 * tính theo batch. Ghi đè chúng ở đây sẽ xoá mất dữ liệu thật.
 */
export class NovelRepository extends BaseRepository {
  async findByIdSnapshot(novelId: string): Promise<NovelSnapshot | null> {
    const row = await this.one<{
      id: string;
      total_chapters: number;
      last_chapter_at: Date | null;
    }>('SELECT id, total_chapters, last_chapter_at FROM novels WHERE id = $1', [novelId]);

    if (!row) return null;
    return {
      id: row.id,
      totalChapters: row.total_chapters,
      lastChapterAt: row.last_chapter_at,
    };
  }

  /**
   * Dedup bước 2: khớp theo slug.
   *
   * Dùng khi (source, external_id) chưa có nhưng novel đã tồn tại từ nguồn khác.
   * Khớp slug là dấu hiệu CHẮC CHẮN — khác hẳn khớp mờ theo tiêu đề + tác giả,
   * thứ mà tôi cố tình KHÔNG tự động gộp vì hai light novel khác nhau hoàn toàn
   * có thể trùng tiêu đề tiếng Anh.
   */
  async findIdBySlug(slug: string): Promise<string | null> {
    const row = await this.one<{ id: string }>('SELECT id FROM novels WHERE slug = $1', [slug]);
    return row?.id ?? null;
  }

  async insert(novel: NormalizedNovel, translationGroupId: string | null): Promise<string> {
    const row = await this.one<{ id: string }>(
      `INSERT INTO novels (
         slug, title, author, artist, cover_url, rating, ratings_count,
         status, total_chapters, synopsis, translation_group_id,
         language, original_publisher, primary_source_id,
         last_synced_at, last_chapter_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::novel_status,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        novel.slug,
        novel.title,
        novel.author,
        novel.artist,
        // cover_url là NOT NULL trong schema -> dùng chuỗi rỗng khi nguồn không có ảnh,
        // thay vì để insert nổ giữa lúc import.
        novel.coverUrl ?? '',
        novel.rating,
        novel.ratingsCount,
        novel.status,
        novel.totalChapters ?? 0,
        novel.synopsis,
        translationGroupId,
        novel.language,
        novel.originalPublisher,
        null, // primary_source_id được gán ở bước sau, khi đã biết uuid nguồn
        novel.crawledAt,
        novel.latestChapter?.publishedAt ?? null,
      ],
    );

    if (!row) throw new Error('INSERT novels không trả về dòng nào');
    return row.id;
  }

  async update(
    novelId: string,
    novel: NormalizedNovel,
    translationGroupId: string | null,
  ): Promise<void> {
    await this.execute(
      `UPDATE novels SET
         title = $2, author = $3, artist = $4,
         cover_url = $5, rating = $6, ratings_count = $7,
         status = $8::novel_status, total_chapters = $9, synopsis = $10,
         translation_group_id = $11, language = $12, original_publisher = $13,
         last_synced_at = $14,
         -- last_chapter_at chỉ được TIẾN, không lùi: nguồn thỉnh thoảng trả
         -- thiếu dữ liệu, và lùi mốc này sẽ làm hỏng section "Recently Updated".
         last_chapter_at = GREATEST(novels.last_chapter_at, $15::timestamptz)
       WHERE id = $1`,
      [
        novelId,
        novel.title,
        novel.author,
        novel.artist,
        novel.coverUrl ?? '',
        novel.rating,
        novel.ratingsCount,
        novel.status,
        novel.totalChapters ?? 0,
        novel.synopsis,
        translationGroupId,
        novel.language,
        novel.originalPublisher,
        novel.crawledAt,
        novel.latestChapter?.publishedAt ?? null,
      ],
    );
  }

  /** Gán nguồn chính nếu novel chưa có. Không ghi đè nguồn đã gán trước đó. */
  async setPrimarySourceIfEmpty(novelId: string, sourceId: string): Promise<void> {
    await this.execute(
      'UPDATE novels SET primary_source_id = $2 WHERE id = $1 AND primary_source_id IS NULL',
      [novelId, sourceId],
    );
  }

  async setReleaseRate(novelId: string, chaptersPerWeek: number | null): Promise<void> {
    if (chaptersPerWeek === null) return;
    await this.execute('UPDATE novels SET release_rate_per_week = $2 WHERE id = $1', [
      novelId,
      chaptersPerWeek,
    ]);
  }

  /**
   * Thay toàn bộ tên khác.
   *
   * Xoá-rồi-chèn thay vì upsert: nguồn có thể BỎ một tên khác, và upsert sẽ để
   * lại dữ liệu cũ mãi mãi.
   */
  async replaceAltTitles(novelId: string, titles: readonly string[]): Promise<void> {
    await this.execute('DELETE FROM novel_alt_titles WHERE novel_id = $1', [novelId]);
    if (titles.length === 0) return;

    await this.execute(
      `INSERT INTO novel_alt_titles (novel_id, title, position)
       SELECT $1, title, (ordinality - 1)::smallint
       FROM unnest($2::text[]) WITH ORDINALITY AS t(title, ordinality)
       ON CONFLICT (novel_id, title) DO NOTHING`,
      [novelId, [...titles]],
    );
  }
}
