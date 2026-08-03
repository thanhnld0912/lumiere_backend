import type { CrawlMode, SourceId } from '../../core/types.js';

/**
 * Cấu hình một nguồn — ĐIỂM MỞ RỘNG chính cho "hàng trăm site".
 *
 * Mọi thứ khác nhau giữa các nguồn mà KHÔNG cần code riêng đều nằm ở đây:
 * tốc độ, retry, timeout, mode hỗ trợ. Chỉ khi cấu trúc HTML khác biệt mới cần
 * viết adapter/parser mới.
 */

/**
 * Chính sách lịch sự.
 *
 * Đây không phải tuỳ chọn trang trí: IP của GitHub Actions runner là dùng chung,
 * bị chặn thì không có cách nào tự gỡ. Crawl chậm và có định danh rõ ràng là
 * cách rẻ nhất để không bao giờ rơi vào tình huống đó.
 */
export interface PolitenessConfig {
  /** Crawlee `maxRequestsPerMinute`. */
  readonly maxRequestsPerMinute: number;
  /** Crawlee `maxConcurrency`. */
  readonly maxConcurrency: number;
  /** Khoảng cách tối thiểu giữa hai request tới cùng host. */
  readonly minDelayMs: number;
  readonly respectRobotsTxt: boolean;
}

export interface HttpConfig {
  /** Crawlee `maxRequestRetries` — đã có backoff luỹ thừa sẵn. */
  readonly maxRequestRetries: number;
  readonly requestTimeoutSecs: number;
  /** Chỉ dùng PlaywrightCrawler khi nguồn thực sự cần JavaScript mới render. */
  readonly requiresJavaScript: boolean;
}

export interface SourceConfig {
  readonly id: SourceId;
  readonly name: string;
  readonly baseUrl: string;
  readonly enabled: boolean;

  /** Mode adapter này hỗ trợ. Registry đối chiếu với `supports()` của adapter. */
  readonly modes: readonly CrawlMode[];

  readonly politeness: PolitenessConfig;
  readonly http: HttpConfig;

  /**
   * Ngưỡng cảnh báo trôi selector. Tỉ lệ item parse hỏng vượt mức này thì coi
   * như nguồn đã đổi HTML -> dừng run với SchemaDriftError, thay vì âm thầm ghi
   * đè dữ liệu tốt bằng vài nghìn bản ghi rỗng.
   */
  readonly schemaDriftThreshold: number;

  /** Chỉ áp dụng khi tỉ lệ được tính trên đủ nhiều mẫu — 3 item hỏng không nói lên gì. */
  readonly schemaDriftMinSamples: number;
}
