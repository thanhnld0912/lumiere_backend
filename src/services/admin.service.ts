import { query, queryOne } from '../config/database';
import { toNumber } from '../utils/presenter';

/**
 * Số liệu vận hành cho bảng điều khiển admin.
 *
 * Mọi con số ở đây đều ĐƯỢC TÍNH TỪ DỮ LIỆU THẬT trong database — không có giá
 * trị nào hardcode. Đây là chỗ dễ sa vào cám dỗ "tạm để số đẹp", và một dashboard
 * có số bịa còn tệ hơn không có dashboard.
 */

export interface AdminOverview {
  readonly library: {
    readonly novels: number;
    readonly chapters: number;
    readonly genres: number;
    readonly tags: number;
    readonly translationGroups: number;
  };
  readonly users: {
    readonly total: number;
    readonly admins: number;
    readonly newLast30Days: number;
    readonly activeLast7Days: number;
  };
  readonly engagement: {
    readonly bookmarks: number;
    readonly chaptersRead: number;
    readonly novelsStarted: number;
  };
  readonly crawler: {
    readonly sources: readonly SourceStat[];
    readonly lastRun: LastRun | null;
    readonly chaptersAddedLast30Days: number;
    readonly novelsNeverCrawled: number;
  };
  readonly breakdown: {
    readonly byStatus: readonly LabelledCount[];
    readonly topGenres: readonly LabelledCount[];
    readonly dailyChapters: readonly DailyPoint[];
  };
  readonly topNovels: readonly TopNovel[];
}

export interface LabelledCount {
  readonly label: string;
  readonly count: number;
}

export interface DailyPoint {
  /** ISO date, VD '2026-08-05'. */
  readonly date: string;
  readonly count: number;
}

export interface SourceStat {
  readonly slug: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly novels: number;
  readonly lastCrawledAt: string | null;
}

