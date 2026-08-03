/**
 * Bóc số ra khỏi chuỗi. Hàm THUẦN.
 *
 * Tách riêng khỏi rating/status extractor vì cùng một logic "1,234" -> 1234
 * được dùng ở nhiều nơi, và đây là chỗ dễ sai lặng lẽ nhất: `parseInt('1,234')`
 * trả về `1` chứ không phải lỗi.
 */

/** Dấu phân cách hàng nghìn hay gặp: phẩy, dấu cách, nháy đơn, dấu cách hẹp. */
const THOUSAND_SEPARATORS = /[,  '’]/g;

/**
 * `parseIntSafe('1,234 votes')`  ->  1234
 * `parseIntSafe('abc')`          ->  null
 * `parseIntSafe('')`             ->  null
 *
 * Trả null thay vì NaN: null buộc người gọi phải xử lý, NaN thì lặng lẽ lan
 * xuống database thành giá trị rác.
 */
export function parseIntSafe(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;

  const match = input.replace(THOUSAND_SEPARATORS, '').match(/-?\d+/);
  if (!match) return null;

  const value = Number.parseInt(match[0], 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * `parseFloatSafe('4.2 / 5')`  ->  4.2
 * `parseFloatSafe('4,2')`      ->  4.2   (dấu phẩy thập phân kiểu châu Âu)
 */
export function parseFloatSafe(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;

  let text = input.replace(/[  '’]/g, '');

  /*
   * Phân biệt '1,234' (nghìn) với '4,2' (thập phân châu Âu): nếu sau dấu phẩy
   * có ĐÚNG 1-2 chữ số và không còn dấu chấm nào, coi là thập phân.
   */
  if (/^\D*-?\d+,\d{1,2}(?!\d)/.test(text) && !text.includes('.')) {
    text = text.replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }

  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Rút gọn dạng compact: '2.8M' -> 2800000, '12.4k' -> 12400.
 *
 * Chưa dùng cho NovelUpdates (site này hiện số đầy đủ), nhưng nguồn khác thì có,
 * và extractor là tầng dùng chung cho mọi nguồn.
 */
export function parseCompactNumber(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;

  const match = input.replace(THOUSAND_SEPARATORS, '').match(/(-?\d+(?:\.\d+)?)\s*([kKmMbB])?/);
  if (!match?.[1]) return null;

  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) return null;

  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === 'b' ? 1e9 : suffix === 'm' ? 1e6 : suffix === 'k' ? 1e3 : 1;

  return Math.round(base * multiplier);
}

/** Kẹp giá trị vào khoảng, giữ null. Dùng để không vi phạm CHECK constraint. */
export function clamp(value: number | null, min: number, max: number): number | null {
  if (value === null) return null;
  return Math.min(Math.max(value, min), max);
}
