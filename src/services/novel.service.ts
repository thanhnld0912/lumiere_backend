import { query, queryOne } from '../config/database';
import type { ChapterDto, ChapterRow, NovelDto, NovelRow } from '../models';
import type { NovelQueryInput } from '../schemas/novel.schema';
import { ApiError } from '../utils/ApiError';
import {
  formatChapterDate,
  formatRatingsCount,
  formatRecommendationsCount,
  formatTotalViews,
  toNumber,
} from '../utils/presenter';

/**
 * SELECT dùng chung cho novel.
 *
 * `$1` là userId (hoặc NULL khi chưa đăng nhập). Đây là cơ chế giải quyết phát
 * hiện F4: các field per-user được merge thẳng vào object Novel vì frontend
 * đọc chúng ở đó (novel.isBookmarked, novel.lastReadChapterId…).
 *
 * Khi $1 IS NULL, các field per-user trả NULL và serializer sẽ bỏ chúng khỏi
 * JSON — đúng như Novel type ở frontend khai báo chúng là optional.
 */
const NOVEL_SELECT = `
  SELECT
    n.id,
    n.slug,
    n.title,
    n.author,
    n.artist,
    n.cover_url,
    n.backdrop_url,
    n.rating,
    n.ratings_count,
    n.status,
    n.total_chapters,

    /*
     * Số chương THỰC SỰ có trong catalog, đếm từ bảng chapters.
     *
     * KHÁC với n.total_chapters — vốn là con số NGUỒN báo (VD 991). Crawler cố ý
     * chỉ nạp một phần mục lục, nên hai số này lệch nhau là chuyện bình thường,
     * không phải lỗi dữ liệu.
     *
     * Phải đếm bằng SQL chứ không lấy độ dài mảng chapters trả về: endpoint danh
     * sách chỉ kèm 1-2 chương rút gọn, nên đếm mảng sẽ ra số vô nghĩa.
     *
     * (Chú ý: comment này nằm TRONG template literal của TypeScript, nên không
     * được dùng dấu backtick để trích code — nó sẽ kết thúc chuỗi giữa chừng.)
     */
    (SELECT COUNT(*) FROM chapters ch WHERE ch.novel_id = n.id)::int AS available_chapters,
    n.synopsis,
    n.release_frequency,
    n.total_views,
    n.recommendations_count,

    tg.slug       AS group_slug,
    tg.name       AS group_name,
    tg.quality    AS group_quality,
    tg.avatar_url AS group_avatar_url,
    tg.site_url   AS group_site_url,
    CASE
      WHEN $1::uuid IS NULL OR tg.id IS NULL THEN NULL
      ELSE EXISTS (
        SELECT 1 FROM group_follows gf
        WHERE gf.user_id = $1::uuid AND gf.group_id = tg.id
      )
    END AS group_is_followed,

    -- Thứ tự genre phải giữ nguyên: HomeView.tsx:219 render genres[0]
    COALESCE(gen.names, ARRAY[]::text[]) AS genres,
    COALESCE(rec.avatars, ARRAY[]::text[]) AS recommendation_avatars,

    CASE
      WHEN $1::uuid IS NULL THEN NULL
      ELSE EXISTS (
        SELECT 1 FROM bookmarks b
        WHERE b.user_id = $1::uuid AND b.novel_id = n.id
      )
    END AS is_bookmarked,

    lrc.slug    AS last_read_chapter_slug,
    rp.progress AS last_read_progress

  FROM novels n
  LEFT JOIN translation_groups tg ON tg.id = n.translation_group_id

  LEFT JOIN LATERAL (
    SELECT array_agg(g.name ORDER BY ng.position, g.name) AS names
    FROM novel_genres ng
    JOIN genres g ON g.id = ng.genre_id
    WHERE ng.novel_id = n.id
  ) gen ON TRUE

  -- NovelDetailView.tsx:327 render tối đa vài avatar; mock có đúng 3.
  LEFT JOIN LATERAL (
    SELECT array_agg(a.avatar_url) AS avatars
    FROM (
      SELECT u.avatar_url
      FROM novel_recommendations nr
      JOIN users u ON u.id = nr.user_id
      WHERE nr.novel_id = n.id AND u.avatar_url IS NOT NULL
      ORDER BY nr.created_at DESC
      LIMIT 3
    ) a
  ) rec ON TRUE

  LEFT JOIN reading_progress rp ON rp.novel_id = n.id AND rp.user_id = $1::uuid
  LEFT JOIN chapters lrc        ON lrc.id = rp.last_chapter_id
`;

