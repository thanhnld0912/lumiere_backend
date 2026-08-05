import type { NormalizedChapterRef } from '../dto/index.js';
import { BaseRepository } from './BaseRepository.js';

/**
 * Bảng `chapters`.
 *
 * ⚠️ TUYỆT ĐỐI không đụng tới `chapter_contents` — yêu cầu hiện tại là chưa
 * crawl nội dung chương. Chương được tạo mà không có nội dung sẽ hiển thị đúng
 * trạng thái rỗng "Chapter content not available yet" mà ReaderView đã có.
 */
export class ChapterRepository extends BaseRepository {
  /** Số chương lớn nhất đang lưu — dùng để đếm chương mới cho sync_events. */
  async findMaxNumber(novelId: string): Promise<number> {
    const row = await this.one<{ max_number: number | null }>(
      'SELECT MAX(number) AS max_number FROM chapters WHERE novel_id = $1',
      [novelId],
    );
    return row?.max_number ?? 0;
  }

  /**
   * Upsert một chương theo (novel_id, slug).
   *
   * Dùng slug làm khoá chứ KHÔNG dùng number: 'Chapter 12' và 'Extra Chapter 12'
   * có cùng number nhưng là hai chương khác nhau — đó chính là lý do migration
   * 003 phải bỏ ràng buộc UNIQUE (novel_id, number).
   *
   * `sort_index` được ghi tường minh từ normalizer. Trigger ở DB chỉ là lưới an
   * toàn cho các đường ghi khác (VD seed.sql).
   */
  async upsert(
    novelId: string,
    chapter: NormalizedChapterRef,
  ): Promise<{ id: string; created: boolean }> {
    const row = await this.one<{ id: string; created: boolean }>(
      `INSERT INTO chapters (
         novel_id, slug, number, title, published_at,
         volume_number, part_number, is_extra, raw_title, display_title, sort_index
       )
       VALUES ($1,$2,$3,$4,COALESCE($5::timestamptz, now()),$6,$7,$8,$9,$10,$11::bigint)
       ON CONFLICT (novel_id, slug) DO UPDATE
         SET title         = EXCLUDED.title,
             display_title = EXCLUDED.display_title,
             raw_title     = COALESCE(EXCLUDED.raw_title, chapters.raw_title),
             volume_number = EXCLUDED.volume_number,
             part_number   = EXCLUDED.part_number,
             is_extra      = EXCLUDED.is_extra,
             sort_index    = EXCLUDED.sort_index
       RETURNING id, (xmax = 0) AS created`,
      [
        novelId,
        chapter.slug,
        chapter.number,
        chapter.title,
        chapter.publishedAt,
        chapter.volumeNumber,
        chapter.partNumber,
        chapter.isExtra,
        chapter.rawTitle,
        chapter.displayTitle,
        chapter.sortIndex,
      ],
    );

    if (!row) throw new Error('UPSERT chapters không trả về dòng nào');

    /*
     * `xmax = 0` là cách chuẩn để phân biệt INSERT với UPDATE trong một câu
     * upsert: dòng vừa được chèn có xmax bằng 0, dòng bị cập nhật thì không.
     * Cần biết điều này để đếm đúng số chương MỚI cho sync_events.
     */
    return { id: row.id, created: row.created };
  }

  /**
   * Đồng bộ `novels.total_chapters` với số dòng thực tế trong bảng chapters.
   *
   * ⚠️ CHỈ gọi khi crawler đã lấy TOÀN BỘ danh sách chương của novel.
   *
   * Hiện adapter chỉ lưu chương mới nhất, nên gọi hàm này sẽ ghi đè con số đúng
   * của nguồn (VD 22) bằng số dòng ta có (1). NovelImporter cố ý không gọi.
   */
  async syncTotalChapters(novelId: string): Promise<number> {
    const row = await this.one<{ total: string }>(
      `UPDATE novels
       SET total_chapters = (SELECT COUNT(*) FROM chapters WHERE novel_id = $1)
       WHERE id = $1
       RETURNING total_chapters::text AS total`,
      [novelId],
    );
    return row ? Number.parseInt(row.total, 10) : 0;
  }
}
