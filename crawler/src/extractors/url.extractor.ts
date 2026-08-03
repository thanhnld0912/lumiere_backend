import { cleanText } from './text.extractor.js';

/**
 * Xử lý URL. Hàm THUẦN.
 *
 * Hai việc chính:
 *   1. đổi link tương đối thành tuyệt đối
 *   2. tách `external_id` — định danh của novel bên nguồn
 *
 * `external_id` là nửa khoá chính của `novel_sources`, nên nó phải ỔN ĐỊNH:
 * cùng một novel phải luôn cho ra cùng một id, bất kể URL có query string,
 * fragment hay dấu gạch chéo cuối hay không. Sai chỗ này sẽ tạo bản ghi trùng ở
 * mỗi lần crawl.
 */

/** Chỉ chấp nhận http/https — chặn `javascript:`, `data:` và các scheme lạ. */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

export function toAbsoluteUrl(
  href: string | null | undefined,
  baseUrl: string,
): string | null {
  const value = cleanText(href);
  if (value === null) return null;

  try {
    const url = new URL(value, baseUrl);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Bỏ query string và fragment, chuẩn hoá dấu gạch chéo cuối.
 *
 * Dùng làm khoá dedupe: `.../series/abc/?utm_source=x` và `.../series/abc`
 * phải cho cùng một chuỗi, nếu không hàng đợi của Crawlee sẽ crawl trùng và
 * database sẽ có hai bản ghi cho một novel.
 */
export function canonicaliseUrl(input: string | null | undefined): string | null {
  const value = cleanText(input);
  if (value === null) return null;

  try {
    const url = new URL(value);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;

    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    // Host không phân biệt hoa thường; 'WWW.Site.com' và 'www.site.com' là một.
    url.hostname = url.hostname.toLowerCase();

    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Tách đoạn định danh cuối cùng của đường dẫn.
 *
 *   extractPathSlug('https://www.novelupdates.com/series/my-novel/', '/series/')
 *     -> 'my-novel'
 *
 * `prefix` bắt buộc phải khớp: nếu không, một URL bất kỳ trên site cũng sẽ sinh
 * ra external_id trông có vẻ hợp lệ.
 */
export function extractPathSlug(
  input: string | null | undefined,
  requiredPrefix?: string,
): string | null {
  const canonical = canonicaliseUrl(input);
  if (canonical === null) return null;

  let pathname: string;
  try {
    pathname = new URL(canonical).pathname;
  } catch {
    return null;
  }

  if (requiredPrefix !== undefined && !pathname.startsWith(requiredPrefix)) {
    return null;
  }

  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  const last = segments[segments.length - 1];
  if (last === undefined || last.length === 0) return null;

  try {
    return decodeURIComponent(last);
  } catch {
    // Chuỗi %-encoding hỏng — dùng nguyên trạng còn hơn mất cả URL.
    return last;
  }
}

/** Hai URL có trỏ về cùng một tài nguyên không (sau khi chuẩn hoá). */
export function isSameResource(a: string | null, b: string | null): boolean {
  const left = canonicaliseUrl(a);
  const right = canonicaliseUrl(b);
  return left !== null && right !== null && left === right;
}

/** URL có thuộc host này không — dùng để không đi lạc sang tên miền khác khi crawl. */
export function isSameHost(url: string | null | undefined, baseUrl: string): boolean {
  const absolute = toAbsoluteUrl(url, baseUrl);
  if (absolute === null) return false;

  try {
    return new URL(absolute).hostname.toLowerCase() === new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
}