/** Chuyển NovelRow -> NovelDto, áp presenter layer (Q1). */
function toNovelDto(row: NovelRow, chapters: ChapterDto[]): NovelDto {
  const dto: NovelDto = {
    id: row.slug, // F1: API trả slug làm id
    title: row.title,
    coverUrl: row.cover_url,
    author: row.author,
    rating: toNumber(row.rating),
    ratingsCount: formatRatingsCount(row.ratings_count),
    status: row.status,
    totalChapters: row.total_chapters,
    availableChapters: row.available_chapters,
    /*
     * Kẹp về >= 0: nếu nguồn hạ `total_chapters` xuống thấp hơn số chương ta đã
     * lưu, con số âm sẽ hiện ra UI thành "-3 chương chưa đồng bộ".
     */
    missingChapters: Math.max(0, row.total_chapters - row.available_chapters),
    genres: row.genres ?? [],
    synopsis: row.synopsis,
    chapters,
    translationGroup: {
      slug: row.group_slug ?? '',
      name: row.group_name ?? '',
      quality: row.group_quality ?? '',
      avatarUrl: row.group_avatar_url ?? '',
      siteUrl: row.group_site_url ?? '',
    },
    releaseFrequency: row.release_frequency ?? '',
    totalViews: formatTotalViews(toNumber(row.total_views)),
    recommendationsCount: formatRecommendationsCount(row.recommendations_count),
    recommendationsAvatars: row.recommendation_avatars ?? [],
  };

  // Các field optional chỉ được thêm vào khi thực sự có giá trị, để JSON khớp
  // với khai báo optional trong frontend types.ts thay vì đầy rẫy null.
  if (row.artist) dto.artist = row.artist;
  if (row.backdrop_url) dto.backdropUrl = row.backdrop_url;
  if (row.group_is_followed !== null) dto.translationGroup.isFollowed = row.group_is_followed;
  if (row.is_bookmarked !== null) dto.isBookmarked = row.is_bookmarked;
  if (row.last_read_chapter_slug) dto.lastReadChapterId = row.last_read_chapter_slug;
  if (row.last_read_progress !== null) dto.lastReadProgress = row.last_read_progress;

  return dto;
}

/** Chuyển ChapterRow -> ChapterDto (không kèm content). */
function toChapterDto(row: ChapterRow): ChapterDto {
  const dto: ChapterDto = {
    id: row.slug, // F1/F2: slug, unique trong phạm vi novel
    number: row.number,
    title: row.title,
    date: formatChapterDate(row.published_at),
    isRead: row.is_read ?? false,
  };
  if (row.illustration_url) dto.illustrationUrl = row.illustration_url;
  if (row.word_count !== null) dto.wordCount = row.word_count;
  return dto;
}

interface ChapterRowWithNovel extends ChapterRow {
  novel_id: string;
}

/**
 * Lấy chapter RÚT GỌN cho endpoint list.
 *
 * Không trả toàn bộ chương: một novel có tới 243 chương (mockData.ts:14) và
 * list có thể chứa hàng chục novel. Frontend ở màn hình list chỉ cần đúng hai
 * chương:
 *   - chương đầu tiên  -> App.tsx:60 `novel.chapters[0]?.id`
 *   - chương đọc dở    -> HomeView.tsx:84, ProfileView.tsx:78
 */
