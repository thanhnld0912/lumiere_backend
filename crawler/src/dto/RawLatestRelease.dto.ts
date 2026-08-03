import type { SourceId } from '../core/types.js';

/**
 * Một dòng trong feed "latest releases" — nguồn của mode `latest`.
 *
 * Đây là chế độ RẺ NHẤT: một trang cho biết hàng trăm novel vừa có chương mới,
 * thay vì phải crawl lại từng novel. Vì vậy nó chạy 6 giờ/lần trong khi
 * `refresh` chỉ chạy hàng tháng.
 *
 * Vẫn là dữ liệu THÔ — mọi thứ là string.
 */
export interface RawLatestRelease {
  readonly sourceId: SourceId;

  /** Định danh novel bên nguồn, tách từ URL. */
  readonly externalId: string;
  readonly novelUrl: string;
  readonly novelTitle: string | null;

  /** VD 'v5c243', 'c.243.5', 'Extra Chapter 12'. */
  readonly chapterLabel: string | null;
  readonly chapterUrl: string | null;

  readonly translationGroup: string | null;

  /** VD '2 hours ago'. */
  readonly releasedAt: string | null;

  readonly crawledAt: Date;
}
