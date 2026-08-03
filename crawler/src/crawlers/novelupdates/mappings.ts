import type { NovelStatus } from '../../core/types.js';

/**
 * Bảng ánh xạ RIÊNG của NovelUpdates: vựng từ của nguồn -> vựng từ của Lumiere.
 *
 * File này CỐ Ý nằm ở `crawlers/<nguồn>/` chứ không phải ở `extractors/`:
 * extractor chỉ tách CẤU TRÚC ('243 Chapters (Completed)' -> token 'Completed'),
 * còn việc token đó nghĩa là gì thì mỗi nguồn một khác. Tách như vậy thì khi
 * NovelUpdates đổi cách viết trạng thái, chỉ file này phải sửa.
 *
 * Nguồn thứ hai (RoyalRoad, ScribbleHub…) sẽ có bảng mapping của riêng nó.
 */

/** Khoá đã được chuẩn hoá: viết thường, gộp khoảng trắng. */
const STATUS_MAP: ReadonlyMap<string, NovelStatus> = new Map([
  ['completed', 'Completed'],
  ['complete', 'Completed'],
  ['completed (up to)', 'Completed'],

  ['ongoing', 'Ongoing'],
  ['on going', 'Ongoing'],
  ['on-going', 'Ongoing'],
  ['active', 'Ongoing'],

  ['hiatus', 'Hiatus'],
  ['on hiatus', 'Hiatus'],
  ['paused', 'Hiatus'],
  ['stalled', 'Hiatus'],

  ['dropped', 'Dropped'],
  ['discontinued', 'Dropped'],
  ['cancelled', 'Dropped'],
  ['canceled', 'Dropped'],
  ['abandoned', 'Dropped'],

  ['unknown', 'Unknown'],
]);

/** Thứ tự quan trọng: token dài kiểm tra trước để 'on hiatus' không khớp nhầm 'ongoing'. */
const SUBSTRING_TOKENS: readonly (readonly [string, NovelStatus])[] = [
  ['on hiatus', 'Hiatus'],
  ['discontinued', 'Dropped'],
  ['abandoned', 'Dropped'],
  ['cancelled', 'Dropped'],
  ['canceled', 'Dropped'],
  ['completed', 'Completed'],
  ['complete', 'Completed'],
  ['dropped', 'Dropped'],
  ['hiatus', 'Hiatus'],
  ['ongoing', 'Ongoing'],
  ['stalled', 'Hiatus'],
];

export interface StatusMapping {
  readonly status: NovelStatus;
  /**
   * true khi nguồn có nói gì đó nhưng ta không hiểu -> đáng ghi log để bổ sung
   * bảng mapping. Phân biệt với trường hợp nguồn im lặng hoàn toàn.
   */
  readonly unmapped: boolean;
}

/**
 * Ánh xạ token trạng thái của NovelUpdates sang enum `novel_status`.
 *
 * Trả `Unknown` khi không map được — KHÔNG đoán 'Ongoing'.
 *
 * Đây chính là lý do quyết định D2 phải thêm giá trị 'Unknown': fixture
 * `the-villains-wishes-...` có trường trạng thái chỉ ghi '269 Chapters', không
 * hề có token nào. Gán bừa 'Ongoing' cho novel đó là bịa dữ liệu.
 */
export function mapNovelStatus(statusText: string | null | undefined): StatusMapping {
  if (statusText === null || statusText === undefined) {
    // Nguồn không nói gì -> Unknown, và đây KHÔNG phải lỗi mapping.
    return { status: 'Unknown', unmapped: false };
  }

  const normalised = statusText.toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalised.length === 0) {
    return { status: 'Unknown', unmapped: false };
  }

  const exact = STATUS_MAP.get(normalised);
  if (exact !== undefined) {
    return { status: exact, unmapped: false };
  }

  for (const [token, status] of SUBSTRING_TOKENS) {
    if (normalised.includes(token)) {
      return { status, unmapped: false };
    }
  }

  /*
   * Chuỗi thuần số/đơn vị như '269 Chapters' nghĩa là nguồn KHÔNG khai báo trạng
   * thái — không phải token lạ. Không đánh dấu unmapped để log khỏi bị nhiễu.
   */
  const looksLikeCountOnly = /^[\d\s,./]*(chapters?|volumes?|chs?|vols?)?[\d\s,./]*$/i.test(
    normalised,
  );

  return { status: 'Unknown', unmapped: !looksLikeCountOnly };
}

/**
 * Chuẩn hoá tên ngôn ngữ.
 *
 * Theo quyết định D3(b): lưu đúng ngôn ngữ GỐC mà nguồn cho, không lọc gì.
 * Trường "Language" của NovelUpdates là ngôn ngữ gốc (Chinese/Korean/Japanese),
 * KHÔNG phải ngôn ngữ bản dịch.
 */
export function mapLanguage(language: string | null): string | null {
  if (language === null) return null;
  const trimmed = language.trim();
  return trimmed.length > 0 ? trimmed : null;
}