async function fetchListChapters(
  novelIds: string[],
  userId: string | null,
): Promise<Map<string, ChapterDto[]>> {
  if (novelIds.length === 0) return new Map();

  const rows = await query<ChapterRowWithNovel>(
    `
    SELECT
      c.novel_id, c.id, c.slug, c.number, c.title,
      c.published_at, c.illustration_url, c.word_count,
      CASE
        WHEN $2::uuid IS NULL THEN NULL
        ELSE EXISTS (
          SELECT 1 FROM chapter_reads cr
          WHERE cr.user_id = $2::uuid AND cr.chapter_id = c.id
        )
      END AS is_read
    FROM chapters c
    WHERE c.novel_id = ANY($1::uuid[])
      AND (
        c.number = (SELECT MIN(c2.number) FROM chapters c2 WHERE c2.novel_id = c.novel_id)
        OR c.id IN (
          SELECT rp.last_chapter_id FROM reading_progress rp
          WHERE rp.user_id = $2::uuid AND rp.novel_id = c.novel_id
        )
      )
    ORDER BY c.novel_id, c.sort_index ASC NULLS LAST, c.number ASC
    `,
    [novelIds, userId],
  );

  const grouped = new Map<string, ChapterDto[]>();
  for (const row of rows) {
    const list = grouped.get(row.novel_id) ?? [];
    list.push(toChapterDto(row));
    grouped.set(row.novel_id, list);
  }
  return grouped;
}

export interface NovelListResult {
  items: NovelDto[];
  total: number;
}

/**
 * GET /api/novels
 *
 * Tiêu thụ bởi HomeView (hero/continue/trending), DiscoverView và SearchModal.
 * Frontend hiện lọc phía client nên mặc định trả toàn bộ, sort created_at DESC
 * (quyết định Q2) — HomeView.tsx:24 lấy `novels.slice(4, 9)` làm Trending nên
 * thứ tự là một hợp đồng ngầm phải giữ ổn định.
 */
