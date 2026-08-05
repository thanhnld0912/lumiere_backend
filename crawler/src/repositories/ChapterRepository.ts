import type { NormalizedChapterRef } from '../dto/index.js';
import { BaseRepository } from './BaseRepository.js';

/**
 * Bảng `chapters` và `chapter_contents`.
 *
 * Nội dung nằm ở bảng RIÊNG chứ không phải một cột của `chapters`, để câu truy
 * vấn mục lục (novel 991 chương) không phải kéo theo hàng megabyte văn bản.
 */
export class ChapterRepository extends BaseRepository {
  /**
   * Ghi nội dung chương.
   *
   * ⚠️ Mảng RỖNG bị bỏ qua, không ghi đè.
   *
   * Nguồn thỉnh thoảng trả chương trống (đang đăng dở, bị gỡ). Ghi mảng rỗng
   * lên nội dung đã có sẽ XOÁ TRẮNG một chương đọc được — mất dữ liệu do một
   * lần crawl lỗi. Ràng buộc CHECK ở DB cũng yêu cầu ít nhất một đoạn.
   */
  async upsertContent(chapterId: string, paragraphs: readonly string[]): Promise<boolean> {
    if (paragraphs.length === 0) return false;

    await this.execute(
      `INSERT INTO chapter_contents (chapter_id, paragraphs, updated_at)
       VALUES ($1, $2::text[], now())
       ON CONFLICT (chapter_id) DO UPDATE
         SET paragraphs = EXCLUDED.paragraphs,
             updated_at = now()`,
      [chapterId, [...paragraphs]],
    );
    return true;
  }

  /**
   * SỐ CHƯƠNG đã có nội dung, tra theo danh tính bên nguồn.
   *
   * Đây là thứ cho phép adapter đi TIẾP thay vì tải lại: mỗi lần refresh chỉ lấy
   * những chương còn thiếu, nên trần `contentChaptersPerNovel` dịch dần về cuối
   * mục lục thay vì cắn mãi vào 50 chương đầu.
   *
   * Tra bằng (source_id, external_id) chứ không bằng novelId, vì người gọi là
   * tầng service — nơi chỉ có danh tính bên nguồn trong tay.
   */
  async findNumbersWithContent(sourceId: string, externalId: string): Promise<Set<number>> {
    const rows = await this.many<{ number: number }>(
      `SELECT c.number
       FROM novel_sources ns
       JOIN chapters c          ON c.novel_id = ns.novel_id
       JOIN chapter_contents cc ON cc.chapter_id = c.id
       WHERE ns.source_id = $1 AND ns.external_id = $2`,
      [sourceId, externalId],
    );
    return new Set(rows.map((row) => row.number));
  }

  /**
   * slug -> id cho các chương đã tồn tại của một novel.
   *
   * Dùng ở đường "metadata không đổi": chương đã có sẵn trong bảng nên không cần
   * UPSERT lại chỉ để lấy id — chỉ cần tra rồi ghi thẳng nội dung.
   */
  async findIdsBySlug(novelId: string, slugs: readonly string[]): Promise<Map<string, string>> {
    if (slugs.length === 0) return new Map();

    const rows = await this.many<{ id: string; slug: string }>(
      `SELECT id, slug FROM chapters WHERE novel_id = $1 AND slug = ANY($2::text[])`,
      [novelId, [...slugs]],
    );
    return new Map(rows.map((row) => [row.slug, row.id]));
  }

  /** Số dòng `chapters` đang lưu của một novel — dùng để phát hiện mục lục thiếu. */
  async countByNovel(novelId: string): Promise<number> {
    const row = await this.one<{ total: string }>(
      'SELECT COUNT(*)::text AS total FROM chapters WHERE novel_id = $1',
      [novelId],
    );
    return row ? Number.parseInt(row.total, 10) : 0;
  }

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
