import { env } from './env.js';
import type { HttpConfig, PolitenessConfig } from './sources/types.js';

/**
 * Mặc định toàn cục. Mỗi nguồn ghi đè phần nào cần thiết trong config riêng.
 *
 * Giá trị lấy từ env để chỉnh được lúc chạy mà không phải sửa code — quan trọng
 * khi cần hạ tốc độ gấp vì nguồn bắt đầu trả 429.
 */
export const DEFAULT_POLITENESS: PolitenessConfig = {
  maxRequestsPerMinute: env.CRAWL_MAX_REQUESTS_PER_MINUTE,
  maxConcurrency: env.CRAWL_MAX_CONCURRENCY,
  minDelayMs: 1_000,
  respectRobotsTxt: true,
};

export const DEFAULT_HTTP: HttpConfig = {
  maxRequestRetries: 3,
  requestTimeoutSecs: 30,
  requiresJavaScript: false,
};

export const crawlerConfig = {
  maxItemsPerRun: env.CRAWL_MAX_ITEMS_PER_RUN,
  dryRun: env.CRAWL_DRY_RUN,
  userAgent: env.CRAWLER_USER_AGENT,

  /** Số novel ghi mỗi lô. Đủ nhỏ để một lô hỏng không mất nhiều việc. */
  importBatchSize: 50,

  /**
   * Mặc định 20% item hỏng là báo động. Đủ rộng để chịu được vài trang lỗi lẻ
   * tẻ, đủ chặt để bắt được thay đổi layout.
   */
  schemaDriftThreshold: 0.2,
  schemaDriftMinSamples: 20,
} as const;
