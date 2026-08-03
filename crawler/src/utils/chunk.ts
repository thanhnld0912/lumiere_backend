/**
 * Cắt mảng thành các lô kích thước cố định.
 *
 * Dùng khi ghi hàng nghìn novel: một câu `WHERE id = ANY($1)` với 5.000 phần tử
 * sẽ tạo query plan tệ và có thể chạm giới hạn tham số của Postgres.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) {
    throw new RangeError(`[chunk] size phải >= 1, nhận được: ${size}`);
  }

  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}
