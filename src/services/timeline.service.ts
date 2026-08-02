import { queryOne, query } from '../config/database';
import type { SyncStatsDto, TimelineEventRow, TimelineItemDto } from '../models';
import {
  formatChaptersThisMonth,
  formatCompactNumber,
  formatCountdown,
  formatMonthName,
  formatTimeAgo,
  formatTranslator,
  formatYear,
} from '../utils/presenter';

/** Bao nhiêu sự kiện trả về cho timeline. Mock có 3; lấy dư để UI có gì cuộn. */
const TIMELINE_LIMIT = 60;

/**
 * GET /api/timeline
 * Nguồn: TimelineView.tsx:118-153, kiểu TimelineItem (types.ts:44-54).
 *
 * `now` được tính MỘT LẦN cho cả danh sách để mọi giá trị timeAgo cùng tham
 * chiếu một mốc thời gian — nếu gọi new Date() trong vòng lặp, hai item cách
 * nhau đúng một giây có thể ra kết quả không nhất quán.
 */
export async function getTimeline(): Promise<TimelineItemDto[]> {
  const rows = await query<TimelineEventRow>(
    `
    SELECT
      se.id,
      n.slug       AS novel_slug,
      n.title      AS novel_title,
      n.cover_url  AS novel_cover,
      tg.name      AS group_name,
      se.chapters_added_count,
      se.occurred_at
    FROM sync_events se
    JOIN novels n ON n.id = se.novel_id
    LEFT JOIN translation_groups tg ON tg.id = se.translation_group_id
    ORDER BY se.occurred_at DESC
    LIMIT $1
    `,
    [TIMELINE_LIMIT],
  );

  const now = new Date();

  return rows.map((row) => ({
    id: row.id,
    novelId: row.novel_slug,
    novelTitle: row.novel_title,
    novelCover: row.novel_cover,
    translator: formatTranslator(row.group_name),
    chaptersAddedCount: row.chapters_added_count,
    timeAgo: formatTimeAgo(row.occurred_at, now),
    month: formatMonthName(row.occurred_at),
    year: formatYear(row.occurred_at),
  }));
}

interface SyncStatsRow {
  total_chapters: string;
  chapters_this_month: string;
  new_series_count: string;
  new_groups_count: string;
  next_run_seconds: string | null;
  progress_percentage: number | null;
}

/**
 * GET /api/timeline/stats
 * Nguồn: SyncStats (types.ts:56-63), render tại TimelineView.tsx:52-92 và :210-232.
 *
 * Toàn bộ số liệu đều derive được từ dữ liệu thật — không có hằng số nào bịa ra:
 *   totalChapters      = tổng số chương trong kho
 *   chaptersThisMonth  = tổng chapters_added_count của sync_events tháng này
 *   newSeriesCount     = số novel tạo trong tháng này
 *   newGroupsCount     = số nhóm dịch tạo trong tháng này
 *   nextSync*          = lần sync_runs đang chạy gần nhất
 */
export async function getSyncStats(): Promise<SyncStatsDto> {
  const row = await queryOne<SyncStatsRow>(`
    SELECT
      (SELECT COUNT(*)::text FROM chapters) AS total_chapters,

      (SELECT COALESCE(SUM(chapters_added_count), 0)::text
       FROM sync_events
       WHERE occurred_at >= date_trunc('month', now())) AS chapters_this_month,

      (SELECT COUNT(*)::text FROM novels
       WHERE created_at >= date_trunc('month', now())) AS new_series_count,

      (SELECT COUNT(*)::text FROM translation_groups
       WHERE created_at >= date_trunc('month', now())) AS new_groups_count,

      -- Scalar subquery: chưa có lần sync nào thì trả NULL thay vì mất cả dòng.
      (SELECT EXTRACT(EPOCH FROM (next_run_at - now()))::text
       FROM sync_runs ORDER BY started_at DESC LIMIT 1) AS next_run_seconds,

      (SELECT progress_percentage
       FROM sync_runs ORDER BY started_at DESC LIMIT 1) AS progress_percentage
  `);

  const totalChapters = row ? Number.parseInt(row.total_chapters, 10) : 0;
  const chaptersThisMonth = row ? Number.parseInt(row.chapters_this_month, 10) : 0;
  const nextRunSeconds = row?.next_run_seconds ? Number.parseFloat(row.next_run_seconds) : 0;

  return {
    totalChapters: formatCompactNumber(totalChapters),
    chaptersThisMonth: formatChaptersThisMonth(chaptersThisMonth),
    newSeriesCount: row ? Number.parseInt(row.new_series_count, 10) : 0,
    newGroupsCount: row ? Number.parseInt(row.new_groups_count, 10) : 0,
    nextSyncCountdown: formatCountdown(nextRunSeconds),
    nextSyncPercentage: row?.progress_percentage ?? 0,
  };
}