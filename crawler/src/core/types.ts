/**
 * Kiểu nền tảng, dùng chung cho mọi nguồn.
 *
 * Không có gì trong file này được biết NovelUpdates tồn tại.
 */

/**
 * Định danh nguồn — khớp `sources.slug` ở database.
 * Kiểu string chứ không phải union đóng: thêm nguồn mới không được đụng vào core.
 */
export type SourceId = string;

/**
 * Ba chế độ crawl, tần suất và chi phí khác hẳn nhau.
 *
 *  discover : duyệt trang browse tìm novel MỚI          — chạy tay, tốn kém
 *  refresh  : crawl lại metadata novel ĐÃ BIẾT          — 1 tháng/lần (D4)
 *  latest   : đọc feed latest-releases bắt chương mới   — 6 giờ/lần, rất rẻ
 */
export type CrawlMode = 'discover' | 'refresh' | 'latest';

export const CRAWL_MODES: readonly CrawlMode[] = ['discover', 'refresh', 'latest'] as const;

export function isCrawlMode(value: string): value is CrawlMode {
  return (CRAWL_MODES as readonly string[]).includes(value);
}

/**
 * Trạng thái novel — PHẢI khớp enum `novel_status` ở database.
 * Xem database/migrations/001_status_enum.sql.
 *
 * Cố ý khai báo lại ở đây thay vì import từ ../../src của REST API: crawler là
 * package độc lập, import chéo sẽ phá vỡ sự cô lập đó.
 */
export type NovelStatus = 'Ongoing' | 'Completed' | 'Hiatus' | 'Dropped' | 'Unknown';

export const NOVEL_STATUSES: readonly NovelStatus[] = [
  'Ongoing',
  'Completed',
  'Hiatus',
  'Dropped',
  'Unknown',
] as const;

/**
 * Con trỏ tới một novel ở nguồn ngoài.
 *
 * Đây là đơn vị danh tính mà `discover` sinh ra và `refresh` tiêu thụ. Cặp
 * (sourceId, externalId) khớp thẳng với khoá chính của bảng `novel_sources` —
 * là cách nhận diện CHẮC CHẮN, không phụ thuộc vào việc ta gộp novel thế nào.
 */
export interface NovelRef {
  sourceId: SourceId;
  externalId: string;
  sourceUrl: string;
}

/** Ngữ cảnh truyền xuyên suốt một lần chạy. */
export interface CrawlContext {
  readonly runId: string;
  readonly sourceId: SourceId;
  readonly mode: CrawlMode;
  /** Trần số item xử lý trong lần chạy này (D4). */
  readonly maxItems: number;
  /** Crawl và normalize bình thường nhưng KHÔNG ghi database. */
  readonly dryRun: boolean;
  /** Huỷ giữa chừng — dùng khi CI sắp hết thời gian. */
  readonly signal?: AbortSignal;
  readonly startedAt: Date;

  /**
   * Mốc thời gian phải DỪNG LẤY THÊM việc mới.
   *
   * Không phải là timeout cứng: việc đang làm dở được làm nốt, chỉ không bắt
   * đầu novel tiếp theo. Adapter trả về những gì đã lấy được và importer ghi
   * chúng xuống bình thường.
   *
   * Cần thiết vì adapter lấy HẾT rồi importer mới ghi. Không có hạn chót thì
   * một lần chạy bị GitHub Actions giết vì quá giờ sẽ ghi được ĐÚNG 0 dòng —
   * toàn bộ công sức mạng của lần chạy đó mất trắng, và lần sau lặp lại y hệt.
   *
   * Vắng mặt = không giới hạn (chạy tay ở local).
   */
  readonly deadline?: Date;

  /**
   * Số chương ĐÃ có nội dung trong database, cho một novel của nguồn này.
   *
   * Adapter dùng để BỎ QUA việc tải lại nội dung đã lưu. Thiếu bước này thì trần
   * `contentChaptersPerNovel` luôn cắn vào cùng 50 chương đầu ở mọi lần chạy, và
   * chương 51 trở đi KHÔNG BAO GIỜ có nội dung dù refresh bao nhiêu lần.
   *
   * Là callback chứ không phải dữ liệu: adapter không được biết database tồn
   * tại, và luật "không có SQL trong crawler class" vẫn giữ nguyên. Vắng mặt
   * (dry-run, unit test) thì adapter coi như chưa có gì và tải từ đầu.
   */
  readonly contentCoverage?: (externalId: string) => Promise<ReadonlySet<number>>;
}