export async function listNovels(
  filters: NovelQueryInput,
  userId: string | null,
): Promise<NovelListResult> {
  /**
   * Giá trị của các filter — KHÔNG bao gồm userId.
   *
   * Câu đếm và câu chính là HAI prepared statement riêng biệt, và Postgres đánh
   * số tham số theo từng statement. Câu đếm không tham chiếu userId, nên filter
   * của nó phải bắt đầu từ $1; câu chính có userId ở $1 nên filter bắt đầu từ $2.
   *
   * Dùng chung một mảng params cho cả hai chính là nguyên nhân lỗi
   * "bind message supplies 1 parameters, but prepared statement "" requires 0":
   * khi không có filter nào, câu đếm không còn placeholder nào nhưng vẫn nhận
   * được 1 tham số (userId).
   */
  const filterValues: unknown[] = [];

  /**
   * Mỗi builder tự nhận vị trí $N của mình, nhờ vậy cùng một điều kiện sinh ra
   * được SQL đúng cho cả hai statement mà không phải viết hai lần.
   */
  const conditionBuilders: Array<(position: number) => string> = [];

  if (filters.q) {
    // SearchModal.tsx:22-27 tìm theo title HOẶC author HOẶC genre.
    filterValues.push(`%${filters.q}%`);
    conditionBuilders.push(
      (p) => `(
      n.title ILIKE $${p}
      OR n.author ILIKE $${p}
      OR EXISTS (
        SELECT 1 FROM novel_genres ng2
        JOIN genres g2 ON g2.id = ng2.genre_id
        WHERE ng2.novel_id = n.id AND g2.name ILIKE $${p}
      )
    )`,
    );
  }

  if (filters.genre) {
    filterValues.push(filters.genre);
    conditionBuilders.push(
      (p) => `EXISTS (
      SELECT 1 FROM novel_genres ng3
      JOIN genres g3 ON g3.id = ng3.genre_id
      WHERE ng3.novel_id = n.id AND g3.name = $${p}
    )`,
    );
  }

  if (filters.status) {
    filterValues.push(filters.status);
    conditionBuilders.push((p) => `n.status = $${p}::novel_status`);
  }

  /** @param offset số tham số đứng TRƯỚC nhóm filter trong statement đó. */
  const buildWhere = (offset: number): string =>
    conditionBuilders.length === 0
      ? ''
      : `WHERE ${conditionBuilders.map((build, i) => build(offset + i + 1)).join(' AND ')}`;

  // ── Câu đếm: không dùng userId -> filter đánh số từ $1, params chỉ là filterValues.
  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM novels n ${buildWhere(0)}`,
    filterValues,
  );
  const total = countRow ? Number.parseInt(countRow.total, 10) : 0;

  // ── Câu chính: NOVEL_SELECT dùng $1 = userId -> filter đánh số từ $2.
  const params: unknown[] = [userId, ...filterValues];
  let sql = `${NOVEL_SELECT} ${buildWhere(1)} ORDER BY n.created_at DESC, n.id`;

  if (filters.limit !== undefined) {
    params.push(filters.limit);
    sql += ` LIMIT $${params.length}`;
  }
  if (filters.offset !== undefined) {
    params.push(filters.offset);
    sql += ` OFFSET $${params.length}`;
  }

  const rows = await query<NovelRow>(sql, params);
  const chaptersByNovel = await fetchListChapters(
    rows.map((row) => row.id),
    userId,
  );

  return {
    items: rows.map((row) => toNovelDto(row, chaptersByNovel.get(row.id) ?? [])),
    total,
  };
}

/**
 * GET /api/novels/:slug
 *
 * Khác list ở chỗ trả ĐẦY ĐỦ chapters, sort theo `sort_index` — bắt buộc, vì
 * ReaderView.tsx:28-31 tính chương trước/sau bằng index trong mảng.
 *
 * Dùng `sort_index` chứ KHÔNG dùng `number`: khi có volume/extra/part thì
 * `number` không còn là thứ tự đọc (sắp theo number sẽ đẩy 'Extra Chapter 12'
 * lên trước 'Chapter 243'). Xem migration 003_chapter_model.sql.
 * `NULLS LAST` + fallback `number` để dữ liệu chưa backfill vẫn có thứ tự hợp lý.
 *
 * Vẫn không kèm `content` (chỉ endpoint chapter mới trả).
 */
export async function getNovelBySlug(slug: string, userId: string | null): Promise<NovelDto> {
  const row = await queryOne<NovelRow>(`${NOVEL_SELECT} WHERE n.slug = $2`, [userId, slug]);

  if (!row) {
    throw ApiError.notFound('Novel not found');
  }

  const chapterRows = await query<ChapterRow>(
    `
    SELECT
      c.id, c.slug, c.number, c.title, c.published_at,
      c.illustration_url, c.word_count,
      CASE
        WHEN $2::uuid IS NULL THEN NULL
        ELSE EXISTS (
          SELECT 1 FROM chapter_reads cr
          WHERE cr.user_id = $2::uuid AND cr.chapter_id = c.id
        )
      END AS is_read
    FROM chapters c
    WHERE c.novel_id = $1
    ORDER BY c.sort_index ASC NULLS LAST, c.number ASC
    `,
    [row.id, userId],
  );

  return toNovelDto(row, chapterRows.map(toChapterDto));
}

/**
 * Lấy novel theo một tập slug, GIỮ NGUYÊN thứ tự slug được truyền vào.
 *
 * Dùng cho /library/bookmarks và /library/history: thứ tự ở đó do bảng
 * bookmarks/reading_progress quyết định (mới nhất trước), không phải
 * novels.created_at. `array_position` sắp xếp lại ngay trong SQL nên không cần
 * kéo toàn bộ novel về rồi lọc ở Node.
 */
export async function listNovelsBySlugs(
  slugs: string[],
  userId: string | null,
): Promise<NovelDto[]> {
  if (slugs.length === 0) return [];

  const rows = await query<NovelRow>(
    `${NOVEL_SELECT}
     WHERE n.slug = ANY($2::text[])
     ORDER BY array_position($2::text[], n.slug)`,
    [userId, slugs],
  );

  const chaptersByNovel = await fetchListChapters(
    rows.map((row) => row.id),
    userId,
  );

  return rows.map((row) => toNovelDto(row, chaptersByNovel.get(row.id) ?? []));
}

/** Tra uuid nội bộ của novel từ slug. Ném 404 nếu không có. */
export async function resolveNovelId(slug: string): Promise<string> {
  const row = await queryOne<{ id: string }>('SELECT id FROM novels WHERE slug = $1', [slug]);
  if (!row) {
    throw ApiError.notFound('Novel not found');
  }
  return row.id;
}

export { toNovelDto, toChapterDto };