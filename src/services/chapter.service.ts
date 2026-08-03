import { query, queryOne, withTransaction } from '../config/database';
import type { ChapterContentRow, ChapterDto } from '../models';
import { ApiError } from '../utils/ApiError';
import { formatChapterDate } from '../utils/presenter';

/**
 * GET /api/novels/:slug/chapters/:chapterSlug
 *
 * Endpoint DUY NHẤT trả `content` — ReaderView.tsx:56 dùng mảng này và render
 * mỗi phần tử thành một thẻ <p> (ReaderView.tsx:127).
 *
 * Bắt buộc nested dưới novel vì chapter slug không unique toàn cục (phát hiện
 * F2: 'ch-42' tồn tại ở cả shadow-of-the-void lẫn eternal-archive).
 */
export async function getChapter(
  novelSlug: string,
  chapterSlug: string,
  userId: string | null,
): Promise<ChapterDto> {
  const row = await queryOne<ChapterContentRow>(
    `
    SELECT
      c.id, c.slug, c.number, c.title, c.published_at,
      c.illustration_url, c.word_count,
      cc.paragraphs,
      CASE
        WHEN $3::uuid IS NULL THEN NULL
        ELSE EXISTS (
          SELECT 1 FROM chapter_reads cr
          WHERE cr.user_id = $3::uuid AND cr.chapter_id = c.id
        )
      END AS is_read
    FROM chapters c
    JOIN novels n ON n.id = c.novel_id
    LEFT JOIN chapter_contents cc ON cc.chapter_id = c.id
    WHERE n.slug = $1 AND c.slug = $2
    `,
    [novelSlug, chapterSlug, userId],
  );

  if (!row) {
    throw ApiError.notFound('Chapter not found');
  }

  const dto: ChapterDto = {
    id: row.slug,
    number: row.number,
    title: row.title,
    date: formatChapterDate(row.published_at),
    isRead: row.is_read ?? false,
  };

  /**
   * Chỉ set `content` khi chương THỰC SỰ có nội dung.
   *
   * KHÔNG được trả mảng rỗng. `Chapter.content` là optional (types.ts:7) và
   * ReaderView.tsx:56 dùng `currentChapter.content || <nội dung dự phòng>`.
   * Trong JavaScript, mảng rỗng là TRUTHY, nên `[] || fallback` cho ra `[]` —
   * ReaderView render đúng 0 đoạn văn và người dùng thấy nội dung vừa hiện lên
   * đã biến mất.
   *
   * Để field vắng mặt thì `undefined || fallback` chạy đúng như frontend thiết kế.
   */
  if (row.paragraphs && row.paragraphs.length > 0) {
    dto.content = row.paragraphs;
  }

  if (row.illustration_url) dto.illustrationUrl = row.illustration_url;
  if (row.word_count !== null) dto.wordCount = row.word_count;

  return dto;
}

export interface ProgressResult {
  novelId: string;
  lastReadChapterId: string;
  lastReadProgress: number;
  isRead: boolean;
}

/**
 * PUT /api/novels/:slug/chapters/:chapterSlug/progress
 *
 * Tái hiện đúng 3 việc mà App.handleReadChapter (App.tsx:57-83) đang làm cùng
 * lúc trên state local:
 *   1. đánh dấu chương đã đọc          (App.tsx:67-69)
 *   2. cập nhật lastReadChapterId      (App.tsx:72)
 *   3. cập nhật lastReadProgress       — không code nào ghi, nên `progress`
 *      optional; vắng mặt thì GIỮ NGUYÊN giá trị cũ.
 *
 * Chạy trong transaction vì ghi vào 2 bảng và phải nguyên tử: nếu
 * reading_progress lỗi mà chapter_reads đã ghi thì UI sẽ hiển thị chương đã đọc
 * nhưng vị trí đọc dở lại sai.
 */
export async function updateProgress(
  novelSlug: string,
  chapterSlug: string,
  progress: number | undefined,
  userId: string,
): Promise<ProgressResult> {
  return withTransaction(async (client) => {
    const chapterResult = await client.query<{ id: string; novel_id: string }>(
      `
      SELECT c.id, c.novel_id
      FROM chapters c
      JOIN novels n ON n.id = c.novel_id
      WHERE n.slug = $1 AND c.slug = $2
      `,
      [novelSlug, chapterSlug],
    );

    const chapter = chapterResult.rows[0];
    if (!chapter) {
      throw ApiError.notFound('Chapter not found');
    }

    // 1. Đánh dấu đã đọc. Đọc lại lần nữa không làm mới read_at — giữ lần đọc
    //    ĐẦU TIÊN để tính streak cho đúng.
    await client.query(
      `
      INSERT INTO chapter_reads (user_id, chapter_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, chapter_id) DO NOTHING
      `,
      [userId, chapter.id],
    );

    // 2 + 3. Upsert vị trí đọc. COALESCE($4, cũ) chính là chỗ giữ nguyên
    //        progress khi client không gửi lên.
    const progressResult = await client.query<{ progress: number }>(
      `
      INSERT INTO reading_progress (user_id, novel_id, last_chapter_id, progress, updated_at)
      VALUES ($1, $2, $3, COALESCE($4::smallint, 0), now())
      ON CONFLICT (user_id, novel_id) DO UPDATE
        SET last_chapter_id = EXCLUDED.last_chapter_id,
            progress        = COALESCE($4::smallint, reading_progress.progress),
            updated_at      = now()
      RETURNING progress
      `,
      [userId, chapter.novel_id, chapter.id, progress ?? null],
    );

    return {
      novelId: novelSlug,
      lastReadChapterId: chapterSlug,
      lastReadProgress: progressResult.rows[0]?.progress ?? 0,
      isRead: true,
    };
  });
}

/** Dùng cho test/debug: liệt kê slug các chương của một novel. */
export async function listChapterSlugs(novelId: string): Promise<string[]> {
  const rows = await query<{ slug: string }>(
    'SELECT slug FROM chapters WHERE novel_id = $1 ORDER BY number ASC',
    [novelId],
  );
  return rows.map((row) => row.slug);
}