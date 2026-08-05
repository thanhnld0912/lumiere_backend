import type { CrawlMode } from '../core/types.js';

/**
 * Nhịp chạy của từng mode — khai báo dưới dạng DỮ LIỆU, không phải cron.
 *
 * ⚠️ File này KHÔNG lập lịch gì cả. Cron nằm ở GitHub Actions và chỉ làm một
 * việc: gọi CLI. Ở đây chỉ mô tả "mode này dự kiến chạy lại sau bao lâu", dùng
 * để ghi `sync_runs.next_run_at` — nguồn cho `SyncStats.nextSyncCountdown` mà
 * TimelineView hiển thị.
 *
 * Tách như vậy thì đổi lịch chỉ cần sửa file YAML, và cùng lắm là con số ở đây
 * cho khớp; không phải đụng vào logic crawl.
 */
export interface ModeSchedule {
  readonly mode: CrawlMode;
  /** Khoảng cách dự kiến giữa hai lần chạy, tính bằng giờ. */
  readonly intervalHours: number;
  /** Trần số item mặc định cho một lần chạy. */
  readonly defaultMaxItems: number;
  readonly description: string;
}

export const SCHEDULES: Readonly<Record<CrawlMode, ModeSchedule>> = {
  latest: {
    mode: 'latest',
    intervalHours: 6,
    defaultMaxItems: 100,
    description: 'Đọc feed chương mới. Rẻ nhất — một request cho hàng chục novel.',
  },
  refresh: {
    mode: 'refresh',
    intervalHours: 24 * 30,
    defaultMaxItems: 1000,
    description: 'Crawl lại metadata novel cũ nhất. Đắt — chạy hàng tháng.',
  },
  discover: {
    mode: 'discover',
    // 0 = không có lịch tự động, chỉ chạy tay qua workflow_dispatch.
    intervalHours: 0,
    defaultMaxItems: 200,
    description: 'Duyệt danh mục tìm novel mới. Chạy tay khi cần mở rộng thư viện.',
  },
};

/**
 * Thời điểm chạy lại dự kiến, hoặc null nếu mode đó không có lịch.
 *
 * Ghi vào `sync_runs.next_run_at`. Không ghi thì đồng hồ đếm ngược trên
 * TimelineView sẽ đứng yên mãi mãi.
 */
export function computeNextRunAt(mode: CrawlMode, from: Date): Date | null {
  const schedule = SCHEDULES[mode];
  if (schedule.intervalHours <= 0) return null;
  return new Date(from.getTime() + schedule.intervalHours * 3_600_000);
}
