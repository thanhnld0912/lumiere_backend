/**
 * Tính `chapters.sort_index` — thứ tự đọc tường minh của một chương.
 *
 * ⚠️ CÔNG THỨC NÀY PHẢI KHỚP TUYỆT ĐỐI với hàm `compute_chapter_sort_index()`
 * trong database/migrations/003_chapter_model.sql. Hai nơi lệch nhau thì thứ tự
 * chương sẽ đổi tuỳ theo dòng đó do crawler ghi hay do trigger điền — một loại
 * bug cực kỳ khó truy.
 *
 *     sort_index = volume × 1e12 + number × 1e6 + part × 1e3 + (is_extra ? 1 : 0)
 *
 * Vì sao cần: `number` một mình KHÔNG phải thứ tự đọc khi có volume/extra/part.
 * Sắp theo number sẽ đẩy 'Extra Chapter 12' lên TRƯỚC 'Chapter 243'.
 * Extra xếp ngay SAU chương thường cùng số nhờ +1 ở bậc thấp nhất.
 */

/**
 * ⚠️ BẮT BUỘC dùng BigInt, không dùng `number`.
 *
 * Ràng buộc DB cho phép volume tới 9999, nên giá trị lớn nhất là
 * 9999 × 1e12 ≈ 9.999e15 — VƯỢT Number.MAX_SAFE_INTEGER (≈ 9.007e15).
 * Dùng `number` sẽ mất chính xác ở dải cao và cho ra sort_index KHÁC với giá trị
 * mà trigger SQL tính (số học bigint bên Postgres là chính xác tuyệt đối).
 *
 * BigInt cho kết quả trùng khít với SQL trong mọi trường hợp.
 */
const VOLUME_WEIGHT = 1_000_000_000_000n;
const NUMBER_WEIGHT = 1_000_000n;
const PART_WEIGHT = 1_000n;

/** Giới hạn khớp với các CHECK constraint ở migration 003. */
export const SORT_INDEX_LIMITS = {
  maxNumber: 1_000_000,
  maxVolume: 10_000,
  maxPart: 1_000,
} as const;

export interface SortIndexInput {
  number: number;
  volumeNumber?: number | null;
  partNumber?: number | null;
  isExtra?: boolean;
}

/**
 * Trả về **string** chứ không phải number/bigint.
 *
 * `pg` nhận string cho cột bigint và giữ nguyên độ chính xác. String cũng an
 * toàn khi JSON.stringify (BigInt thì ném TypeError) — quan trọng vì giá trị này
 * đi qua hàm băm nội dung.
 */
export function computeSortIndex(input: SortIndexInput): string {
  const { number, volumeNumber, partNumber, isExtra } = input;

  assertInRange('number', number, 0, SORT_INDEX_LIMITS.maxNumber);
  if (volumeNumber !== null && volumeNumber !== undefined) {
    assertInRange('volumeNumber', volumeNumber, 0, SORT_INDEX_LIMITS.maxVolume);
  }
  if (partNumber !== null && partNumber !== undefined) {
    assertInRange('partNumber', partNumber, 0, SORT_INDEX_LIMITS.maxPart);
  }

  const value =
    BigInt(volumeNumber ?? 0) * VOLUME_WEIGHT +
    BigInt(number) * NUMBER_WEIGHT +
    BigInt(partNumber ?? 0) * PART_WEIGHT +
    (isExtra === true ? 1n : 0n);

  return value.toString();
}

/**
 * Chặn sớm giá trị tràn bậc. Nếu `number` vượt 1e6 nó sẽ cộng lấn sang bậc của
 * volume và làm hỏng thứ tự một cách âm thầm — CHECK constraint ở DB cũng chặn,
 * nhưng chặn ở đây cho thông báo lỗi rõ ràng hơn nhiều.
 */
function assertInRange(field: string, value: number, min: number, maxExclusive: number): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`[sortIndex] ${field} phải là số nguyên, nhận được: ${value}`);
  }
  if (value < min || value >= maxExclusive) {
    throw new RangeError(
      `[sortIndex] ${field} = ${value} nằm ngoài khoảng [${min}, ${maxExclusive}). ` +
        `Vượt khoảng này sẽ làm sort_index tràn sang bậc khác và hỏng thứ tự chương.`,
    );
  }
}
