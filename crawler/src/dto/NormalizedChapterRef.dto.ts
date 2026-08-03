/**
 * Một chương ở dạng đã chuẩn hoá — **không có nội dung**.
 *
 * Theo yêu cầu hiện tại, crawler chỉ lấy tới mức "chương này tồn tại", chưa
 * crawl phần text. Điều đó khớp sẵn với trạng thái rỗng
 * "Chapter content not available yet" mà ReaderView đã có.
 *
 * Năm trường của D1 nằm ở đây: raw_chapter_title, display_title, chapter_number,
 * volume_number, is_extra.
 */
export interface NormalizedChapterRef {
  /** Định danh trong phạm vi novel — UNIQUE (novel_id, slug). */
  readonly slug: string;

  /**
   * Chuỗi NGUYÊN TRẠNG từ nguồn, VD 'Vol 5 Chapter 243: Return'.
   * Giữ lại để re-parse khi cải tiến extractor mà không cần crawl lại.
   */
  readonly rawTitle: string | null;

  /** Nhãn trọn vẹn cho nơi cần một chuỗi duy nhất, VD 'Vol 5 Chapter 243: Return'. */
  readonly displayTitle: string;

  /**
   * CHỈ tên riêng của chương, VD 'Return'. Rỗng khi nguồn không đặt tên.
   * Frontend render `Chapter {number}: {title}` nên trường này KHÔNG chứa tiền tố.
   * Không bịa tên: nguồn chỉ cho 'c.243' thì đây là chuỗi rỗng.
   */
  readonly title: string;

  readonly number: number;
  readonly volumeNumber: number | null;
  /** 'c.243.5' hoặc 'c.243 part2' -> 5 / 2. */
  readonly partNumber: number | null;
  readonly isExtra: boolean;

  /**
   * Thứ tự đọc, dạng string vì cột là bigint và giá trị vượt
   * Number.MAX_SAFE_INTEGER ở dải volume cao. Xem utils/sortIndex.ts.
   */
  readonly sortIndex: string;

  readonly publishedAt: Date | null;
  readonly sourceUrl: string | null;
  readonly translationGroupSlug: string | null;
}
