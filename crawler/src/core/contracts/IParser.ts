/**
 * Parser: DOM của MỘT loại trang -> DTO thô.
 *
 * Ràng buộc nghiêm ngặt: **không network, không database, không side effect.**
 * Parser là hàm thuần trên một chuỗi HTML, nên test được hoàn toàn bằng fixture
 * lưu sẵn — không cần mạng. Đó là hạ tầng test quan trọng nhất của module này:
 * khi nguồn đổi HTML, chỉ cần thay fixture là biết ngay parser nào gãy.
 */
export interface ParseContext {
  /** URL của trang đang parse — cần để resolve link tương đối và để báo lỗi. */
  readonly url: string;
  readonly sourceId: string;
}

export interface IParser<TInput, TOutput> {
  /** Tên dùng trong log và thông báo lỗi. */
  readonly name: string;

  parse(input: TInput, ctx: ParseContext): TOutput;
}

/**
 * Parser trả về nhiều item từ một trang (danh mục, feed latest).
 * Tách riêng khỏi IParser để kiểu trả về nói rõ ý định.
 */
export interface IListParser<TInput, TItem> extends IParser<TInput, readonly TItem[]> {
  /** URL trang kế tiếp, null nếu đã hết. Dùng cho phân trang. */
  nextPageUrl(input: TInput, ctx: ParseContext): string | null;
}
