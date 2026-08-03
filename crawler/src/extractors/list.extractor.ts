import { cleanText } from './text.extractor.js';

/**
 * Tách danh sách giá trị (genre, tag, tên khác, tác giả) từ chuỗi hoặc mảng.
 *
 * Hàm THUẦN.
 */

const DEFAULT_SEPARATORS = /[,;\n]|\s+\/\s+|\s+\|\s+/;

export interface ExtractListOptions {
  /** Mẫu tách. Mặc định: phẩy, chấm phẩy, xuống dòng, ' / ', ' | '. */
  separators?: RegExp;
  /** Bỏ trùng, so sánh không phân biệt hoa thường. Mặc định true. */
  dedupe?: boolean;
  /** Trần số phần tử — NovelUpdates có novel gắn hàng trăm tag. */
  limit?: number;
}

/**
 * `extractList('Action, Drama , Fantasy')`  ->  `['Action', 'Drama', 'Fantasy']`
 * `extractList('N/A')`                      ->  `[]`
 *
 * Dedupe giữ lại lần XUẤT HIỆN ĐẦU TIÊN, vì thứ tự có ý nghĩa hiển thị:
 * cột `novel_genres.position` quyết định genre nào được render làm badge
 * (HomeView lấy `genres[0]`).
 */
export function extractList(
  input: string | readonly string[] | null | undefined,
  options: ExtractListOptions = {},
): string[] {
  const { separators = DEFAULT_SEPARATORS, dedupe = true, limit } = options;

  if (input === null || input === undefined) return [];

  const rawItems = Array.isArray(input)
    ? [...input]
    : String(input).split(new RegExp(separators, 'g'));

  const cleaned: string[] = [];
  const seen = new Set<string>();

  for (const item of rawItems) {
    const value = cleanText(item);
    if (value === null) continue;

    if (dedupe) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }

    cleaned.push(value);
    if (limit !== undefined && cleaned.length >= limit) break;
  }

  return cleaned;
}

/**
 * Lấy phần tử đầu tiên của danh sách.
 *
 * Cần vì `novels.author` chỉ giữ MỘT tác giả trong khi nguồn có thể liệt kê
 * nhiều. Phần còn lại hiện bị bỏ — nếu sau này cần đủ, thêm bảng novel_authors
 * chứ đừng nhồi hết vào một cột varchar.
 */
export function firstOrNull(items: readonly string[]): string | null {
  return items[0] ?? null;
}
