import type { NovelStatus } from '../../core/types.js';

/**
 * Bảng ánh xạ RIÊNG của ScribbleHub.
 *
 * Giá trị `status` của nguồn là chữ thường ('ongoing'), khác hẳn NovelUpdates
 * ('Completed'). Đây chính là lý do bảng mapping phải nằm ở `crawlers/<nguồn>/`
 * chứ không phải dùng chung.
 */
const STATUS_MAP: ReadonlyMap<string, NovelStatus> = new Map([
  ['ongoing', 'Ongoing'],
  ['completed', 'Completed'],
  ['complete', 'Completed'],
  ['hiatus', 'Hiatus'],
  ['on hiatus', 'Hiatus'],
  ['paused', 'Hiatus'],
  ['dropped', 'Dropped'],
  ['abandoned', 'Dropped'],
  ['cancelled', 'Dropped'],
  ['canceled', 'Dropped'],
  ['discontinued', 'Dropped'],
]);

export interface StatusMapping {
  readonly status: NovelStatus;
  /** true khi nguồn trả giá trị lạ — đáng ghi log để bổ sung bảng. */
  readonly unmapped: boolean;
}

/**
 * Ánh xạ `status` của ScribbleHub sang enum `novel_status`.
 *
 * Không map được thì trả `Unknown` — KHÔNG đoán 'Ongoing'. Cùng nguyên tắc đã
 * áp cho NovelUpdates: gán bừa trạng thái là bịa dữ liệu.
 */
export function mapStoryStatus(status: string | null | undefined): StatusMapping {
  if (typeof status !== 'string' || status.trim().length === 0) {
    return { status: 'Unknown', unmapped: false };
  }

  const normalised = status.toLowerCase().replace(/\s+/g, ' ').trim();
  const mapped = STATUS_MAP.get(normalised);

  return mapped !== undefined
    ? { status: mapped, unmapped: false }
    : { status: 'Unknown', unmapped: true };
}

/**
 * ScribbleHub KHÔNG có khái niệm "nhóm dịch" — tác giả đăng trực tiếp.
 *
 * Trả null thay vì nhét tên tác giả vào ô nhóm dịch. Bảng `translation_groups`
 * mang ngữ nghĩa "nhóm dịch tác phẩm nước ngoài"; dùng nó cho tác giả gốc sẽ làm
 * hỏng ý nghĩa dữ liệu và khiến nút Follow ở NovelDetailView hiển thị sai.
 */
export function mapTranslationGroup(): null {
  return null;
}

/**
 * `slug` của ScribbleHub có dạng '2441502-crimson-star' — đã kèm id ở đầu.
 *
 * Giữ nguyên: nó vừa thoả CHECK `^[a-z0-9]+(-[a-z0-9]+)*$` của DB, vừa đảm bảo
 * không đụng slug khi hai truyện trùng tên. Bỏ tiền tố id đi sẽ tạo ra va chạm.
 */
export function buildSeriesUrl(baseUrl: string, id: number, slug: string): string {
  /*
   * `slug` của API có dạng '2441502-crimson-star' — ĐÃ kèm id ở đầu. Ghép thẳng
   * vào `/series/{id}/{slug}/` sẽ cho ra URL lặp id hai lần:
   *   /series/2441502/2441502-crimson-star/   ← sai
   * Nên phải bỏ tiền tố id đi:
   *   /series/2441502/crimson-star/           ← đúng cấu trúc của ScribbleHub
   *
   * ⚠️ CHƯA KIỂM CHỨNG ĐƯỢC. ScribbleHub trả 403 cho mọi trang HTML nên không
   * thể mở URL này để đối chiếu. Suy luận dựa trên việc API lưu slug theo kiểu
   * '{id}-{title}', vốn là mẫu quen thuộc của WordPress.
   *
   * Rủi ro thấp: crawler KHÔNG BAO GIỜ gọi URL này (nó dùng API theo id).
   * Giá trị chỉ được lưu vào `novel_sources.source_url` để tham chiếu. Cách kiểm
   * chứng: mở thử một URL trong trình duyệt.
   */
  const withoutIdPrefix = slug.replace(new RegExp(`^${id}-`), '');
  return `${baseUrl}/series/${id}/${withoutIdPrefix}/`;
}

export function mapSlug(slug: string, fallbackId: number): string {
  const cleaned = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return cleaned.length > 0 ? cleaned : `story-${fallbackId}`;
}