export interface LastRun {
  readonly sourceSlug: string | null;
  readonly mode: string | null;
  readonly status: string;
  readonly progress: number;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

export interface TopNovel {
  readonly slug: string;
  readonly title: string;
  readonly coverUrl: string;
  readonly bookmarks: number;
  readonly rating: number;
  readonly ratingsCount: number;
  readonly totalChapters: number;
}

export async function getOverview(): Promise<AdminOverview> {
  /*
   * Gộp các phép đếm vào MỘT câu truy vấn thay vì tám câu riêng.
   *
   * Dashboard được mở lại liên tục; mỗi lần mở mà bắn tám round-trip tới Supabase
   * là lãng phí, nhất là khi từng phép đếm đều rẻ.
   */
  const totals = await queryOne<{
    novels: string;
    chapters: string;
    genres: string;
    tags: string;
    groups: string;
    users: string;
    admins: string;
    new_users: string;
    active_users: string;
    bookmarks: string;
    chapter_reads: string;
    novels_started: string;
    chapters_added_30d: string;
    never_crawled: string;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM novels)::text             AS novels,
      (SELECT COUNT(*) FROM chapters)::text           AS chapters,
      (SELECT COUNT(*) FROM genres)::text             AS genres,
      (SELECT COUNT(*) FROM tags)::text               AS tags,
      (SELECT COUNT(*) FROM translation_groups)::text AS groups,

      (SELECT COUNT(*) FROM users)::text                              AS users,
      (SELECT COUNT(*) FROM users WHERE role = 'admin')::text         AS admins,
      (SELECT COUNT(*) FROM users
        WHERE created_at >= now() - interval '30 days')::text         AS new_users,
      -- "Hoạt động" = có đọc chương nào trong 7 ngày. Đây là tín hiệu thật,
      -- khác với "đã đăng ký" vốn không nói lên điều gì.
      (SELECT COUNT(DISTINCT user_id) FROM chapter_reads
        WHERE read_at >= now() - interval '7 days')::text             AS active_users,

      (SELECT COUNT(*) FROM bookmarks)::text          AS bookmarks,
      (SELECT COUNT(*) FROM chapter_reads)::text      AS chapter_reads,
      (SELECT COUNT(*) FROM reading_progress
        WHERE last_chapter_id IS NOT NULL)::text      AS novels_started,

      (SELECT COALESCE(SUM(chapters_added_count), 0) FROM sync_events
        WHERE occurred_at >= now() - interval '30 days')::text        AS chapters_added_30d,
      -- Novel đã biết nhưng chưa lấy metadata lần nào -> việc tồn đọng của crawler.
      (SELECT COUNT(*) FROM novel_sources
        WHERE last_crawled_at IS NULL)::text                          AS never_crawled
  `);

  const [sources, lastRun, byStatus, topGenres, dailyChapters, topNovels] = await Promise.all([
    getSourceStats(),
    getLastRun(),
    getStatusBreakdown(),
    getTopGenres(),
    getDailyChapters(),
    getTopNovels(),
  ]);

  const n = (value: string | undefined): number => (value === undefined ? 0 : Number.parseInt(value, 10));

  return {
    library: {
      novels: n(totals?.novels),
      chapters: n(totals?.chapters),
      genres: n(totals?.genres),
      tags: n(totals?.tags),
      translationGroups: n(totals?.groups),
    },
    users: {
      total: n(totals?.users),
      admins: n(totals?.admins),
      newLast30Days: n(totals?.new_users),
      activeLast7Days: n(totals?.active_users),
    },
    engagement: {
      bookmarks: n(totals?.bookmarks),
      chaptersRead: n(totals?.chapter_reads),
      novelsStarted: n(totals?.novels_started),
    },
    crawler: {
      sources,
      lastRun,
      chaptersAddedLast30Days: n(totals?.chapters_added_30d),
      novelsNeverCrawled: n(totals?.never_crawled),
    },
    breakdown: { byStatus, topGenres, dailyChapters },
    topNovels,
  };
}

async function getSourceStats(): Promise<SourceStat[]> {
  const rows = await query<{
    slug: string;
    name: string;
    is_enabled: boolean;
    novels: string;
    last_crawled_at: Date | null;
  }>(`
    SELECT s.slug, s.name, s.is_enabled,
           COUNT(ns.novel_id)::text AS novels,
           MAX(ns.last_crawled_at)  AS last_crawled_at
    FROM sources s
    LEFT JOIN novel_sources ns ON ns.source_id = s.id
    GROUP BY s.id, s.slug, s.name, s.is_enabled
    ORDER BY COUNT(ns.novel_id) DESC
  `);

  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    enabled: row.is_enabled,
    novels: Number.parseInt(row.novels, 10),
    lastCrawledAt: row.last_crawled_at?.toISOString() ?? null,
  }));
}

async function getLastRun(): Promise<LastRun | null> {
  const row = await queryOne<{
    source_slug: string | null;
    mode: string | null;
    status: string;
    progress_percentage: number;
    started_at: Date;
    finished_at: Date | null;
  }>(`
    SELECT s.slug AS source_slug, sr.mode, sr.status,
           sr.progress_percentage, sr.started_at, sr.finished_at
    FROM sync_runs sr
    LEFT JOIN sources s ON s.id = sr.source_id
    ORDER BY sr.started_at DESC
    LIMIT 1
  `);

  if (!row) return null;
  return {
    sourceSlug: row.source_slug,
    mode: row.mode,
    status: row.status,
    progress: row.progress_percentage,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

async function getStatusBreakdown(): Promise<LabelledCount[]> {
  const rows = await query<{ status: string; count: string }>(`
    SELECT status::text, COUNT(*)::text AS count
    FROM novels GROUP BY status ORDER BY COUNT(*) DESC
  `);
  return rows.map((row) => ({ label: row.status, count: Number.parseInt(row.count, 10) }));
}

async function getTopGenres(): Promise<LabelledCount[]> {
  const rows = await query<{ name: string; count: string }>(`
    SELECT g.name, COUNT(*)::text AS count
    FROM novel_genres ng JOIN genres g ON g.id = ng.genre_id
    GROUP BY g.name ORDER BY COUNT(*) DESC LIMIT 8
  `);
  return rows.map((row) => ({ label: row.name, count: Number.parseInt(row.count, 10) }));
}

/**
 * Số chương mới mỗi ngày trong 14 ngày qua.
 *
 * `generate_series` để ngày KHÔNG có sự kiện vẫn xuất hiện với giá trị 0 — thiếu
 * nó thì biểu đồ sẽ nén các ngày lại và trông như hoạt động đều đặn hơn thực tế.
 */
async function getDailyChapters(): Promise<DailyPoint[]> {
  const rows = await query<{ day: Date; count: string }>(`
    SELECT d.day::date AS day,
           COALESCE(SUM(se.chapters_added_count), 0)::text AS count
    FROM generate_series(
           (now() AT TIME ZONE 'UTC')::date - interval '13 days',
           (now() AT TIME ZONE 'UTC')::date,
           interval '1 day'
         ) AS d(day)
    LEFT JOIN sync_events se
      ON (se.occurred_at AT TIME ZONE 'UTC')::date = d.day::date
    GROUP BY d.day
    ORDER BY d.day
  `);

  return rows.map((row) => ({
    date: row.day.toISOString().slice(0, 10),
    count: Number.parseInt(row.count, 10),
  }));
}

async function getTopNovels(): Promise<TopNovel[]> {
  const rows = await query<{
    slug: string;
    title: string;
    cover_url: string;
    bookmarks_count: number;
    rating: string;
    ratings_count: number;
    total_chapters: number;
  }>(`
    SELECT slug, title, cover_url, bookmarks_count, rating, ratings_count, total_chapters
    FROM novels
    ORDER BY bookmarks_count DESC, ratings_count DESC
    LIMIT 8
  `);

  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    coverUrl: row.cover_url,
    bookmarks: row.bookmarks_count,
    rating: toNumber(row.rating),
    ratingsCount: row.ratings_count,
    totalChapters: row.total_chapters,
  }));
}
