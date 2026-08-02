/**
 * PRESENTER LAYER — quyết định Q1.
 *
 * Database lưu SỐ THÔ (`total_views BIGINT`, `published_at TIMESTAMPTZ`, …) nên
 * vẫn sort/filter/aggregate được. Nhưng frontend đang render thẳng các giá trị
 * đó ra JSX, VD `{novel.totalViews}` (HomeView.tsx:232), và mong đợi chuỗi đã
 * format sẵn kiểu '2.8M Readers'.
 *
 * Module này là cầu nối: mỗi hàm dưới đây tái tạo CHÍNH XÁC định dạng đang có
 * trong src/data/mockData.ts, để frontend chạy được mà không phải sửa dòng nào.
 * Khi nào muốn chuyển sang raw API, chỉ cần bỏ lớp này đi.
 *
 * Mỗi hàm đều ghi rõ giá trị mock mà nó phải khớp.
 */

/**
 * Rút gọn số theo kiểu compact.
 *
 * Quy tắc suy ra từ mockData.ts: luôn 1 chữ số thập phân, TRỪ KHI phần định trị
 * đã có 3 chữ số (>= 100) thì bỏ thập phân — vì '980.0k' trông sai còn '980k'
 * mới đúng như mock.
 *
 *   12400   -> '12.4k'   (mockData.ts:12  ratingsCount)
 *   21000   -> '21.0k'   (mockData.ts:139 ratingsCount — giữ '.0')
 *   2400    -> '2.4k'    (mockData.ts:291 SyncStats.totalChapters)
 *   980000  -> '980k'    (mockData.ts:123 totalViews — không thập phân)
 *   850000  -> '850k'    (mockData.ts:247 totalViews)
 *   2800000 -> '2.8M'    (mockData.ts:25  totalViews)
 *   142     -> '142'
 */
export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);

  const scale = (divisor: number, suffix: string): string => {
    const mantissa = value / divisor;
    // >= 100 thì 3 chữ số là đủ chính xác, thêm '.0' chỉ gây nhiễu.
    const digits = Math.abs(mantissa) >= 100 ? 0 : 1;
    return `${mantissa.toFixed(digits)}${suffix}`;
  };

  if (abs >= 1_000_000_000) return scale(1_000_000_000, 'B');
  if (abs >= 1_000_000) return scale(1_000_000, 'M');
  if (abs >= 1_000) return scale(1_000, 'k');
  return String(value);
}

/**
 * Novel.totalViews — mockData.ts:25 '2.8M Readers', :123 '980k Readers'.
 */
export function formatTotalViews(totalViews: number): string {
  return `${formatCompactNumber(totalViews)} Readers`;
}

/**
 * Novel.ratingsCount — mockData.ts:12 '12.4k'.
 */
export function formatRatingsCount(ratingsCount: number): string {
  return formatCompactNumber(ratingsCount);
}

/**
 * Novel.recommendationsCount — mockData.ts:26 '+8k', :64 '+12k'.
 *
 * Khác formatCompactNumber: luôn có tiền tố '+' và KHÔNG có thập phân
 * (mock là '+8k' chứ không phải '+8.0k').
 */
export function formatRecommendationsCount(count: number): string {
  if (count >= 1_000_000) return `+${Math.round(count / 1_000_000)}M`;
  if (count >= 1_000) return `+${Math.round(count / 1_000)}k`;
  return `+${count}`;
}

/**
 * Chapter.date — mockData.ts:36 'Oct 12, 2023', :173 'Jul 01, 2024'.
 *
 * Dùng day: '2-digit' vì mock có 'Jul 01' (có số 0 ở đầu), và ép timeZone UTC
 * để ngày không bị lệch theo múi giờ của server (Vercel chạy UTC, máy local thì
 * không — nếu không ép sẽ ra kết quả khác nhau giữa hai môi trường).
 */
export function formatChapterDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * TimelineItem.timeAgo — mockData.ts:262 '2h ago', :273 'Yesterday', :284 '3d ago'.
 */
export function formatTimeAgo(date: Date, now: Date = new Date()): string {
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(months / 12)}y ago`;
}

/**
 * TimelineItem.month — types.ts:52 'August'.
 */
export function formatMonthName(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date);
}

/**
 * TimelineItem.year — types.ts:53 '2024' (kiểu string, không phải number).
 */
export function formatYear(date: Date): string {
  return String(date.getUTCFullYear());
}

/**
 * TimelineItem.translator — mockData.ts:260 'Translation by Abyss Scans'.
 */
export function formatTranslator(groupName: string | null): string {
  return groupName ? `Translation by ${groupName}` : 'Unknown translator';
}

/**
 * SyncStats.chaptersThisMonth — mockData.ts:292 '+142 discovered this month'.
 */
export function formatChaptersThisMonth(count: number): string {
  return `+${count} discovered this month`;
}

/**
 * SyncStats.nextSyncCountdown — mockData.ts:295 '4m 12s'.
 *
 * Nhận số giây còn lại. Về 0 hoặc âm (đã quá hạn sync) thì trả 'Syncing now'.
 */
export function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'Syncing now';

  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

/**
 * pg trả `numeric` và `bigint` về dưới dạng STRING (để không mất chính xác với
 * số lớn hơn Number.MAX_SAFE_INTEGER). Frontend thì cần number thật —
 * VD `novel.rating` được render và so sánh như số.
 *
 * Các giá trị của Lumiere đều nằm thừa trong khoảng an toàn của double nên
 * chuyển sang number là không mất mát.
 */
export function toNumber(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}