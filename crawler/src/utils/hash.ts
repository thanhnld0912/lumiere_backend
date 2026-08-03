import { createHash } from 'node:crypto';

/**
 * Băm nội dung để phát hiện thay đổi (`novel_sources.content_hash`).
 *
 * Mục đích: đa số lần refresh cho ra dữ liệu Y HỆT lần trước. So hash trước khi
 * ghi giúp tránh UPDATE vài nghìn dòng mỗi lần chạy — thứ sẽ đẩy `updated_at`
 * nhảy loạn và làm `sync_events` đầy rác, khiến Timeline của người dùng vô nghĩa.
 */

/**
 * JSON.stringify KHÔNG dùng được ở đây: nó giữ nguyên thứ tự khoá theo thứ tự
 * chèn, nên hai object cùng nội dung nhưng khác thứ tự field sẽ ra hash khác
 * nhau — crawler sẽ báo "đã thay đổi" ở mọi lần chạy.
 *
 * Hàm này sắp xếp khoá đệ quy để hash chỉ phụ thuộc vào NỘI DUNG.
 */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null) return 'null';

  // Date phải xử lý riêng: typeof Date === 'object' nên nếu không bắt ở đây,
  // nó sẽ rơi vào nhánh object và cho ra '{}' — mọi Date đều băm giống nhau.
  if (value instanceof Date) return JSON.stringify(value.toISOString());

  // BigInt không JSON.stringify được (ném TypeError). VD: sort_index.
  if (typeof value === 'bigint') return JSON.stringify(value.toString());

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys
      // Bỏ qua field undefined để "vắng mặt" và "= undefined" cho cùng hash.
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

/** sha256 hex 64 ký tự — khớp kiểu cột `char(64)` của novel_sources.content_hash. */
export function hashContent(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

export { stableStringify };
